import { describe, expect, it } from 'vitest'
import { parseEpjson } from '../src/core/parse'
import { buildGeometry } from '../src/core/buildBuffers'
import { summarizeSurfaces } from '../src/core/metrics'
import { CATEGORIES, groupKeyOf, type EpSurface } from '../src/core/types'

/** Minimal synthetic epJSON exercising the relative-coordinate transform. */
function syntheticModel(): Record<string, unknown> {
  return {
    Version: { 'Version 1': { version_identifier: '26.1' } },
    Building: { TestBuilding: { north_axis: 0, terrain: 'City' } },
    GlobalGeometryRules: {
      Rules: {
        coordinate_system: 'Relative',
        starting_vertex_position: 'UpperLeftCorner',
        vertex_entry_direction: 'Counterclockwise',
      },
    },
    Zone: {
      ZoneA: { x_origin: 10, y_origin: 20, z_origin: 5, direction_of_relative_north: 90 },
    },
    'BuildingSurface:Detailed': {
      WallSouth: {
        surface_type: 'Wall',
        zone_name: 'ZoneA',
        construction_name: 'C1',
        outside_boundary_condition: 'Outdoors',
        // South-facing 4×3 wall at the zone origin, relative coords
        vertices: [
          { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 3 },
          { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 4, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 4, vertex_y_coordinate: 0, vertex_z_coordinate: 3 },
        ],
        is_shared: true, // non-schema field must be tolerated
      },
      FloorA: {
        surface_type: 'Floor',
        zone_name: 'ZoneA',
        outside_boundary_condition: 'Ground',
        vertices: [
          { vertex_x_coordinate: 0, vertex_y_coordinate: 4, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 4, vertex_y_coordinate: 4, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 4, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
        ],
      },
    },
    'FenestrationSurface:Detailed': {
      Window1: {
        surface_type: 'Window',
        building_surface_name: 'WallSouth',
        vertex_1_x_coordinate: 1,
        vertex_1_y_coordinate: 0,
        vertex_1_z_coordinate: 2,
        vertex_2_x_coordinate: 1,
        vertex_2_y_coordinate: 0,
        vertex_2_z_coordinate: 1,
        vertex_3_x_coordinate: 3,
        vertex_3_y_coordinate: 0,
        vertex_3_z_coordinate: 1,
        vertex_4_x_coordinate: 3,
        vertex_4_y_coordinate: 0,
        vertex_4_z_coordinate: 2,
      },
    },
    'Shading:Site:Detailed': {
      Context_1: {
        vertices: [
          { vertex_x_coordinate: 50, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 55, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 55, vertex_y_coordinate: 0, vertex_z_coordinate: 8 },
          { vertex_x_coordinate: 50, vertex_y_coordinate: 0, vertex_z_coordinate: 8 },
        ],
      },
    },
    'Site:Location': { Loc: { city: 'Antwerpen', reference_system: 'urn:ogc:def:crs:EPSG::31370' } },
  }
}

describe('parseEpjson', () => {
  it('applies the relative-coordinate transform (zone rotation + origin)', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const wall = model.surfaces.find((s) => s.name === 'WallSouth')!
    // Zone rotated 90° clockwise: relative (4,0,0) → world (10, 16, 5) before
    // recentering. Check via original coords = stored + center.
    const c = model.meta.center
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < wall.polygon.length; i += 3) {
      xs.push(wall.polygon[i] + c[0])
      ys.push(wall.polygon[i + 1] + c[1])
    }
    // Wall runs along -Y from the origin after 90° clockwise zone rotation
    expect(Math.min(...xs)).toBeCloseTo(10)
    expect(Math.max(...xs)).toBeCloseTo(10)
    expect(Math.max(...ys)).toBeCloseTo(20)
    expect(Math.min(...ys)).toBeCloseTo(16)
    expect(wall.polygon[2] + c[2]).toBeCloseTo(8) // z 3 + origin 5
  })

  it('rotates the outward normal with the zone (azimuth 180 → 270)', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const wall = model.surfaces.find((s) => s.name === 'WallSouth')!
    // South-facing wall in a zone rotated 90° clockwise now faces west (270°)
    expect(wall.azimuth).toBeCloseTo(270)
    expect(wall.tilt).toBeCloseTo(90)
  })

  it('attaches fenestration to its host as hole rings', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const wall = model.surfaces.find((s) => s.name === 'WallSouth')!
    const win = model.surfaces.find((s) => s.name === 'Window1')!
    expect(wall.holes.length).toBe(1)
    expect(wall.fenestration).toEqual([win.index])
    expect(win.hostSurface).toBe('WallSouth')
    expect(win.zone).toBe('ZoneA')
    expect(wall.area).toBeCloseTo(12)
    expect(wall.netArea).toBeCloseTo(10)
    expect(win.area).toBeCloseTo(2)
  })

  it('leaves site shading untransformed and computes stats', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const shade = model.surfaces.find((s) => s.name === 'Context_1')!
    expect(shade.category).toBe('shading')
    const c = model.meta.center
    expect(shade.polygon[0] + c[0]).toBeCloseTo(50)
    expect(model.stats.counts.wall).toBe(1)
    expect(model.stats.counts.window).toBe(1)
    expect(model.stats.counts.shading).toBe(1)
    expect(model.stats.wwr).toBeCloseTo(2 / 12)
    expect(model.stats.zoneCount).toBe(1)
    expect(model.meta.epVersion).toBe('26.1')
  })

  it('groups urban zone names into buildings by the _F floor marker', () => {
    const json = syntheticModel()
    const zones = json.Zone as Record<string, unknown>
    zones['ID_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee_Teststraat_5_F1_Core'] = {}
    zones['ID_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee_Teststraat_5_F2_P1'] = {}
    zones['ID_11111111-2222-3333-4444-555555555555_Anderelaan_9'] = {}
    const model = parseEpjson(json, 'x.epJSON')
    const b1 = model.zones['ID_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee_Teststraat_5_F1_Core'].building
    expect(b1).toBe('ID_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee_Teststraat_5')
    expect(model.buildings[b1].label).toBe('Teststraat 5')
    expect(model.zones['ID_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee_Teststraat_5_F1_Core'].label).toBe('F1 Core')
    expect(model.zones['ID_11111111-2222-3333-4444-555555555555_Anderelaan_9'].building).toBe(
      'ID_11111111-2222-3333-4444-555555555555_Anderelaan_9',
    )
  })

  it('throws a clear error for non-epJSON input', () => {
    expect(() => parseEpjson([1, 2, 3], 'x.json')).toThrow(/top level/)
    expect(() => parseEpjson({ some: 'json' }, 'x.json')).toThrow(/No geometry/)
  })
})

