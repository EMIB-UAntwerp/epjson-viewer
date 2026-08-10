<script setup lang="ts">
import { computed } from 'vue'
import { EyeOff } from 'lucide-vue-next'
import { useModelStore } from '../stores/model'

const store = useModelStore()
const stats = computed(() => store.model?.stats ?? null)

function pct(x: number): string {
  return (x * 100).toFixed(0) + '%'
}
</script>

<template>
  <div v-if="stats" class="glass absolute top-3 left-3 z-10 flex items-center gap-3 rounded-xl px-3 py-1.5 text-[11px]">
    <span v-if="stats.buildingCount > 1" class="text-ink-300">
      <span class="font-mono text-ink-100">{{ stats.buildingCount }}</span> buildings
    </span>
    <span class="text-ink-300">
      <span class="font-mono text-ink-100">{{ stats.zoneCount.toLocaleString() }}</span>
      zone{{ stats.zoneCount === 1 ? '' : 's' }}
    </span>
    <span class="text-ink-300">
      <span class="font-mono text-ink-100">{{ stats.surfaceCount.toLocaleString() }}</span> surfaces
    </span>
    <span
      v-if="stats.wwr != null"
      class="text-ink-300"
      title="Exterior window-to-wall ratio (window area ÷ gross exterior wall area)"
    >
      WWR <span class="font-mono text-ink-100">{{ pct(stats.wwr) }}</span>
    </span>
    <span v-if="stats.totalFloorArea > 0" class="text-ink-300" title="Total floor area">
      <span class="font-mono text-ink-100">{{ Math.round(stats.totalFloorArea).toLocaleString() }}</span> m²
    </span>
    <button
      v-if="store.hiddenZoneCount > 0"
      class="flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-200 transition-colors duration-150 hover:bg-amber-500/25"
      title="Some zones are hidden — click to show all"
      @click="store.showAllZones()"
    >
      <EyeOff class="h-3 w-3" />
      <span class="font-mono">{{ store.hiddenZoneCount }}</span> hidden
    </button>
  </div>
</template>
