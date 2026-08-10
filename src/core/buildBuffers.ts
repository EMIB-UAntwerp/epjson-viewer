/**
 * Turn a parsed EpModel into GPU-ready merged buffers, one group per
 * category × exterior/interior. Interior and adiabatic surfaces come in
 * coincident matched pairs (party walls, floor/ceiling between storeys), so
 * each is nudged slightly into its own zone (opposite the outward normal) to
 * prevent z-fighting.
 */

import { newellNormal, normalize3 } from './plane'
import { triangulatePolygon } from './triangulate'
import { groupKeyOf, type EpModel, type GeometryBundle, type GroupBuffers, type GroupKey } from './types'

/** Half-gap between coincident matched surfaces, meters. */
const PAIR_OFFSET = 0.006

/** Below this Newell-normal area (m²) a surface is already reported as zero-area upstream. */
const ZERO_AREA_EPS = 1e-6

/** Cap on per-surface degenerate-triangulation warnings, mirroring parse.ts's MAX_WARNINGS. */
const MAX_WARNINGS = 80

interface GroupAccumulator {
  pos: number[]
  nrm: number[]
  tri: number[]
  edg: number[]
  /** surface index per edge segment, parallel to edg in units of 6 floats */
  edgSurface: number[]
  ranges: Record<number, [number, number]>
}

export interface BuildResult {
  bundle: GeometryBundle
  warnings: string[]
}

export function buildGeometry(model: EpModel): BuildResult {
  const acc = new Map<GroupKey, GroupAccumulator>()
  const warnings: string[] = []
  let droppedHoles = 0

  for (const s of model.surfaces) {
    const res = triangulatePolygon(s.polygon, s.holes)
    if (!res) {
      // Near-zero-area surfaces are already reported by parse.ts's zero-area
      // warning — only name surfaces that have real area but still failed.
      if (s.area >= ZERO_AREA_EPS) {
        if (warnings.length < MAX_WARNINGS) {
          warnings.push(`${s.name}: degenerate surface — could not be triangulated`)
        } else if (warnings.length === MAX_WARNINGS) {
          warnings.push('… further warnings suppressed')
        }
      }
      continue
    }
    if (res.holesDropped) droppedHoles++

    const key = groupKeyOf(s)
    let g = acc.get(key)
    if (!g) {
      g = { pos: [], nrm: [], tri: [], edg: [], edgSurface: [], ranges: {} }
      acc.set(key, g)
    }

    const n = normalize3(newellNormal(s.polygon))
    const needsOffset = s.isInterior || (s.boundaryCondition !== null && /adiabatic/i.test(s.boundaryCondition))
    const ox = needsOffset ? -n[0] * PAIR_OFFSET : 0
    const oy = needsOffset ? -n[1] * PAIR_OFFSET : 0
    const oz = needsOffset ? -n[2] * PAIR_OFFSET : 0

    const triStart = g.tri.length
    const { vertices, indices } = res
    for (let t = 0; t < indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = indices[t + k] * 3
        g.pos.push(vertices[vi] + ox, vertices[vi + 1] + oy, vertices[vi + 2] + oz)
        g.nrm.push(n[0], n[1], n[2])
      }
      g.tri.push(s.index)
    }
    g.ranges[s.index] = [triStart, indices.length / 3]

    const edgeStart = g.edg.length
    appendRingEdges(g.edg, s.polygon, ox, oy, oz)
    for (const hole of s.holes) appendRingEdges(g.edg, hole, ox, oy, oz)
    for (let e = edgeStart; e < g.edg.length; e += 6) g.edgSurface.push(s.index)
  }

  if (droppedHoles > 0) {
    warnings.push(`${droppedHoles} surface(s) rendered without window cut-outs (hole triangulation failed)`)
  }

  const groups: Partial<Record<GroupKey, GroupBuffers>> = {}
  let triangleCount = 0
  for (const [key, g] of acc) {
    triangleCount += g.tri.length
    groups[key] = {
      positions: Float32Array.from(g.pos),
      normals: Float32Array.from(g.nrm),
      triSurface: Uint32Array.from(g.tri),
      edges: Float32Array.from(g.edg),
      edgeSurface: Uint32Array.from(g.edgSurface),
      ranges: g.ranges,
    }
  }

  return { bundle: { groups, triangleCount }, warnings }
}

function appendRingEdges(out: number[], ring: number[], ox: number, oy: number, oz: number): void {
  const n = ring.length / 3
  if (n < 2) return
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    out.push(
      ring[i * 3] + ox,
      ring[i * 3 + 1] + oy,
      ring[i * 3 + 2] + oz,
      ring[j * 3] + ox,
      ring[j * 3 + 1] + oy,
      ring[j * 3 + 2] + oz,
    )
  }
}

/** Copy of one surface's triangles out of its group buffer (for highlights). */
export function surfaceTriangles(bundle: GeometryBundle, surfaceKey: GroupKey, surfaceIndex: number): Float32Array | null {
  const group = bundle.groups[surfaceKey]
  if (!group) return null
  const range = group.ranges[surfaceIndex]
  if (!range) return null
  const [triStart, triCount] = range
  return group.positions.slice(triStart * 9, (triStart + triCount) * 9)
}
