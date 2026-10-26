import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const source = process.argv[2]
if (!source) throw new Error('Usage: npm run energyplus:install -- <extracted-artifact-directory>')
const registry = JSON.parse(await readFile(join(source, 'registry.json'), 'utf8'))
if (![1, 2, 3].includes(registry.protocol) || !Array.isArray(registry.engines) || !registry.engines.length) throw new Error('Invalid engine registry')
function safePath(path) {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error('Invalid artifact path')
  }
  return path
}
const manifests = []
const entries = [...registry.engines]
if (registry.upgradeManifest) entries.push({ modelVersion: registry.targetVersion, manifest: registry.upgradeManifest })
const versions = registry.engines.map((entry) => entry.modelVersion)
if (new Set(versions).size !== versions.length) throw new Error('Duplicate schema versions')
for (const entry of entries) {
  const manifestPath = safePath(entry.manifest)
  const base = dirname(manifestPath)
  const manifest = JSON.parse(await readFile(join(source, manifestPath), 'utf8'))
  if (!manifest.capabilities?.includes('convert')) throw new Error('Incompatible engine manifest')
  if (manifest.protocol === 3) {
    if (!['schema-convert-input-format', 'schema-parser'].includes(manifest.invocation) || !entry.schema || !entry.validation ||
        !/^\d+\.\d+\.\d+$/.test(entry.schema.version) || !/^[a-f0-9]{40}$/.test(entry.schema.sourceCommit) ||
        (entry.modelVersion !== entry.schema.version && entry.modelVersion !== entry.schema.version.split('.').slice(0, 2).join('.'))) throw new Error('Incompatible schema manifest')
    const schemaBytes = await readFile(join(source, safePath(entry.schema.file)))
    if (createHash('sha256').update(schemaBytes).digest('hex') !== entry.schema.sha256) throw new Error('Schema checksum mismatch')
    const schema = JSON.parse(schemaBytes)
    const patterns = schema.properties?.Version?.patternProperties
    const declared = String(Object.values(patterns ?? {})[0]?.properties?.version_identifier?.default)
    if (declared !== entry.schema.version.split('.').slice(0, 2).join('.')) throw new Error('Schema version mismatch')
    const receipt = JSON.parse(await readFile(join(source, safePath(entry.validation)), 'utf8'))
    if (receipt.nativeParity !== true || receipt.browserParity !== true || receipt.schemaSha256 !== entry.schema.sha256 || receipt.schemaVersion !== entry.schema.version ||
        receipt.loaderSha256 !== manifest.loader.sha256 || receipt.wasmSha256 !== manifest.wasm.sha256 ||
        !Array.isArray(receipt.comparisons) || !receipt.comparisons.length || receipt.comparisons.some((comparison) =>
          comparison.nativeParity !== true || comparison.schemaSha256 !== entry.schema.sha256 ||
          comparison.loaderSha256 !== manifest.loader.sha256 || comparison.wasmSha256 !== manifest.wasm.sha256) ||
        !Array.isArray(receipt.browserComparisons) || receipt.comparisons.some((comparison) =>
          ['chromium', 'firefox'].some((browser) => !receipt.browserComparisons.some((check) =>
            check.browser === browser && check.model === comparison.model && check.nativeParity === true &&
            check.transitionRequests === 0 && check.inputSha256 === comparison.inputSha256 &&
            check.schemaSha256 === entry.schema.sha256 && check.loaderSha256 === manifest.loader.sha256 &&
            check.wasmSha256 === manifest.wasm.sha256)))) {
      throw new Error('Schema converter has no matching native parity evidence')
    }
    manifests.push(dirname(entry.schema.file), dirname(entry.validation))
  } else if (manifest.protocol !== 1 ||
      (manifest.invocation !== undefined && manifest.invocation !== 'convert-input-format') ||
      manifest.energyPlusVersion.split('.').slice(0, 2).join('.') !== entry.modelVersion) throw new Error('Incompatible engine manifest')
  for (const asset of [manifest.loader, manifest.wasm]) {
    const bytes = await readFile(join(source, base, safePath(asset.file)))
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Checksum mismatch: ${asset.file}`)
  }
  await readFile(join(source, base, 'LICENSE-EnergyPlus.txt'))
  manifests.push(base)
}
if (registry.protocol >= 2) {
  if (!registry.engines.some((engine) => engine.modelVersion === registry.targetVersion) || !Array.isArray(registry.transitions)) throw new Error('Invalid upgrade registry target')
  for (const entry of registry.transitions) {
    if (!/^\d+\.\d+$/.test(entry.fromVersion) || !/^\d+\.\d+$/.test(entry.toVersion)) throw new Error('Invalid transition versions')
    const from = entry.fromVersion.split('.').map(Number), to = entry.toVersion.split('.').map(Number)
    if (!(to[0] > from[0] || (to[0] === from[0] && to[1] > from[1]))) throw new Error('Transition must upgrade its input version')
    const path = safePath(entry.manifest), base = dirname(path)
    const manifest = JSON.parse(await readFile(join(source, path), 'utf8'))
    if (manifest.protocol !== 2 || manifest.capabilities?.[0] !== 'transition' || manifest.fromVersion !== entry.fromVersion ||
        manifest.toVersion !== entry.toVersion || manifest.invocation !== 'input.idf' || manifest.output !== 'input.idfnew' ||
        !Array.isArray(manifest.support)) throw new Error('Incompatible transition manifest')
    for (const asset of [manifest.loader, manifest.wasm, ...manifest.support]) {
      const bytes = await readFile(join(source, base, safePath(asset.file)))
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Checksum mismatch: ${asset.file}`)
    }
    const validation = JSON.parse(await readFile(join(source, base, 'validation.json'), 'utf8'))
    if (validation.wasmSha256 !== manifest.wasm.sha256 || validation.loaderSha256 !== manifest.loader.sha256 ||
        JSON.stringify(validation.support) !== JSON.stringify(manifest.support) || validation.nativeParity !== true) {
      throw new Error('Transition has no matching native parity evidence')
    }
    await readFile(join(source, base, 'LICENSE-EnergyPlus.txt'))
    await readFile(join(source, base, 'LICENSE-LLVM.txt'))
    manifests.push(base)
  }
  for (const edge of registry.transitions) {
    const seen = new Set(), queue = [edge.fromVersion]
    while (queue.length) {
      const version = queue.shift()
      if (seen.has(version)) continue
      seen.add(version)
      for (const next of registry.transitions.filter((step) => step.fromVersion === version)) queue.push(next.toVersion)
    }
    if (!seen.has(registry.targetVersion)) throw new Error(`Incomplete transition path from ${edge.fromVersion}`)
  }
}
const target = join(root, 'public/energyplus')
await mkdir(target, { recursive: true })
for (const base of new Set(manifests)) await cp(join(source, base), join(target, base), { recursive: true })
// Promote only after every engine passed verification; retain prior assets for rollback.
await writeFile(join(target, 'registry.json'), JSON.stringify(registry, null, 2) + '\n')
console.log(`Installed EnergyPlus versions: ${registry.engines.map((engine) => engine.modelVersion).join(', ')}`)
