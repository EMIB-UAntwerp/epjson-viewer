/**
 * Rectangular ("simple") surface geometry, mirroring EnergyPlus
 * `SurfaceGeometry.cc` `MakeRectangularVertices`.
 *
 * The simple objects — `Wall:Exterior`, `Roof`, `Window`, `Shading:Site` and
 * their kin — give a start point, an azimuth, a tilt and two dimensions
 * instead of vertices. Azimuth is degrees clockwise from north (+Y) and names
 * the direction the outward normal faces; tilt is degrees from horizontal,
 * 0 facing up. This module owns those conventions; `plane.ts` stays free of
 * them and `parse.ts` stays free of trigonometry.
 */

import { surfaceMetrics } from './metrics'
import { cross3, dot3, type Vec3 } from './plane'

const DEG = Math.PI / 180

export interface SurfaceAxes {
  /** Outward normal. */
  n: Vec3
  /** Length axis — "right" when the surface is viewed from outside. */
  u: Vec3
  /** Height axis — "up" along the surface. */
  w: Vec3
}

export function axesFromAngles(azimuthDeg: number, tiltDeg: number): SurfaceAxes {
  const ca = Math.cos(azimuthDeg * DEG)
  const sa = Math.sin(azimuthDeg * DEG)
  const ct = Math.cos(tiltDeg * DEG)
  const st = Math.sin(tiltDeg * DEG)
  const n: Vec3 = [sa * st, ca * st, ct]
  const u: Vec3 = [-ca, sa, 0]
  return { n, u, w: cross3(n, u) }
}

/**
 * Upper-left, lower-left, lower-right, upper-right from the lower-left corner
 * — the order EnergyPlus generates. It winds counter-clockwise seen from
 * outside, so the ring's Newell normal is `u × w`.
 *
 * For a ring built from `axesFromAngles` that normal is the declared outward
 * normal, so `surfaceMetrics` on the result returns exactly the azimuth and
 * tilt that went in. That round trip pins the angles, but not the handedness:
 * mirroring `u` mirrors `w = n × u` with it, leaving `u × w` — and every
 * normal, area, tilt and azimuth — unchanged while the rectangle mirrors about
 * its start point. Only a positional check sees that, so the tests assert both.
 *
 * `GlobalGeometryRules.vertex_entry_direction` and `starting_vertex_position`
 * govern hand-entered vertex lists only, so rings from here must not be passed
 * through the parser's `finishRing`.
 */
export function rectRingFromAxes(
  origin: Vec3,
  u: Vec3,
  w: Vec3,
  length: number,
  height: number,
): number[] {
  const [ox, oy, oz] = origin
  const lx = length * u[0]
  const ly = length * u[1]
  const lz = length * u[2]
  const hx = height * w[0]
  const hy = height * w[1]
  const hz = height * w[2]
  return [
    ox + hx, oy + hy, oz + hz,
    ox, oy, oz,
    ox + lx, oy + ly, oz + lz,
    ox + lx + hx, oy + ly + hy, oz + lz + hz,
  ]
}

export function rectRingFromAngles(
  origin: Vec3,
  azimuthDeg: number,
  tiltDeg: number,
  length: number,
  height: number,
): number[] {
  const { u, w } = axesFromAngles(azimuthDeg, tiltDeg)
  return rectRingFromAxes(origin, u, w, length, height)
}

export interface OverhangParams {
  heightAbove: number
  tiltFromWindow: number
  leftExtension: number
  rightExtension: number
  depth: number
}

/**
 * A plate above a window. `tiltFromWindow` 90 — the EnergyPlus default —
 * stands it perpendicular to the glazing, so it is horizontal on a vertical
 * wall; 0 lays it in the window plane, extending upward.
 *
 * The ring runs along the depth axis first, which makes its normal
 * `sinθ·w − cosθ·n`: at the default angle that is tilt 0, facing up, matching
 * EnergyPlus reporting an overhang's tilt as the window's minus θ. Only the
 * reported tilt and azimuth depend on this choice — materials are double-sided.
 */
