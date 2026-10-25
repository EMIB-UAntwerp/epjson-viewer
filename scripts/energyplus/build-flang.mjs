import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Linux host build, isolated from the EnergyPlus C++ converter toolchain.
const here = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(await readFile(join(here, 'transition-config.json')))
const [archiveArg, distributionArg] = process.argv.slice(2)
if (!archiveArg || !distributionArg || !process.env.EMSDK) {
  throw new Error('Activate the pinned Emscripten SDK, then run build-flang.mjs <LLVM source archive> <Flang distribution root>')
}
const emccVersion = spawnSync('emcc', ['--version'], { encoding: 'utf8' })
if (emccVersion.status !== 0 || !emccVersion.stdout.includes(` ${config.emscriptenVersion} `)) {
  throw new Error(`Activate Emscripten ${config.emscriptenVersion}`)
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const archive = resolve(archiveArg)
if (digest(await readFile(archive)) !== config.llvmSourceSha256) throw new Error('LLVM source archive checksum mismatch')
const distribution = resolve(distributionArg)
const runtimeRelative = 'lib/clang/21/lib/wasm32-unknown-emscripten/libflang_rt.runtime.wasm32.a'
if (digest(await readFile(join(distribution, runtimeRelative))) !== config.runtimeSha256) throw new Error('Flang runtime checksum mismatch')
const patch = await readFile(join(here, 'flang-wasm32.patch'))
const runtimePatch = await readFile(join(here, 'flang-runtime-append.patch'))
const recipeHash = digest(Buffer.concat([patch, runtimePatch, await readFile(fileURLToPath(import.meta.url)), await readFile(join(here, 'transition-config.json'))]))
const root = resolve(here, '../../.energyplus-build/transition', `toolchain-${recipeHash.slice(0, 16)}`)
const source = join(root, `llvm-project-llvmorg-${config.flangVersion}`)
const build = join(root, 'build')
const output = join(root, 'install')
await mkdir(root, { recursive: true })
const commands = []
const evidence = { config, emccVersion: emccVersion.stdout, recipeHash, sourceSha256: config.llvmSourceSha256, patchSha256: digest(patch), runtimeSha256: config.runtimeSha256, status: 'building', commands }
evidence.originalRuntimeSha256 = config.runtimeSha256
evidence.runtimePatchSha256 = digest(runtimePatch)
function run(command, args, cwd = root) {
  console.log(command, ...args)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  commands.push({ command, args, cwd, status: result.status })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`)
}
try {
  // A recipe-specific directory permits incremental retries without reapplying patches.
  let prepared = false
  try { prepared = (await readFile(join(root, 'prepared'), 'utf8')) === recipeHash } catch {}
  if (!prepared) {
    run('tar', ['-xzf', archive, '-C', root])
    run('patch', ['--batch', '--fuzz=0', '-p1', '-i', join(here, 'flang-wasm32.patch')], source)
    run('patch', ['--batch', '--fuzz=0', '-p1', '-i', join(here, 'flang-runtime-append.patch')], source)
    await writeFile(join(root, 'prepared'), recipeHash)
  }
  const nativeTools = join(process.env.EMSDK, 'upstream/bin')
  run('cmake', ['-S', join(source, 'llvm'), '-B', build, '-G', 'Ninja',
    '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_C_COMPILER=${join(nativeTools, 'clang')}`,
    `-DCMAKE_CXX_COMPILER=${join(nativeTools, 'clang++')}`,
    '-DCMAKE_C_FLAGS_RELEASE=-O1 -DNDEBUG', '-DCMAKE_CXX_FLAGS_RELEASE=-O1 -DNDEBUG',
    '-DLLVM_USE_LINKER=gold', '-DLLVM_ENABLE_PROJECTS=clang;mlir;flang',
    '-DLLVM_APPEND_VC_REV=OFF',
    '-DLLVM_TARGETS_TO_BUILD=WebAssembly;X86', '-DLLVM_INCLUDE_TESTS=OFF',
    '-DLLVM_INCLUDE_BENCHMARKS=OFF', '-DFLANG_INCLUDE_TESTS=OFF',
    '-DFLANG_INCLUDE_DOCS=OFF', '-DMLIR_INCLUDE_TESTS=OFF', '-DLLVM_PARALLEL_LINK_JOBS=1',
  ])
  run('cmake', ['--build', build, '--target', 'flang', '--parallel', process.env.EPLUS_BUILD_JOBS || '4'])
  await mkdir(join(output, 'bin'), { recursive: true })
  // The driver invokes a sibling named flang for its -fc1 subprocess.
  await cp(join(build, 'bin/flang'), join(output, 'bin/flang'), { dereference: true })
  await cp(join(build, 'bin/flang'), join(output, 'bin/flang-new'), { dereference: true })
  // Transition sources need these internal modules. Host-generated modules
  // encode 64-bit C pointers and must not enter the wasm32 compilation.
  const modules = join(output, 'include/flang')
  await mkdir(modules, { recursive: true })
  for (const name of ['__fortran_builtins', '__fortran_type_info']) {
    run(join(output, 'bin/flang'), ['--target=wasm32-unknown-emscripten',
      '-cpp', '-fsyntax-only', '-module-dir', modules, '-I', modules,
      join(source, 'flang/module', `${name}.f90`),
    ])
  }
  evidence.intrinsicModules = {}
  for (const name of ['__fortran_builtins.mod', '__fortran_type_info.mod']) {
    evidence.intrinsicModules[name] = digest(await readFile(join(modules, name)))
  }
  await mkdir(dirname(join(output, runtimeRelative)), { recursive: true })
  await cp(join(distribution, runtimeRelative), join(output, runtimeRelative))
  // max()-2 overflows when upstream appends its IDD audit.
  const runtimeObject = join(root, 'external-unit.o')
  run('em++', ['-std=c++17', '-O2', '-DNDEBUG', '-fno-exceptions', '-fno-rtti',
    '-I', join(source, 'flang/include'), '-I', join(source, 'flang-rt/include'),
    '-c', join(source, 'flang-rt/lib/runtime/external-unit.cpp'), '-o', runtimeObject,
  ])
  run('emar', ['r', join(output, runtimeRelative), runtimeObject])
  evidence.runtimeObjectSha256 = digest(await readFile(runtimeObject))
  // The distribution's assignment bitcode carries minsize/optsize attributes
  // that survive final -O2 linking. Rebuild the unchanged implementation so
  // character padding and descriptor traversal can be optimized for speed.
  const assignmentSource = join(source, 'flang-rt/lib/runtime/assign.cpp')
  const assignmentObject = join(root, 'assign.o')
  run('em++', ['-std=c++17', '-O2', '-DNDEBUG', '-fno-exceptions', '-fno-rtti',
    '-I', join(source, 'flang/include'), '-I', join(source, 'flang-rt/include'),
    '-c', assignmentSource, '-o', assignmentObject,
  ])
  run('emar', ['r', join(output, runtimeRelative), assignmentObject])
  evidence.assignment = {
    sourceSha256: digest(await readFile(assignmentSource)),
    objectSha256: digest(await readFile(assignmentObject)), optimization: '-O2',
  }
  evidence.runtimeSha256 = digest(await readFile(join(output, runtimeRelative)))
  await cp(join(source, 'LICENSE.TXT'), join(output, 'LICENSE-LLVM.txt'))
  evidence.compilerSha256 = digest(await readFile(join(output, 'bin/flang-new')))
  evidence.status = 'compiled-unvalidated'
  await writeFile(join(output, 'toolchain.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(`Toolchain: ${output}`)
} catch (error) {
  evidence.status = 'failed'
  evidence.error = String(error)
  process.exitCode = 1
  console.error(error)
} finally {
  await writeFile(join(root, 'build-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
}
