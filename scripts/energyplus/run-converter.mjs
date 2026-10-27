// Native-parity tooling: each invocation owns fresh Emscripten global state.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const [manifestPath, schemaPath, inputPath, outputPath] = process.argv.slice(2)
if (!outputPath) throw new Error('Usage: node scripts/energyplus/run-converter.mjs <manifest> <schema> <input.idf> <output.epJSON>')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const base = dirname(resolve(manifestPath))
const verified = async (asset) => {
  const bytes = await readFile(resolve(base, asset.file))
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Runtime checksum mismatch')
  return bytes
}
await verified(manifest.loader)
const wasmBinary = await verified(manifest.wasm)
const factory = (await import(pathToFileURL(resolve(base, manifest.loader.file)).href)).default
const runtime = await factory({ noInitialRun: true, wasmBinary, print: console.log, printErr: console.error })
runtime.FS.mkdir('/job')
runtime.FS.chdir('/job')
runtime.FS.writeFile('input.idf', await readFile(inputPath))
runtime.FS.writeFile('Energy+.schema.epJSON', await readFile(schemaPath))
const args = manifest.invocation === 'schema-parser'
  ? ['/job/Energy+.schema.epJSON', '/job/input.idf', '/job/input.epJSON']
  : ['--schema', '/job/Energy+.schema.epJSON', '--format', 'epjson', '--output', '/job/', '/job/input.idf']
if (!['schema-parser', 'schema-convert-input-format'].includes(manifest.invocation)) throw new Error('Unsupported schema runtime')
let exit
try { exit = runtime.callMain(args) } catch (error) { if (error.name === 'ExitStatus') exit = error.status; else throw error }
if (exit) throw new Error(`Converter exited with ${exit}`)
await writeFile(outputPath, runtime.FS.readFile('/job/input.epJSON'))