export function overhangRing(win: SurfaceFrame, p: OverhangParams): number[] {
  const ct = Math.cos(p.tiltFromWindow * DEG)
  const st = Math.sin(p.tiltFromWindow * DEG)
  const depthAxis: Vec3 = [
    win.w[0] * ct + win.n[0] * st,
    win.w[1] * ct + win.n[1] * st,
    win.w[2] * ct + win.n[2] * st,
  ]
  const up = win.height + p.heightAbove
  const origin: Vec3 = [
    win.origin[0] - p.leftExtension * win.u[0] + up * win.w[0],
    win.origin[1] - p.leftExtension * win.u[1] + up * win.w[1],
    win.origin[2] - p.leftExtension * win.u[2] + up * win.w[2],
  ]
  const length = win.width + p.leftExtension + p.rightExtension
  return rectRingFromAxes(origin, depthAxis, win.u, p.depth, length)
}

export interface FinSideParams {
  extension: number
  above: number
  below: number
  tiltFromWindow: number
  depth: number
}

export interface FinParams {
  left: FinSideParams
  right: FinSideParams
}

/**
 * The vertical plates flanking a window. EnergyPlus emits one surface per
 * side and drops a side whose depth is zero, so either result may be null.
 * Each fin's outward face looks away from the window it shades.
 */
export function finRings(
  win: SurfaceFrame,
  p: FinParams,
): { left: number[] | null; right: number[] | null } {
  const side = (s: FinSideParams, right: boolean): number[] | null => {
    if (s.depth <= 0) return null
    const ct = Math.cos(s.tiltFromWindow * DEG)
    const st = Math.sin(s.tiltFromWindow * DEG)
    const sign = right ? 1 : -1
    const depthAxis: Vec3 = [
      win.n[0] * st + sign * win.u[0] * ct,
      win.n[1] * st + sign * win.u[1] * ct,
      win.n[2] * st + sign * win.u[2] * ct,
    ]
    const along = right ? win.width + s.extension : -s.extension
    const origin: Vec3 = [
      win.origin[0] + along * win.u[0] - s.below * win.w[0],
      win.origin[1] + along * win.u[1] - s.below * win.w[1],
      win.origin[2] + along * win.u[2] - s.below * win.w[2],
    ]
    const height = win.height + s.above + s.below
    return right
      ? rectRingFromAxes(origin, win.w, depthAxis, height, s.depth)
      : rectRingFromAxes(origin, depthAxis, win.w, s.depth, height)
  }
  return { left: side(p.left, false), right: side(p.right, true) }
}

export interface SurfaceFrame extends SurfaceAxes {
  /** Lower-left corner seen from outside — the anchor offsets measure from. */
  origin: Vec3
  azimuth: number
  tilt: number
  width: number
  height: number
}

/**
 * Recover the placement frame of a surface that is already in world
 * coordinates, so rectangular subsurfaces and attached shading can be laid out
 * on it. EnergyPlus anchors those to the base's `Vertex(2)`; the independent
 * minimum in the `(u, w)` plane is the same point for any rectangle and stays
 * well-defined for a detailed base, whose vertex order depends on
 * `starting_vertex_position` and may already have been reversed for winding.
 *
 * `origin` is an absolute coordinate, so a frame is only valid until the
 * parser recenters the model — the axes and dimensions are unaffected.
 */
export function surfaceFrame(polygon: number[]): SurfaceFrame {
  const { azimuth, tilt } = surfaceMetrics(polygon)
  const { n, u, w } = axesFromAngles(azimuth, tilt)

  let minU = Infinity
  let maxU = -Infinity
  let minW = Infinity
  let maxW = -Infinity
  for (let i = 0; i < polygon.length; i += 3) {
    const p: Vec3 = [polygon[i], polygon[i + 1], polygon[i + 2]]
    const du = dot3(p, u)
    const dw = dot3(p, w)
    if (du < minU) minU = du
    if (du > maxU) maxU = du
    if (dw < minW) minW = dw
    if (dw > maxW) maxW = dw
  }

  // Slide the first vertex to the minimum corner. Moving only along u and w
  // keeps the result in the surface's plane.
  const p0: Vec3 = [polygon[0], polygon[1], polygon[2]]
  const su = minU - dot3(p0, u)
  const sw = minW - dot3(p0, w)
  return {
    n,
    u,
    w,
    azimuth,
    tilt,
    origin: [
      p0[0] + su * u[0] + sw * w[0],
      p0[1] + su * u[1] + sw * w[1],
      p0[2] + su * u[2] + sw * w[2],
    ],
    width: maxU - minU,
    height: maxW - minW,
  }
}
