/**
 * File-backed coverage for the rectangular geometry objects, against two real
 * EnergyPlus example models.
 *
 * These matter because nothing else in the repository exercises this code on
 * real input: neither bundled demo nor any `data/` model contains a single
 * rectangular object. The pair is chosen because between them they use every
 * rectangular type and no detailed ones, in both coordinate modes — Simple_1
 * is World/World, Simple_2 is Relative/Relative.
 *
 * Assertions are structural rather than exact counts, so a revision upstream
 * does not break them for no reason. The one exception is the coverage check,
 * which is deliberately loud: if these files stop exercising a type, the guard
 * has silently weakened and the fixture needs replacing.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildGeometry } from '../src/core/buildBuffers'
import { parseEpjson } from '../src/core/parse'
import { surfaceFrame } from '../src/core/rectSurfaces'
import { dot3, type Vec3 } from '../src/core/plane'
import type { EpModel } from '../src/core/types'

const FIXTURES = ['4ZoneWithShading_Simple_1', '4ZoneWithShading_Simple_2'] as const

function load(name: string): EpModel {
  const path = fileURLToPath(new URL(`./fixtures/${name}.epJSON`, import.meta.url))
  return parseEpjson(JSON.parse(readFileSync(path, 'utf8')), `${name}.epJSON`)
}

const models = new Map(FIXTURES.map((n) => [n, load(n)]))

/** The 22 object types this feature added, all of which the pair must use. */
const RECT_TYPES = [
  'Wall:Exterior', 'Wall:Adiabatic', 'Wall:Underground', 'Wall:Interzone',
  'Roof', 'Ceiling:Adiabatic', 'Ceiling:Interzone',
  'Floor:GroundContact', 'Floor:Adiabatic', 'Floor:Interzone',
  'Window', 'Window:Interzone', 'Door', 'Door:Interzone',
  'GlazedDoor', 'GlazedDoor:Interzone',
  'Shading:Site', 'Shading:Building',
  'Shading:Overhang', 'Shading:Overhang:Projection',
  'Shading:Fin', 'Shading:Fin:Projection',
]

