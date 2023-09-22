import { OLoCo } from '../lib/oloco'
import type { FanProfilePoint, RgbData, SensorData, FanData, LogData } from '../lib/interfaces'
import { Config } from '../config'
import Logger, { ILogHandler, ILogLevel } from 'js-logger'
import { inspect } from 'node:util'
import { exit, platform } from 'node:process'
import {
  AirBalanced,
  AirSilent,
  LiquidBalanced,
  LiquidPerformance,
  LiquidSilent,
  Maximum,
} from '../lib/profiles'
import type {
  AllowedIndexes,
  AppConfig,
  FanProfileCurves,
  FanProfileName,
  FixedSizeArray,
  LogMode,
  LogTarget,
  PartialLogData,
} from '../lib/types'
import { LogLevelEnum } from '../lib/enums'
import exitHook from 'exit-hook'
import { appendFile, rm } from 'node:fs/promises'
import { EOL } from 'node:os'
import { sleepSync } from '../util'
import { resolve } from 'node:path'
import { existsSync, mkdirSync, readdir, stat } from 'node:fs'
import { FanPorts, TemperaturePorts } from '../lib/iterables'

let defaultLogger: ILogHandler
let controller: OLoCo
let oldFan: FixedSizeArray<FanData, 6>
let oldRgb: RgbData
let currentData: PartialLogData
let daemonConfig: AppConfig['daemon']
let currentLogTarget: LogTarget
let logCounter = 0
const fanProfiles: FanProfileCurves = {
  AirSilent,
  AirBalanced,
  LiquidSilent,
  LiquidBalanced,
  LiquidPerformance,
  Maximum,
  Custom: AirBalanced, // overwritten later on
}

export const command = 'daemon'
export const describe = 'Run this tool in daemon mode using custom user Configuration.'

export const handler = async (): Promise<void> => {
  try {
    setupLogger()

    controller = new OLoCo()
    controller.setReadTimeout(Config.get('readTimeout'))
    Logger.info('Successfully connected to controller!')

    oldRgb = controller.getRgb()
    oldFan = controller.getFan<undefined>()

    const interval = setInterval(() => {
      const current = controller.getSensor()

      const sensors = handleSensor(current)
      const fans = handleFan(current)
      const rgb = handleRgb()

      currentData = { fans, rgb, sensors }
      handleLogger(currentData)
    }, Config.get('daemon').interval)

    if (platform !== 'win32') {
      process.on('SIGUSR1', () => {
        console.error(buildMessage([currentData], { level: Logger.INFO }, ', ', 'Text')[0])
      })
    }

    exitHook(() => {
      resetLogCounter(true)
      Logger.info(
        'Daemon terminating, setting all fans and RGB to their configured `backOff`-settings.',
      )
      clearInterval(interval)
      sleepSync(1000)

      controller.setRgb(Config.get('rgb').backOffConfig)

      const fanConfigs = Config.get('fans')
      for (const port of FanPorts.filter((p) => fanConfigs[p].enabled)) {
        const cfg = fanConfigs[port]
        controller.setFan(cfg.backOffSpeed, port)
      }
    })
  } catch (error) {
    if (error instanceof Error) Logger.error(error.message)
    exit(1)
  }
}

function findLessOrEqual(curve: FanProfilePoint[], find: number) {
  const maximum = curve.reduce(
    (max, current) =>
      current.temp < find && current.temp - find > max - find ? current.temp : max,
    0,
  )
  return curve.find((value) => value.temp === maximum)
}

function findGreater(curve: FanProfilePoint[], find: number) {
  const minimum = curve.reduce(
    (min, current) =>
      current.temp > find && current.temp + find < min + find ? current.temp : min,
    100,
  )
  return curve.find((value) => value.temp === minimum)
}

function interpolate(x: number, x1: number, x2: number, y1: number, y2: number) {
  return Math.round(y1 + ((y2 - y1) * (x - x1)) / (x2 - x1))
}

function equalRgb(rgb1: RgbData, rgb2: RgbData): boolean {
  return (
    rgb1.mode === rgb2.mode &&
    rgb1.speed === rgb2.speed &&
    rgb1.color.red === rgb2.color.red &&
    rgb1.color.green === rgb2.color.green &&
    rgb1.color.blue === rgb2.color.blue
  )
}

