/** Polygon plane math. Polygons are flat arrays [x0,y0,z0, x1,y1,z1, …]. */

export type Vec3 = [number, number, number]

/**
 * Newell normal of a (possibly non-planar) polygon.
 * Not normalized — its magnitude equals the polygon area.
 */
export function newellNormal(poly: number[]): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  const n = poly.length / 3
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const xi = poly[i * 3]
    const yi = poly[i * 3 + 1]
    const zi = poly[i * 3 + 2]
    const xj = poly[j * 3]
    const yj = poly[j * 3 + 1]
    const zj = poly[j * 3 + 2]
    nx += (yi - yj) * (zi + zj)
    ny += (zi - zj) * (xi + xj)
    nz += (xi - xj) * (yi + yj)
  }
  return [nx / 2, ny / 2, nz / 2]
}

export function length3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

export function normalize3(v: Vec3): Vec3 {
  const l = length3(v)
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1]
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** Polygon area in m² (half the Newell normal magnitude). */
export function polygonArea(poly: number[]): number {
  return length3(newellNormal(poly))
}

/** Orthonormal in-plane basis (u, v) for a plane with the given normal. */
export function planeBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  const n = normalize3(normal)
  // Pick a helper axis that is not parallel to the normal
  const helper: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = normalize3(cross3(helper, n))
  const v = cross3(n, u)
  return { u, v }
}

/** Project 3D polygon onto the (u, v) plane basis → flat [u0,v0, u1,v1, …]. */
export function projectTo2D(poly: number[], origin: Vec3, u: Vec3, v: Vec3): number[] {
  const out: number[] = new Array((poly.length / 3) * 2)
  for (let i = 0, j = 0; i < poly.length; i += 3, j += 2) {
    const dx = poly[i] - origin[0]
    const dy = poly[i + 1] - origin[1]
    const dz = poly[i + 2] - origin[2]
    out[j] = dx * u[0] + dy * u[1] + dz * u[2]
    out[j + 1] = dx * v[0] + dy * v[1] + dz * v[2]
  }
  return out
}

/**
 * Remove consecutive duplicate vertices (within eps) and an explicit closing
 * vertex equal to the first. Returns a new array.
 */
export function cleanRing(poly: number[], eps = 1e-3): number[] {
  const n = poly.length / 3
  if (n < 2) return poly.slice()
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const x = poly[i * 3]
    const y = poly[i * 3 + 1]
    const z = poly[i * 3 + 2]
    const m = out.length
    if (m >= 3) {
      const px = out[m - 3]
      const py = out[m - 2]
      const pz = out[m - 1]
      if (Math.abs(x - px) < eps && Math.abs(y - py) < eps && Math.abs(z - pz) < eps) continue
    }
    out.push(x, y, z)
  }
  // Drop closing vertex identical to the first
  while (out.length >= 6) {
    const m = out.length
    if (
      Math.abs(out[m - 3] - out[0]) < eps &&
      Math.abs(out[m - 2] - out[1]) < eps &&
      Math.abs(out[m - 1] - out[2]) < eps
    ) {
      out.length = m - 3
    } else {
      break
    }
  }
  return out
}
