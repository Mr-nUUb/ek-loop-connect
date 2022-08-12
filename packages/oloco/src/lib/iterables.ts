import type { FanPort, FanProfileName, RgbMode, RgbSpeed, TempPort } from './types'

export const FanPorts: ReadonlyArray<FanPort> = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']

export const TempPorts: ReadonlyArray<TempPort> = ['T1', 'T2', 'T3']

export const RgbModes: ReadonlyArray<RgbMode> = [
  'Off',
  'Static',
  'Breathing',
  'Fading',
  'Marquee',
  'CoveringMarquee',
  'Pulse',
  'SpectrumWave',
  'Alternating',
  'Candle',
]

export const RgbSpeeds: ReadonlyArray<RgbSpeed> = [
  'Slowest',
  'Slower',
  'Slow',
  'Slowish',
  'Normal',
  'Fastish',
  'Fast',
  'Faster',
  'Fastest',
]

export const FanProfiles: ReadonlyArray<FanProfileName> = [
  'air_silent',
  'air_balanced',
  'liquid_silent',
  'liquid_balanced',
  'liquid_performance',
  'max',
  'custom',
]
