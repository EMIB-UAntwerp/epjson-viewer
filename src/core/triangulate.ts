import earcut from 'earcut'
import { cleanRing, cross3, dot3, newellNormal, length3, planeBasis, projectTo2D, type Vec3 } from './plane'

export interface TriangulationResult {
  /** Concatenated 3D vertices of outer ring + hole rings, flat xyz */
  vertices: number[]
  /** Triangle vertex indices into `vertices` (three per triangle) */
  indices: number[]
  /** True when hole cutting failed and the polygon was retriangulated solid */
  holesDropped: boolean
}

const MIN_AREA = 1e-6

/**
 * Triangulate a planar polygon (with optional hole rings) via ear clipping in
 * the polygon's own plane. Returns null for degenerate polygons.
 * Triangle winding is normalized to match the polygon's Newell normal.
 */
export function triangulatePolygon(outer: number[], holes: number[][] = []): TriangulationResult | null {
  const ring = cleanRing(outer)
  if (ring.length < 9) return null

  const normal = newellNormal(ring)
  if (length3(normal) < MIN_AREA) return null

  const origin: Vec3 = [ring[0], ring[1], ring[2]]
  const { u, v } = planeBasis(normal)

  const cleanHoles = holes.map((h) => cleanRing(h)).filter((h) => h.length >= 9)

  let vertices = ring
  let flat = projectTo2D(ring, origin, u, v)
  let holeIndices: number[] | undefined
  let holesDropped = false

  if (cleanHoles.length > 0) {
    holeIndices = []
    for (const hole of cleanHoles) {
      holeIndices.push(flat.length / 2)
      flat = flat.concat(projectTo2D(hole, origin, u, v))
    }
    vertices = ring.concat(...cleanHoles)
  }

  let indices = earcut(flat, holeIndices, 2)

  // Ear clipping can fail on holes that touch the outer ring — fall back to a
  // solid polygon so the surface still renders (caller records a warning).
  if (indices.length === 0 && cleanHoles.length > 0) {
    holesDropped = true
    vertices = ring
    flat = projectTo2D(ring, origin, u, v)
    indices = earcut(flat, undefined, 2)
  }
  if (indices.length === 0) return null

  orientTriangles(vertices, indices, normal)
  return { vertices, indices, holesDropped }
}

/** Flip triangles whose winding opposes the polygon normal. */
function orientTriangles(vertices: number[], indices: number[], normal: Vec3): void {
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const ab: Vec3 = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]]
    const ac: Vec3 = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]]
    if (dot3(cross3(ab, ac), normal) < 0) {
      const tmp = indices[t + 1]
      indices[t + 1] = indices[t + 2]
      indices[t + 2] = tmp
    }
  }
}
