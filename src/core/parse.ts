/**
 * Lenient epJSON → normalized EpModel parser.
 *
 * Real-world epJSON files carry non-schema fields (custom Site:Location keys,
 * is_shared flags, …) — everything unknown is ignored, nothing is validated
 * strictly. Only geometry-bearing objects are read.
 *
 * Coordinate handling follows EnergyPlus SurfaceGeometry.cc exactly:
 *   relative mode:  rotate by -zone.direction_of_relative_north, translate by
 *                   zone origin, then rotate by -(building.north_axis + appG)
 *   world mode:     rotate by -appG only
 *   site shading:   never rotated
 * All rotation angles are degrees clockwise from north, hence the negation.
 */

import { summarizeSurfaces, surfaceMetrics } from './metrics'
import { polygonArea, type Vec3 } from './plane'
import {
  finRings,
  overhangRing,
  rectRingFromAngles,
  rectRingFromAxes,
  surfaceFrame,
  type SurfaceFrame,
} from './rectSurfaces'
import {
  type Category,
  type EpBuildingGroup,
  type EpModel,
  type EpSurface,
  type EpZone,
  type ModelStats,
  type SurfaceKind,
} from './types'

type Obj = Record<string, unknown>

const DEG = Math.PI / 180
const UUID_RE = /^ID_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
const MAX_WARNINGS = 80

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function objectsOf(root: Obj, type: string): [string, Obj][] {
  const group = root[type]
  if (!group || typeof group !== 'object') return []
  return Object.entries(group as Record<string, Obj>)
}

function firstOf(root: Obj, type: string): Obj | null {
  const entries = objectsOf(root, type)
  return entries.length > 0 ? entries[0][1] : null
}

/** vertices: [{vertex_x_coordinate, …}, …] → flat xyz */
function readVertexArray(o: Obj): number[] {
  const arr = o.vertices
  if (!Array.isArray(arr)) return []
  const out: number[] = []
  for (const v of arr) {
    if (!v || typeof v !== 'object') continue
    const vo = v as Obj
    out.push(num(vo.vertex_x_coordinate), num(vo.vertex_y_coordinate), num(vo.vertex_z_coordinate))
  }
  return out
}

/** FenestrationSurface:Detailed flat vertex_1_x_coordinate … vertex_4_z_coordinate → flat xyz */
function readFlatVertices(o: Obj): number[] {
  const out: number[] = []
  for (let i = 1; i <= 4; i++) {
    const x = o[`vertex_${i}_x_coordinate`]
    const y = o[`vertex_${i}_y_coordinate`]
    const z = o[`vertex_${i}_z_coordinate`]
    if (x === undefined && y === undefined && z === undefined) break
    out.push(num(x), num(y), num(z))
  }
  return out
}

interface ZoneFrame {
  cosZ: number
  sinZ: number
  ox: number
  oy: number
  oz: number
}

/** Everything a surface needs beyond the computed and always-empty fields. */
interface SurfaceInit {
  name: string
  kind: SurfaceKind
  epType: string
  surfaceType: string
  category: Category
  polygon: number[]
  raw: Obj
  zone?: string | null
  building?: string | null
  construction?: string | null
  boundaryCondition?: string | null
  boundaryObject?: string | null
  hostSurface?: string | null
  isInterior?: boolean
  isAirBoundary?: boolean
}

/** Outside boundary conditions that put a surface between two conditioned spaces. */
function isInteriorBc(bc: string | null): boolean {
  return bc !== null && /^(surface|zone|space)$/i.test(bc)
}

interface RectHtSource {
  epType: string
  surfaceType: 'Wall' | 'Roof' | 'Ceiling' | 'Floor'
  /** These objects carry no boundary field — the type is the condition. */
  boundaryCondition: 'Outdoors' | 'Adiabatic' | 'Ground' | 'Surface'
  /** EnergyPlus defaults tilt per family; reading 0 for a floor inverts it. */
  defaultTilt: 0 | 90 | 180
  /** Walls are `height`; roofs, ceilings and floors are `width`. */
  heightField: 'height' | 'width'
}

