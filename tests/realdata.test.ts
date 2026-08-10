/**
 * Integration tests against the real research files in data/.
 * data/ is git-ignored (contains real addresses) — these tests skip when the
 * folder is absent (e.g. in CI).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEpjson } from '../src/core/parse'
import { buildGeometry } from '../src/core/buildBuffers'

const dataDir = fileURLToPath(new URL('../data', import.meta.url))
const hasData = existsSync(dataDir)

const smallFile = hasData
  ? readdirSync(dataDir).find((f) => f.startsWith('ID_') && f.endsWith('.epJSON'))
  : undefined

describe.skipIf(!hasData)('real data: single building', () => {
  it('parses a small house end to end', () => {
    const text = readFileSync(join(dataDir, smallFile!), 'utf-8')
    const model = parseEpjson(JSON.parse(text), smallFile!)

    expect(model.stats.zoneCount).toBe(1)
    expect(model.stats.counts.wall).toBeGreaterThan(0)
    expect(model.stats.counts.window).toBeGreaterThan(0)
    expect(model.meta.coordinateSystem).toBe('Relative')

    // Every fenestration surface must resolve to a host wall hole
    const fens = model.surfaces.filter((s) => s.kind === 'fenestration')
    expect(fens.length).toBeGreaterThan(0)
    for (const f of fens) {
      expect(f.hostSurface).toBeTruthy()
      expect(f.zone).toBeTruthy()
    }
    const holeCount = model.surfaces.reduce((n, s) => n + s.holes.length, 0)
    expect(holeCount).toBe(fens.length)

    const { bundle, warnings } = buildGeometry(model)
    expect(bundle.triangleCount).toBeGreaterThan(0)
    expect(warnings).toEqual([])
  })
})

describe.skipIf(!hasData || !existsSync(join(dataDir, 'block_9.epJSON')))('real data: block_9 (interior walls)', () => {
  it('classifies matched interior pairs and resolves paired surfaces', () => {
    const text = readFileSync(join(dataDir, 'block_9.epJSON'), 'utf-8')
    const model = parseEpjson(JSON.parse(text), 'block_9.epJSON')

    expect(model.stats.zoneCount).toBe(55)
    const interior = model.surfaces.filter((s) => s.isInterior && s.kind === 'building')
    expect(interior.length).toBe(334)

    // Matched pairs must reference each other by name
    const byName = new Map(model.surfaces.map((s) => [s.name, s]))
    for (const s of interior.slice(0, 20)) {
      expect(s.boundaryObject).toBeTruthy()
      const pair = byName.get(s.boundaryObject!)
      expect(pair).toBeTruthy()
      expect(pair!.boundaryObject).toBe(s.name)
    }
    expect(model.stats.buildingCount).toBeGreaterThan(1)
  })
})

describe.skipIf(!hasData || !existsSync(join(dataDir, 'block_3.epJSON')))('real data: block_3 (scale + air walls)', () => {
  it('handles 747 zones, air boundaries and ceilings at scale', () => {
    const t0 = performance.now()
    const text = readFileSync(join(dataDir, 'block_3.epJSON'), 'utf-8')
    const model = parseEpjson(JSON.parse(text), 'block_3.epJSON')
    const { bundle } = buildGeometry(model)
    const elapsed = performance.now() - t0

    expect(model.stats.zoneCount).toBe(747)
    expect(model.stats.counts.airBoundary).toBe(3246)
    expect(model.stats.counts.ceiling).toBeGreaterThan(0)
    expect(model.stats.counts.shading).toBe(14675)
    expect(bundle.triangleCount).toBeGreaterThan(20000)

    // All coordinates must stay float32-safe after recentering
    for (const group of Object.values(bundle.groups)) {
      if (!group) continue
      for (let i = 0; i < group.positions.length; i += 997) {
        expect(Math.abs(group.positions[i])).toBeLessThan(4000)
      }
    }
    // Parse + triangulate + buffers should stay well under 30 s even on WSL
    expect(elapsed).toBeLessThan(30000)
    // eslint-disable-next-line no-console
    console.log(`block_3: ${Math.round(elapsed)} ms, ${bundle.triangleCount} triangles, ${model.warnings.length} warnings`)
  }, 60000)
})
