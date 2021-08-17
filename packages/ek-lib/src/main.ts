import { HID } from 'node-hid'

export interface FanData {
  rpm: number
  pwm: number
}
export interface SensorData {
  temps: { [key in TempPort]: number | undefined }
  flow: number
  level: LevelData
}
export interface DeviceInformation {
  sensors: SensorData
  fans: { [key in FanPort]: FanData }
  lights: LightData
}
export interface LightColor {
  red: number
  green: number
  blue: number
}
export interface LightData {
  color: LightColor
  mode: LightMode
  speed: LightSpeed
}

export type LevelData = 'warning' | 'good'
export type FanPort = 'fan1' | 'fan2' | 'fan3' | 'fan4' | 'fan5' | 'fan6'
export type TempPort = 'temp1' | 'temp2' | 'temp3'
export type EkPort = FanPort | 'lights' | 'sensors'
export type LightMode =
  | 'off'
  | 'static'
  | 'breathing'
  | 'fading'
  | 'marquee'
  | 'coveringMarquee'
  | 'pulse'
  | 'spectrumWave'
  | 'alternating'
  | 'candle'
export type LightSpeed =
  | 'slowest'
  | 'slower'
  | 'slow'
  | 'slowish'
  | 'normal'
  | 'fastish'
  | 'fast'
  | 'faster'
  | 'fastest'
type CommMode = 'read' | 'write'

enum LightModeEnum {
  off = 0x00,
  static,
  breathing,
  fading,
  marquee,
  coveringMarquee,
  pulse,
  spectrumWave,
  alternating,
  candle,
}
enum LightSpeedEnum {
  slowest = 0x00,
  slower = 0x0c,
  slow = 0x19,
  slowish = 0x25,
  normal = 0x32,
  fastish = 0xe3,
  fast = 0x4b,
  faster = 0x57,
  fastest = 0x64,
}

const readTimeout = 1000

export function getFanspeed(device: HID, fanPort: FanPort): FanData {
  const packet = createPacket('read', fanPort)
  const recv = sendPacket(device, packet)

  return {
    rpm: parseInt('0x' + recv[12].toString(16) + padLeadingZeros(recv[13].toString(16), 2)),
    pwm: recv[21],
  }
}

export function getLights(device: HID): LightData {
  const packet = createPacket('read', 'lights')
  const recv = sendPacket(device, packet)

  return {
    mode: LightModeEnum[recv[9]] as LightMode,
    speed: LightSpeedEnum[recv[11]] as LightSpeed,
    color: { red: recv[13], green: recv[14], blue: recv[15] },
  }
}

export function getSensors(device: HID): SensorData {
  const packet = createPacket('read', 'sensors')

  packet[9] = 0x20 // offset for checksum? length of answer?

  const recv = sendPacket(device, packet)

  return {
    temps: {
      temp1: recv[11] !== 231 ? recv[11] : undefined,
      temp2: recv[15] !== 231 ? recv[15] : undefined,
      temp3: recv[19] !== 231 ? recv[19] : undefined,
    },
    flow: recv[23],
    level: recv[27] === 100 ? 'good' : 'warning',
  }
}

export function getInformation(device: HID): DeviceInformation {
  return {
    sensors: getSensors(device),
    fans: {
      fan1: getFanspeed(device, 'fan1'),
      fan2: getFanspeed(device, 'fan2'),
      fan3: getFanspeed(device, 'fan3'),
      fan4: getFanspeed(device, 'fan4'),
      fan5: getFanspeed(device, 'fan5'),
      fan6: getFanspeed(device, 'fan6'),
    },
    lights: getLights(device),
  }
}

export function setFanspeed(device: HID, fanPort: FanPort, fanSpeed: number): number[] {
  const packet = createPacket('write', fanPort)

  packet[24] = fanSpeed

  const recv = sendPacket(device, packet) // I don'w know what to expect here

  return recv
}

export function setLightmode(device: HID, LightData: LightData): number[] {
  const packet = createPacket('write', 'lights')

  packet[12] = LightModeEnum[LightData.mode]
  packet[14] = LightSpeedEnum[LightData.speed]
  packet[16] = LightData.color.red
  packet[17] = LightData.color.green
  packet[18] = LightData.color.blue

  const recv = sendPacket(device, packet) // I don'w know what to expect here

  return recv
}

export function padLeadingZeros(s: string, n: number): string {
  let p = s
  while (p.length < n) p = `0${p}`
  return p
}

function createPacket(mode: CommMode, port: EkPort): number[] {
  const packet = new Array<number>(63)

  const packetTemplate = [0x10, 0x12, 0x00, 0xaa, 0x01, 0x00, 0x00, 0x00, 0x00, 0x10, 0x20]
  const portAddress = {
    fan1: [0xa0, 0xa0],
    fan2: [0xa0, 0xc0],
    fan3: [0xa0, 0xe0],
    fan4: [0xa1, 0x00],
    fan5: [0xa1, 0x20],
    fan6: [0xa1, 0xe0],
    sensors: [0xa2, 0x20],
    lights: [0xa2, 0x60],
  }
  const commMode = {
    read: [0x00, 0x00, 0x08, 0x00, 0x00, 0x03],
    write: [0x00, 0x00, 0x29, 0x00, 0x00, 0x10],
  }

  for (let i = 0; i < packet.length; i++) {
    if (i === 2 || i === 5) packet[i] = commMode[mode][i]
    else if (i === 6 || i === 7) packet[i] = portAddress[port][i - 6]
    else if (i < packetTemplate.length) packet[i] = packetTemplate[i]
    else packet[i] = 0
  }

  return packet
}

function sendPacket(device: HID, packet: number[]): number[] {
  // calculate checksum here. Checksum is optional though...
  // anybody got an idea what kind of checksum EKWB is using?

  // workaround for first byte going MIA :shrug:
  packet.unshift(0x00)
  packet.pop()

  device.write(packet)
  const recv = device.readTimeout(readTimeout)
  if (recv.length === 0) throw 'Unable to read response!'

  // check response here
  // since checksums are optional, I doubt checking the response is worth it

  return recv
}
