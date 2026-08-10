import { describe, expect, it } from 'vitest'
import { dot3, length3, newellNormal, normalize3, type Vec3 } from '../src/core/plane'
import { surfaceMetrics } from '../src/core/metrics'
import {
  axesFromAngles,
  finRings,
  overhangRing,
  rectRingFromAngles,
  surfaceFrame,
  type SurfaceFrame,
} from '../src/core/rectSurfaces'

describe('axesFromAngles', () => {
  it('produces an orthonormal right-handed frame for a range of angles', () => {
    for (const azimuth of [0, 37, 90, 180, 271]) {
      for (const tilt of [10, 45, 90, 135, 170]) {
        const { n, u, w } = axesFromAngles(azimuth, tilt)
        expect(length3(n)).toBeCloseTo(1)
        expect(length3(u)).toBeCloseTo(1)
        expect(length3(w)).toBeCloseTo(1)
        expect(dot3(n, u)).toBeCloseTo(0)
        expect(dot3(n, w)).toBeCloseTo(0)
        expect(dot3(u, w)).toBeCloseTo(0)
      }
    }
  })
})

describe('rectRingFromAngles: the round-trip invariant', () => {
  it('recovers the declared azimuth and tilt, and the declared area, for a spread of angles', () => {
    for (const azimuth of [0, 30, 90, 180, 260, 359]) {
      for (const tilt of [5, 45, 90, 135, 175]) {
        const ring = rectRingFromAngles([1, 2, 3], azimuth, tilt, 5, 2)
        const m = surfaceMetrics(ring)
        expect(m.area).toBeCloseTo(10)
        expect(m.tilt).toBeCloseTo(tilt, 3)
        expect(m.azimuth).toBeCloseTo(azimuth, 3)
      }
    }
  })

  it('extends the rectangle to the right of its start point as seen from outside', () => {
    // The round-trip invariant above cannot see this: flipping the length axis
    // also flips w = n x u, so the Newell normal is preserved and only the
    // position mirrors. Handedness needs a positional assertion.
    //
    // A south-facing wall (azimuth 180) is viewed from the south looking
    // north, which puts east on the right, so it must run toward +X.
    const ring = rectRingFromAngles([0, 0, 0], 180, 90, 5, 2)
    let maxX = -Infinity
    let minX = Infinity
    for (let i = 0; i < ring.length; i += 3) {
      maxX = Math.max(maxX, ring[i])
      minX = Math.min(minX, ring[i])
    }
    expect(minX).toBeCloseTo(0)
    expect(maxX).toBeCloseTo(5)
    // ...and upward, not downward, along the wall.
    expect(Math.max(ring[2], ring[5], ring[8], ring[11])).toBeCloseTo(2)
  })

  it("winds the ring so its Newell normal is exactly the declared outward normal", () => {
    const { n } = axesFromAngles(40, 60)
    const ring = rectRingFromAngles([0, 0, 0], 40, 60, 3, 4)
    const normal = normalize3(newellNormal(ring))
    expect(normal[0]).toBeCloseTo(n[0])
    expect(normal[1]).toBeCloseTo(n[1])
    expect(normal[2]).toBeCloseTo(n[2])
  })

  it('zeroes the azimuth for near-horizontal surfaces, matching surfaceMetrics convention', () => {
    // Flat roof facing up: tilt 0, azimuth is undefined and reported as 0
    // regardless of what was fed in, per surfaceMetrics.
    const roof = rectRingFromAngles([0, 0, 0], 123, 0, 4, 4)
    const roofMetrics = surfaceMetrics(roof)
    expect(roofMetrics.tilt).toBeCloseTo(0)
    expect(roofMetrics.azimuth).toBe(0)

    // Floor facing down: tilt 180, azimuth likewise undefined.
    const floor = rectRingFromAngles([0, 0, 0], 77, 180, 4, 4)
    const floorMetrics = surfaceMetrics(floor)
    expect(floorMetrics.tilt).toBeCloseTo(180)
    expect(floorMetrics.azimuth).toBe(0)
  })
})

