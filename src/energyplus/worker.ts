import { modelVersion, versionFamily, upgradePath } from './registry'
import type { EngineAsset, EngineManifest, EngineRegistry, EngineRequest, EngineResponse, TransitionManifest, ConversionProvenance, UpgradeProvenance } from './types'

interface NativeModule {
  FS: {
    writeFile(path: string, text: string | Uint8Array): void
    readFile(path: string, options: { encoding: 'utf8' }): string
    readdir(path: string): string[]
    mkdir(path: string): void
    chdir(path: string): void
  }
  callMain(args: string[]): number
}

type ModuleFactory = (options: {
  noInitialRun: boolean
  wasmBinary: ArrayBuffer
  print: (line: string) => void
  printErr: (line: string) => void
}) => Promise<NativeModule>

const post = (message: EngineResponse): void => self.postMessage(message)

function assetUrl(path: string, base: string): string {
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error('Invalid EnergyPlus asset path.')
  }
  return new URL(path, base).href
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('The EnergyPlus converter is unavailable on this deployment. Please retry after the engine assets are installed.')
  try {
    return await response.json()
  } catch {
    throw new Error('The EnergyPlus converter assets are missing or invalid on this deployment.')
  }
}

async function verifiedAsset(asset: EngineAsset, base: string, timings: { phase: string; milliseconds: number }[]): Promise<ArrayBuffer> {
  if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid EnergyPlus asset checksum.')
  const started = performance.now()
  const response = await fetch(assetUrl(asset.file, base))
  if (!response.ok) throw new Error(`Could not download the EnergyPlus converter (${response.status}). Please retry.`)
  const bytes = await response.arrayBuffer()
  const fetched = performance.now()
  timings.push({ phase: `parallel asset fetch: ${asset.file}`, milliseconds: fetched - started })
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  timings.push({ phase: `parallel asset verification: ${asset.file}`, milliseconds: performance.now() - fetched })
  if (hash !== asset.sha256) throw new Error('EnergyPlus asset verification failed. Reload the page and retry.')
  return bytes
}

function invoke(runtime: NativeModule, args: string[]): number {
  try { return runtime.callMain(args) ?? 0 } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ExitStatus' && 'status' in error) return Number(error.status)
    throw error
  }
}

