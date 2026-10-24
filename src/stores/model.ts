import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, markRaw } from 'vue'
import type { EpModel, EpSurface, GeometryBundle, Category } from '../core/types'
import { CATEGORIES } from '../core/types'
import type { RenderMode } from '../three/materials'
import type { WorkerRequest, WorkerResponse } from '../worker/modelWorker'
import { ConversionError, convertIdf } from '../energyplus/client'
import type { UpgradeProvenance } from '../energyplus/types'

export type LoadStatus = 'empty' | 'loading' | 'ready' | 'error'
export type ViewPreset = 'exterior' | 'all' | 'xray'
export type BuildingVisibility = 'visible' | 'partial' | 'hidden'
/** How far a click expands: the surface itself, its zone, or its whole building. */
export type SelectionLevel = 'surface' | 'zone' | 'building'

export const SELECTION_LEVELS: readonly SelectionLevel[] = ['surface', 'zone', 'building']

/** The picked surface expanded to the current selection level. */
export interface SelectionGroup {
  level: SelectionLevel
  /** Zone or building name; null at surface level. */
  key: string | null
  /** Display label — the zone/building label, or the surface name. */
  label: string
  indices: number[]
}

export const useModelStore = defineStore('model', () => {
  const status = ref<LoadStatus>('empty')
  const fileName = ref('')
  const errorMsg = ref('')
  const progress = ref({ phase: '', pct: 0 })
  const importFileName = ref('')
  const conversionDiagnostics = shallowRef<string[]>([])
  const upgradedDocument = shallowRef<{ name: string; text: string; provenance: UpgradeProvenance } | null>(null)
  const convertedDocument = shallowRef<{ name: string; text: string; version: string } | null>(null)
  // Preserve complete input independently of the recentered, geometry-only model.
  const sourceDocument = shallowRef<{ name: string; original: string; epjson: string; upgradedIdf?: string; provenance?: UpgradeProvenance } | null>(null)

  const model = shallowRef<EpModel | null>(null)
  const bundle = shallowRef<GeometryBundle | null>(null)

  /** The picked surface — the anchor the selection level expands from. */
  const selected = ref<number | null>(null)
  const selectionLevel = ref<SelectionLevel>('surface')
  const renderMode = ref<RenderMode>('type')
  const preset = ref<ViewPreset>('all')
  const categoryVisible = reactive(
    Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>,
  )
  const interiorVisible = ref(true)
  const xray = ref(false)
  const edges = ref(true)
  /**
   * Zones hidden from the viewer — the single source of truth for both zone and
   * building visibility (every zone belongs to a building). Always replaced,
   * never mutated, so watchers fire on identity.
   */
  const hiddenZones = shallowRef<ReadonlySet<string>>(new Set())

  /** One-shot camera request consumed (and cleared) by the viewer component. */
  const viewRequest = ref<'fit' | 'top' | 'north' | null>(null)
  /** Surface indices to frame, consumed by the viewer. */
  const zoomRequest = shallowRef<number[] | null>(null)
  /** Viewing direction bearing in degrees from north (drives the compass). */
  const cameraBearing = ref(0)

  const selectedSurface = computed<EpSurface | null>(() =>
    model.value && selected.value != null ? (model.value.surfaces[selected.value] ?? null) : null,
  )

  /**
   * Surface indices grouped by `surface.zone` / `surface.building` rather than
   * by `EpZone.surfaces` (which holds building surfaces only) — grouping on the
   * surface field brings hosted fenestration and zone/building shading along
   * for free. Site shading has both fields null and is never grouped.
   */
  const surfacesByZone = computed(() => groupSurfacesBy((s) => s.zone))
  const surfacesByBuilding = computed(() => groupSurfacesBy((s) => s.building))

  function groupSurfacesBy(keyOf: (s: EpSurface) => string | null): Map<string, number[]> {
    const map = new Map<string, number[]>()
    for (const s of model.value?.surfaces ?? []) {
      const key = keyOf(s)
      if (key === null) continue
      const list = map.get(key)
      if (list) list.push(s.index)
      else map.set(key, [s.index])
    }
    return map
  }

  /**
   * The selection as the viewer and info card see it. A surface that has no
   * zone or building (site shading) falls back to itself, so raising the level
   * never produces an empty selection.
   */
  const selectionGroup = computed<SelectionGroup | null>(() => {
    const m = model.value
    const anchor = selectedSurface.value
    if (!m || !anchor) return null

    if (selectionLevel.value === 'zone' && anchor.zone) {
      const indices = surfacesByZone.value.get(anchor.zone)
      if (indices) {
        return { level: 'zone', key: anchor.zone, label: m.zones[anchor.zone]?.label ?? anchor.zone, indices }
      }
    } else if (selectionLevel.value === 'building' && anchor.building) {
      const indices = surfacesByBuilding.value.get(anchor.building)
      if (indices) {
        return {
          level: 'building',
          key: anchor.building,
          label: m.buildings[anchor.building]?.label ?? anchor.building,
          indices,
        }
      }
    }
    return { level: 'surface', key: null, label: anchor.name, indices: [anchor.index] }
  })

  /**
   * The levels the loaded model can express. Zone needs zones at all; Building
   * needs more than one, since epJSON has a single `Building` object and only
   * urban exports pack several real buildings into it — offering the level on a
   * conventional file would just mean "select everything".
   */
  const availableSelectionLevels = computed<SelectionLevel[]>(() => {
    const stats = model.value?.stats
    if (!stats || stats.zoneCount === 0) return ['surface']
    return SELECTION_LEVELS.filter((l) => l !== 'building' || stats.buildingCount > 1)
  })

  const hiddenZoneCount = computed(() => hiddenZones.value.size)

  /** Building name → visibility, derived from how many of its zones are hidden. */
  const buildingVisibility = computed(() => {
    const map = new Map<string, BuildingVisibility>()
    const m = model.value
    if (!m) return map
    for (const name of m.buildingNames) {
      const zones = m.buildings[name].zones
      const hidden = zones.reduce((n, z) => n + (hiddenZones.value.has(z) ? 1 : 0), 0)
      map.set(name, hidden === 0 ? 'visible' : hidden === zones.length ? 'hidden' : 'partial')
    }
    return map
  })

  const constructionIndex = computed(() => {
    const map = new Map<string, number>()
    model.value?.constructionNames.forEach((name, i) => map.set(name, i))
    return map
  })

  let worker: Worker | null = null
  let requestId = 0
  let controller: AbortController | null = null
  let pendingDocument: typeof sourceDocument.value = null

  function stopWork(): void {
    controller?.abort()
    controller = null
    worker?.terminate()
    worker = null
    pendingDocument = null
  }

  function failLoad(id: number, error: unknown): void {
    if (id !== requestId) return
    errorMsg.value = error instanceof Error ? error.message : String(error)
    if (error instanceof ConversionError) conversionDiagnostics.value = error.diagnostics
    status.value = model.value ? 'ready' : 'error'
    stopWork()
  }

  function ensureWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('../worker/modelWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.id !== requestId) return // stale response from a superseded load
      if (msg.type === 'progress') {
        progress.value = { phase: msg.phase, pct: convertedDocument.value ? 40 + msg.pct * 0.6 : msg.pct }
      } else if (msg.type === 'done') {
        sourceDocument.value = pendingDocument ? markRaw(pendingDocument) : null
        fileName.value = importFileName.value
        model.value = markRaw(msg.model)
        bundle.value = markRaw(msg.bundle)
        selected.value = null
        hiddenZones.value = new Set()
        // The level carries over between models, so drop it if the new one has
        // no such level (urban block at Building level → single-zone house).
        if (!availableSelectionLevels.value.includes(selectionLevel.value)) {
          selectionLevel.value = 'surface'
        }
        status.value = 'ready'
        stopWork()
      } else {
        failLoad(msg.id, new Error(msg.message))
      }
    }
    const workerId = requestId
    worker.onerror = (e) => {
      failLoad(workerId, new Error(e.message || 'Worker failed'))
    }
    worker.onmessageerror = () => failLoad(workerId, new Error('Could not read the geometry worker result.'))
    return worker
  }

  function beginLoad(name: string): number {
    stopWork()
    const id = ++requestId
    controller = new AbortController()
    status.value = 'loading'
    importFileName.value = name
    errorMsg.value = ''
    conversionDiagnostics.value = []
    convertedDocument.value = null
    upgradedDocument.value = null
    progress.value = { phase: 'Reading file', pct: 2 }
    return id
  }

  async function processText(id: number, name: string, original: string): Promise<void> {
    if (id !== requestId || !controller) return
    let text = original
    let upgradedIdf: string | undefined
    let provenance: UpgradeProvenance | undefined
    if (/\.idf$/i.test(name)) {
      const result = await convertIdf(original, {
        id,
        signal: controller.signal,
        assetBaseUrl: new URL(import.meta.env.BASE_URL + 'energyplus/', document.baseURI).href,
        onProgress: (phase, pct) => {
          if (id === requestId) progress.value = { phase, pct }
        },
      })
      if (id !== requestId) return
      text = result.epjson
      upgradedIdf = result.upgradedIdf
      provenance = result.provenance
      conversionDiagnostics.value = result.diagnostics
      upgradedDocument.value = result.upgradedIdf ? markRaw({
        name: name.replace(/\.idf$/i, `-v${result.provenance.targetVersion}.idf`),
        text: result.upgradedIdf, provenance: result.provenance,
      }) : null
      convertedDocument.value = markRaw({
        name: name.replace(/\.idf$/i, '.epJSON'), text, version: result.energyPlusVersion,
      })
    }
    if (id !== requestId) return
    pendingDocument = { name, original, epjson: text, upgradedIdf, provenance }
    const req: WorkerRequest = { id, fileName: name, text }
    ensureWorker().postMessage(req)
  }

  async function loadFile(file: File): Promise<void> {
    const id = beginLoad(file.name)
    try {
      await processText(id, file.name, await file.text())
    } catch (error) {
      failLoad(id, error)
    }
  }

  async function loadText(name: string, text: string): Promise<void> {
    const id = beginLoad(name)
    try {
      await processText(id, name, text)
    } catch (error) {
      failLoad(id, error)
    }
  }

  async function loadDemo(url: string, name: string): Promise<void> {
    const id = beginLoad(name)
    progress.value = { phase: 'Downloading demo model', pct: 2 }
    try {
      const res = await fetch(url, { signal: controller!.signal })
      if (!res.ok) throw new Error(`Demo model not found (${res.status})`)
      await processText(id, name, await res.text())
    } catch (err) {
      failLoad(id, err)
    }
  }

  function cancelLoad(): void {
    ++requestId
    stopWork()
    errorMsg.value = ''
    conversionDiagnostics.value = []
    convertedDocument.value = null
    upgradedDocument.value = null
    status.value = model.value ? 'ready' : 'empty'
  }

  function downloadUpgraded(): void {
    const upgraded = upgradedDocument.value
    if (!upgraded) return
    const url = URL.createObjectURL(new Blob([upgraded.text], { type: 'text/plain' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = upgraded.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function downloadConverted(): void {
    const converted = convertedDocument.value
    if (!converted) return
    const url = URL.createObjectURL(new Blob([converted.text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = converted.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function close(): void {
    cancelLoad()
    model.value = null
    bundle.value = null
    selected.value = null
    hiddenZones.value = new Set()
    fileName.value = ''
    importFileName.value = ''
    sourceDocument.value = null
    status.value = 'empty'
  }

  function select(index: number | null): void {
    selected.value = index
  }

  /** Select by surface name (paired-surface / host links in the info card). */
  function selectByName(name: string, zoom = true): void {
    const m = model.value
    if (!m) return
    // Cross-references such as boundaryObject carry the casing the author
    // wrote, which EnergyPlus folds away but epJSON preserves.
    const folded = name.toLowerCase()
    const s = m.surfaces.find((x) => x.name === name)
      ?? m.surfaces.find((x) => x.name.toLowerCase() === folded)
    if (s) {
      selected.value = s.index
      if (zoom) zoomRequest.value = [s.index]
    }
  }

  function setSelectionLevel(level: SelectionLevel): void {
    if (availableSelectionLevels.value.includes(level)) selectionLevel.value = level
  }

  /** Step Surface → Zone → Building → Surface, skipping levels this model lacks. */
  function cycleSelectionLevel(): void {
    const levels = availableSelectionLevels.value
    const i = levels.indexOf(selectionLevel.value)
    selectionLevel.value = levels[(i + 1) % levels.length]
  }

  function setHiddenZones(next: Set<string>): void {
    hiddenZones.value = next
    // A group selection survives as long as part of it is still visible — hiding
    // one zone of a selected building only moves the anchor. At surface level
    // the group is the surface itself, so it deselects as before.
    const group = selectionGroup.value
    if (!group) return
    const m = model.value
    const stillVisible = group.indices.filter((i) => {
      const zone = m?.surfaces[i]?.zone
      return !(zone && next.has(zone))
    })
    if (stillVisible.length === 0) selected.value = null
    else if (!stillVisible.includes(selected.value!)) selected.value = stillVisible[0]
  }

  function toggleZone(name: string): void {
    const next = new Set(hiddenZones.value)
    if (!next.delete(name)) next.add(name)
    setHiddenZones(next)
  }

  /** Fully hidden building → show all its zones; otherwise hide them all. */
  function toggleBuilding(name: string): void {
    const zones = model.value?.buildings[name]?.zones
    if (!zones) return
    const next = new Set(hiddenZones.value)
    const allHidden = zones.every((z) => next.has(z))
    for (const z of zones) {
      if (allHidden) next.delete(z)
      else next.add(z)
    }
    setHiddenZones(next)
  }

  /** Hide every zone but these; repeating the same solo restores everything. */
  function soloZones(keep: readonly string[]): void {
    const m = model.value
    if (!m) return
    const keepSet = new Set(keep)
    const next = new Set(m.zoneNames.filter((z) => !keepSet.has(z)))
    const unchanged = next.size === hiddenZones.value.size && [...next].every((z) => hiddenZones.value.has(z))
    setHiddenZones(unchanged ? new Set() : next)
  }

  function soloZone(name: string): void {
    soloZones([name])
  }

  function soloBuilding(name: string): void {
    const zones = model.value?.buildings[name]?.zones
    if (zones) soloZones(zones)
  }

  function showAllZones(): void {
    setHiddenZones(new Set())
  }

  function applyPreset(p: ViewPreset): void {
    preset.value = p
    for (const c of CATEGORIES) categoryVisible[c] = true
    if (p === 'exterior') {
      interiorVisible.value = false
      xray.value = false
      categoryVisible.airBoundary = false
    } else if (p === 'all') {
      interiorVisible.value = true
      xray.value = false
    } else {
      // X-ray inspects the inside of the model — shading context only obscures it
      interiorVisible.value = true
      xray.value = true
      categoryVisible.shading = false
    }
  }

  function requestView(v: 'fit' | 'top' | 'north'): void {
    viewRequest.value = v
  }

  function zoomToSurfaces(indices: number[]): void {
    zoomRequest.value = indices
  }

  return {
    status,
    fileName,
    errorMsg,
    progress,
    importFileName,
    conversionDiagnostics,
    convertedDocument,
    upgradedDocument,
    sourceDocument,
    model,
    bundle,
    selected,
    selectedSurface,
    selectionLevel,
    availableSelectionLevels,
    selectionGroup,
    constructionIndex,
    renderMode,
    preset,
    categoryVisible,
    interiorVisible,
    xray,
    edges,
    hiddenZones,
    hiddenZoneCount,
    buildingVisibility,
    viewRequest,
    zoomRequest,
    cameraBearing,
    loadFile,
    loadText,
    loadDemo,
    cancelLoad,
    downloadConverted,
    downloadUpgraded,
    close,
    select,
    selectByName,
    setSelectionLevel,
    cycleSelectionLevel,
    toggleZone,
    toggleBuilding,
    soloZone,
    soloBuilding,
    showAllZones,
    applyPreset,
    requestView,
    zoomToSurfaces,
  }
})
