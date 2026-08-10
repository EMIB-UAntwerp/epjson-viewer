import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseEpjson } from '../src/core/parse'
import { useModelStore } from '../src/stores/model'
import { CATEGORIES, type EpModel, type EpSurface, type EpZone, type EpBuildingGroup } from '../src/core/types'

/**
 * `useModelStore` is a Pinia setup store — its type-only imports (`RenderMode`,
 * `WorkerRequest`/`WorkerResponse`) never execute, and none of the behavior
 * under test touches `ensureWorker()`, so instantiating it here under
 * Node-environment Vitest (no DOM, no `Worker` global) is safe. Confirmed
 * `typeof Worker === 'undefined'` in this environment below.
 *
 * NOT COVERED HERE, DELIBERATELY: the on-load reset of `selectionLevel` to
 * 'surface' when a newly loaded model doesn't offer the currently held level.
 * That logic lives in `ensureWorker()`'s `worker.onmessage` 'done' handler,
 * which only runs after `new Worker(...)` — unavailable under Node-environment
 * Vitest (no `Worker` global, confirmed below). Reaching it honestly would
 * need a jsdom/browser test harness, which this suite does not have (see
 * `.agents/test-engineer.md`: "Tests are Node-environment Vitest against
 * `src/core/*`... a case that needs one is a BLOCKED report, not a new
 * dependency"). Faking it with a hand-rolled re-implementation of the handler
 * would test the fake, not the store, so it is left unpinned.
 */

/** Zone geometry (no vertices needed — only stats.zoneCount/buildingCount matter). */
function singleZoneModel(): Record<string, unknown> {
  return {
    Version: { 'Version 1': { version_identifier: '26.1' } },
    Building: { B: {} },
    Zone: { ZoneA: {} },
    'BuildingSurface:Detailed': {
      Wall1: {
        surface_type: 'Wall',
        zone_name: 'ZoneA',
        outside_boundary_condition: 'Outdoors',
        vertices: [
          { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 3 },
          { vertex_x_coordinate: 0, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 4, vertex_y_coordinate: 0, vertex_z_coordinate: 0 },
          { vertex_x_coordinate: 4, vertex_y_coordinate: 0, vertex_z_coordinate: 3 },
        ],
      },
    },
  }
}

/** Two zones under distinct UUID-prefixed buildings, so buildingCount === 2. */
function twoBuildingModel(): Record<string, unknown> {
  const json = singleZoneModel()
  const zones = json.Zone as Record<string, unknown>
  delete zones.ZoneA
  zones['ID_aaaaaaaa-1111-1111-1111-111111111111_Kerkstraat_1'] = {}
  zones['ID_bbbbbbbb-2222-2222-2222-222222222222_Dorpstraat_2'] = {}
  const surfaces = json['BuildingSurface:Detailed'] as Record<string, { zone_name: string }>
  surfaces.Wall1.zone_name = 'ID_aaaaaaaa-1111-1111-1111-111111111111_Kerkstraat_1'
  return json
}

describe('useModelStore: availableSelectionLevels', () => {
  it('offers only surface when there is no model', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    expect(store.availableSelectionLevels).toEqual(['surface'])
  })

  it('adds zone once the model has zones, but not building with a single building', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = parseEpjson(singleZoneModel(), 'x.epJSON')
    expect(store.availableSelectionLevels).toEqual(['surface', 'zone'])
  })

  it('adds building once stats.buildingCount > 1', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = parseEpjson(twoBuildingModel(), 'x.epJSON')
    expect(store.availableSelectionLevels).toEqual(['surface', 'zone', 'building'])
  })
})

describe('useModelStore: setSelectionLevel', () => {
  it('ignores a level the current model does not offer', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = parseEpjson(singleZoneModel(), 'x.epJSON') // no building level
    store.setSelectionLevel('building')
    expect(store.selectionLevel).toBe('surface')
    store.setSelectionLevel('zone')
    expect(store.selectionLevel).toBe('zone')
  })

  it('accepts every level once the model offers all three', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = parseEpjson(twoBuildingModel(), 'x.epJSON')
    store.setSelectionLevel('building')
    expect(store.selectionLevel).toBe('building')
  })
})

