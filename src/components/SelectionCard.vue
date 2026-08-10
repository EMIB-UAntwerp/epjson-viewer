<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, Box, Building2, Focus, X } from 'lucide-vue-next'
import { useModelStore } from '../stores/model'
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../three/materials'
import { CATEGORIES } from '../core/types'
import { summarizeSurfaces } from '../core/metrics'

const store = useModelStore()
const s = computed(() => store.selectedSurface)
const group = computed(() => store.selectionGroup)
/** True when the level expanded the click past the single clicked surface. */
const isGroup = computed(() => group.value != null && group.value.level !== 'surface')

function fmt(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}
function pct(x: number): string {
  return (x * 100).toFixed(0) + '%'
}

const cardinal = computed(() => {
  if (!s.value || s.value.tilt <= 1 || s.value.tilt >= 179) return ''
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(s.value.azimuth / 22.5) % 16]
})

const zoneLabel = computed(() => (s.value?.zone && store.model ? store.model.zones[s.value.zone]?.label : null))
const buildingLabel = computed(() =>
  s.value?.building && store.model ? store.model.buildings[s.value.building]?.label : null,
)

/** The EpZone behind a zone-level selection — carries volume, height, origin. */
const zone = computed(() =>
  group.value?.level === 'zone' && group.value.key && store.model ? store.model.zones[group.value.key] : null,
)
const zoneCount = computed(() =>
  group.value?.level === 'building' && group.value.key && store.model
    ? (store.model.buildings[group.value.key]?.zones.length ?? 0)
    : 0,
)

/** Same roll-up parse.ts runs model-wide, applied to the selected subset. */
const summary = computed(() => {
  const g = group.value
  const m = store.model
  if (!g || !m || !isGroup.value) return null
  return summarizeSurfaces(g.indices.map((i) => m.surfaces[i]))
})

const breakdown = computed(() => {
  const counts = summary.value?.counts
  if (!counts) return []
  return CATEGORIES.filter((c) => counts[c] > 0).map((c) => ({
    id: c,
    label: CATEGORY_LABELS[c],
    color: CATEGORY_COLORS[c],
    count: counts[c],
  }))
})

const fens = computed(() => {
  if (!s.value || !store.model) return []
  return s.value.fenestration.map((i) => store.model!.surfaces[i])
})

const rawJson = computed(() => (s.value ? JSON.stringify(s.value.raw, null, 2) : ''))

function frameSelection(): void {
  if (group.value) store.zoomToSurfaces(group.value.indices)
}
</script>

