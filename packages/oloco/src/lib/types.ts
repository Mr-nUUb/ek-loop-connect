export type FanProfileName =
  | 'air_silent'
  | 'air_balanced'
  | 'liquid_silent'
  | 'liquid_balanced'
  | 'liquid_performance'
  | 'max'
  | 'custom'

export type LogTarget = 'terminal'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LevelData = 'warning' | 'good'

export type FanPort = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6'

export type TempPort = 'T1' | 'T2' | 'T3'

export type DevicePort = FanPort | 'RGB' | 'Sensor'

export type RgbMode =
  | 'Off'
  | 'Static'
  | 'Breathing'
  | 'Fading'
  | 'Marquee'
  | 'CoveringMarquee'
  | 'Pulse'
  | 'SpectrumWave'
  | 'Alternating'
  | 'Candle'

export type RgbSpeed =
  | 'Slowest'
  | 'Slower'
  | 'Slow'
  | 'Slowish'
  | 'Normal'
  | 'Fastish'
  | 'Fast'
  | 'Faster'
  | 'Fastest'