self.onmessage = async (event: MessageEvent<EngineRequest>) => {
  const request = event.data
  const { id } = request
  const diagnostics: string[] = []
  const timings: { phase: string; milliseconds: number }[] = []
  const started = performance.now()
  let phaseStart = started
  let lastPhase = 'setup'
  const mark = (phase: string): void => {
    const now = performance.now()
    timings.push({ phase: lastPhase, milliseconds: now - phaseStart })
    phaseStart = now
    lastPhase = phase
  }
  let logSize = 0
  let omittedDiagnostics = false
  const log = (line: string): void => {
    // Keep recent failures visible even after a long chain fills the log budget.
    const bounded = String(line).slice(0, 2000)
    diagnostics.push(bounded)
    logSize += bounded.length
    while (diagnostics.length > 79 || logSize > 48_000) {
      logSize -= diagnostics.shift()!.length
      omittedDiagnostics = true
    }
  }
  const retainedDiagnostics = (): string[] => omittedDiagnostics ? ['Earlier EnergyPlus diagnostics omitted.', ...diagnostics] : diagnostics
  const progress = (phase: string, pct: number): void => post({ protocol: 3, id, type: 'progress', phase, pct })
  try {
    if (request.protocol !== 3 || !['convert', 'upgrade'].includes(request.operation)) throw new Error('Unsupported EnergyPlus operation.')
    progress('Checking IDF version', 5)
    mark('version detection')
    const version = modelVersion(request.text)
    mark('registry and manifest')
    const registry = await readJson(new URL('registry.json', request.assetBaseUrl).href) as EngineRegistry
    if (!registry || ![1, 2, 3].includes(registry.protocol) || !Array.isArray(registry.engines)) throw new Error('Unsupported EnergyPlus registry format.')
    if (!registry.engines.length) throw new Error('IDF conversion is not installed on this deployment yet. You can still open an epJSON file.')
    const targetVersion = request.operation === 'upgrade' ? request.targetVersion : version
    const path = request.operation === 'upgrade' && targetVersion === registry.targetVersion ? upgradePath(registry, version, targetVersion) : null
    if (request.operation === 'upgrade' && !path) throw new Error(`No validated EnergyPlus upgrade path from ${version} to ${targetVersion} is installed.`)
    const entries = registry.engines.filter((engine) => engine.modelVersion === targetVersion)
    if (entries.length > 1) throw new Error('Ambiguous EnergyPlus schema registry.')
    // Legacy entries cover only their declared release, never arbitrary patches.
    let entry = entries[0] ?? (registry.protocol < 3 ? registry.engines.find((engine) => engine.modelVersion === versionFamily(targetVersion)) : undefined)
    if (!entry) {
      const supported = registry.engines.map((engine) => engine.modelVersion).join(', ') || 'none installed'
      throw new Error(`IDF version ${version} is not supported by this converter. Supported versions: ${supported}. Convert with the matching EnergyPlus release or upgrade the IDF first.`)
    }
    if (request.operation === 'upgrade' && registry.upgradeManifest) entry = { modelVersion: targetVersion, manifest: registry.upgradeManifest }
    const manifestUrl = assetUrl(entry.manifest, request.assetBaseUrl)
    const manifest = await readJson(manifestUrl) as EngineManifest
    const schemaVersion = entry.schema?.version ?? manifest?.energyPlusVersion
    if (!manifest || ![1, 3].includes(manifest.protocol) || typeof manifest.energyPlusVersion !== 'string' || !manifest.capabilities?.includes('convert') ||
        typeof manifest.buildId !== 'string' || typeof manifest.sourceCommit !== 'string' ||
        (manifest.protocol === 3 ? !['schema-convert-input-format', 'schema-parser'].includes(manifest.invocation ?? '') || !entry.schema :
          manifest.invocation !== undefined && manifest.invocation !== 'convert-input-format') ||
        versionFamily(schemaVersion) !== versionFamily(targetVersion) ||
        (targetVersion.split('.').length === 3 && schemaVersion !== targetVersion)) {
      throw new Error('The EnergyPlus schema and model versions do not match.')
    }
    let input = request.text
    const conversion: ConversionProvenance = {
      operation: 'convert', sourceVersion: version, schemaVersion,
      schemaSha256: entry.schema?.sha256, schemaSourceCommit: entry.schema?.sourceCommit ?? manifest.sourceCommit,
      converter: { energyPlusVersion: manifest.energyPlusVersion, buildId: manifest.buildId, sourceCommit: manifest.sourceCommit },
    }
    const provenance: ConversionProvenance | UpgradeProvenance = request.operation === 'upgrade'
      ? { ...conversion, operation: 'upgrade', targetVersion, steps: [] } : conversion
    if (path && provenance.operation === 'upgrade') {
      for (const [index, edge] of path.entries()) {
        mark(`transition ${edge.fromVersion} → ${edge.toVersion}`)
        const label = `Upgrading EnergyPlus ${edge.fromVersion} → ${edge.toVersion}`
        progress(label, 5 + 25 * index / path.length)
        log(label)
        try {
          const url = assetUrl(edge.manifest, request.assetBaseUrl)
          const step = await readJson(url) as TransitionManifest
          if (step.protocol !== 2 || step.capabilities?.[0] !== 'transition' || step.fromVersion !== edge.fromVersion ||
              step.toVersion !== edge.toVersion || step.invocation !== 'input.idf' || step.output !== 'input.idfnew' ||
              !step.buildId || !step.sourceCommit || !Array.isArray(step.support)) throw new Error('Invalid transition manifest.')
          const base = new URL('.', url).href
          const [, wasmBinary, ...support] = await Promise.all([
            verifiedAsset(step.loader, base, timings), verifiedAsset(step.wasm, base, timings), ...step.support.map((asset) => verifiedAsset(asset, base, timings)),
          ])
          const module = await import(/* @vite-ignore */ assetUrl(step.loader.file, base)) as { default: ModuleFactory }
          const runtime = await module.default({ noInitialRun: true, wasmBinary: wasmBinary!, print: log, printErr: log })
          runtime.FS.mkdir('/job')
          runtime.FS.chdir('/job')
          const names = new Set<string>()
          for (const [i, asset] of step.support.entries()) {
            if (!/^[a-zA-Z0-9 +_.-]+$/.test(asset.name) || asset.name === 'input.idf' || names.has(asset.name)) throw new Error('Invalid transition support filename.')
            names.add(asset.name)
            runtime.FS.writeFile(asset.name, new Uint8Array(support[i]!))
          }
          runtime.FS.writeFile('input.idf', input)
          const exit = invoke(runtime, ['input.idf'])
          for (const name of runtime.FS.readdir('/job').filter((name) => /(?:\.audit|\.vcperr)$/i.test(name))) {
            for (const line of runtime.FS.readFile(name, { encoding: 'utf8' }).split('\n')) log(line)
          }
          if (exit !== 0) throw new Error(`Native transition exited with status ${exit}.`)
          if (!runtime.FS.readdir('/job').includes(step.output)) throw new Error('Native transition produced no upgraded IDF.')
          input = runtime.FS.readFile(step.output, { encoding: 'utf8' })
          if (versionFamily(modelVersion(input)) !== edge.toVersion) throw new Error('Native transition returned an unexpected Version.')
          provenance.steps.push({ fromVersion: edge.fromVersion, toVersion: edge.toVersion, buildId: step.buildId, sourceCommit: step.sourceCommit })
        } catch (error) {
          throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    mark('converter assets and verification')
    progress(`Loading EnergyPlus ${manifest.energyPlusVersion}`, 32)
    const base = new URL('.', manifestUrl).href
    const [, wasmBinary, schemaBytes] = await Promise.all([
      verifiedAsset(manifest.loader, base, timings), verifiedAsset(manifest.wasm, base, timings),
      entry.schema ? verifiedAsset(entry.schema, request.assetBaseUrl, timings) : Promise.resolve(undefined),
    ])
    // Keep Emscripten's import.meta.url relative to its immutable artifact,
    // rather than a blob URL that cannot resolve its runtime resources.
    const loaderUrl = assetUrl(manifest.loader.file, base)
    const module = await import(/* @vite-ignore */ loaderUrl) as { default: ModuleFactory }
    mark('WASM initialization')
    const runtime = await module.default({ noInitialRun: true, wasmBinary, print: log, printErr: log })
    mark('conversion and output reading')
    progress('Converting IDF to epJSON', 35)
    runtime.FS.mkdir('/job')
    runtime.FS.chdir('/job')
    runtime.FS.writeFile('input.idf', input)
    if (schemaBytes) runtime.FS.writeFile('/job/schema.json', new Uint8Array(schemaBytes))
    // The standalone format utility preserves HVAC templates; the engine CLI rejects them.
    const exitCode = invoke(runtime, manifest.invocation === 'schema-parser'
      ? ['/job/schema.json', '/job/input.idf', '/job/input.epJSON']
      : manifest.invocation === 'schema-convert-input-format'
      ? ['--schema', '/job/schema.json', '--format', 'epjson', '--output', '/job/', '/job/input.idf']
      : manifest.invocation === 'convert-input-format'
      ? ['--format', 'epjson', '--output', '/job/', '/job/input.idf']
      : ['--convert-only', '-d', '/job/', '/job/input.idf'])
    for (const name of runtime.FS.readdir('/job').filter((name) => name.endsWith('.err'))) {
      for (const line of runtime.FS.readFile(`/job/${name}`, { encoding: 'utf8' }).split('\n')) log(line)
    }
    if (exitCode !== 0) throw new Error(`EnergyPlus could not convert this IDF (exit ${exitCode}). See the conversion diagnostics.`)
    const outputs = runtime.FS.readdir('/job').filter((name) => name.toLowerCase().endsWith('.epjson'))
    if (outputs.length !== 1) throw new Error('EnergyPlus did not produce an epJSON file. See the conversion diagnostics.')
    const epjson = runtime.FS.readFile(`/job/${outputs[0]}`, { encoding: 'utf8' })
    mark('output JSON parsing')
    const parsed: unknown = JSON.parse(epjson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('EnergyPlus returned an invalid epJSON document.')
    mark('delivery')
    timings.push({ phase: 'total', milliseconds: performance.now() - started })
    post({ protocol: 3, id, type: 'done', result: {
      epjson, diagnostics: retainedDiagnostics(), provenance, upgradedIdf: provenance.operation === 'upgrade' ? input : undefined, energyPlusVersion: schemaVersion, buildId: manifest.buildId,
      upgradeTarget: registry.targetVersion && registry.engines.some((engine) => engine.modelVersion === registry.targetVersion) && upgradePath(registry, version, registry.targetVersion) ? registry.targetVersion : undefined,
      timings,
    } })
  } catch (error) {
    post({ protocol: 3, id, type: 'error', message: error instanceof Error ? error.message : String(error), diagnostics: retainedDiagnostics() })
  }
}