function handleSensor(sensor: SensorData): PartialLogData['sensors'] {
  const temperatureConfigs = Config.get('temps')
  const resultTemps: LogData['sensors']['temps'] = TemperaturePorts.filter(
    (t) => temperatureConfigs[t].enabled,
  ).map((port) => {
    const temperatureConfig = temperatureConfigs[port]
    const { name, warning, offset } = temperatureConfig
    let temperature = sensor.temps.find((t) => t.port === port)?.temp

    if (temperature) {
      temperature += offset
      if (temperature > warning)
        Logger.warn(`${name || port} is above warning temperature: ${temperature} > ${warning} °C!`)
    } else {
      Logger.warn(`Couldn't read temperature ${name}!`)
    }

    return { port, name, temp: temperature }
  })

  const flowConfig = Config.get('flow')
  let resultFlow: LogData['sensors']['flow'] | undefined = undefined
  if (flowConfig.enabled) {
    const { name, warning, signalsPerLiter } = flowConfig
    const { port } = sensor.flow
    const flow = (sensor.flow.flow * signalsPerLiter) / 100

    if (flow < warning)
      Logger.warn(`${name || port} is below warning flow: ${flow} < ${warning} l/h!`)

    resultFlow = { port, name, flow }
  }

  const levelConfig = Config.get('level')
  let resultLevel: LogData['sensors']['level'] | undefined = undefined
  if (levelConfig.enabled) {
    const { name, warning } = levelConfig
    const { port, level } = sensor.level

    if (warning && level === 'Warning') Logger.warn(`${name || port} is below warning level!`)

    resultLevel = { port, name, level }
  }

  return { temps: resultTemps, flow: resultFlow, level: resultLevel }
}

function handleRgb(): PartialLogData['rgb'] {
  const newRgb = Config.get('rgb')

  if (!newRgb.enabled) newRgb.mode = 'Off'

  if (!equalRgb(newRgb, oldRgb)) {
    controller.setRgb(newRgb)
    oldRgb = newRgb
  }
  return { ...newRgb, port: 'Lx' }
}

function handleFan(sensor: SensorData): PartialLogData['fans'] {
  const fanConfigs = Config.get('fans')
  return FanPorts.filter((port) => fanConfigs[port].enabled).map((port) => {
    const { name, warning, tempMode, activeProfile, customProfile, tempSources } = fanConfigs[port]
    const customProfileCurve = Config.get('profiles')[customProfile]
    const rpm = controller.getFan(port)[0].rpm
    const logName = name || port

    if (rpm < warning) Logger.warn(`${logName} is below warning speed: ${rpm} < ${warning} RPM!`)

    if (activeProfile === 'Custom' && !customProfileCurve) {
      Logger.warn(`Custom profile "${customProfile}" not found, falling back to "AirBalanced".`)
      fanProfiles.Custom = AirBalanced
    } else {
      // we only care about customProfileCurve if we actually use it
      fanProfiles.Custom = customProfileCurve as FanProfilePoint[]
    }

    const temperatures = tempSources
      .map((source) => {
        const currentSensor = sensor.temps.find((s) => s.port === source)
        if (!currentSensor || !currentSensor.temp) {
          Logger.warn(`Couldn't read temperature sensor: ${inspect(currentSensor)}`)
          return
        }
        return currentSensor.temp + Config.get('temps')[currentSensor.port].offset
      })
      .filter((t) => isNumber(t)) as number[]

    if (temperatures.length === 0) {
      Logger.warn(`No valid temperature sources found for ${logName}, assuming 100°C`)
      temperatures.push(100)
    }

    const controlTemperature =
      tempMode === 'Average' ? average(...temperatures) : Math.max(...temperatures)

    const curve = fanProfiles[activeProfile]
    const { lower, higher } = checkPoints(
      activeProfile,
      findLessOrEqual(curve, controlTemperature),
      findGreater(curve, controlTemperature),
    )
    const pwm = interpolate(controlTemperature, lower.temp, higher.temp, lower.pwm, higher.pwm)

    const fanIndex = oldFan.findIndex((f) => f.port === port) as AllowedIndexes<typeof oldFan>
    if (oldFan[fanIndex].pwm !== pwm) {
      controller.setFan(pwm, port)
      oldFan[fanIndex].pwm = pwm
    }

    return { port, name, pwm, rpm }
  })
}

function isNumber(n: unknown): n is number {
  return typeof n === 'number'
}

function handleLogger(data: PartialLogData) {
  setupLogger()
  Logger.info(data)
  logCounter++
}

function setupLogger() {
  daemonConfig = Config.get('daemon')

  if (!defaultLogger) {
    Logger.useDefaults()
    defaultLogger = Logger.createDefaultHandler()
  }

  const level = Logger[LogLevelEnum[daemonConfig.logLevel]]
  if (Logger.getLevel() !== level) Logger.setLevel(level)

  if (currentLogTarget !== daemonConfig.logTarget) {
    switch (daemonConfig.logTarget) {
      case 'None': {
        Logger.setHandler(() => {
          // log nothing
        })
        break
      }

      case 'Console': {
        Logger.setHandler((message, context) => {
          if (shouldLog(context.level)) {
            defaultLogger(buildMessage(message, context), context)
            resetLogCounter()
          }
        })
        break
      }

      case 'File': {
        Logger.setHandler((message, context) => {
          const file = resolve(daemonConfig.logDirectory, getLogFilename())
          prepareLogDirectory()
          if (shouldLog(context.level)) {
            appendFile(file, `${buildMessage(message, context)}${EOL}`)
            resetLogCounter()
          }
        })
        break
      }
    }
    currentLogTarget = daemonConfig.logTarget
  }
}