const RECT_HT_SOURCES: RectHtSource[] = [
  { epType: 'Wall:Exterior', surfaceType: 'Wall', boundaryCondition: 'Outdoors', defaultTilt: 90, heightField: 'height' },
  { epType: 'Wall:Adiabatic', surfaceType: 'Wall', boundaryCondition: 'Adiabatic', defaultTilt: 90, heightField: 'height' },
  { epType: 'Wall:Underground', surfaceType: 'Wall', boundaryCondition: 'Ground', defaultTilt: 90, heightField: 'height' },
  { epType: 'Wall:Interzone', surfaceType: 'Wall', boundaryCondition: 'Surface', defaultTilt: 90, heightField: 'height' },
  { epType: 'Roof', surfaceType: 'Roof', boundaryCondition: 'Outdoors', defaultTilt: 0, heightField: 'width' },
  { epType: 'Ceiling:Adiabatic', surfaceType: 'Ceiling', boundaryCondition: 'Adiabatic', defaultTilt: 0, heightField: 'width' },
  { epType: 'Ceiling:Interzone', surfaceType: 'Ceiling', boundaryCondition: 'Surface', defaultTilt: 0, heightField: 'width' },
  { epType: 'Floor:GroundContact', surfaceType: 'Floor', boundaryCondition: 'Ground', defaultTilt: 180, heightField: 'width' },
  { epType: 'Floor:Adiabatic', surfaceType: 'Floor', boundaryCondition: 'Adiabatic', defaultTilt: 180, heightField: 'width' },
  { epType: 'Floor:Interzone', surfaceType: 'Floor', boundaryCondition: 'Surface', defaultTilt: 180, heightField: 'width' },
]

interface RectSubSource {
  epType: string
  surfaceType: 'Window' | 'Door' | 'GlassDoor'
  interzone: boolean
}

const RECT_SUB_SOURCES: RectSubSource[] = [
  { epType: 'Window', surfaceType: 'Window', interzone: false },
  { epType: 'Window:Interzone', surfaceType: 'Window', interzone: true },
  { epType: 'Door', surfaceType: 'Door', interzone: false },
  { epType: 'Door:Interzone', surfaceType: 'Door', interzone: true },
  { epType: 'GlazedDoor', surfaceType: 'GlassDoor', interzone: false },
  { epType: 'GlazedDoor:Interzone', surfaceType: 'GlassDoor', interzone: true },
]

/** `true` when the object states its depth as a fraction of the window. */
const OVERHANG_SOURCES: [epType: string, projection: boolean][] = [
  ['Shading:Overhang', false],
  ['Shading:Overhang:Projection', true],
]

const FIN_SOURCES: [epType: string, projection: boolean][] = [
  ['Shading:Fin', false],
  ['Shading:Fin:Projection', true],
]

function rectOrigin(o: Obj): Vec3 {
  return [
    num(o.starting_x_coordinate),
    num(o.starting_y_coordinate),
    num(o.starting_z_coordinate),
  ]
}

