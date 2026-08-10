import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Category, EpModel, EpSurface, GeometryBundle, GroupKey } from '../core/types'
import { CATEGORIES, groupKeyOf } from '../core/types'
import { ACCENT, CANVAS_BACKGROUND, EDGE_COLOR, applyGhost, createGroupMaterial } from './materials'

export interface SceneCallbacks {
  /** Fired on click: picked surface index or null (empty click). */
  onPick(surfaceIndex: number | null): void
  /** Fired when the camera moves; bearing = viewing direction, degrees from north. */
  onCameraChange?(bearingDeg: number): void
}

interface GroupEntry {
  key: GroupKey
  category: Category
  interior: boolean
  mesh: Mesh<BufferGeometry, MeshLambertMaterial>
  edges: LineSegments
  /** drawn triangle → triangle index in the group buffers (for picking) */
  visibleTri: Uint32Array
  visibleTriCount: number
}

const DRAG_THRESHOLD_PX = 5
/** Past this many surfaces the highlight draws its fill only — the outlines of
 *  a whole building read as noise at that zoom and cost real time to build. */
const MAX_OUTLINE_SURFACES = 2000

export class SceneManager {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera: PerspectiveCamera
  private controls: OrbitControls
  private raycaster = new Raycaster()
  private resizeObserver: ResizeObserver

  private modelGroup = new Group()
  private highlightGroup = new Group()
  private grid: GridHelper | null = null
  private groups: GroupEntry[] = []
  private model: EpModel | null = null
  private bundle: GeometryBundle | null = null

  private edgesVisible = true
  private ghost = false
  private interiorVisible = true
  private categoryVisible = new Set<Category>(CATEGORIES)
  private hiddenZones: ReadonlySet<string> = new Set()
  /** Set when hiddenZones changes; index buffers are rebuilt on the next apply. */
  private maskDirty = true
  /** Selected surface indices, kept so visibility changes can re-highlight. */
  private selection: readonly number[] = []

  private renderQueued = false
  private pointerDown: { x: number; y: number } | null = null
  private disposed = false

  constructor(
    private container: HTMLElement,
    private callbacks: SceneCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(this.renderer.domElement)

    this.scene.background = new Color(CANVAS_BACKGROUND)
    this.scene.add(this.modelGroup)
    this.scene.add(this.highlightGroup)

    this.camera = new PerspectiveCamera(55, this.aspect(), 0.1, 10000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(30, -30, 25)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.addEventListener('change', () => {
      this.requestRender()
      this.emitCamera()
    })

    const hemi = new HemisphereLight(0xffffff, 0x30303a, 0.85)
    hemi.position.set(0, 0, 1)
    const sun = new DirectionalLight(0xffffff, 1.35)
    sun.position.set(-0.6, -0.45, 1)
    const fill = new DirectionalLight(0xbfd4ff, 0.35)
    fill.position.set(0.7, 0.6, 0.4)
    const ambient = new AmbientLight(0xffffff, 0.12)
    this.scene.add(hemi, sun, fill, ambient)

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointerup', this.handlePointerUp)

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)

    this.animate()
  }

  // ---------------------------------------------------------------- model