function resetLogCounter(force = false) {
  if (force || logCounter % daemonConfig.logThreshold === 0) logCounter = 0
}

function getLogFilename() {
  const today = new Date()
  const year = today.getFullYear()
  const month = (today.getMonth() + 1).toString().padStart(2, '0')
  const day = today.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}.log`
}

function prepareLogDirectory() {
  const { logDirectory, logFileRetentionDays } = daemonConfig

  if (!existsSync(logDirectory)) {
    mkdirSync(logDirectory)
    return
  }

  if (logFileRetentionDays < 0) return

  readdir(logDirectory, (readdirError, entries) => {
    if (readdirError) console.error(readdirError)

    const before = new Date()
    before.setDate(before.getDate() - logFileRetentionDays)
    before.setMilliseconds(0)
    before.setSeconds(0)
    before.setMinutes(0)
    before.setHours(1)
    const rmTime = before.getTime()

    for (const entry of entries) {
      const path = resolve(logDirectory, entry)
      stat(path, (statError, stats) => {
        if (statError) console.error(statError)
        if (stats.isFile() && stats.ctime.getTime() < rmTime) rm(path)
      })
    }
  })
}

function shouldLog(level: ILogLevel) {
  return (
    logCounter === -1 ||
    logCounter % daemonConfig.logThreshold === 0 ||
    level === Logger.WARN ||
    level === Logger.ERROR
  )
}

function buildMessage(
  msgs: Parameters<ILogHandler>[0],
  context: Parameters<ILogHandler>[1],
  delimiterOverride?: string,
  modeOverride?: LogMode,
) {
  const logDelimiter = delimiterOverride || Config.get('daemon').logDelimiter
  const logMode = modeOverride || Config.get('daemon').logMode
  const data = Object.values(msgs)

  const message = {
    timestamp: getTimestamp(),
    level: context.level.name,
    messages: [] as string[],
  }

  switch (logMode) {
    case 'JSON': {
      message.messages = data
      return [JSON.stringify(message)]
    }
    case 'Text': {
      message.messages.push(
        ...data.flatMap((d) =>
          typeof d === 'string' ? [d] : buildMessageFromControllerData(d as PartialLogData),
        ),
      )
      return [`[${message.timestamp} ${message.level[0]}] ${message.messages.join(logDelimiter)}`]
    }
  }
}

function buildMessageFromControllerData(data: PartialLogData) {
  const txtMessage: string[] = []
  const { sensors, fans, rgb } = data

  // Names are optional, ports are always there

  if (sensors) {
    if (sensors.temps) {
      for (const t of sensors.temps) {
        const { name, port, temp } = t
        txtMessage.push(`${name || port}: ${temp} °C`)
      }
    }

    if (sensors.flow) {
      const { name, port, flow } = sensors.flow
      txtMessage.push(`${name || port}: ${flow} l/h`)
    }

    if (sensors.level) {
      const { name, port, level } = sensors.level
      txtMessage.push(`${name || port}: ${level}`)
    }
  }

  if (fans) {
    for (const f of fans) {
      const { name, port, rpm } = f
      txtMessage.push(`${name || port}: ${rpm} RPM`)
    }
  }

  if (rgb) {
    const { name, port, color, mode, speed } = rgb
    const modeInfo = mode === 'Off' ? `` : `/${speed}/${color?.red},${color?.green},${color?.blue}`
    txtMessage.push(`${name || port}: ${mode}${modeInfo}`)
  }

  return txtMessage
}

function getTimestamp() {
  switch (Config.get('daemon').timestampFormat) {
    case 'ISO': {
      return new Date().toISOString()
    }
    case 'UNIX': {
      return Date.now().toString()
    }
    case 'UTC': {
      return new Date().toUTCString()
    }
  }
}

function average(...values: number[]): number {
  return values.reduce((x, s) => s + x, 0) / values.length
}

function checkPoints(
  profile: FanProfileName,
  lower?: FanProfilePoint,
  higher?: FanProfilePoint,
): { lower: FanProfilePoint; higher: FanProfilePoint } {
  if (!lower || !higher) {
    const max = { pwm: 100, temp: 100 }
    Logger.warn(`Fan profile ${profile} incomplete or broken, using max values!`)
    return { lower: max, higher: max }
  }
  return { lower, higher }
}