describe('surfaceFrame', () => {
  it('recovers the exact origin, axes, width and height of a rectangle it did not build', () => {
    const origin: [number, number, number] = [2, 3, 4]
    const azimuth = 30
    const tilt = 90
    const ring = rectRingFromAngles(origin, azimuth, tilt, 5, 2)
    const frame = surfaceFrame(ring)
    expect(frame.origin[0]).toBeCloseTo(origin[0])
    expect(frame.origin[1]).toBeCloseTo(origin[1])
    expect(frame.origin[2]).toBeCloseTo(origin[2])
    expect(frame.width).toBeCloseTo(5)
    expect(frame.height).toBeCloseTo(2)
    expect(frame.azimuth).toBeCloseTo(azimuth)
    expect(frame.tilt).toBeCloseTo(tilt)
  })

  it('is invariant to which vertex of the ring comes first (detailed-base starting position)', () => {
    const ring = rectRingFromAngles([-1, 5, 0], 200, 90, 6, 3)
    const base = surfaceFrame(ring)
    for (let shift = 1; shift < 4; shift++) {
      const rotated = [...ring.slice(shift * 3), ...ring.slice(0, shift * 3)]
      const f = surfaceFrame(rotated)
      expect(f.origin[0]).toBeCloseTo(base.origin[0])
      expect(f.origin[1]).toBeCloseTo(base.origin[1])
      expect(f.origin[2]).toBeCloseTo(base.origin[2])
      expect(f.width).toBeCloseTo(base.width)
      expect(f.height).toBeCloseTo(base.height)
    }
  })

  it('bounds a non-rectangular (detailed, L-shaped) base without throwing', () => {
    // An L-shaped wall in the vertical XZ plane (Y=0): not a rectangle, so
    // surfaceFrame can only bound it, not reproduce it exactly.
    const lShape = [
      0, 0, 0, 4, 0, 0, 4, 0, 2, 2, 0, 2, 2, 0, 4, 0, 0, 4,
    ]
    const frame = surfaceFrame(lShape)
    expect(Number.isFinite(frame.width)).toBe(true)
    expect(Number.isFinite(frame.height)).toBe(true)
    expect(frame.width).toBeGreaterThanOrEqual(4 - 1e-6)
    expect(frame.height).toBeGreaterThanOrEqual(4 - 1e-6)
  })
})

describe('overhangRing', () => {
  it('reports tilt 0 (facing up) at the default tiltFromWindow=90 on a vertical window', () => {
    const winFrame = axesFromAngles(0, 90)
    const win: SurfaceFrame = { ...winFrame, origin: [0, 0, 3], azimuth: 0, tilt: 90, width: 4, height: 3 }
    const ring = overhangRing(win, {
      heightAbove: 0,
      tiltFromWindow: 90,
      leftExtension: 0,
      rightExtension: 0,
      depth: 1,
    })
    const m = surfaceMetrics(ring)
    expect(m.tilt).toBeCloseTo(0)
    expect(m.area).toBeCloseTo(1 * 4)
  })

  it('lifts the plate clear of the window top by heightAbove', () => {
    const winFrame = axesFromAngles(0, 90)
    const win: SurfaceFrame = { ...winFrame, origin: [0, 0, 3], azimuth: 0, tilt: 90, width: 4, height: 3 }
    const ring = overhangRing(win, {
      heightAbove: 0.5,
      tiltFromWindow: 90,
      leftExtension: 0,
      rightExtension: 0,
      depth: 1,
    })
    for (let i = 2; i < ring.length; i += 3) {
      expect(ring[i]).toBeCloseTo(win.origin[2] + win.height + 0.5)
    }
  })

  it('extends the plate by the left/right extensions and heightAbove', () => {
    const winFrame = axesFromAngles(0, 90)
    const win: SurfaceFrame = { ...winFrame, origin: [0, 0, 3], azimuth: 0, tilt: 90, width: 4, height: 3 }
    const ring = overhangRing(win, {
      heightAbove: 0,
      tiltFromWindow: 90,
      leftExtension: 1,
      rightExtension: 2,
      depth: 1,
    })
    const m = surfaceMetrics(ring)
    expect(m.area).toBeCloseTo(1 * (4 + 1 + 2))
  })
})