export function parseEpjson(json: unknown, fileName: string): EpModel {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Not an epJSON file: top level must be a JSON object')
  }
  const root = json as Obj
  const warnings: string[] = []
  const warn = (msg: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(msg)
    else if (warnings.length === MAX_WARNINGS) warnings.push('… further warnings suppressed')
  }

  // --- Global rules and building rotation -------------------------------
  const rules = firstOf(root, 'GlobalGeometryRules') ?? {}
  const coordinateSystem = str(rules.coordinate_system) ?? 'Relative'
  const isWorld = /world|absolute/i.test(coordinateSystem)
  const clockwise = /clockwise/i.test(str(rules.vertex_entry_direction) ?? 'Counterclockwise')
    && !/counterclockwise/i.test(str(rules.vertex_entry_direction) ?? '')
  // Rectangular surfaces read their own field, so one file can be World for
  // detailed geometry and Relative for the simple objects.
  const rectCoordinateSystem = str(rules.rectangular_surface_coordinate_system) ?? 'Relative'
  const isRectWorld = /world|absolute/i.test(rectCoordinateSystem)

  const buildingObj = firstOf(root, 'Building')
  const northAxis = num(buildingObj?.north_axis, 0)
  const appG = num(firstOf(root, 'Compliance:Building')?.building_rotation_for_appendix_g, 0)

  const cosB = Math.cos(-(northAxis + appG) * DEG)
  const sinB = Math.sin(-(northAxis + appG) * DEG)
  const cosG = Math.cos(-appG * DEG)
  const sinG = Math.sin(-appG * DEG)

  // --- Zones -------------------------------------------------------------
  const zones: Record<string, EpZone> = {}
  const zoneFrames = new Map<string, ZoneFrame>()
  const buildingFallback = str(buildingObj?.name) ?? 'Building'

  // Building keys depend on the other zones in the group, so they are resolved
  // for the whole file before any single zone is built.
  const zoneEntries = objectsOf(root, 'Zone')
  const buildingOfZone = groupZonesIntoBuildings(
    zoneEntries.map(([name]) => name),
    buildingFallback,
  )

  for (const [name, o] of zoneEntries) {
    const relNorth = num(o.direction_of_relative_north, 0)
    zoneFrames.set(name, {
      cosZ: Math.cos(-relNorth * DEG),
      sinZ: Math.sin(-relNorth * DEG),
      ox: num(o.x_origin, 0),
      oy: num(o.y_origin, 0),
      oz: num(o.z_origin, 0),
    })
    const building = buildingOfZone.get(name) ?? buildingFallback
    zones[name] = {
      name,
      label: zoneLabel(name, building),
      building,
      origin: [num(o.x_origin, 0), num(o.y_origin, 0), num(o.z_origin, 0)],
      relativeNorth: relNorth,
      ceilingHeight: o.ceiling_height !== undefined && typeof o.ceiling_height !== 'string' ? num(o.ceiling_height) : null,
      volume: o.volume !== undefined && typeof o.volume !== 'string' ? num(o.volume) : null,
      floorArea: 0,
      surfaces: [],
    }
  }

  // --- Air-boundary constructions ---------------------------------------
  const airBoundaryConstructions = new Set(objectsOf(root, 'Construction:AirBoundary').map(([n]) => n))

  // --- Transforms --------------------------------------------------------
  const identityFrame: ZoneFrame = { cosZ: 1, sinZ: 0, ox: 0, oy: 0, oz: 0 }

  /**
   * Building surfaces, fenestration, zone shading (zone-anchored geometry).
   * Parameterised on the coordinate system because detailed and rectangular
   * surfaces read separate GlobalGeometryRules fields.
   */
  const makeZoneTransform = (world: boolean) => (poly: number[], zoneName: string | null): void => {
    if (world) {
      if (appG === 0) return
      for (let i = 0; i < poly.length; i += 3) {
        const x = poly[i]
        const y = poly[i + 1]
        poly[i] = x * cosG - y * sinG
        poly[i + 1] = x * sinG + y * cosG
      }
      return
    }
    const f = (zoneName && zoneFrames.get(zoneName)) || identityFrame
    for (let i = 0; i < poly.length; i += 3) {
      const xb = poly[i] * f.cosZ - poly[i + 1] * f.sinZ + f.ox
      const yb = poly[i] * f.sinZ + poly[i + 1] * f.cosZ + f.oy
      poly[i] = xb * cosB - yb * sinB
      poly[i + 1] = xb * sinB + yb * cosB
      poly[i + 2] += f.oz
    }
  }

  /** Shading:Building[:Detailed] — rotates with the building, no zone. */
  const makeBuildingShadingTransform = (world: boolean) => (poly: number[]): void => {
    const c = world ? cosG : cosB
    const s = world ? sinG : sinB
    if (c === 1 && s === 0) return
    for (let i = 0; i < poly.length; i += 3) {
      const x = poly[i]
      const y = poly[i + 1]
      poly[i] = x * c - y * s
      poly[i + 1] = x * s + y * c
    }
  }

  const zoneTransform = makeZoneTransform(isWorld)
  const buildingShadingTransform = makeBuildingShadingTransform(isWorld)
  const rectZoneTransform = makeZoneTransform(isRectWorld)
  const rectBuildingShadingTransform = makeBuildingShadingTransform(isRectWorld)

  // --- Surfaces ----------------------------------------------------------
  const surfaces: EpSurface[] = []
  const surfaceByName = new Map<string, EpSurface>()
  const surfaceByFoldedName = new Map<string, EpSurface>()
  const constructionSet = new Set<string>()
  let rectSurfaceCount = 0

  const pushSurface = (s: EpSurface): void => {
    surfaces.push(s)
    surfaceByName.set(s.name, s)
    surfaceByFoldedName.set(s.name.toLowerCase(), s)
    if (s.construction) constructionSet.add(s.construction)
  }

  /**
   * EnergyPlus uppercases every name as it reads the input, so a reference
   * whose casing differs from its target still resolves there. epJSON keeps
   * the author's casing, so exact matching alone would drop the geometry that
   * hangs off the reference. Exact match wins; folding is only a fallback.
   */
  const findSurface = (name: string | null): EpSurface | undefined => {
    if (name === null) return undefined
    return surfaceByName.get(name) ?? surfaceByFoldedName.get(name.toLowerCase())
  }

  /**
   * Placement frames for surfaces that host rectangular geometry. Valid only
   * before recentering, because `SurfaceFrame.origin` is an absolute
   * coordinate; every caller runs in the surface passes below.
   */
  const frameCache = new Map<number, SurfaceFrame>()
  const frameOf = (s: EpSurface): SurfaceFrame => {
    let f = frameCache.get(s.index)
    if (f === undefined) {
      f = surfaceFrame(s.polygon)
      frameCache.set(s.index, f)
    }
    return f
  }

  /**
   * Fills in the fields every surface shares. `index` is read at call time, so
   * a caller that builds two surfaces must `pushSurface` the first before
   * making the second — two surfaces sharing an index silently collide in
   * `GroupBuffers.ranges` and break picking.
   */
  const makeSurface = (init: SurfaceInit): EpSurface => ({
    index: surfaces.length,
    name: init.name,
    kind: init.kind,
    epType: init.epType,
    surfaceType: init.surfaceType,
    category: init.category,
    zone: init.zone ?? null,
    building: init.building ?? null,
    construction: init.construction ?? null,
    boundaryCondition: init.boundaryCondition ?? null,
    boundaryObject: init.boundaryObject ?? null,
    hostSurface: init.hostSurface ?? null,
    isInterior: init.isInterior ?? false,
    isAirBoundary: init.isAirBoundary ?? false,
    polygon: init.polygon,
    holes: [],
    area: 0,
    netArea: 0,
    tilt: 0,
    azimuth: 0,
    fenestration: [],
    raw: init.raw,
  })

  const finishRing = (poly: number[]): number[] => {
    if (clockwise) {
      const out: number[] = []
      for (let i = poly.length - 3; i >= 0; i -= 3) out.push(poly[i], poly[i + 1], poly[i + 2])
      return out
    }
    return poly
  }

  // Building surfaces: BuildingSurface:Detailed + single-type detailed variants
  const buildingSurfaceSources: [string, string | null][] = [
    ['BuildingSurface:Detailed', null],
    ['Wall:Detailed', 'Wall'],
    ['RoofCeiling:Detailed', 'Roof'],
    ['Floor:Detailed', 'Floor'],
  ]

  for (const [epType, forcedType] of buildingSurfaceSources) {
    for (const [name, o] of objectsOf(root, epType)) {
      const zone = str(o.zone_name)
      const polygon = finishRing(readVertexArray(o))
      if (polygon.length < 9) {
        warn(`${name}: fewer than 3 vertices — skipped`)
        continue
      }
      zoneTransform(polygon, zone)
      if (zone && !zones[zone]) warn(`${name}: unknown zone "${zone}"`)

      const construction = str(o.construction_name)
      const isAirBoundary = construction !== null && airBoundaryConstructions.has(construction)
      const surfaceType = forcedType ?? str(o.surface_type) ?? 'Wall'
      const bc = str(o.outside_boundary_condition)

      const s = makeSurface({
        name,
        kind: 'building',
        epType,
        surfaceType,
        category: buildingCategory(surfaceType, isAirBoundary, warn, name),
        zone,
        building: zone ? (zones[zone]?.building ?? buildingFallback) : buildingFallback,
        construction,
        boundaryCondition: bc,
        boundaryObject: str(o.outside_boundary_condition_object),
        isInterior: isInteriorBc(bc),
        isAirBoundary,
        polygon,
        raw: o,
      })
      pushSurface(s)
      if (zone && zones[zone]) zones[zone].surfaces.push(s.index)
    }
  }

  // Rectangular heat-transfer surfaces. The ring is built in the surface's own
  // frame from the *raw* azimuth and then transformed whole. Rotation is
  // linear, so that is algebraically identical to EnergyPlus rotating the
  // start point and adding the same rotation to the azimuth — and it keeps
  // every sign convention in the one transform closure.
  for (const src of RECT_HT_SOURCES) {
    for (const [name, o] of objectsOf(root, src.epType)) {
      const length = num(o.length)
      const height = num(o[src.heightField])
      if (length <= 0 || height <= 0) {
        warn(`${name}: zero length or ${src.heightField} — skipped`)
        continue
      }
      const zone = str(o.zone_name)
      const polygon = rectRingFromAngles(
        rectOrigin(o),
        num(o.azimuth_angle),
        num(o.tilt_angle, src.defaultTilt),
        length,
        height,
      )
      rectZoneTransform(polygon, zone)
      if (zone && !zones[zone]) warn(`${name}: unknown zone "${zone}"`)

      const construction = str(o.construction_name)
      const isAirBoundary = construction !== null && airBoundaryConstructions.has(construction)
      const s = makeSurface({
        name,
        kind: 'building',
        epType: src.epType,
        surfaceType: src.surfaceType,
        category: buildingCategory(src.surfaceType, isAirBoundary, warn, name),
        zone,
        building: zone ? (zones[zone]?.building ?? buildingFallback) : buildingFallback,
        construction,
        // Ground and Adiabatic surfaces render as exterior but carry no
        // Outdoors string, so summarizeSurfaces leaves them out of the WWR
        // denominator. That is correct — do not "fix" it.
        boundaryCondition: src.boundaryCondition,
        boundaryObject: src.boundaryCondition === 'Surface'
          ? str(o.outside_boundary_condition_object)
          : null,
        isInterior: isInteriorBc(src.boundaryCondition),
        isAirBoundary,
        polygon,
        raw: o,
      })
      pushSurface(s)
      rectSurfaceCount++
      if (zone && zones[zone]) zones[zone].surfaces.push(s.index)
    }
  }

  // Fenestration — flat vertex fields, anchored to a host building surface
  for (const [name, o] of objectsOf(root, 'FenestrationSurface:Detailed')) {
    const hostName = str(o.building_surface_name)
    const host = findSurface(hostName)
    if (hostName && !host) warn(`${name}: unknown host surface "${hostName}"`)

    const polygon = finishRing(readFlatVertices(o))
    if (polygon.length < 9) {
      warn(`${name}: fewer than 3 vertices — skipped`)
      continue
    }
    zoneTransform(polygon, host?.zone ?? null)

    const surfaceType = str(o.surface_type) ?? 'Window'
    const s = makeSurface({
      name,
      kind: 'fenestration',
      epType: 'FenestrationSurface:Detailed',
      surfaceType,
      category: fenestrationCategory(surfaceType),
      zone: host?.zone ?? null,
      building: host?.building ?? null,
      construction: str(o.construction_name),
      boundaryCondition: host?.boundaryCondition ?? null,
      hostSurface: hostName,
      isInterior: host?.isInterior ?? false,
      polygon,
      raw: o,
    })
    pushSurface(s)
    if (host) {
      host.fenestration.push(s.index)
      // The hole ring shares the fenestration polygon array on purpose:
      // recentering shifts it exactly once.
      host.holes.push(polygon)
    }
  }

  // Rectangular subsurfaces: an offset along the base surface's own length and
  // height axes. The base polygon is already in world coordinates, so the ring
  // built on its frame must not be transformed again.
  let horizontalBaseCount = 0
  for (const src of RECT_SUB_SOURCES) {
    for (const [name, o] of objectsOf(root, src.epType)) {
      const baseName = str(o.building_surface_name)
      const base = findSurface(baseName)
      if (base === undefined) {
        // FenestrationSurface:Detailed carries its own vertices and still
        // renders without a host; a rectangular subsurface has nothing to
        // place without its base.
        warn(`${name}: unknown base surface "${baseName ?? ''}" — skipped`)
        continue
      }
      const length = num(o.length)
      const height = num(o.height)
      if (length <= 0 || height <= 0) {
        warn(`${name}: zero length or height — skipped`)
        continue
      }

      const frame = frameOf(base)
      if (frame.tilt <= 1 || frame.tilt >= 179) horizontalBaseCount++
      const startX = num(o.starting_x_coordinate)
      const startZ = num(o.starting_z_coordinate)
      const origin: Vec3 = [
        frame.origin[0] + startX * frame.u[0] + startZ * frame.w[0],
        frame.origin[1] + startX * frame.u[1] + startZ * frame.w[1],
        frame.origin[2] + startX * frame.u[2] + startZ * frame.w[2],
      ]
      const polygon = rectRingFromAxes(origin, frame.u, frame.w, length, height)

      const s = makeSurface({
        name,
        kind: 'fenestration',
        epType: src.epType,
        surfaceType: src.surfaceType,
        category: fenestrationCategory(src.surfaceType),
        zone: base.zone,
        building: base.building,
        construction: str(o.construction_name),
        boundaryCondition: src.interzone ? 'Surface' : base.boundaryCondition,
        boundaryObject: src.interzone ? str(o.outside_boundary_condition_object) : null,
        hostSurface: base.name,
        isInterior: src.interzone || base.isInterior,
        polygon,
        raw: o,
      })
      pushSurface(s)
      rectSurfaceCount++
      base.fenestration.push(s.index)
      // Same aliasing contract as the detailed path: the hole ring *is* the
      // subsurface polygon, so recentering shifts it exactly once.
      base.holes.push(polygon)
    }
  }

  // One line rather than one per opening: a flat roof full of skylights would
  // otherwise use the whole warning budget.
  if (horizontalBaseCount > 0) {
    warn(
      `${horizontalBaseCount} rectangular subsurface(s) placed on a near-horizontal base `
      + '— in-plane orientation is arbitrary',
    )
  }

  // Shading
  const shadingSources: [string, (o: Obj, poly: number[]) => string | null][] = [
    [
      'Shading:Site:Detailed',
      (_o, _poly) => null, // never rotated
    ],
    [
      'Shading:Building:Detailed',
      (_o, poly) => {
        buildingShadingTransform(poly)
        return null
      },
    ],
    [
      'Shading:Zone:Detailed',
      (o, poly) => {
        const base = findSurface(str(o.base_surface_name))
        zoneTransform(poly, base?.zone ?? null)
        return base?.zone ?? null
      },
    ],
  ]

  for (const [epType, applyTransform] of shadingSources) {
    for (const [name, o] of objectsOf(root, epType)) {
      const polygon = finishRing(readVertexArray(o))
      if (polygon.length < 9) {
        warn(`${name}: fewer than 3 vertices — skipped`)
        continue
      }
      const zone = applyTransform(o, polygon)
      pushSurface(makeSurface({
        name,
        kind: 'shading',
        epType,
        surfaceType: 'Shading',
        category: 'shading',
        zone,
        building: zone ? (zones[zone]?.building ?? null) : null,
        polygon,
        raw: o,
      }))
    }
  }

  // Rectangular detached shading, mirroring the detailed pair above: site
  // shading is never rotated, building shading turns with the building.
  const rectShadingSources: [string, (poly: number[]) => void][] = [
    ['Shading:Site', () => {}],
    ['Shading:Building', rectBuildingShadingTransform],
  ]

  for (const [epType, applyTransform] of rectShadingSources) {
    for (const [name, o] of objectsOf(root, epType)) {
      const length = num(o.length)
      const height = num(o.height)
      if (length <= 0 || height <= 0) {
        warn(`${name}: zero length or height — skipped`)
        continue
      }
      const polygon = rectRingFromAngles(
        rectOrigin(o),
        num(o.azimuth_angle),
        num(o.tilt_angle, 90),
        length,
        height,
      )
      applyTransform(polygon)
      pushSurface(makeSurface({
        name,
        kind: 'shading',
        epType,
        surfaceType: 'Shading',
        category: 'shading',
        polygon,
        raw: o,
      }))
      rectSurfaceCount++
    }
  }

  // Only worth saying when the file actually has rectangular geometry to
  // place; a mismatch is harmless otherwise.
  if (rectSurfaceCount > 0 && isWorld !== isRectWorld) {
    warn(
      `GlobalGeometryRules: coordinate_system "${coordinateSystem}" and `
      + `rectangular_surface_coordinate_system "${rectCoordinateSystem}" disagree — `
      + 'rectangular surfaces use the rectangular setting',
    )
  }

  // Parametric attached shading, laid out on the frame of the window or door
  // it shades. Those vertices are already in world coordinates, so nothing
  // here is transformed again. A zero depth means no device, not an error.
  for (const [epType, projection] of OVERHANG_SOURCES) {
    for (const [name, o] of objectsOf(root, epType)) {
      const winName = str(o.window_or_door_name)
      const win = findSurface(winName)
      if (win === undefined) {
        warn(`${name}: unknown window or door "${winName ?? ''}" — skipped`)
        continue
      }
      const frame = frameOf(win)
      const depth = projection
        ? num(o.depth_as_fraction_of_window_door_height) * frame.height
        : num(o.depth)
      if (depth <= 0) continue

      pushSurface(makeSurface({
        name,
        kind: 'shading',
        epType,
        surfaceType: 'Shading',
        category: 'shading',
        zone: win.zone,
        building: win.building,
        hostSurface: win.name,
        polygon: overhangRing(frame, {
          heightAbove: num(o.height_above_window_or_door),
          tiltFromWindow: num(o.tilt_angle_from_window_door, 90),
          leftExtension: num(o.left_extension_from_window_door_width),
          rightExtension: num(o.right_extension_from_window_door_width),
          depth,
        }),
        raw: o,
      }))
    }
  }

  for (const [epType, projection] of FIN_SOURCES) {
    for (const [name, o] of objectsOf(root, epType)) {
      const winName = str(o.window_or_door_name)
      const win = findSurface(winName)
      if (win === undefined) {
        warn(`${name}: unknown window or door "${winName ?? ''}" — skipped`)
        continue
      }
      const frame = frameOf(win)
      const depthOf = (side: 'left' | 'right'): number => (projection
        ? num(o[`${side}_depth_as_fraction_of_window_door_width`]) * frame.width
        : num(o[`${side}_depth`]))
      const sideOf = (side: 'left' | 'right') => ({
        extension: num(o[`${side}_extension_from_window_door`]),
        above: num(o[`${side}_distance_above_top_of_window`]),
        below: num(o[`${side}_distance_below_bottom_of_window`]),
        tiltFromWindow: num(o[`${side}_tilt_angle_from_window_door`], 90),
        depth: depthOf(side),
      })
      const rings = finRings(frame, { left: sideOf('left'), right: sideOf('right') })

      // EnergyPlus emits one surface per side, so these names are not keys in
      // the source epJSON and both sides share one raw object.
      for (const [label, polygon] of [['Left', rings.left], ['Right', rings.right]] as const) {
        if (polygon === null) continue
        pushSurface(makeSurface({
          name: `${name} ${label}`,
          kind: 'shading',
          epType,
          surfaceType: 'Shading',
          category: 'shading',
          zone: win.zone,
          building: win.building,
          hostSurface: win.name,
          polygon,
          raw: o,
        }))
      }
    }
  }

  if (surfaces.length === 0) {
    throw new Error('No geometry found: the file contains no surface objects')
  }

  // --- Recenter to bounding-box center (x, y) and minimum z --------------
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const s of surfaces) {
    const p = s.polygon
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < minX) minX = p[i]
      if (p[i] > maxX) maxX = p[i]
      if (p[i + 1] < minY) minY = p[i + 1]
      if (p[i + 1] > maxY) maxY = p[i + 1]
      if (p[i + 2] < minZ) minZ = p[i + 2]
      if (p[i + 2] > maxZ) maxZ = p[i + 2]
    }
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, minZ]
  for (const s of surfaces) {
    const p = s.polygon
    for (let i = 0; i < p.length; i += 3) {
      p[i] -= center[0]
      p[i + 1] -= center[1]
      p[i + 2] -= center[2]
    }
  }

  // --- Metrics (post-recenter; areas/angles are translation-invariant) ---
  for (const s of surfaces) {
    const m = surfaceMetrics(s.polygon)
    s.area = m.area
    s.tilt = m.tilt
    s.azimuth = m.azimuth
    s.netArea = s.area
    for (const hole of s.holes) s.netArea -= polygonArea(hole)
    if (s.netArea < 0) s.netArea = 0
    if (s.area < 1e-6) warn(`${s.name}: zero-area surface`)
  }

  for (const s of surfaces) {
    if (s.kind === 'building' && s.category === 'floor' && s.zone && zones[s.zone]) {
      zones[s.zone].floorArea += s.area
    }
  }

  // --- Buildings ---------------------------------------------------------
  const buildings: Record<string, EpBuildingGroup> = {}
  for (const zoneName of Object.keys(zones)) {
    const b = zones[zoneName].building
    if (!buildings[b]) buildings[b] = { name: b, label: buildingLabel(b), zones: [] }
    buildings[b].zones.push(zoneName)
  }
  // Disambiguate duplicate street labels (distinct UUIDs, same address)
  const labelCounts = new Map<string, number>()
  for (const b of Object.values(buildings)) labelCounts.set(b.label, (labelCounts.get(b.label) ?? 0) + 1)
  for (const b of Object.values(buildings)) {
    if ((labelCounts.get(b.label) ?? 0) > 1) {
      const m = UUID_RE.exec(b.name)
      if (m) b.label = `${b.label} · ${b.name.slice(3, 11)}`
    }
  }

  // --- Stats -------------------------------------------------------------
  const stats: ModelStats = {
    ...summarizeSurfaces(surfaces),
    zoneCount: Object.keys(zones).length,
    buildingCount: Object.keys(buildings).length,
  }

  const version = firstOf(root, 'Version')
  const site = firstOf(root, 'Site:Location')

  return {
    fileName,
    surfaces,
    zones,
    zoneNames: Object.keys(zones),
    buildings,
    buildingNames: Object.keys(buildings).sort((a, b) => buildings[a].label.localeCompare(buildings[b].label)),
    constructionNames: [...constructionSet].sort(),
    meta: {
      epVersion: str(version?.version_identifier),
      buildingName: str(buildingObj?.name),
      northAxis,
      coordinateSystem,
      terrain: str(buildingObj?.terrain),
      site: site as Record<string, unknown> | null,
      center,
      bboxSize: [maxX - minX, maxY - minY, maxZ - minZ],
    },
    stats,
    warnings,
  }
}

