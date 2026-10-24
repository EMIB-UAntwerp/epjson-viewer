import type { EngineAsset, EngineManifest, EngineRegistry, EngineRequest, EngineResponse, TransitionManifest, UpgradeProvenance } from './types'

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

// Only identify Version here. All object interpretation remains with EnergyPlus.
function modelVersion(text: string): string {
  const matches = [...text.replace(/!.*$/gm, '').matchAll(/(?:^|(?<=;))\s*Version\s*,\s*(\d+)\.(\d+)(?:\.\d+)?\s*;/gi)]
  if (matches.length !== 1) throw new Error('The IDF must declare exactly one Version object before it can be converted.')
  return `${Number(matches[0][1])}.${Number(matches[0][2])}`
}

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

async function verifiedAsset(asset: EngineAsset, base: string): Promise<ArrayBuffer> {
  if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid EnergyPlus asset checksum.')
  const response = await fetch(assetUrl(asset.file, base))
  if (!response.ok) throw new Error(`Could not download the EnergyPlus converter (${response.status}). Please retry.`)
  const bytes = await response.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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
  const progress = (phase: string, pct: number): void => post({ protocol: 2, id, type: 'progress', phase, pct })
  try {
    if (request.protocol !== 2 || request.operation !== 'convert') throw new Error('Unsupported EnergyPlus operation.')
    progress('Checking IDF version', 5)
    const version = modelVersion(request.text)
    const registry = await readJson(new URL('registry.json', request.assetBaseUrl).href) as EngineRegistry
    if (!registry || ![1, 2].includes(registry.protocol) || !Array.isArray(registry.engines)) throw new Error('Unsupported EnergyPlus registry format.')
    if (!registry.engines.length) throw new Error('IDF conversion is not installed on this deployment yet. You can still open an epJSON file.')
    const targetVersion = registry.protocol === 2 ? registry.targetVersion : version
    if (!targetVersion || !/^\d+\.\d+$/.test(targetVersion)) throw new Error('Invalid EnergyPlus target version.')
    const entry = registry.engines.find((engine) => engine.modelVersion === targetVersion)
    if (!entry) {
      const supported = registry.engines.map((engine) => engine.modelVersion).join(', ') || 'none installed'
      throw new Error(`IDF version ${version} is not supported by this converter. Supported versions: ${supported}. Convert with the matching EnergyPlus release or upgrade the IDF first.`)
    }
    const manifestUrl = assetUrl(entry.manifest, request.assetBaseUrl)
    const manifest = await readJson(manifestUrl) as EngineManifest
    if (!manifest || manifest.protocol !== 1 || typeof manifest.energyPlusVersion !== 'string' || !manifest.capabilities?.includes('convert') ||
        typeof manifest.buildId !== 'string' || typeof manifest.sourceCommit !== 'string' ||
        manifest.energyPlusVersion.split('.').slice(0, 2).join('.') !== targetVersion) {
      throw new Error('The EnergyPlus engine and model versions do not match.')
    }
    let input = request.text
    const provenance: UpgradeProvenance = {
      sourceVersion: version, targetVersion, steps: [],
      converter: { energyPlusVersion: manifest.energyPlusVersion, buildId: manifest.buildId, sourceCommit: manifest.sourceCommit },
    }
    if (version !== targetVersion) {
      if (!Array.isArray(registry.transitions)) throw new Error('No EnergyPlus upgrade paths are installed.')
      const queue: { version: string; path: NonNullable<EngineRegistry['transitions']> }[] = [{ version, path: [] }]
      const visited = new Set<string>()
      let path: NonNullable<EngineRegistry['transitions']> | undefined
      while (queue.length) {
        const current = queue.shift()!
        if (current.version === targetVersion) { path = current.path; break }
        if (visited.has(current.version)) continue
        visited.add(current.version)
        for (const edge of registry.transitions.filter((edge) => edge.fromVersion === current.version)) {
          const from = edge.fromVersion.split('.').map(Number), to = edge.toVersion.split('.').map(Number)
          if (to[0]! > from[0]! || (to[0] === from[0] && to[1]! > from[1]!)) queue.push({ version: edge.toVersion, path: [...current.path, edge] })
        }
      }
      if (!path) throw new Error(`No validated EnergyPlus upgrade path from ${version} to ${targetVersion} is installed.`)
      for (const [index, edge] of path.entries()) {
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
            verifiedAsset(step.loader, base), verifiedAsset(step.wasm, base), ...step.support.map((asset) => verifiedAsset(asset, base)),
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
          if (modelVersion(input) !== edge.toVersion) throw new Error('Native transition returned an unexpected Version.')
          provenance.steps.push({ fromVersion: edge.fromVersion, toVersion: edge.toVersion, buildId: step.buildId, sourceCommit: step.sourceCommit })
        } catch (error) {
          throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    progress(`Loading EnergyPlus ${manifest.energyPlusVersion}`, 32)
    const base = new URL('.', manifestUrl).href
    const [, wasmBinary] = await Promise.all([
      verifiedAsset(manifest.loader, base), verifiedAsset(manifest.wasm, base),
    ])
    // Keep Emscripten's import.meta.url relative to its immutable artifact,
    // rather than a blob URL that cannot resolve its runtime resources.
    const loaderUrl = assetUrl(manifest.loader.file, base)
    const module = await import(/* @vite-ignore */ loaderUrl) as { default: ModuleFactory }
    const runtime = await module.default({ noInitialRun: true, wasmBinary, print: log, printErr: log })
    progress('Converting IDF to epJSON', 35)
    runtime.FS.mkdir('/job')
    runtime.FS.chdir('/job')
    runtime.FS.writeFile('input.idf', input)
    const exitCode = invoke(runtime, ['--convert-only', '-d', '/job/', '/job/input.idf'])
    for (const name of runtime.FS.readdir('/job').filter((name) => name.endsWith('.err'))) {
      for (const line of runtime.FS.readFile(`/job/${name}`, { encoding: 'utf8' }).split('\n')) log(line)
    }
    if (exitCode !== 0) throw new Error(`EnergyPlus could not convert this IDF (exit ${exitCode}). See the conversion diagnostics.`)
    const outputs = runtime.FS.readdir('/job').filter((name) => name.toLowerCase().endsWith('.epjson'))
    if (outputs.length !== 1) throw new Error('EnergyPlus did not produce an epJSON file. See the conversion diagnostics.')
    const epjson = runtime.FS.readFile(`/job/${outputs[0]}`, { encoding: 'utf8' })
    const parsed: unknown = JSON.parse(epjson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('EnergyPlus returned an invalid epJSON document.')
    post({ protocol: 2, id, type: 'done', result: {
      epjson, diagnostics: retainedDiagnostics(), provenance, upgradedIdf: provenance.steps.length ? input : undefined, energyPlusVersion: manifest.energyPlusVersion, buildId: manifest.buildId,
    } })
  } catch (error) {
    post({ protocol: 2, id, type: 'error', message: error instanceof Error ? error.message : String(error), diagnostics: retainedDiagnostics() })
  }
}
