import { Color, DoubleSide, MeshLambertMaterial } from 'three'
import type { Category, EpSurface } from '../core/types'

/** Surface-type palette — OpenStudio/SketchUp-familiar hues tuned for a dark canvas. */
export const CATEGORY_COLORS: Record<Category, string> = {
  wall: '#e8dcc0',
  roof: '#a05252',
  floor: '#6e6e78',
  ceiling: '#b08968',
  window: '#6fb7d9',
  door: '#8f6f4e',
  shading: '#52525e',
  airBoundary: '#22d3ee',
}

export const CATEGORY_LABELS: Record<Category, string> = {
  wall: 'Walls',
  roof: 'Roofs',
  floor: 'Floors',
  ceiling: 'Ceilings',
  window: 'Windows',
  door: 'Doors',
  airBoundary: 'Air boundaries',
  shading: 'Shading context',
}

/** Outside boundary condition palette. */
export const BOUNDARY_COLORS: Record<string, string> = {
  outdoors: '#4a9bd1',
  ground: '#8a6642',
  foundation: '#8a6642',
  adiabatic: '#c4667a',
  surface: '#e0a458',
  zone: '#e0a458',
  space: '#e0a458',
  othersidecoefficients: '#9c755f',
  othersideconditionsmodel: '#9c755f',
}

export const BOUNDARY_FALLBACK = '#7c7c8c'
export const SHADING_NEUTRAL = '#3f3f4a'

/** Categorical palette for render-by-construction (cycled). */
export const CONSTRUCTION_PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#86bcb6',
  '#d37295',
  '#bab0ac',
]

export const ACCENT = '#22d3ee'
export const CANVAS_BACKGROUND = '#131318'
export const EDGE_COLOR = '#0c0c10'

export type RenderMode = 'type' | 'boundary' | 'construction'

export function boundaryColor(bc: string | null): string {
  if (!bc) return BOUNDARY_FALLBACK
  return BOUNDARY_COLORS[bc.toLowerCase()] ?? BOUNDARY_FALLBACK
}

/** Returns the css color for a surface under the given render mode. */
export function surfaceColor(s: EpSurface, mode: RenderMode, constructionIndex: Map<string, number>): string {
  switch (mode) {
    case 'type':
      return CATEGORY_COLORS[s.category]
    case 'boundary':
      if (s.kind === 'shading') return SHADING_NEUTRAL
      return boundaryColor(s.boundaryCondition)
    case 'construction': {
      if (s.kind === 'shading' || !s.construction) return SHADING_NEUTRAL
      const i = constructionIndex.get(s.construction) ?? 0
      return CONSTRUCTION_PALETTE[i % CONSTRUCTION_PALETTE.length]
    }
  }
}

export interface GroupStyle {
  opacity: number
  polygonOffsetFactor: number
}

/** Per-category material tuning; interior/exterior share the style. */
export function categoryStyle(category: Category): GroupStyle {
  switch (category) {
    case 'window':
      return { opacity: 0.62, polygonOffsetFactor: -1 }
    case 'airBoundary':
      return { opacity: 0.38, polygonOffsetFactor: -0.5 }
    case 'shading':
      return { opacity: 0.96, polygonOffsetFactor: 1.5 }
    default:
      return { opacity: 1, polygonOffsetFactor: 1 }
  }
}

export function createGroupMaterial(category: Category): MeshLambertMaterial {
  const style = categoryStyle(category)
  return new MeshLambertMaterial({
    vertexColors: true,
    side: DoubleSide,
    transparent: style.opacity < 1,
    opacity: style.opacity,
    polygonOffset: true,
    polygonOffsetFactor: style.polygonOffsetFactor,
    polygonOffsetUnits: 1,
  })
}

/** Ghost (x-ray) appearance applied to exterior groups. */
export function applyGhost(mat: MeshLambertMaterial, on: boolean, category: Category): void {
  const style = categoryStyle(category)
  if (on) {
    mat.transparent = true
    mat.opacity = 0.09
    mat.depthWrite = false
  } else {
    mat.opacity = style.opacity
    mat.transparent = style.opacity < 1
    mat.depthWrite = true
  }
  mat.needsUpdate = true
}

const colorScratch = new Color()

/** css color → linear-space rgb triple for vertex-color attributes. */
export function cssToLinearRgb(css: string): [number, number, number] {
  colorScratch.set(css)
  return [colorScratch.r, colorScratch.g, colorScratch.b]
}
