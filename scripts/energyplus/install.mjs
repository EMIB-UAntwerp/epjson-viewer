import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const source = process.argv[2]
if (!source) throw new Error('Usage: npm run energyplus:install -- <extracted-artifact-directory>')
const registry = JSON.parse(await readFile(join(source, 'registry.json'), 'utf8'))
if (![1, 2].includes(registry.protocol) || !Array.isArray(registry.engines) || !registry.engines.length) throw new Error('Invalid engine registry')
function safePath(path) {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error('Invalid artifact path')
  }
  return path
}
const manifests = []
for (const entry of registry.engines) {
  const manifestPath = safePath(entry.manifest)
  const base = dirname(manifestPath)
  const manifest = JSON.parse(await readFile(join(source, manifestPath), 'utf8'))
  if (manifest.protocol !== 1 || !manifest.capabilities?.includes('convert') ||
      (manifest.invocation !== undefined && manifest.invocation !== 'convert-input-format') ||
      manifest.energyPlusVersion.split('.').slice(0, 2).join('.') !== entry.modelVersion) throw new Error('Incompatible engine manifest')
  for (const asset of [manifest.loader, manifest.wasm]) {
    const bytes = await readFile(join(source, base, safePath(asset.file)))
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Checksum mismatch: ${asset.file}`)
  }
  await readFile(join(source, base, 'LICENSE-EnergyPlus.txt'))
  manifests.push(base)
}
if (registry.protocol === 2) {
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
for (const base of manifests) await cp(join(source, base), join(target, base), { recursive: true })
// Promote only after every engine passed verification; retain prior assets for rollback.
await writeFile(join(target, 'registry.json'), JSON.stringify(registry, null, 2) + '\n')
console.log(`Installed EnergyPlus versions: ${registry.engines.map((engine) => engine.modelVersion).join(', ')}`)
