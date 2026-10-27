import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { schemaAdapter, validationAdapter } from './schema-adapter.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(await readFile(join(here, 'build-config.json'), 'utf8'))
const root = resolve(here, '../..')
const workspace = join(root, '.energyplus-build', `${config.energyPlusVersion}-${config.buildRevision}`)
const source = join(workspace, 'source')
const build = join(workspace, 'build')
const formatConverter = process.argv.includes('--format-converter')
const schemaConverter = process.argv.includes('--schema-converter')
const target = schemaConverter ? 'SchemaConvertInputFormat' : formatConverter ? 'ConvertInputFormat' : 'energyplus'

function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`)
  return result.stdout?.trim() ?? ''
}

const compiler = run('emcc', ['--version'], root, true)
if (!compiler.includes(` ${config.emscriptenVersion} `) && !compiler.includes(` ${config.emscriptenVersion}\n`)) {
  throw new Error(`Activate Emscripten ${config.emscriptenVersion} before building this pinned release.`)
}
await mkdir(workspace, { recursive: true })
try {
  await readFile(join(source, '.git/HEAD'))
} catch {
  run('git', ['clone', '--depth', '1', '--branch', config.ref, config.repository, source])
}
const commit = run('git', ['rev-parse', 'HEAD'], source, true)
if (commit !== config.commit) throw new Error(`Unexpected upstream commit ${commit}`)
const cmake = join(source, 'CMakeLists.txt')
const include = `\ninclude("${join(here, 'browser.cmake').replaceAll('\\', '/')}")\n`
const upstreamCmake = run('git', ['show', 'HEAD:CMakeLists.txt'], source, true)
const currentCmake = await readFile(cmake, 'utf8')
if (currentCmake.replace(include, '').trim() !== upstreamCmake) throw new Error('Unexpected changes in the EnergyPlus build checkout')
const changed = run('git', ['diff', '--name-only'], source, true)
const platformFile = 'src/EnergyPlus/FileSystem.cc'
if (changed.split('\n').some((file) => file && file !== 'CMakeLists.txt' && file !== platformFile)) {
  throw new Error('Unexpected changes in the EnergyPlus source checkout')
}
if (!currentCmake.includes(include)) await appendFile(cmake, include)

// Upstream has executable discovery for desktop OSes only. Browsers have no
// executable path; use the root of the private virtual filesystem instead.
const upstreamPlatform = run('git', ['show', `HEAD:${platformFile}`], source, true)
const anchor = '        char executableRelativePath[1024];'
if (upstreamPlatform.split(anchor).length !== 2) throw new Error('Review the upstream executable-path adapter before upgrading')
const browserPlatform = upstreamPlatform.replace(anchor,
  '#ifdef __EMSCRIPTEN__\n        return "/energyplus.mjs";\n#endif\n' + anchor) + '\n'
const currentPlatform = await readFile(join(source, platformFile), 'utf8')
if (currentPlatform.trim() !== upstreamPlatform && currentPlatform !== browserPlatform) {
  throw new Error('Unexpected changes in the EnergyPlus filesystem adapter')
}
if (currentPlatform !== browserPlatform) await writeFile(join(source, platformFile), browserPlatform)

const adapterPath = join(workspace, 'SchemaConvertInputFormat.cpp')
if (schemaConverter) await writeFile(adapterPath, schemaAdapter(await readFile(join(source, 'src/ConvertInputFormat/main.cpp'), 'utf8')))
if (schemaConverter) await writeFile(join(workspace, 'SchemaValidation.cpp'), validationAdapter(await readFile(join(source, 'src/EnergyPlus/InputProcessing/InputValidation.cc'), 'utf8')))

run('emcmake', ['cmake', '-S', source, '-B', build, '-G', 'Ninja',
  '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_STATIC_ENERGYPLUS_API=ON',
  '-DBUILD_TESTING=OFF', '-DBUILD_FORTRAN=OFF', '-DBUILD_PACKAGE=OFF',
  '-DLINK_WITH_PYTHON=OFF', '-DOPENGL_REQUIRED=OFF', '-DDOCUMENTATION_BUILD=DoNotBuild',
  '-DENABLE_GTEST_DEBUG_MODE=OFF',
  `-DSCHEMA_CONVERTER_SOURCE=${schemaConverter ? adapterPath : ''}`,
  // cstdint supplies fixed-width types used by upstream SSC with recent Clang.
  '-DCMAKE_CXX_FLAGS=-fwasm-exceptions -include cstdint', '-DCMAKE_C_FLAGS=-fwasm-exceptions',
])
run('cmake', ['--build', build, '--target', target, '--parallel', process.env.EPLUS_BUILD_JOBS || '2'])

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const recipeHash = digest(Buffer.concat([
  await readFile(fileURLToPath(import.meta.url)), await readFile(join(here, 'browser.cmake')),
  await readFile(join(here, 'build-config.json')),
  await readFile(join(here, 'schema-adapter.mjs')),
]))
const loaderBytes = await readFile(join(build, `browser/${target}.mjs`))
const wasmBytes = await readFile(join(build, `browser/${target}.wasm`))
const buildId = `${config.energyPlusVersion}-${digest(Buffer.concat([loaderBytes, wasmBytes])).slice(0, 16)}`
const artifactRoot = join(root, schemaConverter ? '.energyplus-build/versioned-conversion/candidate' : '.energyplus-build/candidate')
const output = join(artifactRoot, buildId)
await mkdir(output, { recursive: true })
const assets = {}
for (const [key, file, bytes] of [['loader', `${target}.mjs`, loaderBytes], ['wasm', `${target}.wasm`, wasmBytes]]) {
  await writeFile(join(output, file), bytes)
  assets[key] = { file, sha256: digest(bytes) }
}
// Ship upstream notices, including dependency licences, with every binary bundle.
await cp(join(source, 'LICENSE.txt'), join(output, 'LICENSE-EnergyPlus.txt'))
async function copyNotices(directory, relative = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const name = join(relative, entry.name)
    if (entry.isDirectory()) await copyNotices(join(directory, entry.name), name)
    else if (/^(license|copying|copyright|notice)/i.test(entry.name)) {
      const target = join(output, 'notices', name)
      await mkdir(dirname(target), { recursive: true })
      await cp(join(directory, entry.name), target)
    }
  }
}
await copyNotices(join(source, 'third_party'))
await writeFile(join(output, 'manifest.json'), JSON.stringify({
  protocol: schemaConverter ? 3 : 1, energyPlusVersion: config.energyPlusVersion, sourceCommit: commit,
  ...(schemaConverter ? { invocation: 'schema-convert-input-format' } : formatConverter ? { invocation: 'convert-input-format' } : {}),
  sourceRef: config.ref, emscriptenVersion: config.emscriptenVersion,
  recipeHash, buildId, capabilities: ['convert'], ...assets,
}, null, 2) + '\n')
await writeFile(join(artifactRoot, 'registry.json'), JSON.stringify({
  protocol: 1, engines: [{ modelVersion: config.energyPlusVersion.split('.').slice(0, 2).join('.'), manifest: `${buildId}/manifest.json` }],
}, null, 2) + '\n')
if (schemaConverter) await writeFile(join(artifactRoot, '../shared-runtime.json'), JSON.stringify({ manifest: `${buildId}/manifest.json` }, null, 2) + '\n')
console.log(`Artifact built at ${artifactRoot}. Validate against native EnergyPlus before promotion.`)
