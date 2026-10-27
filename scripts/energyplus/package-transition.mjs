import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

const [buildArg, sourceArg, llvmArg, outputArg] = process.argv.slice(2)
if (!outputArg) throw new Error('Usage: package-transition.mjs <build> <EnergyPlus source> <LLVM source> <candidate directory>')
const build = resolve(buildArg), source = resolve(sourceArg)
const evidence = JSON.parse(await readFile(join(build, 'build-evidence.json')))
if (evidence.status !== 'compiled-unvalidated') throw new Error('Transition build did not complete')
const { config } = evidence
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const wasm = await readFile(join(build, 'transition.wasm'))
const loader = await readFile(join(build, 'transition.mjs'))
// The pinned source determines the IDDs/CSV too; loader or recipe changes must
// never reuse an immutable asset directory with the same WASM bytes.
const identity = hash(Buffer.concat([wasm, loader, Buffer.from(JSON.stringify({ config, recipeHash: evidence.recipeHash }))]))
const buildId = `${config.fromVersion}-to-${config.toVersion}-${identity.slice(0, 16)}`
const output = join(resolve(outputArg), buildId)
await mkdir(output, { recursive: true })
async function asset(name, bytes) {
  await writeFile(join(output, name), bytes)
  return { file: name, sha256: hash(bytes) }
}
async function upstream(path) {
  const result = spawnSync('git', ['show', `${config.sourceCommit}:${path}`], { cwd: source, maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`Cannot read pinned source ${path}`)
  return result.stdout
}
const support = []
for (const version of [config.fromVersion, config.toVersion]) {
  const name = `V${version.replace('.', '-')}-0-Energy+.idd`
  let bytes
  if (version === '26.1') {
    const template = (await upstream('idd/Energy+.idd.in')).toString()
    bytes = Buffer.from(template.replaceAll('${CMAKE_VERSION_MAJOR}', '26').replaceAll('${CMAKE_VERSION_MINOR}', '1')
      .replaceAll('${CMAKE_VERSION_PATCH}', '0').replaceAll('${CMAKE_VERSION_BUILD}', config.sourceCommit.slice(0, 10)))
  } else bytes = await upstream(`idd/versions/${name}`)
  support.push({ ...await asset(`support-${support.length}.idd`, bytes), name })
}
const csv = `Report Variables ${config.fromVersion.replace('.', '-')}-0 to ${config.toVersion.replace('.', '-')}-0.csv`
support.push({ ...await asset('report-variables.csv', await upstream(`src/Transition/SupportFiles/${csv}`)), name: csv })
const manifest = {
  protocol: 2, capabilities: ['transition'], fromVersion: config.fromVersion, toVersion: config.toVersion,
  sourceCommit: config.sourceCommit, buildId,
  loader: await asset('transition.mjs', loader),
  wasm: await asset('transition.wasm', wasm), support,
  invocation: 'input.idf', output: 'input.idfnew',
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
await cp(join(build, 'build-evidence.json'), join(output, 'build-evidence.json'))
await asset('LICENSE-EnergyPlus.txt', await upstream('LICENSE.txt'))
await cp(join(resolve(llvmArg), 'LICENSE.TXT'), join(output, 'LICENSE-LLVM.txt'))
// Packaging is not validation or promotion. The deployment registry is separate.
console.log(join(output, 'manifest.json'))
