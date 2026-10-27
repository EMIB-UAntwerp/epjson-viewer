export interface EngineAsset {
  file: string
  sha256: string
}

export interface EngineManifest {
  protocol: 1 | 3
  energyPlusVersion: string
  sourceCommit: string
  buildId: string
  capabilities: ['convert']
  invocation?: 'convert-input-format' | 'schema-convert-input-format' | 'schema-parser'
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
  protocol: 1 | 2 | 3
  engines: { modelVersion: string; manifest: string; validation?: string; schema?: EngineAsset & { version: string; sourceCommit: string } }[]
  targetVersion?: string
  upgradeManifest?: string
  transitions?: { fromVersion: string; toVersion: string; manifest: string }[]
}

export interface ConversionProvenance {
  operation: 'convert'
  sourceVersion: string
  schemaVersion: string
  schemaSha256?: string
  schemaSourceCommit: string
  converter: { energyPlusVersion: string; buildId: string; sourceCommit: string }
}

export interface UpgradeProvenance extends Omit<ConversionProvenance, 'operation'> {
  operation: 'upgrade'
  targetVersion: string
  steps: { fromVersion: string; toVersion: string; buildId: string; sourceCommit: string }[]
}

export interface ConversionResult {
  epjson: string
  diagnostics: string[]
  energyPlusVersion: string
  buildId: string
  provenance: ConversionProvenance | UpgradeProvenance
  upgradedIdf?: string
  upgradeTarget?: string
  timings: { phase: string; milliseconds: number }[]
}

export type EngineRequest = {
  protocol: 3
  id: number
  text: string
  assetBaseUrl: string
} & ({ operation: 'convert' } | { operation: 'upgrade'; targetVersion: string })

export type EngineResponse =
  | { protocol: 3; id: number; type: 'progress'; phase: string; pct: number }
  | { protocol: 3; id: number; type: 'done'; result: ConversionResult }
  | { protocol: 3; id: number; type: 'error'; message: string; diagnostics: string[] }
