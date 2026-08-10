<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useModelStore } from '../stores/model'
import { CATEGORIES } from '../core/types'
import {
  BOUNDARY_FALLBACK,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CONSTRUCTION_PALETTE,
  SHADING_NEUTRAL,
  boundaryColor,
} from '../three/materials'

const store = useModelStore()
const collapsed = ref(false)

interface LegendRow {
  key: string
  label: string
  color: string
  toggleCategory?: (typeof CATEGORIES)[number]
  muted?: boolean
}

const title = computed(
  () =>
    ({ type: 'Surface type', boundary: 'Boundary condition', construction: 'Construction' })[store.renderMode],
)

const rows = computed<LegendRow[]>(() => {
  const m = store.model
  if (!m) return []
  if (store.renderMode === 'type') {
    return CATEGORIES.filter((c) => m.stats.counts[c] > 0).map((c) => ({
      key: c,
      label: CATEGORY_LABELS[c],
      color: CATEGORY_COLORS[c],
      toggleCategory: c,
      muted: !store.categoryVisible[c],
    }))
  }
  if (store.renderMode === 'boundary') {
    const seen = new Map<string, number>()
    for (const s of m.surfaces) {
      if (s.kind === 'shading') continue
      const bc = s.boundaryCondition ?? 'Unknown'
      seen.set(bc, (seen.get(bc) ?? 0) + 1)
    }
    const out: LegendRow[] = [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([bc]) => ({ key: bc, label: bc, color: bc === 'Unknown' ? BOUNDARY_FALLBACK : boundaryColor(bc) }))
    if (m.stats.counts.shading > 0)
      out.push({ key: '__shading', label: 'Shading context', color: SHADING_NEUTRAL })
    return out
  }
  // construction: top entries by surface count
  const counts = new Map<string, number>()
  for (const s of m.surfaces) {
    if (s.construction) counts.set(s.construction, (counts.get(s.construction) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  const rowsC: LegendRow[] = top.map(([name]) => ({
    key: name,
    label: name,
    color: CONSTRUCTION_PALETTE[(store.constructionIndex.get(name) ?? 0) % CONSTRUCTION_PALETTE.length],
  }))
  const more = counts.size - top.length
  if (more > 0) rowsC.push({ key: '__more', label: `+${more} more constructions`, color: 'transparent', muted: true })
  return rowsC
})

function onRowClick(row: LegendRow): void {
  if (row.toggleCategory) {
    store.categoryVisible[row.toggleCategory] = !store.categoryVisible[row.toggleCategory]
  }
}
</script>

<template>
  <div v-if="rows.length" class="glass absolute bottom-3 left-3 z-10 w-52 rounded-xl">
    <button
      class="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold tracking-wider text-ink-300 uppercase"
      :title="collapsed ? 'Expand legend' : 'Collapse legend'"
      @click="collapsed = !collapsed"
    >
      {{ title }}
      <ChevronDown class="h-3.5 w-3.5 transition-transform duration-150" :class="{ 'rotate-180': collapsed }" />
    </button>
    <div v-if="!collapsed" class="max-h-64 overflow-y-auto px-1.5 pb-1.5">
      <div
        v-for="row in rows"
        :key="row.key"
        class="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors duration-150"
        :class="[
          row.toggleCategory ? 'cursor-pointer hover:bg-ink-800' : '',
          row.muted ? 'opacity-40' : '',
        ]"
        :title="row.toggleCategory ? 'Click to toggle layer' : row.label"
        @click="onRowClick(row)"
      >
        <span
          v-if="row.color !== 'transparent'"
          class="h-2.5 w-2.5 flex-none rounded-[3px]"
          :style="{ background: row.color }"
        />
        <span v-else class="w-2.5 flex-none" />
        <span class="truncate text-ink-200">{{ row.label }}</span>
      </div>
    </div>
  </div>
</template>