describe.each(FIXTURES)('%s', (name) => {
  const model = models.get(name)!

  it('parses without a single warning', () => {
    expect(model.warnings).toEqual([])
    expect(buildGeometry(model).warnings).toEqual([])
  })

  it('builds geometry from a file that contains no detailed surface objects', () => {
    // These files used to hit the "no geometry found" throw outright. Assert
    // the premise as well as the result, so the test cannot quietly turn into
    // a check of the detailed path.
    const detailed = model.surfaces.filter((s) => s.epType.endsWith(':Detailed'))
    expect(detailed).toEqual([])
    expect(model.surfaces.length).toBeGreaterThan(0)
    expect(buildGeometry(model).bundle.triangleCount).toBeGreaterThan(0)
  })

  it('reports the tilt and azimuth each object declared', () => {
    // The invariant the whole rectangular construction rests on. Azimuth is
    // undefined for near-horizontal surfaces and reported as 0 by convention,
    // so only tilt is checked there.
    const checked: string[] = []
    for (const s of model.surfaces) {
      const raw = s.raw as Record<string, unknown>
      if (typeof raw.tilt_angle !== 'number' || typeof raw.azimuth_angle !== 'number') continue
      checked.push(s.name)
      expect(s.tilt).toBeCloseTo(raw.tilt_angle, 3)
      if (s.tilt > 1 && s.tilt < 179) expect(s.azimuth).toBeCloseTo(raw.azimuth_angle, 3)
    }
    expect(checked.length).toBeGreaterThan(10)
  })

  it('keeps every subsurface inside its base surface and in its plane', () => {
    let subsurfaces = 0
    for (const base of model.surfaces) {
      if (base.fenestration.length === 0) continue
      const frame = surfaceFrame(base.polygon)
      const uOrigin = dot3(frame.origin, frame.u)
      const wOrigin = dot3(frame.origin, frame.w)
      const nOrigin = dot3(frame.origin, frame.n)
      for (const index of base.fenestration) {
        subsurfaces++
        const sub = model.surfaces[index]
        for (let i = 0; i < sub.polygon.length; i += 3) {
          const p: Vec3 = [sub.polygon[i], sub.polygon[i + 1], sub.polygon[i + 2]]
          expect(dot3(p, frame.n) - nOrigin).toBeCloseTo(0, 6)
          expect(dot3(p, frame.u) - uOrigin).toBeGreaterThanOrEqual(-1e-6)
          expect(dot3(p, frame.w) - wOrigin).toBeGreaterThanOrEqual(-1e-6)
          expect(dot3(p, frame.u) - uOrigin).toBeLessThanOrEqual(frame.width + 1e-6)
          expect(dot3(p, frame.w) - wOrigin).toBeLessThanOrEqual(frame.height + 1e-6)
        }
        expect(base.netArea).toBeLessThan(base.area)
      }
    }
    expect(subsurfaces).toBeGreaterThan(0)
  })

  it('closes each zone: its walls enclose exactly the plan extent of its floor', () => {
    // The strongest positional check these models offer, and the one the
    // round-trip invariant cannot make. A mirrored length axis preserves every
    // normal, area, tilt and azimuth — walls simply run the wrong way from
    // their start points and stop meeting the floor they bound.
    let zonesChecked = 0
    for (const zone of model.zoneNames) {
      const inZone = model.surfaces.filter((s) => s.zone === zone && s.kind === 'building')
      const plan = (categories: string[]): [number, number, number, number] | null => {
        let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
        let seen = false
        for (const s of inZone.filter((x) => categories.includes(x.category))) {
          seen = true
          for (let i = 0; i < s.polygon.length; i += 3) {
            minX = Math.min(minX, s.polygon[i]); maxX = Math.max(maxX, s.polygon[i])
            minY = Math.min(minY, s.polygon[i + 1]); maxY = Math.max(maxY, s.polygon[i + 1])
          }
        }
        return seen ? [minX, maxX, minY, maxY] : null
      }
      const walls = plan(['wall'])
      const floor = plan(['floor'])
      if (walls === null || floor === null) continue
      zonesChecked++
      for (let i = 0; i < 4; i++) expect(walls[i], `${zone} bound ${i}`).toBeCloseTo(floor[i], 6)
    }
    expect(zonesChecked).toBeGreaterThan(0)
  })

  it('gives every surface a unique index matching its position', () => {
    // A Shading:Fin emits two surfaces from one object; if the second were
    // built before the first was pushed they would collide here, and the
    // collision would surface much later as mis-picked geometry.
    expect(model.surfaces.every((s, i) => s.index === i)).toBe(true)
  })

  it('anchors every attached shade to a window that exists, and inherits its zone', () => {
    const attached = model.surfaces.filter((s) => /^Shading:(Overhang|Fin)/.test(s.epType))
    expect(attached.length).toBeGreaterThan(0)
    for (const shade of attached) {
      const host = model.surfaces.find((s) => s.name === shade.hostSurface)
      expect(host, shade.name).toBeDefined()
      expect(host!.kind).toBe('fenestration')
      expect(shade.zone).toBe(host!.zone)
      expect(shade.category).toBe('shading')
    }
  })
})

describe('the fixture pair', () => {
  it('covers both coordinate modes', () => {
    const modes = FIXTURES.map((n) => models.get(n)!.meta.coordinateSystem.toLowerCase())
    expect(modes).toContain('world')
    expect(modes).toContain('relative')
  })

  it('between them exercises all 22 rectangular object types', () => {
    const used = new Set<string>()
    for (const model of models.values()) {
      for (const s of model.surfaces) used.add(s.epType)
    }
    expect([...RECT_TYPES].filter((t) => !used.has(t))).toEqual([])
  })
})
