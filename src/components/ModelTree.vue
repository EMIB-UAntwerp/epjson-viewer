<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { ChevronRight, Eye, EyeOff, Focus, Search, Trees } from 'lucide-vue-next'
import { useModelStore } from '../stores/model'
import { CATEGORY_COLORS } from '../three/materials'
import type { EpSurface } from '../core/types'

const store = useModelStore()
const search = ref('')
const expanded = ref(new Set<string>())
const MATCH_CAP = 250

const model = computed(() => store.model)

interface SurfaceRow {
  surface: EpSurface
  fens: EpSurface[]
}
interface ZoneNode {
  name: string
  label: string
  rows: SurfaceRow[]
}
interface BuildingNode {
  name: string
  label: string
  zones: ZoneNode[]
  surfaceCount: number
}

const query = computed(() => search.value.trim().toLowerCase())

const tree = computed<{ buildings: BuildingNode[]; shadingCount: number; capped: number }>(() => {
  const m = model.value
  if (!m) return { buildings: [], shadingCount: 0, capped: 0 }
  const q = query.value
  let matches = 0
  let capped = 0

  const buildings: BuildingNode[] = []
  for (const bName of m.buildingNames) {
    const b = m.buildings[bName]
    const zones: ZoneNode[] = []
    for (const zName of b.zones) {
      const z = m.zones[zName]
      const rows: SurfaceRow[] = []
      for (const si of z.surfaces) {
        const s = m.surfaces[si]
        const fens = s.fenestration.map((fi) => m.surfaces[fi])
        const hit =
          q === '' ||
          s.name.toLowerCase().includes(q) ||
          fens.some((f) => f.name.toLowerCase().includes(q)) ||
          zName.toLowerCase().includes(q) ||
          bName.toLowerCase().includes(q)
        if (!hit) continue
        if (q !== '' && matches >= MATCH_CAP) {
          capped++
          continue
        }
        if (q !== '') matches++
        rows.push({ surface: s, fens })
      }
      if (rows.length > 0) zones.push({ name: zName, label: z.label, rows })
    }
    if (zones.length > 0) buildings.push({ name: bName, label: b.label, zones, surfaceCount: zones.reduce((n, z) => n + z.rows.length, 0) })
  }
  return { buildings, shadingCount: m.stats.counts.shading, capped }
})

const searching = computed(() => query.value !== '')

// Auto-expand small models once loaded
watch(
  () => store.model,
  (m) => {
    expanded.value = new Set()
    if (m && m.buildingNames.length === 1) {
      expanded.value.add('b:' + m.buildingNames[0])
      const zones = m.buildings[m.buildingNames[0]].zones
      if (zones.length <= 3) for (const z of zones) expanded.value.add('z:' + z)
    }
  },
  { immediate: true },
)

// Reveal the selection in the tree when picked from the canvas
watch(
  () => store.selected,
  async (i) => {
    const m = store.model
    if (i == null || !m) return
    const s = m.surfaces[i]
    const host = s.hostSurface ? m.surfaces.find((x) => x.name === s.hostSurface) : null
    const zone = s.zone ?? host?.zone
    if (!zone) return
    const building = m.zones[zone]?.building
    if (building) expanded.value.add('b:' + building)
    expanded.value.add('z:' + zone)
    if (host) expanded.value.add('s:' + host.index)
    await nextTick()
    document.getElementById('tree-surface-' + i)?.scrollIntoView({ block: 'nearest' })
  },
)

