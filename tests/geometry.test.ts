import { describe, expect, it } from 'vitest'
import { cleanRing, newellNormal, polygonArea } from '../src/core/plane'
import { triangulatePolygon } from '../src/core/triangulate'
import { surfaceMetrics } from '../src/core/metrics'

const unitSquare = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]

function triangleAreaSum(vertices: number[], indices: number[]): number {
  let sum = 0
  for (let t = 0; t < indices.length; t += 3) {
    const tri: number[] = []
    for (let k = 0; k < 3; k++) {
      const vi = indices[t + k] * 3
      tri.push(vertices[vi], vertices[vi + 1], vertices[vi + 2])
    }
    sum += polygonArea(tri)
  }
  return sum
}

describe('plane math', () => {
  it('newell normal of CCW unit square points +Z with area magnitude', () => {
    const n = newellNormal(unitSquare)
    expect(n[0]).toBeCloseTo(0)
    expect(n[1]).toBeCloseTo(0)
    expect(n[2]).toBeCloseTo(1)
  })

  it('cleanRing removes consecutive duplicates and closing vertex', () => {
    const ring = [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0]
    expect(cleanRing(ring)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0])
  })
})

describe('triangulation', () => {
  it('triangulates a square into 2 triangles', () => {
    const res = triangulatePolygon(unitSquare)!
    expect(res.indices.length).toBe(6)
    expect(triangleAreaSum(res.vertices, res.indices)).toBeCloseTo(1)
  })

  it('cuts a hole (window in wall) and preserves net area', () => {
    // Vertical wall 4×3 in the XZ plane with a 1×1 window
    const wall = [0, 0, 3, 0, 0, 0, 4, 0, 0, 4, 0, 3]
    const window = [1, 0, 2, 1, 0, 1, 2, 0, 1, 2, 0, 2]
    const res = triangulatePolygon(wall, [window])!
    expect(res.holesDropped).toBe(false)
    expect(triangleAreaSum(res.vertices, res.indices)).toBeCloseTo(12 - 1)
  })

  it('triangulates a concave polygon correctly (L-shape)', () => {
    const lShape = [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0]
    const res = triangulatePolygon(lShape)!
    expect(triangleAreaSum(res.vertices, res.indices)).toBeCloseTo(3)
  })

  it('rejects degenerate polygons', () => {
    expect(triangulatePolygon([0, 0, 0, 1, 0, 0])).toBeNull()
    expect(triangulatePolygon([0, 0, 0, 1, 0, 0, 2, 0, 0])).toBeNull() // collinear
  })

  it('orients all triangles along the polygon normal', () => {
    const res = triangulatePolygon(unitSquare)!
    for (let t = 0; t < res.indices.length; t += 3) {
      const [a, b, c] = [res.indices[t] * 3, res.indices[t + 1] * 3, res.indices[t + 2] * 3]
      const ab = [res.vertices[b] - res.vertices[a], res.vertices[b + 1] - res.vertices[a + 1], res.vertices[b + 2] - res.vertices[a + 2]]
      const ac = [res.vertices[c] - res.vertices[a], res.vertices[c + 1] - res.vertices[a + 1], res.vertices[c + 2] - res.vertices[a + 2]]
      const nz = ab[0] * ac[1] - ab[1] * ac[0]
      expect(nz).toBeGreaterThan(0)
    }
  })
})

describe('surface metrics', () => {
  it('computes tilt/azimuth of a south-facing wall (EnergyPlus convention)', () => {
    // Outward normal -Y → south → azimuth 180, tilt 90
    const wall = [0, 0, 3, 0, 0, 0, 4, 0, 0, 4, 0, 3]
    const m = surfaceMetrics(wall)
    expect(m.area).toBeCloseTo(12)
    expect(m.tilt).toBeCloseTo(90)
    expect(m.azimuth).toBeCloseTo(180)
  })

  it('computes a flat roof as tilt 0', () => {
    const m = surfaceMetrics(unitSquare)
    expect(m.tilt).toBeCloseTo(0)
    expect(m.azimuth).toBe(0)
  })

  it('computes an east-facing wall as azimuth 90', () => {
    // Outward normal +X: CCW seen from +X
    const wall = [2, 0, 3, 2, 0, 0, 2, 4, 0, 2, 4, 3]
    const m = surfaceMetrics(wall)
    expect(m.tilt).toBeCloseTo(90)
    expect(m.azimuth).toBeCloseTo(90)
  })
})