describe('parseEpjson: urban building grouping', () => {
  /** Same synthetic model, but with the default `ZoneA` cleared so only the
   * caller's zone names participate in grouping (WallSouth's zone_name then
   * refers to nothing, which just produces an "unknown zone" warning). */
  function withZones(zoneNames: string[]): Record<string, unknown> {
    const json = syntheticModel()
    const zoneMap: Record<string, unknown> = {}
    for (const name of zoneNames) zoneMap[name] = {}
    json.Zone = zoneMap
    return json
  }

  it('groups the same building across five real-world zone-suffix shapes', () => {
    const uuid = 'ID_aaaaaaaa-1111-1111-1111-111111111111'
    const address = `${uuid}_Kerkstraat_1`
    const shapes: string[][] = [
      [address], // suffix absent
      [`${address}_P1`, `${address}_Core`], // _P1 / _Core, single floor implied
      [`${address}_F1`], // _F1, lone zone
      [`${address}_F1_P1`, `${address}_F2_P1`], // _F1_P1, multiple floors
      // _F1_P1 / _F1_Core: every zone shares the SAME floor, so the common
      // prefix computed across zones already ends in "_F1" — only the
      // trailing _F<n> trim (not segment disagreement) drops it to the
      // address. Distinct from the shape above, where floor segments
      // disagree and the prefix stops before "_F" on its own.
      [`${address}_F1_P1`, `${address}_F1_Core`],
    ]
    for (const zoneNames of shapes) {
      const model = parseEpjson(withZones(zoneNames), 'x.epJSON')
      expect(model.stats.buildingCount).toBe(1)
      for (const name of zoneNames) expect(model.zones[name].building).toBe(address)
      expect(model.buildings[address].label).toBe('Kerkstraat 1')
    }
  })

  it('trims a shared trailing floor marker even when every zone in the group agrees on it', () => {
    // The single-floor "floor/core/perim" shape: F1_P1 and F1_Core share their
    // floor segment, so commonSegmentPrefix alone would stop at "..._F1" — the
    // _F\d+ trim is what pulls the key back to the bare address.
    const uuid = 'ID_dddddddd-4444-4444-4444-444444444444'
    const address = `${uuid}_Kerkstraat_1`
    const p1 = `${address}_F1_P1`
    const core = `${address}_F1_Core`
    const model = parseEpjson(withZones([p1, core]), 'x.epJSON')
    expect(model.zones[p1].building).toBe(address)
    expect(model.zones[core].building).toBe(address)
    expect(model.buildings[address].label).toBe('Kerkstraat 1')
    expect(model.zones[p1].label).toBe('F1 P1')
    expect(model.zones[core].label).toBe('F1 Core')
  })

  it('keeps a single-building file at one building when zones use _F1_P1 naming', () => {
    const uuid = 'ID_bbbbbbbb-2222-2222-2222-222222222222'
    const address = `${uuid}_Dorpstraat_10`
    const zoneNames = [`${address}_F1_P1`, `${address}_F2_P1`, `${address}_F3_Core`]
    const model = parseEpjson(withZones(zoneNames), 'x.epJSON')
    expect(model.stats.buildingCount).toBe(1)
    expect(model.stats.zoneCount).toBe(3)
    for (const name of zoneNames) expect(model.zones[name].building).toBe(address)
  })

  it('keys a lone zone that carries only a floor marker (no street) on its bare UUID', () => {
    const uuid = 'ID_cccccccc-3333-3333-3333-333333333333'
    const zoneName = `${uuid}_F1`
    const model = parseEpjson(withZones([zoneName]), 'x.epJSON')
    expect(model.stats.buildingCount).toBe(1)
    expect(model.zones[zoneName].building).toBe(uuid)
    // No address remains in the key, so the label falls back to a UUID fragment.
    expect(model.buildings[uuid].label).toBe('Building cccccccc')
  })

  it('disambiguates two distinct buildings that share a street label via a UUID fragment', () => {
    const zoneA = 'ID_dddddddd-4444-4444-4444-444444444444_Kerkstraat_1'
    const zoneB = 'ID_eeeeeeee-5555-5555-5555-555555555555_Kerkstraat_1'
    const model = parseEpjson(withZones([zoneA, zoneB]), 'x.epJSON')
    expect(model.stats.buildingCount).toBe(2)
    expect(model.buildings[zoneA].label).toBe('Kerkstraat 1 · dddddddd')
    expect(model.buildings[zoneB].label).toBe('Kerkstraat 1 · eeeeeeee')
  })

  it('falls back to the Building object name when a zone carries no UUID prefix', () => {
    // syntheticModel()'s own ZoneA (no UUID) exercises the conventional
    // single-building epJSON case already covered elsewhere; this asserts the
    // fallback survives alongside an unrelated urban zone in the same file.
    const json = syntheticModel()
    const zones = json.Zone as Record<string, unknown>
    zones['ID_ffffffff-6666-6666-6666-666666666666_Kerkstraat_2'] = {}
    const model = parseEpjson(json, 'x.epJSON')
    expect(model.zones.ZoneA.building).toBe('Building') // no Building.name field set in the fixture
    expect(model.stats.buildingCount).toBe(2)
  })
})

