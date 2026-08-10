import { newellNormal, normalize3, polygonArea } from './plane'
import { CATEGORIES } from './types'
import type { Category, EpSurface, SurfaceSummary } from './types'

const RAD_TO_DEG = 180 / Math.PI

export interface SurfaceMetrics {
  area: number
  /** Degrees from horizontal: 0 facing up, 90 vertical, 180 facing down */
  tilt: number
  /** Degrees clockwise from north (+Y); 0 for near-horizontal surfaces */
  azimuth: number
}

export function surfaceMetrics(polygon: number[]): SurfaceMetrics {
  const area = polygonArea(polygon)
  if (area <= 0) return { area: 0, tilt: 0, azimuth: 0 }

  const n = normalize3(newellNormal(polygon))
  const tilt = Math.acos(Math.max(-1, Math.min(1, n[2]))) * RAD_TO_DEG

  // Azimuth of the outward normal, EnergyPlus convention: 0 = North (+Y),
  // 90 = East (+X). Undefined for (near-)horizontal surfaces.
  let azimuth = 0
  if (tilt > 1 && tilt < 179) {
    azimuth = Math.atan2(n[0], n[1]) * RAD_TO_DEG
    if (azimuth < 0) azimuth += 360
  }
  return { area, tilt, azimuth }
}

/**
 * Roll up counts and areas over an arbitrary surface set. Used for the whole
 * model at parse time and for a selected zone or building in the info card, so
 * both report the same numbers by construction.
 */
export function summarizeSurfaces(surfaces: Iterable<EpSurface>): SurfaceSummary {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
  let surfaceCount = 0
  let exteriorWallArea = 0
  let exteriorWindowArea = 0
  let totalFloorArea = 0
  for (const s of surfaces) {
    surfaceCount++
    counts[s.category]++
    if (!s.isInterior && s.boundaryCondition && /outdoors/i.test(s.boundaryCondition)) {
      if (s.category === 'wall') exteriorWallArea += s.area
      if (s.category === 'window') exteriorWindowArea += s.area
    }
    if (s.category === 'floor') totalFloorArea += s.area
  }
  return {
    counts,
    surfaceCount,
    totalFloorArea,
    exteriorWallArea,
    exteriorWindowArea,
    wwr: exteriorWallArea > 0 ? exteriorWindowArea / exteriorWallArea : null,
  }
}
