import HID from 'node-hid'
import yargs from 'yargs/yargs'

import {
  DevicePort,
  getInformation,
  getLights,
  getSensors,
  getFans,
  getFan,
  getFanPwmCurve,
  getFanPwmCurves,
  SensorData,
  LightData,
  DeviceInformation,
  FanData,
  AllFanData,
  AllFanPwmCurveData,
  FanPort,
  LightMode,
  setFan,
  setFans,
  LightSpeed,
  setLights,
  LightColor,
} from '@ek-loop-connect/ek-lib'
import { exit } from 'process'

type DevicePorts = DevicePort | 'fans' | 'all'
type FanPorts = FanPort | 'fans'

const fanPortChoices: ReadonlyArray<FanPorts> = [
  'fan1',
  'fan2',
  'fan3',
  'fan4',
  'fan5',
  'fan6',
  'fans',
]
const lightModeChoices: ReadonlyArray<LightMode> = [
  'off',
  'static',
  'breathing',
  'fading',
  'marquee',
  'coveringMarquee',
  'pulse',
  'spectrumWave',
  'alternating',
  'candle',
]
const lightSpeedChoices: ReadonlyArray<LightSpeed> = [
  'slowest',
  'slower',
  'slow',
  'slowish',
  'normal',
  'fastish',
  'fast',
  'faster',
  'fastest',
]
const devicePortChoices: ReadonlyArray<DevicePorts> = [
  'fan1',
  'fan2',
  'fan3',
  'fan4',
  'fan5',
  'fan6',
  'fans',
  'lights',
  'sensors',
  'all',
]

const device = HID.devices(0x0483, 0x5750).filter((dev) => dev.interface === 0)[0]
if (device === undefined || !device.path) {
  console.error("Couldn't find EK Loop Connect! Is it connected?")
  exit(2)
}
const hiddev = new HID.HID(device.path)

yargs(process.argv.slice(2))
  .scriptName('ek-connect-cli')
  .usage('Usage: $0 <command>')
  .command({
    command: 'get [port]',
    describe: 'Get information from your EK Loop Connect.',
    builder: (args) =>
      args.positional('port', {
        choices: devicePortChoices,
        describe: 'Read a specific port.',
        default: 'all',
      }),
    handler: (argv) => {
      let data: AllFanData | FanData | LightData | SensorData | DeviceInformation
      const port = argv.port as DevicePorts

      if (port === 'all') data = getInformation(hiddev)
      else if (port === 'lights') data = getLights(hiddev)
      else if (port === 'sensors') data = getSensors(hiddev)
      else if (port === 'fans') data = getFans(hiddev)
      else data = getFan(hiddev, port)

      console.log(data)
    },
  })
  .command({
    command: 'get-fancurve [port]',
    describe: 'Get a RPM response curve for a specific fan port.',
    builder: (args) =>
      args.positional('port', {
        choices: fanPortChoices,
        describe: 'The port to read.',
        default: 'fans',
      }),
    handler: async (argv) => {
      let data: AllFanPwmCurveData | FanData[]
      const port = argv.port as FanPorts
      if (port === 'fans') data = await getFanPwmCurves(hiddev)
      else data = await getFanPwmCurve(hiddev, port)
      console.log(JSON.stringify(data, null, 2))
    },
  })
  .command({
    command: 'set-fan [port] [speed]',
    describe: 'Set fan speed on a specific port.',
    builder: (args) =>
      args
        .positional('port', {
          choices: fanPortChoices,
          describe: 'The fan to configure.',
        })
        .positional('speed', {
          type: 'number',
          describe: 'The desired fan speed (PWM duty cycle).',
        }),
    handler: (argv) => {
      let data: FanData | AllFanData
      const port = argv.port as FanPorts
      const speed = argv.speed as number
      if (port === 'fans') {
        setFans(hiddev, speed)
        data = getFans(hiddev)
      } else {
        setFan(hiddev, port, speed)
        data = getFan(hiddev, port)
      }
      console.log(data)
    },
  })
  .command({
    command: 'set-light [mode] [speed] [color]',
    describe: 'Configure RGB lights.',
    builder: (args) =>
      args
        .positional('mode', {
          choices: lightModeChoices,
          describe: 'The pattern.',
          default: 'static',
        })
        .positional('speed', {
          choices: lightSpeedChoices,
          describe: 'The speed.',
          default: 'normal',
        })
        .positional('color', {
          type: 'string',
          describe: 'Color code in hex format.',
          default: '#FFFFFF',
        }),
    handler: (argv) => {
      const mode = argv.mode as LightMode
      const speed = argv.speed as LightSpeed
      const userColor = argv.color as string
      if (!(userColor.length === 7 || userColor.startsWith('#'))) {
        console.log("Couln't set color: wrong format!")
        exit(1)
      }
      const color: LightColor = {
        red: parseInt(userColor.slice(1, 3), 16),
        green: parseInt(userColor.slice(3, 5), 16),
        blue: parseInt(userColor.slice(5, 7), 16),
      }
      setLights(hiddev, { mode, speed, color })
      console.log(getLights(hiddev))
    },
  })
  .alias('h', 'help')
  .alias('v', 'version').argv