function toggle(key: string): void {
  if (expanded.value.has(key)) expanded.value.delete(key)
  else expanded.value.add(key)
}
function isOpen(key: string): boolean {
  return searching.value || expanded.value.has(key)
}
function pick(s: EpSurface): void {
  store.select(s.index)
}
function frame(indices: number[]): void {
  store.zoomToSurfaces(indices)
}
function zoneIndices(z: ZoneNode): number[] {
  return z.rows.map((r) => r.surface.index)
}
function buildingIndices(b: BuildingNode): number[] {
  return b.zones.flatMap(zoneIndices)
}
function dot(s: EpSurface): string {
  return CATEGORY_COLORS[s.category]
}
function buildingState(name: string): 'visible' | 'partial' | 'hidden' {
  return store.buildingVisibility.get(name) ?? 'visible'
}
function zoneHidden(name: string): boolean {
  return store.hiddenZones.has(name)
}
/** Alt-click isolates instead of toggling — the "show only this" shortcut. */
function onBuildingEye(name: string, e: MouseEvent): void {
  if (e.altKey) store.soloBuilding(name)
  else store.toggleBuilding(name)
}
function onZoneEye(name: string, e: MouseEvent): void {
  if (e.altKey) store.soloZone(name)
  else store.toggleZone(name)
}
/** True when the current zone/building selection is exactly this row. */
function isSelectedGroup(level: 'zone' | 'building', name: string): boolean {
  const g = store.selectionGroup
  return g?.level === level && g.key === name
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Search -->
    <div class="flex-none border-b border-ink-800 p-2.5">
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          v-model="search"
          type="search"
          placeholder="Search surfaces, zones, buildings…"
          class="w-full rounded-md border border-ink-700 bg-ink-850 py-1.5 pr-2 pl-8 text-xs text-ink-100 placeholder:text-ink-400 focus:border-accent-600"
        />
      </div>
    </div>

    <!-- Hidden-geometry reset -->
    <div
      v-if="store.hiddenZoneCount > 0"
      class="flex flex-none items-center gap-2 border-b border-ink-800 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200"
    >
      <EyeOff class="h-3.5 w-3.5 flex-none" />
      <span
        >{{ store.hiddenZoneCount }} zone{{ store.hiddenZoneCount === 1 ? '' : 's' }} hidden</span
      >
      <button
        class="ml-auto flex-none rounded px-1.5 py-0.5 font-medium text-amber-100 transition-colors duration-150 hover:bg-amber-500/20"
        @click="store.showAllZones()"
      >
        Show all
      </button>
    </div>

    <!-- Tree -->
    <div class="min-h-0 flex-1 overflow-y-auto p-1.5 text-[13px]">
      <template v-if="model">
        <div v-for="b in tree.buildings" :key="b.name">
          <div
            class="group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-150"
            :class="isSelectedGroup('building', b.name) ? 'bg-accent-500/15' : 'hover:bg-ink-800'"
            @click="toggle('b:' + b.name)"
            @dblclick="frame(buildingIndices(b))"
          >
            <ChevronRight
              class="h-3.5 w-3.5 flex-none text-ink-400 transition-transform duration-150"
              :class="{ 'rotate-90': isOpen('b:' + b.name) }"
            />
            <span
              class="truncate font-medium text-ink-100"
              :class="{ 'opacity-45': buildingState(b.name) === 'hidden' }"
              :title="b.name"
              >{{ b.label }}</span
            >
            <span class="ml-auto flex-none rounded bg-ink-800 px-1.5 text-[10px] text-ink-400"
              >{{ b.zones.length }} zone{{ b.zones.length > 1 ? 's' : '' }}</span
            >
            <button
              class="flex-none rounded p-0.5 text-ink-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-accent-400"
              title="Frame building"
              @click.stop="frame(buildingIndices(b))"
            >
              <Focus class="h-3 w-3" />
            </button>
            <button
              class="flex-none rounded p-0.5 transition-opacity duration-150 hover:text-accent-400"
              :class="
                buildingState(b.name) === 'visible'
                  ? 'text-ink-400 opacity-0 group-hover:opacity-100'
                  : buildingState(b.name) === 'partial'
                    ? 'text-amber-400'
                    : 'text-ink-500'
              "
              :title="
                buildingState(b.name) === 'partial'
                  ? 'Show/hide building (some zones hidden) · Alt-click: show only this'
                  : 'Show/hide building · Alt-click: show only this'
              "
              @click.stop="onBuildingEye(b.name, $event)"
            >
              <EyeOff v-if="buildingState(b.name) === 'hidden'" class="h-3 w-3" />
              <Eye v-else class="h-3 w-3" />
            </button>
          </div>

          <div v-if="isOpen('b:' + b.name)" class="ml-3 border-l border-ink-800 pl-1.5">
            <div v-for="z in b.zones" :key="z.name">
              <div
                class="group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-150"
                :class="isSelectedGroup('zone', z.name) ? 'bg-accent-500/15' : 'hover:bg-ink-800'"
                @click="toggle('z:' + z.name)"
                @dblclick="frame(zoneIndices(z))"
              >
                <ChevronRight
                  class="h-3.5 w-3.5 flex-none text-ink-400 transition-transform duration-150"
                  :class="{ 'rotate-90': isOpen('z:' + z.name) }"
                />
                <span
                  class="truncate text-ink-200"
                  :class="{ 'opacity-45': zoneHidden(z.name) }"
                  :title="z.name"
                  >{{ z.label }}</span
                >
                <span class="ml-auto flex-none rounded bg-ink-800 px-1.5 text-[10px] text-ink-400">{{
                  z.rows.length
                }}</span>
                <button
                  class="flex-none rounded p-0.5 transition-opacity duration-150 hover:text-accent-400"
                  :class="zoneHidden(z.name) ? 'text-ink-500' : 'text-ink-400 opacity-0 group-hover:opacity-100'"
                  title="Show/hide zone · Alt-click: show only this"
                  @click.stop="onZoneEye(z.name, $event)"
                >
                  <EyeOff v-if="zoneHidden(z.name)" class="h-3 w-3" />
                  <Eye v-else class="h-3 w-3" />
                </button>
              </div>

              <div v-if="isOpen('z:' + z.name)" class="ml-3 border-l border-ink-800 pl-1.5">
                <div v-for="row in z.rows" :key="row.surface.index">
                  <div
                    :id="'tree-surface-' + row.surface.index"
                    class="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-[3px] transition-colors duration-150"
                    :class="
                      store.selected === row.surface.index
                        ? 'bg-accent-500/15 text-accent-300'
                        : 'text-ink-300 hover:bg-ink-800'
                    "
                    @click="pick(row.surface)"
                    @dblclick="frame([row.surface.index])"
                  >
                    <ChevronRight
                      v-if="row.fens.length"
                      class="h-3 w-3 flex-none text-ink-500 transition-transform duration-150"
                      :class="{ 'rotate-90': isOpen('s:' + row.surface.index) }"
                      @click.stop="toggle('s:' + row.surface.index)"
                    />
                    <span v-else class="w-3 flex-none" />
                    <span
                      class="h-2 w-2 flex-none rounded-[3px]"
                      :style="{ background: dot(row.surface) }"
                      :title="row.surface.surfaceType"
                    />
                    <span class="truncate font-mono text-[11px]" :title="row.surface.name">{{
                      row.surface.name
                    }}</span>
                  </div>

                  <div
                    v-if="row.fens.length && isOpen('s:' + row.surface.index)"
                    class="ml-[1.35rem] border-l border-ink-800 pl-1.5"
                  >
                    <div
                      v-for="f in row.fens"
                      :id="'tree-surface-' + f.index"
                      :key="f.index"
                      class="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-[3px] transition-colors duration-150"
                      :class="
                        store.selected === f.index
                          ? 'bg-accent-500/15 text-accent-300'
                          : 'text-ink-300 hover:bg-ink-800'
                      "
                      @click="pick(f)"
                      @dblclick="frame([f.index])"
                    >
                      <span class="h-2 w-2 flex-none rounded-[3px]" :style="{ background: dot(f) }" />
                      <span class="truncate font-mono text-[11px]" :title="f.name">{{ f.name }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p v-if="tree.capped > 0" class="px-2 py-1.5 text-[11px] text-ink-400">
          +{{ tree.capped }} more matches — refine the search
        </p>

        <!-- Shading context summary -->
        <div
          v-if="tree.shadingCount > 0 && !searching"
          class="mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ink-400"
        >
          <Trees class="h-3.5 w-3.5 flex-none" />
          <span>Shading context</span>
          <span class="ml-auto rounded bg-ink-800 px-1.5 text-[10px]"
            >{{ tree.shadingCount.toLocaleString() }} surfaces</span
          >
        </div>

        <p v-if="searching && tree.buildings.length === 0" class="px-2 py-3 text-center text-xs text-ink-400">
          No matches for “{{ search }}”
        </p>
      </template>
    </div>
  </div>
</template>