describe('useModelStore: cycleSelectionLevel', () => {
  it('steps only within the levels a zoneless model offers (stays on surface)', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    // No model loaded: availableSelectionLevels === ['surface']
    store.cycleSelectionLevel()
    expect(store.selectionLevel).toBe('surface')
  })

  it('cycles surface -> zone -> surface, skipping building with one building', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = parseEpjson(singleZoneModel(), 'x.epJSON')
    expect(store.selectionLevel).toBe('surface')
    store.cycleSelectionLevel()
    expect(store.selectionLevel).toBe('zone')
    store.cycleSelectionLevel()
    expect(store.selectionLevel).toBe('surface')
  })

  it('cycles surface -> zone -> building -> surface with more than one building', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = parseEpjson(twoBuildingModel(), 'x.epJSON')
    store.cycleSelectionLevel()
    expect(store.selectionLevel).toBe('zone')
    store.cycleSelectionLevel()
    expect(store.selectionLevel).toBe('building')
    store.cycleSelectionLevel()
    expect(store.selectionLevel).toBe('surface')
  })
})

describe('environment precondition', () => {
  it('has no global Worker under Node-environment Vitest', () => {
    expect(typeof Worker).toBe('undefined')
  })
})

/**
 * Hand-built `EpModel` (bypassing `parseEpjson`) so the fixture can pin the
 * exact invariant under test: `EpZone.surfaces` deliberately lists only the
 * host building surface, while the fenestration it hosts and the zone-anchored
 * shading beside it carry the same `zone`/`building` fields without being in
 * that list. If `selectionGroup` were ever switched to group on
 * `EpZone.surfaces` (the regression this suite exists to catch), the fenestration
 * and zone-shading indices below would silently drop out of the zone-level group.
 */
function surfaceFixture(overrides: Partial<EpSurface> & Pick<EpSurface, 'index' | 'name'>): EpSurface {
  return {
    kind: 'building',
    epType: 'BuildingSurface:Detailed',
    surfaceType: 'Wall',
    category: 'wall',
    zone: null,
    building: null,
    construction: null,
    boundaryCondition: null,
    boundaryObject: null,
    hostSurface: null,
    isInterior: false,
    isAirBoundary: false,
    polygon: [],
    holes: [],
    area: 0,
    netArea: 0,
    tilt: 90,
    azimuth: 0,
    fenestration: [],
    raw: {},
    ...overrides,
  }
}

/**
 * One zone ("Z1") in one building ("Bldg1") holding:
 *  - Host: a building surface — the only member `zones.Z1.surfaces` lists.
 *  - Win: fenestration hosted by Host — same zone/building, absent from
 *    `zones.Z1.surfaces` (parse.ts only ever pushes building surfaces there).
 *  - ZoneShade: Shading:Zone:Detailed anchored to Host's zone — same story.
 *  - BldgShade: Shading:Building:Detailed — building set, zone null.
 *  - Site: Shading:Site:Detailed — both zone and building null.
 * "Zghost"/"Bghost" are surface-level zone/building names with no matching
 * entry in `model.zones` / `model.buildings`, for the label-fallback case.
 */