  setModel(model: EpModel, bundle: GeometryBundle): void {
    this.clearModel()
    this.model = model
    this.bundle = bundle

    for (const key of Object.keys(bundle.groups) as GroupKey[]) {
      const buffers = bundle.groups[key]
      if (!buffers || buffers.positions.length === 0) continue
      const [category, side] = key.split(':') as [Category, 'ext' | 'int']

      // Indexed geometry: hiding zones rewrites the index instead of splitting
      // the merge into per-zone meshes, which would multiply draw calls.
      const triCount = buffers.triSurface.length
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3))
      geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3))
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(buffers.positions.length), 3))
      geometry.setIndex(new BufferAttribute(new Uint32Array(triCount * 3), 1))

      const mesh = new Mesh(geometry, createGroupMaterial(category))
      mesh.userData.groupKey = key

      const segCount = buffers.edgeSurface.length
      const edgeGeometry = new BufferGeometry()
      edgeGeometry.setAttribute('position', new BufferAttribute(buffers.edges, 3))
      edgeGeometry.setIndex(new BufferAttribute(new Uint32Array(segCount * 2), 1))
      const edges = new LineSegments(
        edgeGeometry,
        new LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.55 }),
      )

      this.modelGroup.add(mesh, edges)
      this.groups.push({
        key,
        category,
        interior: side === 'int',
        mesh,
        edges,
        visibleTri: new Uint32Array(triCount),
        visibleTriCount: 0,
      })
    }
    this.maskDirty = true

    this.buildGrid()
    this.applyVisibility()
    this.fitAll()
  }

  clearModel(): void {
    this.selection = []
    this.disposeHighlight()
    for (const g of this.groups) {
      g.mesh.geometry.dispose()
      g.mesh.material.dispose()
      g.edges.geometry.dispose()
      ;(g.edges.material as LineBasicMaterial).dispose()
    }
    this.groups = []
    this.hiddenZones = new Set()
    this.maskDirty = true
    this.modelGroup.clear()
    if (this.grid) {
      this.grid.geometry.dispose()
      ;(this.grid.material as LineBasicMaterial).dispose()
      this.scene.remove(this.grid)
      this.grid = null
    }
    this.model = null
    this.bundle = null
    this.requestRender()
  }

  /** Fill vertex-color attributes from a per-surface color function. */
  applyColors(colorOf: (s: EpSurface) => [number, number, number]): void {
    if (!this.model || !this.bundle) return
    const surfaces = this.model.surfaces
    for (const g of this.groups) {
      const buffers = this.bundle.groups[g.key]
      if (!buffers) continue
      const attr = g.mesh.geometry.getAttribute('color') as BufferAttribute
      const colors = attr.array as Float32Array
      const triSurface = buffers.triSurface
      for (let t = 0; t < triSurface.length; t++) {
        const [r, gg, b] = colorOf(surfaces[triSurface[t]])
        const base = t * 9
        colors[base] = r
        colors[base + 1] = gg
        colors[base + 2] = b
        colors[base + 3] = r
        colors[base + 4] = gg
        colors[base + 5] = b
        colors[base + 6] = r
        colors[base + 7] = gg
        colors[base + 8] = b
      }
      attr.needsUpdate = true
    }
    this.requestRender()
  }

  // ----------------------------------------------------------- visibility

  setCategoryVisible(category: Category, visible: boolean): void {
    if (visible) this.categoryVisible.add(category)
    else this.categoryVisible.delete(category)
    this.applyVisibility()
  }

  setInteriorVisible(visible: boolean): void {
    this.interiorVisible = visible
    this.applyVisibility()
  }

  /** Hide whole zones by name; buildings are expanded to their zones by the caller. */
  setHiddenZones(zones: ReadonlySet<string>): void {
    this.hiddenZones = zones
    this.maskDirty = true
    this.applyVisibility()
  }

  setGhost(on: boolean): void {
    this.ghost = on
    for (const g of this.groups) {
      if (!g.interior && g.category !== 'shading') applyGhost(g.mesh.material, on, g.category)
      // Edge lines of ghosted groups fade as well
      const lineMat = g.edges.material as LineBasicMaterial
      lineMat.opacity = on && !g.interior ? 0.12 : 0.55
    }
    this.requestRender()
  }

  setEdges(on: boolean): void {
    this.edgesVisible = on
    this.applyVisibility()
  }

  private applyVisibility(): void {
    if (this.maskDirty) {
      this.rebuildZoneMask()
      this.maskDirty = false
    }
    for (const g of this.groups) {
      const visible =
        g.visibleTriCount > 0 && this.categoryVisible.has(g.category) && (this.interiorVisible || !g.interior)
      g.mesh.visible = visible
      g.edges.visible = visible && this.edgesVisible
    }
    // Members that just appeared or disappeared change what the highlight covers
    this.rebuildHighlight()
  }

  /** Whether a surface is drawn right now, given zones, categories and preset. */
  private isSurfaceVisible(s: EpSurface): boolean {
    if (s.zone !== null && this.hiddenZones.has(s.zone)) return false
    if (!this.categoryVisible.has(s.category)) return false
    return !(s.isInterior && !this.interiorVisible)
  }

  /**
   * Rewrite each group's index buffer to skip triangles belonging to a hidden
   * zone. Surfaces with no zone (site and building shading) are never hidden.
   */
  private rebuildZoneMask(): void {
    if (!this.model || !this.bundle) return
    const surfaces = this.model.surfaces
    const hidden = this.hiddenZones
    const nothingHidden = hidden.size === 0

    for (const g of this.groups) {
      const buffers = this.bundle.groups[g.key]
      if (!buffers) continue

      const triSurface = buffers.triSurface
      const index = g.mesh.geometry.getIndex()!
      const idx = index.array as Uint32Array
      let w = 0
      for (let t = 0; t < triSurface.length; t++) {
        const zone = surfaces[triSurface[t]].zone
        if (!nothingHidden && zone !== null && hidden.has(zone)) continue
        g.visibleTri[w] = t
        const v = t * 3
        idx[w * 3] = v
        idx[w * 3 + 1] = v + 1
        idx[w * 3 + 2] = v + 2
        w++
      }
      g.visibleTriCount = w
      index.needsUpdate = true
      g.mesh.geometry.setDrawRange(0, w * 3)

      const edgeSurface = buffers.edgeSurface
      const edgeIndex = g.edges.geometry.getIndex()!
      const eIdx = edgeIndex.array as Uint32Array
      let e = 0
      for (let s = 0; s < edgeSurface.length; s++) {
        const zone = surfaces[edgeSurface[s]].zone
        if (!nothingHidden && zone !== null && hidden.has(zone)) continue
        eIdx[e * 2] = s * 2
        eIdx[e * 2 + 1] = s * 2 + 1
        e++
      }
      edgeIndex.needsUpdate = true
      g.edges.geometry.setDrawRange(0, e * 2)
    }
  }

  // ------------------------------------------------------------ selection

  /** Highlight a set of surfaces — one surface, a zone, or a whole building. */
  select(indices: readonly number[]): void {
    this.selection = indices
    this.rebuildHighlight()
  }

  /**
   * Merge every selected surface into a single fill mesh and a single outline,
   * so a 1-surface and a 500-surface selection both cost two draw calls. Only
   * currently visible members contribute — a hidden zone must not leave a
   * highlight floating where its geometry used to be.
   */
  private rebuildHighlight(): void {
    this.disposeHighlight()
    const model = this.model
    const bundle = this.bundle
    if (!model || !bundle || this.selection.length === 0) {
      this.requestRender()
      return
    }

    // Pass 1 — collect the visible members and size the merged buffers.
    const members: EpSurface[] = []
    let triCount = 0
    let ringVertexCount = 0
    for (const i of this.selection) {
      const s = model.surfaces[i]
      if (!s || !this.isSurfaceVisible(s)) continue
      const range = bundle.groups[groupKeyOf(s)]?.ranges[i]
      if (!range) continue
      members.push(s)
      triCount += range[1]
      ringVertexCount += s.polygon.length / 3
      for (const h of s.holes) ringVertexCount += h.length / 3
    }
    if (triCount === 0) {
      this.requestRender()
      return
    }

    // Pass 2 — copy triangle spans straight out of the merged group buffers.
    const positions = new Float32Array(triCount * 9)
    let w = 0
    for (const s of members) {
      const buffers = bundle.groups[groupKeyOf(s)]!
      const [first, count] = buffers.ranges[s.index]
      positions.set(buffers.positions.subarray(first * 9, (first + count) * 9), w)
      w += count * 9
    }
    const fillGeometry = new BufferGeometry()
    fillGeometry.setAttribute('position', new BufferAttribute(positions, 3))
    this.highlightGroup.add(
      new Mesh(
        fillGeometry,
        new MeshBasicMaterial({
          color: ACCENT,
          transparent: true,
          opacity: 0.35,
          side: DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      ),
    )

    if (members.length > MAX_OUTLINE_SURFACES) {
      this.requestRender()
      return
    }
    const rings = new Float32Array(ringVertexCount * 6)
    let r = 0
    for (const s of members) {
      r = writeRing(rings, r, s.polygon)
      for (const h of s.holes) r = writeRing(rings, r, h)
    }
    const outline = new BufferGeometry()
    outline.setAttribute('position', new BufferAttribute(rings, 3))
    this.highlightGroup.add(
      new LineSegments(outline, new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95 })),
    )
    this.requestRender()
  }

  private disposeHighlight(): void {
    for (const child of this.highlightGroup.children as (Mesh | LineSegments)[]) {
      child.geometry.dispose()
      ;(child.material as MeshBasicMaterial | LineBasicMaterial).dispose()
    }
    this.highlightGroup.clear()
  }

  /** Frame a set of surfaces (indices into model.surfaces). */
  zoomToSurfaces(indices: number[]): void {
    if (!this.model || indices.length === 0) return
    const box = new Box3()
    const v = new Vector3()
    for (const i of indices) {
      const p = this.model.surfaces[i]?.polygon
      if (!p) continue
      for (let k = 0; k < p.length; k += 3) box.expandByPoint(v.set(p[k], p[k + 1], p[k + 2]))
    }
    if (!box.isEmpty()) this.frameBox(box, 1.8)
  }

  // --------------------------------------------------------------- camera

  /** Frame what is currently on screen, so Fit after a solo zooms to that building. */
  fitAll(): void {
    if (!this.model) return
    // Merged geometry spans every zone, so bounds come from the visible surfaces
    const box = new Box3()
    const v = new Vector3()
    for (const s of this.model.surfaces) {
      if (!this.isSurfaceVisible(s)) continue
      for (let k = 0; k < s.polygon.length; k += 3) {
        box.expandByPoint(v.set(s.polygon[k], s.polygon[k + 1], s.polygon[k + 2]))
      }
    }
    if (box.isEmpty()) box.setFromObject(this.modelGroup)
    if (!box.isEmpty()) this.frameBox(box, 1.15)
  }

  setTopView(): void {
    this.moveCameraToDirection(new Vector3(0, 0.0001, 1))
  }

  setNorthView(): void {
    // Look from the south toward north
    this.moveCameraToDirection(new Vector3(0, -1, 0.35))
  }

  private moveCameraToDirection(dir: Vector3): void {
    const target = this.controls.target.clone()
    const dist = this.camera.position.distanceTo(target)
    this.camera.position.copy(target).addScaledVector(dir.normalize(), dist)
    this.controls.update()
    this.requestRender()
  }

  private frameBox(box: Box3, padding: number): void {
    const sphere = box.getBoundingSphere(new Sphere())
    const fov = (this.camera.fov * Math.PI) / 180
    const dist = ((sphere.radius * padding) / Math.tan(fov / 2)) * 1.0
    const dir = this.camera.position.clone().sub(this.controls.target)
    if (dir.lengthSq() < 1e-6) dir.set(1, -1, 0.8)
    dir.normalize()
    this.controls.target.copy(sphere.center)
    this.camera.position.copy(sphere.center).addScaledVector(dir, Math.max(dist, sphere.radius * 0.02 + 0.5))
    this.camera.near = Math.max(0.05, dist / 1000)
    this.camera.far = Math.max(10000, dist * 20)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.requestRender()
  }

  // -------------------------------------------------------------- picking

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button === 0) this.pointerDown = { x: e.clientX, y: e.clientY }
  }

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.pointerDown || e.button !== 0) return
    const dx = e.clientX - this.pointerDown.x
    const dy = e.clientY - this.pointerDown.y
    this.pointerDown = null
    if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return

    const surfaceIndex = this.pick(e.clientX, e.clientY)
    this.callbacks.onPick(surfaceIndex)
  }

  private pick(clientX: number, clientY: number): number | null {
    if (!this.bundle) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    // Ghosted exterior groups stay pickable only when solid; interior surfaces
    // become pickable exactly when visible.
    const pickable = this.groups
      .filter((g) => g.mesh.visible && !(this.ghost && !g.interior && g.category !== 'shading'))
      .map((g) => g.mesh)
    const hits = this.raycaster.intersectObjects(pickable, false)
    const hit = hits[0]
    if (!hit || hit.faceIndex == null) return null
    const key = (hit.object as Mesh).userData.groupKey as GroupKey
    const buffers = this.bundle.groups[key]
    const group = this.groups.find((g) => g.key === key)
    if (!buffers || !group) return null
    // faceIndex counts drawn faces, so map it back through the visible-triangle table
    if (hit.faceIndex >= group.visibleTriCount) return null
    return buffers.triSurface[group.visibleTri[hit.faceIndex]] ?? null
  }

  // ------------------------------------------------------------ internals

  private buildGrid(): void {
    if (!this.model) return
    const [sx, sy] = this.model.meta.bboxSize
    const extent = Math.max(sx, sy) * 1.6
    const step = niceStep(extent / 20)
    const divisions = Math.max(2, Math.round(extent / step))
    const grid = new GridHelper(divisions * step, divisions, 0x2c2c36, 0x1d1d25)
    grid.rotation.x = Math.PI / 2
    grid.position.z = -0.02
    this.grid = grid
    this.scene.add(grid)
  }

  private emitCamera(): void {
    if (!this.callbacks.onCameraChange) return
    const d = this.controls.target.clone().sub(this.camera.position)
    const bearing = (Math.atan2(d.x, d.y) * 180) / Math.PI
    this.callbacks.onCameraChange(bearing)
  }

  private aspect(): number {
    return this.container.clientWidth / Math.max(1, this.container.clientHeight)
  }

  private handleResize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.requestRender()
  }

  requestRender(): void {
    this.renderQueued = true
  }

  /** Damping needs a light animation loop; renders only when queued or moving. */
  private animate = (): void => {
    if (this.disposed) return
    requestAnimationFrame(this.animate)
    const damping = this.controls.update()
    if (this.renderQueued || damping) {
      this.renderQueued = false
      this.renderer.render(this.scene, this.camera)
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearModel()
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

/** Write a closed ring as line-segment pairs at `offset`; returns the next offset. */
function writeRing(out: Float32Array, offset: number, ring: number[]): number {
  const n = ring.length / 3
  let w = offset
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    out[w++] = ring[i * 3]
    out[w++] = ring[i * 3 + 1]
    out[w++] = ring[i * 3 + 2]
    out[w++] = ring[j * 3]
    out[w++] = ring[j * 3 + 1]
    out[w++] = ring[j * 3 + 2]
  }
  return w
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.1))))
  const n = raw / pow
  if (n < 1.5) return pow
  if (n < 3.5) return 2 * pow
  if (n < 7.5) return 5 * pow
  return 10 * pow
}