describe('finRings', () => {
  const win: SurfaceFrame = { ...axesFromAngles(0, 90), origin: [0, 0, 3], azimuth: 0, tilt: 90, width: 4, height: 3 }

  it('drops a side whose depth is zero, and keeps a side whose depth is positive', () => {
    const rings = finRings(win, {
      left: { extension: 0, above: 0, below: 0, tiltFromWindow: 90, depth: 0 },
      right: { extension: 0, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
    })
    expect(rings.left).toBeNull()
    expect(rings.right).not.toBeNull()
  })

  it('anchors the left fin at the window origin and the right fin at the window far edge', () => {
    const rings = finRings(win, {
      left: { extension: 0, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
      right: { extension: 0, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
    })
    // rectRingFromAxes ring layout is [P+H*w, P, P+L*u, P+L*u+H*w]; the second
    // vertex (index 1, i.e. floats 3..6) is always the anchor point P.
    const leftP = rings.left!.slice(3, 6)
    const rightP = rings.right!.slice(3, 6)
    expect(leftP[0]).toBeCloseTo(win.origin[0])
    expect(leftP[1]).toBeCloseTo(win.origin[1])
    expect(leftP[2]).toBeCloseTo(win.origin[2])
    // win.u = [-1, 0, 0] for azimuth 0, so the far edge is at x = -width
    expect(rightP[0]).toBeCloseTo(win.origin[0] + win.width * win.u[0])
    expect(rightP[1]).toBeCloseTo(win.origin[1] + win.width * win.u[1])
    expect(rightP[2]).toBeCloseTo(win.origin[2] + win.width * win.u[2])
  })

  it('sets each fin outside the glazing it flanks, by its own extension', () => {
    const rings = finRings(win, {
      left: { extension: 0.5, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
      right: { extension: 0.25, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
    })
    // Measured along the window's own length axis from its lower-left corner,
    // so this holds whatever the wall's orientation. The window occupies
    // 0..width; a fin must sit strictly outside that span.
    const alongU = (ring: number[]) => {
      const p: Vec3 = [ring[3], ring[4], ring[5]]
      return dot3(p, win.u) - dot3(win.origin, win.u)
    }
    expect(alongU(rings.left!)).toBeCloseTo(-0.5)
    expect(alongU(rings.right!)).toBeCloseTo(win.width + 0.25)
  })

  it('faces the two fins away from each other at the default tiltFromWindow', () => {
    const rings = finRings(win, {
      left: { extension: 0, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
      right: { extension: 0, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
    })
    const nLeft = normalize3(newellNormal(rings.left!))
    const nRight = normalize3(newellNormal(rings.right!))
    // Antiparallel: one points into the building, the other out — never the
    // same way.
    expect(dot3(nLeft, nRight)).toBeCloseTo(-1, 3)
  })

  it('extends a fin below the window bottom and above the window top, not just to the right size', () => {
    // Area alone cannot see this: applying "distance below" upward gives a fin
    // of identical size in the wrong place.
    const rings = finRings(win, {
      left: { extension: 0, above: 1, below: 2, tiltFromWindow: 90, depth: 1 },
      right: { extension: 0, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
    })
    const zOf = (ring: number[]) => {
      let lo = Infinity
      let hi = -Infinity
      for (let i = 2; i < ring.length; i += 3) { lo = Math.min(lo, ring[i]); hi = Math.max(hi, ring[i]) }
      return [lo, hi]
    }
    // win.w is +Z here, so the window spans z 3..6.
    const [lo, hi] = zOf(rings.left!)
    expect(lo).toBeCloseTo(win.origin[2] - 2)
    expect(hi).toBeCloseTo(win.origin[2] + win.height + 1)
    // A side with no extensions must match the window exactly.
    expect(zOf(rings.right!)).toEqual([
      expect.closeTo(win.origin[2]),
      expect.closeTo(win.origin[2] + win.height),
    ])
  })

  it('reports each fin height as the window height plus its own above/below extensions', () => {
    const rings = finRings(win, {
      left: { extension: 0, above: 1, below: 2, tiltFromWindow: 90, depth: 1 },
      right: { extension: 0, above: 0, below: 0, tiltFromWindow: 90, depth: 1 },
    })
    expect(surfaceMetrics(rings.left!).area).toBeCloseTo(1 * (win.height + 1 + 2))
    expect(surfaceMetrics(rings.right!).area).toBeCloseTo(1 * win.height)
  })
})