function selectionFixtureModel(): EpModel {
  const surfaces: EpSurface[] = [
    surfaceFixture({ index: 0, name: 'Host', zone: 'Z1', building: 'Bldg1' }),
    surfaceFixture({
      index: 1,
      name: 'Win',
      kind: 'fenestration',
      epType: 'FenestrationSurface:Detailed',
      surfaceType: 'Window',
      category: 'window',
      zone: 'Z1',
      building: 'Bldg1',
      hostSurface: 'Host',
    }),
    surfaceFixture({
      index: 2,
      name: 'ZoneShade',
      kind: 'shading',
      epType: 'Shading:Zone:Detailed',
      surfaceType: 'Shading',
      category: 'shading',
      zone: 'Z1',
      building: 'Bldg1',
    }),
    surfaceFixture({
      index: 3,
      name: 'BldgShade',
      kind: 'shading',
      epType: 'Shading:Building:Detailed',
      surfaceType: 'Shading',
      category: 'shading',
      zone: null,
      building: 'Bldg1',
    }),
    surfaceFixture({
      index: 4,
      name: 'Site',
      kind: 'shading',
      epType: 'Shading:Site:Detailed',
      surfaceType: 'Shading',
      category: 'shading',
      zone: null,
      building: null,
    }),
    surfaceFixture({ index: 5, name: 'GhostWall', zone: 'Zghost', building: 'Bghost' }),
  ]

  const zones: Record<string, EpZone> = {
    Z1: {
      name: 'Z1',
      label: 'Zone One',
      building: 'Bldg1',
      origin: [0, 0, 0],
      relativeNorth: 0,
      ceilingHeight: null,
      volume: null,
      floorArea: 0,
      surfaces: [0], // deliberately excludes Win (1) and ZoneShade (2)
    },
  }
  const buildings: Record<string, EpBuildingGroup> = {
    Bldg1: { name: 'Bldg1', label: 'Building One', zones: ['Z1'] },
  }

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<(typeof CATEGORIES)[number], number>

  return {
    fileName: 'fixture.epJSON',
    surfaces,
    zones,
    zoneNames: ['Z1'],
    buildings,
    buildingNames: ['Bldg1'],
    constructionNames: [],
    meta: {
      epVersion: null,
      buildingName: 'Bldg1',
      northAxis: 0,
      coordinateSystem: 'Relative',
      terrain: null,
      site: null,
      center: [0, 0, 0],
      bboxSize: [0, 0, 0],
    },
    stats: {
      counts,
      surfaceCount: surfaces.length,
      totalFloorArea: 0,
      exteriorWallArea: 0,
      exteriorWindowArea: 0,
      wwr: null,
      zoneCount: 1,
      // `setSelectionLevel`/`availableSelectionLevels` gate on stats.buildingCount
      // (>1), independent of how many buildings.* entries actually exist — set
      // to 2 purely so the fixture can reach 'building' via setSelectionLevel;
      // selectionGroup itself only reads `model.buildings`/`surfacesByBuilding`.
      buildingCount: 2,
    },
    warnings: [],
  }
}

describe('useModelStore: selectionGroup', () => {
  it('surface level: key is null and label is the surface name', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = selectionFixtureModel()
    store.select(0) // Host
    expect(store.selectionGroup).toEqual({ level: 'surface', key: null, label: 'Host', indices: [0] })
  })

  it('zone level groups on surface.zone, pulling in hosted fenestration and zone shading that EpZone.surfaces omits', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = selectionFixtureModel()
    store.select(0) // Host, anchor
    store.setSelectionLevel('zone')
    const group = store.selectionGroup
    expect(group?.level).toBe('zone')
    expect(group?.key).toBe('Z1')
    expect(group?.label).toBe('Zone One')
    // Host + Win + ZoneShade, even though zones.Z1.surfaces === [0] only.
    expect(group?.indices.sort()).toEqual([0, 1, 2])
  })

  it('building level groups on surface.building, including building shading but not site shading', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = selectionFixtureModel()
    store.select(0) // Host, anchor
    store.setSelectionLevel('building')
    const group = store.selectionGroup
    expect(group?.level).toBe('building')
    expect(group?.key).toBe('Bldg1')
    expect(group?.label).toBe('Building One')
    expect(group?.indices.sort()).toEqual([0, 1, 2, 3])
  })

  it('site shading (zone and building both null) falls back to the single anchor at every level', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = selectionFixtureModel()
    store.select(4) // Site
    for (const level of ['surface', 'zone', 'building'] as const) {
      store.setSelectionLevel(level)
      expect(store.selectionGroup).toEqual({ level: 'surface', key: null, label: 'Site', indices: [4] })
    }
  })

  it('label falls back to the raw zone/building key when the model has no matching entry', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    store.model = selectionFixtureModel()
    store.select(5) // GhostWall: zone "Zghost", building "Bghost", neither defined on the model
    store.setSelectionLevel('zone')
    expect(store.selectionGroup).toEqual({ level: 'zone', key: 'Zghost', label: 'Zghost', indices: [5] })
    store.setSelectionLevel('building')
    expect(store.selectionGroup).toEqual({ level: 'building', key: 'Bghost', label: 'Bghost', indices: [5] })
  })

  it('returns null with no selection and null with no model', () => {
    setActivePinia(createPinia())
    const store = useModelStore()
    expect(store.selectionGroup).toBeNull() // no model
    store.model = selectionFixtureModel()
    expect(store.selectionGroup).toBeNull() // no selection
  })
})