describe('summarizeSurfaces', () => {
  it('reproduces the model-wide stats it was extracted from', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const summary = summarizeSurfaces(model.surfaces)
    expect(summary.counts).toEqual(model.stats.counts)
    expect(summary.surfaceCount).toBe(model.stats.surfaceCount)
    expect(summary.totalFloorArea).toBeCloseTo(model.stats.totalFloorArea)
    expect(summary.exteriorWallArea).toBeCloseTo(model.stats.exteriorWallArea)
    expect(summary.exteriorWindowArea).toBeCloseTo(model.stats.exteriorWindowArea)
    expect(summary.wwr).toBeCloseTo(model.stats.wwr!)
  })

  it('summarizes a single zone the way the selection card will', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    // Grouping on surface.zone (not EpZone.surfaces) picks up the fenestration
    const zoneA = model.surfaces.filter((s) => s.zone === 'ZoneA')
    const summary = summarizeSurfaces(zoneA)
    expect(summary.surfaceCount).toBe(3) // wall + floor + window
    expect(summary.counts.shading).toBe(0) // site context is not in the zone
    expect(summary.totalFloorArea).toBeCloseTo(16)
    expect(summary.exteriorWallArea).toBeCloseTo(12)
    expect(summary.exteriorWindowArea).toBeCloseTo(2)
    expect(summary.wwr).toBeCloseTo(2 / 12)
  })

  it('partitions the model: per-zone subsets plus zoneless surfaces = the whole', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const subsets = model.zoneNames.map((z) => model.surfaces.filter((s) => s.zone === z))
    subsets.push(model.surfaces.filter((s) => s.zone === null))

    const totals = subsets.map(summarizeSurfaces)
    const sum = (pick: (x: (typeof totals)[number]) => number): number => totals.reduce((n, t) => n + pick(t), 0)
    expect(sum((t) => t.surfaceCount)).toBe(model.stats.surfaceCount)
    expect(sum((t) => t.totalFloorArea)).toBeCloseTo(model.stats.totalFloorArea)
    expect(sum((t) => t.exteriorWallArea)).toBeCloseTo(model.stats.exteriorWallArea)
    for (const c of CATEGORIES) expect(sum((t) => t.counts[c])).toBe(model.stats.counts[c])
  })

  it('reports no WWR for a group with no exterior walls', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const shading = model.surfaces.filter((s) => s.category === 'shading')
    expect(summarizeSurfaces(shading).wwr).toBeNull()
    expect(summarizeSurfaces([]).surfaceCount).toBe(0)
  })
})