function buildingCategory(
  surfaceType: string,
  isAirBoundary: boolean,
  warn: (m: string) => void,
  name: string,
): Category {
  if (isAirBoundary) return 'airBoundary'
  switch (surfaceType.toLowerCase()) {
    case 'wall':
      return 'wall'
    case 'roof':
      return 'roof'
    case 'floor':
      return 'floor'
    case 'ceiling':
      return 'ceiling'
    default:
      warn(`${name}: unknown surface_type "${surfaceType}" — treated as wall`)
      return 'wall'
  }
}

/**
 * A glazed door reads as a window: it is glazing, and colouring it as a door
 * would hide it from the window area roll-up.
 */
function fenestrationCategory(surfaceType: string): Category {
  return /door$/i.test(surfaceType) && !/glass/i.test(surfaceType) ? 'door' : 'window'
}

/**
 * Map every zone to its building key. Urban exports name zones
 * ID_<uuid>[_<Street>_<No>][_F<floor>][_<zone>]; the UUID is the CityGML
 * building id, so zones sharing one are the same building whatever suffix
 * convention (_F1_Core, _P1/_Core, none) the exporter used. Grouping on the
 * suffix instead would need a vocabulary the exports do not agree on.
 *
 * The key is the longest whole `_` segment the group's zones agree on, so the
 * address stays in the key and only the zone part is left for `zoneLabel`.
 * Zones without a UUID fall back to the Building object name.
 */
