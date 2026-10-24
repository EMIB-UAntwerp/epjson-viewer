import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A feasibility build only: no registry entry is emitted until native/browser
// parity establishes that the compiler and its Fortran runtime agree.
const here = dirname(fileURLToPath(import.meta.url))
const configBytes = await readFile(join(here, 'transition-config.json'))
const config = JSON.parse(configBytes)
const [sourceArg, flangArg, fromArg, toArg] = process.argv.slice(2)
const versions = ['9.6', '22.1', '22.2', '23.1', '23.2', '24.1', '24.2', '25.1', '25.2', '26.1']
if (fromArg || toArg) {
  const index = versions.indexOf(fromArg)
  if (index < 0 || versions[index + 1] !== toArg) throw new Error('Unsupported transition edge')
  config.fromVersion = fromArg
  config.toVersion = toArg
  config.rules = `CreateNewIDFUsingRulesV${toArg.replace('.', '_')}_0`
}
if (!sourceArg || !flangArg) throw new Error('Usage: npm run energyplus:build-transition -- <EnergyPlus source> <Flang root>')
const source = resolve(sourceArg)
const flang = resolve(flangArg)
const workspace = resolve(here, '../../.energyplus-build/transition')
await mkdir(workspace, { recursive: true })
// Each attempt owns its module files; failed/older builds cannot supply them.
const build = await mkdtemp(join(workspace, 'build-'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const commands = []
function run(command, args, cwd = build) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  commands.push({ command, args, cwd, status: result.status, stdout: result.stdout, stderr: result.stderr })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr}`)
  return result.stdout
}

const provenance = { config, recipeHash: hash(Buffer.concat([configBytes, await readFile(fileURLToPath(import.meta.url))])), status: 'building' }
console.log(`Transition build evidence: ${build}`)
try {
  if (run('git', ['rev-parse', 'HEAD'], source).trim() !== config.sourceCommit) throw new Error('Unexpected EnergyPlus source commit')
  const compiler = join(flang, 'bin/flang-new')
  const runtime = join(flang, 'lib/clang/21/lib/wasm32-unknown-emscripten/libflang_rt.runtime.wasm32.a')
  provenance.compilerSha256 = hash(await readFile(compiler))
  provenance.runtimeSha256 = hash(await readFile(runtime))
  let toolchain
  try {
    toolchain = JSON.parse(await readFile(join(flang, 'toolchain.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (toolchain) {
    if (toolchain.compilerSha256 !== provenance.compilerSha256 ||
        toolchain.runtimeSha256 !== provenance.runtimeSha256 ||
        toolchain.sourceSha256 !== config.llvmSourceSha256 ||
        toolchain.originalRuntimeSha256 !== config.runtimeSha256 ||
        toolchain.runtimePatchSha256 !== hash(await readFile(join(here, 'flang-runtime-append.patch'))) ||
        toolchain.patchSha256 !== hash(await readFile(join(here, 'flang-wasm32.patch')))) {
      throw new Error('Patched Flang toolchain provenance mismatch')
    }
    for (const name of ['__fortran_builtins.mod', '__fortran_type_info.mod']) {
      if (toolchain.intrinsicModules?.[name] !== hash(await readFile(join(flang, 'include/flang', name)))) {
        throw new Error(`Flang intrinsic module provenance mismatch: ${name}`)
      }
    }
    provenance.toolchain = toolchain
  } else if (provenance.runtimeSha256 !== config.runtimeSha256) {
    throw new Error('Unexpected Flang runtime archive')
  }
  if (!run(compiler, ['--version']).includes(`flang version ${config.flangVersion}\n`)) throw new Error('Unexpected Flang version')
  if (!run('emcc', ['--version']).includes(` ${config.emscriptenVersion} `)) throw new Error(`Activate Emscripten ${config.emscriptenVersion}`)
  const names = [
    'DataGlobals', 'DataStringGlobals', 'DataVCompareGlobals', 'DisplayRoutines',
    'General', 'SortAndStringUtilities', 'InputProcessor', 'platformDepUtilityRoutines',
    'UtilityRoutines', 'VCompareGlobalRoutines', 'VCompareUtilityRoutines', config.rules, 'Transition',
  ]
  for (const name of names) {
    const relative = `src/Transition/${name}.f90`
    const path = join(source, relative)
    if (await readFile(path, 'utf8') !== run('git', ['show', `HEAD:${relative}`], source)) throw new Error(`Modified upstream source: ${relative}`)
    console.log(`Compiling ${name}`)
    run(compiler, ['--target=wasm32-unknown-emscripten', '-c', '-O2', path, '-o', `${name}.o`])
  }
  // Signature warnings become trap stubs in WASM. Never package such a binary.
  run('emcc', [
    ...names.map((name) => `${name}.o`), runtime, '-O2', '-o', 'transition.mjs',
    '-Wl,--fatal-warnings', '-sMODULARIZE=1', '-sEXPORT_ES6=1',
    '-sENVIRONMENT=worker,node', '-sINVOKE_RUN=0', '-sEXIT_RUNTIME=0',
    '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=5242880', '-sFORCE_FILESYSTEM=1',
    '-sEXPORTED_RUNTIME_METHODS=["FS","callMain"]',
  ])
  provenance.status = 'compiled-unvalidated'
  console.log('Compiled only. Native parity and browser validation are required before packaging.')
} catch (error) {
  provenance.status = 'failed'
  provenance.error = String(error)
  process.exitCode = 1
  console.error(provenance.error)
} finally {
  await writeFile(join(build, 'build-evidence.json'), JSON.stringify({ ...provenance, commands }, null, 2) + '\n')
}
