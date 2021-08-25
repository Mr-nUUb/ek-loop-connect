import { Argv, Arguments } from 'yargs'
import fanSilent from '../res/silent.json'
import fanBalanced from '../res/balanced.json'
import fanMax from '../res/max.json'
import {
  FanPort,
  getFan,
  getSensors,
  setFan,
  setLights,
  sleep,
  TempPort,
} from '@ek-loop-connect/ek-lib'
import {
  fanProfileChoices,
  FanProfileCurves,
  FanProfileName,
  FanProfilePoint,
  openController,
} from '../common'
import { exit } from 'process'
import fs from 'fs'
import { configFilePath, UserConfig } from '../userconfig'

export const command = 'daemon <profile>'
export const describe = 'Run this tool in daemon mode using custom user configuration.'

export const builder = (yargs: Argv): Argv =>
  yargs.positional('profile', {
    choices: fanProfileChoices,
    describe: 'The fan profile to use.',
  })

export const handler = async (yargs: Arguments): Promise<void> => {
  const profile = yargs.profile as FanProfileName

  if (!fs.existsSync(configFilePath)) {
    console.log(`Config file "${configFilePath}" does not exist, please create first!`)
    exit(2)
  }
  const userConfig: UserConfig = JSON.parse(fs.readFileSync(configFilePath).toString())
  console.log('Successfully loaded user config!')

  const device = openController()
  console.log('Successfully connected to controller!')

  setLights(device, userConfig.lights)

  while (device) {
    console.time()
    const current = getSensors(device)

    tempportIterable.forEach((port) => {
      if (userConfig.sensors.temps[port].enabled) {
        const name = userConfig.sensors.temps[port].name
        let temp = current.temps[port]
        const warn = userConfig.sensors.temps[port].warning
        if (!temp) {
          console.error("Couldn't read current temperature!")
          device.close()
          exit(2)
        }
        temp += userConfig.sensors.temps[port].offset
        if (temp > userConfig.sensors.temps[port].warning) {
          console.warn(`WARN - Temp ${name} is above warning temperature: ${temp} > ${warn} °C!`)
        } else {
          console.log(`Temp ${name}: ${temp} °C`)
        }
      }
    })

    if (userConfig.sensors.flow.enabled) {
      const name = userConfig.sensors.flow.name
      const flow = (current.flow * userConfig.sensors.flow.signalsPerLiter) / 100
      const warn = userConfig.sensors.flow.warning
      if (flow < warn) {
        console.warn(`WARN - Sensor ${name} is below warning flow: ${flow} < ${warn} l/h!`)
      } else {
        console.log(`Sensor ${name}: ${flow} l/h`)
      }
    }

    if (userConfig.sensors.level.enabled) {
      const name = userConfig.sensors.level.name
      const level = current.level
      const warn = userConfig.sensors.level.warning
      if (warn && level === 'warning') {
        console.warn(`WARN - Sensor ${name} is below warning level!`)
      } else {
        console.log(`Sensor ${name}: ${level}`)
      }
    }

    fanportIterable.forEach((port) => {
      if (userConfig.fans[port].enabled) {
        const name = userConfig.fans[port].name
        const currentSpeed = getFan(device, port).rpm
        const warn = userConfig.fans[port].warning
        if (currentSpeed < warn) {
          console.warn(`Fan ${name} is below warning speed: ${currentSpeed} < ${warn} RPM!`)
        }
        const fanProfiles: FanProfileCurves = {
          profiles: {
            silent: fanSilent,
            balanced: fanBalanced,
            max: fanMax,
            custom: userConfig.fans[port].customProfile,
          },
        }
        let currentTemp = current.temps[userConfig.fans[port].tempSource]
        if (!currentTemp) {
          console.error("Couldn't read current temperature!")
          device.close()
          exit(2)
        }
        currentTemp += userConfig.sensors.temps[userConfig.fans[port].tempSource].offset
        const curve = fanProfiles.profiles[profile]
        const index = nextLowerPoint(curve, currentTemp)
        const lower = curve[index]
        const higher = curve[index + 1]
        const speed = interpolate(currentTemp, lower.x, higher.x, lower.y, higher.y)

        console.info(
          `Fan ${userConfig.fans[port].name}; ` +
            `Current RPM: ${currentSpeed}; ` +
            `Profile: ${profile}; ` +
            `Temperature: ${currentTemp}; ` +
            `New PWM: ${speed}; `,
        )
        setFan(device, port, speed)
      }
    })
    console.timeEnd()
    await sleep(1000)
  }
}

function nextLowerPoint(curve: FanProfilePoint[], find: number): number {
  let max = 0
  curve.forEach((value) => {
    if (value.x < find && value.x - find > max - find) max = value.x
  })
  return curve.findIndex((val) => val.x === max)
}

function interpolate(x: number, x1: number, x2: number, y1: number, y2: number): number {
  return Math.round(y1 + ((y2 - y1) * (x - x1)) / (x2 - x1))
}

const fanportIterable: ReadonlyArray<FanPort> = ['fan1', 'fan2', 'fan3', 'fan4', 'fan5', 'fan6']
const tempportIterable: ReadonlyArray<TempPort> = ['temp1', 'temp2', 'temp3']
