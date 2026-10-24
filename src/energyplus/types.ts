export interface EngineAsset {
  file: string
  sha256: string
}

export interface EngineManifest {
  protocol: 1
  energyPlusVersion: string
  sourceCommit: string
  buildId: string
  capabilities: ['convert']
  loader: EngineAsset
  wasm: EngineAsset
}

export interface TransitionManifest {
  protocol: 2
  capabilities: ['transition']
  fromVersion: string
  toVersion: string
  sourceCommit: string
  buildId: string
  loader: EngineAsset
  wasm: EngineAsset
  support: (EngineAsset & { name: string })[]
  invocation: 'input.idf'
  output: 'input.idfnew'
}

export interface EngineRegistry {
  protocol: 1 | 2
  engines: { modelVersion: string; manifest: string }[]
  targetVersion?: string
  transitions?: { fromVersion: string; toVersion: string; manifest: string }[]
}

export interface UpgradeProvenance {
  sourceVersion: string
  targetVersion: string
  converter: { energyPlusVersion: string; buildId: string; sourceCommit: string }
  steps: { fromVersion: string; toVersion: string; buildId: string; sourceCommit: string }[]
}

export interface ConversionResult {
  epjson: string
  diagnostics: string[]
  energyPlusVersion: string
  buildId: string
  provenance: UpgradeProvenance
  upgradedIdf?: string
}

export interface EngineRequest {
  protocol: 2
  id: number
  operation: 'convert'
  text: string
  assetBaseUrl: string
}

export type EngineResponse =
  | { protocol: 2; id: number; type: 'progress'; phase: string; pct: number }
  | { protocol: 2; id: number; type: 'done'; result: ConversionResult }
  | { protocol: 2; id: number; type: 'error'; message: string; diagnostics: string[] }