<template>
  <transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="translate-x-3 opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="translate-x-3 opacity-0"
  >
    <aside
      v-if="s && group"
      class="glass absolute top-3 right-3 z-20 flex max-h-[calc(100%-5rem)] w-80 flex-col overflow-hidden rounded-xl"
    >
      <!-- Header -->
      <div class="flex items-start gap-2 border-b border-ink-800 p-3">
        <component
          :is="group.level === 'building' ? Building2 : Box"
          v-if="isGroup"
          class="mt-0.5 h-3.5 w-3.5 flex-none text-accent-400"
        />
        <span
          v-else
          class="mt-1 h-2.5 w-2.5 flex-none rounded-[3px]"
          :style="{ background: CATEGORY_COLORS[s.category] }"
        />
        <div class="min-w-0 flex-1">
          <p class="leading-snug break-all text-ink-100" :class="isGroup ? 'text-[13px] font-medium' : 'font-mono text-xs'">
            {{ group.label }}
          </p>
          <div class="mt-1.5 flex flex-wrap gap-1">
            <template v-if="isGroup">
              <span class="rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-300">{{
                group.level === 'building' ? 'Building' : 'Zone'
              }}</span>
              <span v-if="zoneCount > 0" class="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300"
                >{{ zoneCount }} zone{{ zoneCount === 1 ? '' : 's' }}</span
              >
              <span class="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300"
                >{{ group.indices.length.toLocaleString() }} surfaces</span
              >
            </template>
            <template v-else>
              <span class="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-medium text-ink-300">{{
                s.surfaceType
              }}</span>
              <span v-if="s.isAirBoundary" class="rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] text-accent-300"
                >Air boundary</span
              >
              <span v-else-if="s.isInterior" class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                >Interior</span
              >
              <span class="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">{{ s.epType }}</span>
            </template>
          </div>
        </div>
        <button
          class="flex-none rounded p-1 text-ink-400 transition-colors duration-150 hover:bg-ink-700 hover:text-ink-100"
          :title="isGroup ? 'Frame this selection' : 'Frame this surface'"
          @click="frameSelection()"
        >
          <Focus class="h-3.5 w-3.5" />
        </button>
        <button
          class="flex-none rounded p-1 text-ink-400 transition-colors duration-150 hover:bg-ink-700 hover:text-ink-100"
          title="Deselect (Esc)"
          @click="store.select(null)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Body -->
      <div class="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        <!-- Group summary -->
        <template v-if="isGroup && summary">
          <dl class="space-y-1.5">
            <div v-if="group.level === 'zone' && buildingLabel" class="flex justify-between gap-3">
              <dt class="flex-none text-ink-400">Building</dt>
              <dd class="truncate text-right text-ink-200" :title="s.building ?? ''">{{ buildingLabel }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="flex-none text-ink-400">{{ group.level === 'building' ? 'Building ID' : 'Zone name' }}</dt>
              <dd class="min-w-0 text-right font-mono text-[11px] break-all text-ink-200">{{ group.key }}</dd>
            </div>
            <div v-if="zone?.volume != null" class="flex justify-between gap-3">
              <dt class="flex-none text-ink-400">Volume</dt>
              <dd class="text-right text-ink-200">{{ fmt(zone.volume) }} m³</dd>
            </div>
            <div v-if="zone?.ceilingHeight != null" class="flex justify-between gap-3">
              <dt class="flex-none text-ink-400">Ceiling height</dt>
              <dd class="text-right text-ink-200">{{ fmt(zone.ceilingHeight) }} m</dd>
            </div>
            <div v-if="zone && zone.relativeNorth !== 0" class="flex justify-between gap-3">
              <dt class="flex-none text-ink-400">Relative north</dt>
              <dd class="text-right text-ink-200">{{ fmt(zone.relativeNorth, 1) }}°</dd>
            </div>
          </dl>

          <div class="mt-3 grid grid-cols-2 gap-1.5 border-t border-ink-800 pt-2.5">
            <div class="rounded-md bg-ink-850 p-2">
              <p class="text-[10px] text-ink-400">Floor area</p>
              <p class="font-mono text-[13px] text-ink-100">
                {{ fmt(summary.totalFloorArea, 1) }}<span class="text-ink-400"> m²</span>
              </p>
            </div>
            <div class="rounded-md bg-ink-850 p-2" title="Exterior window area ÷ gross exterior wall area">
              <p class="text-[10px] text-ink-400">WWR</p>
              <p class="font-mono text-[13px] text-ink-100">
                {{ summary.wwr != null ? pct(summary.wwr) : '—' }}
              </p>
            </div>
            <div class="rounded-md bg-ink-850 p-2">
              <p class="text-[10px] text-ink-400">Ext. wall</p>
              <p class="font-mono text-[13px] text-ink-100">
                {{ fmt(summary.exteriorWallArea, 1) }}<span class="text-ink-400"> m²</span>
              </p>
            </div>
            <div class="rounded-md bg-ink-850 p-2">
              <p class="text-[10px] text-ink-400">Ext. window</p>
              <p class="font-mono text-[13px] text-ink-100">
                {{ fmt(summary.exteriorWindowArea, 1) }}<span class="text-ink-400"> m²</span>
              </p>
            </div>
          </div>

          <div class="mt-3 space-y-0.5 border-t border-ink-800 pt-2.5">
            <div v-for="row in breakdown" :key="row.id" class="flex items-center gap-2 px-0.5 py-[3px]">
              <span class="h-2 w-2 flex-none rounded-[3px]" :style="{ background: row.color }" />
              <span class="text-ink-300">{{ row.label }}</span>
              <span class="ml-auto font-mono text-[11px] text-ink-200">{{ row.count.toLocaleString() }}</span>
            </div>
          </div>
        </template>

        <!-- Clicked surface: always reachable, collapsed when a group is selected -->
        <component
          :is="isGroup ? 'details' : 'div'"
          :class="isGroup ? 'mt-3 border-t border-ink-800 pt-2.5' : ''"
        >
          <summary
            v-if="isGroup"
            class="cursor-pointer text-[11px] text-ink-400 transition-colors duration-150 hover:text-ink-200"
          >
            Clicked surface — {{ s.name }}
          </summary>

          <div :class="isGroup ? 'mt-2' : ''">
            <dl class="space-y-1.5">
              <div v-if="!isGroup && buildingLabel" class="flex justify-between gap-3">
                <dt class="flex-none text-ink-400">Building</dt>
                <dd class="truncate text-right text-ink-200" :title="s.building ?? ''">{{ buildingLabel }}</dd>
              </div>
              <div v-if="!isGroup && s.building && s.building !== buildingLabel" class="flex justify-between gap-3">
                <dt class="flex-none text-ink-400">Building ID</dt>
                <dd class="min-w-0 text-right font-mono text-[11px] break-all text-ink-200">{{ s.building }}</dd>
              </div>
              <div v-if="s.zone && group.level !== 'zone'" class="flex justify-between gap-3">
                <dt class="flex-none text-ink-400">Zone</dt>
                <dd class="truncate text-right text-ink-200" :title="s.zone">{{ zoneLabel || s.zone }}</dd>
              </div>
              <div v-if="isGroup" class="flex justify-between gap-3">
                <dt class="flex-none text-ink-400">Type</dt>
                <dd class="text-right text-ink-200">{{ s.surfaceType }}</dd>
              </div>
              <div v-if="s.construction" class="flex justify-between gap-3">
                <dt class="flex-none text-ink-400">Construction</dt>
                <dd class="truncate text-right font-mono text-[11px] text-ink-200" :title="s.construction">
                  {{ s.construction }}
                </dd>
              </div>
              <div v-if="s.boundaryCondition" class="flex justify-between gap-3">
                <dt class="flex-none text-ink-400">Boundary</dt>
                <dd class="text-right text-ink-200">{{ s.boundaryCondition }}</dd>
              </div>
            </dl>

            <!-- Links -->
            <div
              v-if="s.boundaryObject || s.hostSurface || fens.length"
              class="mt-3 space-y-1 border-t border-ink-800 pt-2.5"
            >
              <button
                v-if="s.boundaryObject"
                class="flex w-full items-center gap-1.5 rounded-md bg-ink-800/60 px-2 py-1.5 text-left transition-colors duration-150 hover:bg-ink-800 hover:text-accent-300"
                title="Select the matched surface on the other side"
                @click="store.selectByName(s.boundaryObject)"
              >
                <ArrowRight class="h-3 w-3 flex-none text-accent-400" />
                <span class="text-[10px] tracking-wide text-ink-400 uppercase">Paired</span>
                <span class="truncate font-mono text-[11px]">{{ s.boundaryObject }}</span>
              </button>
              <button
                v-if="s.hostSurface"
                class="flex w-full items-center gap-1.5 rounded-md bg-ink-800/60 px-2 py-1.5 text-left transition-colors duration-150 hover:bg-ink-800 hover:text-accent-300"
                title="Select the host surface"
                @click="store.selectByName(s.hostSurface)"
              >
                <ArrowRight class="h-3 w-3 flex-none text-accent-400" />
                <span class="text-[10px] tracking-wide text-ink-400 uppercase">Host</span>
                <span class="truncate font-mono text-[11px]">{{ s.hostSurface }}</span>
              </button>
              <button
                v-for="f in fens"
                :key="f.index"
                class="flex w-full items-center gap-1.5 rounded-md bg-ink-800/60 px-2 py-1.5 text-left transition-colors duration-150 hover:bg-ink-800 hover:text-accent-300"
                title="Select this fenestration surface"
                @click="store.select(f.index)"
              >
                <span class="h-2 w-2 flex-none rounded-[3px]" :style="{ background: CATEGORY_COLORS[f.category] }" />
                <span class="truncate font-mono text-[11px]">{{ f.name }}</span>
              </button>
            </div>

            <!-- Metrics -->
            <div class="mt-3 grid grid-cols-3 gap-1.5 border-t border-ink-800 pt-2.5">
              <div class="rounded-md bg-ink-850 p-2">
                <p class="text-[10px] text-ink-400">Area</p>
                <p class="font-mono text-[13px] text-ink-100">{{ fmt(s.area) }}<span class="text-ink-400"> m²</span></p>
              </div>
              <div class="rounded-md bg-ink-850 p-2">
                <p class="text-[10px] text-ink-400">Tilt</p>
                <p class="font-mono text-[13px] text-ink-100">{{ fmt(s.tilt, 1) }}°</p>
              </div>
              <div class="rounded-md bg-ink-850 p-2">
                <p class="text-[10px] text-ink-400">Azimuth</p>
                <p class="font-mono text-[13px] text-ink-100">
                  {{ fmt(s.azimuth, 1) }}°<span v-if="cardinal" class="text-ink-400"> {{ cardinal }}</span>
                </p>
              </div>
              <div v-if="s.netArea < s.area - 0.005" class="rounded-md bg-ink-850 p-2">
                <p class="text-[10px] text-ink-400">Net area</p>
                <p class="font-mono text-[13px] text-ink-100">
                  {{ fmt(s.netArea) }}<span class="text-ink-400"> m²</span>
                </p>
              </div>
              <div class="rounded-md bg-ink-850 p-2">
                <p class="text-[10px] text-ink-400">Vertices</p>
                <p class="font-mono text-[13px] text-ink-100">{{ s.polygon.length / 3 }}</p>
              </div>
            </div>

            <!-- Raw epJSON -->
            <details class="mt-3 border-t border-ink-800 pt-2.5">
              <summary class="cursor-pointer text-[11px] text-ink-400 transition-colors duration-150 hover:text-ink-200">
                Raw epJSON object
              </summary>
              <pre
                class="mt-2 max-h-64 overflow-auto rounded-md bg-ink-950 p-2 font-mono text-[10px] leading-relaxed text-ink-300"
                >{{ rawJson }}</pre
              >
            </details>
          </div>
        </component>
      </div>
    </aside>
  </transition>
</template>
