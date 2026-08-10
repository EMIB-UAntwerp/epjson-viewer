/**
 * Normalized data model produced by parsing an epJSON file.
 * Pure TypeScript — no Vue or DOM imports, usable from a Web Worker.
 */

export const CATEGORIES = [
  'wall',
  'roof',
  'floor',
  'ceiling',
  'window',
  'door',
  'airBoundary',
  'shading',
] as const

export type Category = (typeof CATEGORIES)[number]

export type SurfaceKind = 'building' | 'fenestration' | 'shading'

/** Buffer group key: each category is split into exterior/interior sub-meshes. */
export type GroupKey = `${Category}:ext` | `${Category}:int`

export interface EpSurface {
  index: number
  name: string
  kind: SurfaceKind
  /** epJSON object type, e.g. "BuildingSurface:Detailed" */
  epType: string
  /** Raw surface_type value: Wall, Roof, Floor, Ceiling, Window, Door, GlassDoor, Shading… */
  surfaceType: string
  category: Category
  zone: string | null
  building: string | null
  construction: string | null
  boundaryCondition: string | null
  /** Name of the matched surface when boundaryCondition is "Surface" */
  boundaryObject: string | null
  /** Host BuildingSurface name (fenestration only) */
  hostSurface: string | null
  /** True for partitions internal to the model (boundary condition Surface/Zone) */
  isInterior: boolean
  isAirBoundary: boolean
  /** Outer ring, flat [x0,y0,z0, x1,y1,z1, …], world coordinates, recentered */
  polygon: number[]
  /** Hole rings cut by hosted fenestration (building surfaces only) */
  holes: number[][]
  /** Gross polygon area in m² */
  area: number
  /** Area minus hosted fenestration, m² (equals area when no holes) */
  netArea: number
  /** Degrees from horizontal: 0 = facing up, 90 = vertical wall, 180 = facing down */
  tilt: number
  /** Degrees clockwise from north (+Y); 0 for near-horizontal surfaces */
  azimuth: number
  /** Indices of fenestration surfaces hosted by this surface */
  fenestration: number[]
  /** Original epJSON object (lenient parse keeps unknown fields) */
  raw: Record<string, unknown>
}

export interface EpZone {
  name: string
  /** Short display label (name minus the building prefix), e.g. "F1 Core" */
  label: string
  building: string
  origin: [number, number, number]
  relativeNorth: number
  ceilingHeight: number | null
  volume: number | null
  /** Computed from Floor surface polygons, m² */
  floorArea: number
  /** Indices of building surfaces belonging to this zone */
  surfaces: number[]
}

export interface EpBuildingGroup {
  name: string
  /** Short display label, e.g. "Sleutelstraat 13" */
  label: string
  zones: string[]
}

/** Aggregate geometry metrics over any set of surfaces — whole model, zone or building. */
export interface SurfaceSummary {
  counts: Record<Category, number>
  surfaceCount: number
  totalFloorArea: number
  exteriorWallArea: number
  exteriorWindowArea: number
  /** Exterior window-to-wall ratio, 0–1, null when no exterior walls */
  wwr: number | null
}

export interface ModelStats extends SurfaceSummary {
  zoneCount: number
  buildingCount: number
}

export interface EpModelMeta {
  epVersion: string | null
  buildingName: string | null
  northAxis: number
  coordinateSystem: string
  terrain: string | null
  /** Raw Site:Location object (files in the wild carry custom fields) */
  site: Record<string, unknown> | null
  /** Offset subtracted from all coordinates (original = stored + center) */
  center: [number, number, number]
  bboxSize: [number, number, number]
}

export interface EpModel {
  fileName: string
  surfaces: EpSurface[]
  zones: Record<string, EpZone>
  zoneNames: string[]
  buildings: Record<string, EpBuildingGroup>
  buildingNames: string[]
  constructionNames: string[]
  meta: EpModelMeta
  stats: ModelStats
  warnings: string[]
}

/** Triangulated GPU-ready buffers for one render group (category × ext/int). */
export interface GroupBuffers {
  positions: Float32Array
  normals: Float32Array
  /** triangle index → surface index (into EpModel.surfaces) */
  triSurface: Uint32Array
  /** Perimeter outlines (outer + hole rings) as line-segment pairs */
  edges: Float32Array
  /** edge segment index → surface index; lets hidden zones drop their outlines */
  edgeSurface: Uint32Array
  /** surface index → [first triangle, triangle count] within this group */
  ranges: Record<number, [number, number]>
}

export interface GeometryBundle {
  groups: Partial<Record<GroupKey, GroupBuffers>>
  triangleCount: number
}

export function groupKeyOf(surface: EpSurface): GroupKey {
  return `${surface.category}:${surface.isInterior ? 'int' : 'ext'}`
}
