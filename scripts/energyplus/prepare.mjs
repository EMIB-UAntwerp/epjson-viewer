import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const release = JSON.parse(await readFile(join(here, 'release.json'), 'utf8'))
if (!release.url) {
  console.warn('No validated EnergyPlus runtime is pinned. IDF conversion is unavailable; epJSON viewing works.')
  await mkdir(join(root, 'public/energyplus'), { recursive: true })
  await writeFile(join(root, 'public/energyplus/registry.json'), '{"protocol":1,"engines":[]}\n')
} else {
  if (!release.url.startsWith('https://') || !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error('Invalid pinned EnergyPlus release')
  const response = await fetch(release.url)
  if (!response.ok) throw new Error(`EnergyPlus runtime download failed (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw new Error('EnergyPlus release checksum mismatch')
  const temporary = await mkdtemp(join(tmpdir(), 'epjson-energyplus-'))
  try {
    const archive = join(temporary, 'runtime.tar.gz')
    const extracted = join(temporary, 'runtime')
    await mkdir(extracted)
    await writeFile(archive, bytes)
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', extracted], { stdio: 'inherit' })
    if (unpack.error) throw unpack.error
    if (unpack.status !== 0) throw new Error('EnergyPlus runtime extraction failed')
    const install = spawnSync(process.execPath, [join(here, 'install.mjs'), extracted], { stdio: 'inherit' })
    if (install.error) throw install.error
    if (install.status !== 0) throw new Error('EnergyPlus runtime installation failed')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