function groupZonesIntoBuildings(zoneNames: string[], fallback: string): Map<string, string> {
  const byUuid = new Map<string, string[]>()
  const building = new Map<string, string>()

  for (const name of zoneNames) {
    const m = UUID_RE.exec(name)
    if (!m) {
      building.set(name, fallback)
      continue
    }
    const list = byUuid.get(m[0])
    if (list) list.push(name)
    else byUuid.set(m[0], [name])
  }

  for (const names of byUuid.values()) {
    // A lone zone has no sibling to disagree with, so its whole name is the
    // prefix. Either way a trailing floor marker is dropped: a one-floor
    // building must key on its address like its multi-floor neighbours.
    const key = (names.length === 1 ? names[0] : commonSegmentPrefix(names)).replace(/_F\d+$/, '')
    for (const name of names) building.set(name, key)
  }

  return building
}

/** Longest prefix the strings share on whole `_`-separated segments. */
function commonSegmentPrefix(names: string[]): string {
  const first = names[0].split('_')
  let n = first.length
  for (const name of names) {
    const parts = name.split('_')
    if (parts.length < n) n = parts.length
    for (let i = 0; i < n; i++) {
      if (parts[i] !== first[i]) {
        n = i
        break
      }
    }
  }
  return first.slice(0, n).join('_')
}

function zoneLabel(zoneName: string, building: string): string {
  if (zoneName !== building && zoneName.startsWith(building + '_')) {
    return zoneName.slice(building.length + 1).replace(/_/g, ' ')
  }
  const m = UUID_RE.exec(zoneName)
  if (m) {
    const rest = zoneName.slice(m[0].length).replace(/^_/, '')
    return rest !== '' ? rest.replace(/_/g, ' ') : 'Zone'
  }
  return zoneName
}

function buildingLabel(key: string): string {
  const m = UUID_RE.exec(key)
  if (!m) return key
  const rest = key.slice(m[0].length).replace(/^_/, '')
  return rest !== '' ? rest.replace(/_/g, ' ') : `Building ${key.slice(3, 11)}`
}