describe('buildGeometry', () => {
  it('produces finite buffers with a range for every surface', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const { bundle, warnings } = buildGeometry(model)
    expect(warnings).toEqual([])
    expect(bundle.triangleCount).toBeGreaterThan(0)

    let ranged = 0
    for (const group of Object.values(bundle.groups)) {
      if (!group) continue
      expect(group.positions.length).toBe(group.normals.length)
      expect(group.positions.length / 9).toBe(group.triSurface.length)
      for (const v of group.positions) expect(Number.isFinite(v)).toBe(true)
      ranged += Object.keys(group.ranges).length
    }
    expect(ranged).toBe(model.surfaces.length)
  })

  it('maps every edge segment to its surface so zones can be masked', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const { bundle } = buildGeometry(model)

    for (const group of Object.values(bundle.groups)) {
      if (!group) continue
      // Two vertices (6 floats) per segment, one surface id per segment
      expect(group.edgeSurface.length).toBe(group.edges.length / 6)
      for (const si of group.edgeSurface) expect(model.surfaces[si]).toBeDefined()
    }
  })

  it('lets a zone be masked out by walking triSurface', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const { bundle } = buildGeometry(model)
    const hidden = new Set(['ZoneA'])

    let kept = 0
    let dropped = 0
    for (const group of Object.values(bundle.groups)) {
      if (!group) continue
      for (const t of group.triSurface) {
        const zone = model.surfaces[t].zone
        if (zone !== null && hidden.has(zone)) dropped++
        else kept++
      }
    }
    expect(dropped).toBeGreaterThan(0) // the zone's walls/windows go away
    expect(kept).toBeGreaterThan(0) // site shading has no zone and stays
    const shade = model.surfaces.find((s) => s.name === 'Context_1')!
    expect(shade.zone).toBeNull()
    expect(groupKeyOf(shade)).toBe('shading:ext')
  })

  it('names surfaces that fail triangulation despite having area, but suppresses zero-area ones', () => {
    const model = parseEpjson(syntheticModel(), 'synthetic.epJSON')
    const base = model.surfaces[0]
    // A degenerate (2-point) ring can't be triangulated regardless of its
    // reported area — only the "has real area" one should be named here,
    // since the zero-area one is already covered by parse.ts's own warning.
    const withArea: EpSurface = { ...base, index: model.surfaces.length, name: 'GhostWall', polygon: [0, 0, 0, 1, 0, 0], holes: [], area: 5 }
    const zeroArea: EpSurface = { ...base, index: model.surfaces.length + 1, name: 'FlatWall', polygon: [0, 0, 0, 1, 0, 0], holes: [], area: 0 }
    model.surfaces.push(withArea, zeroArea)

    const { warnings } = buildGeometry(model)
    expect(warnings).toContain('GhostWall: degenerate surface — could not be triangulated')
    expect(warnings.some((w) => w.includes('FlatWall'))).toBe(false)
  })
})
