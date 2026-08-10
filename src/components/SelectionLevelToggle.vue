<script setup lang="ts">
import { computed } from 'vue'
import { MousePointerClick } from 'lucide-vue-next'
import { useModelStore, type SelectionLevel } from '../stores/model'

const store = useModelStore()

const LEVELS: { id: SelectionLevel; label: string; hint: string }[] = [
  { id: 'surface', label: 'Surface', hint: 'Click selects the single surface' },
  { id: 'zone', label: 'Zone', hint: "Click selects every surface of the clicked surface's zone" },
  { id: 'building', label: 'Building', hint: "Click selects every zone of the clicked surface's building" },
]

// A level the model cannot express is dropped rather than shown disabled, so a
// conventional single-building file never offers "Building" at all.
const levels = computed(() => LEVELS.filter((l) => store.availableSelectionLevels.includes(l.id)))
</script>

<template>
  <div
    v-if="levels.length > 1"
    class="glass absolute top-12 left-3 z-10 flex items-center gap-2 rounded-xl px-2 py-1.5 text-[11px]"
  >
    <span class="flex items-center gap-1 text-ink-400" title="What a click in the viewer selects (S to cycle)">
      <MousePointerClick class="h-3 w-3" />
      Select
    </span>
    <div class="flex overflow-hidden rounded-md border border-ink-700">
      <button
        v-for="l in levels"
        :key="l.id"
        class="px-2 py-0.5 transition-colors duration-150"
        :class="
          store.selectionLevel === l.id
            ? 'bg-accent-500/20 font-medium text-accent-300'
            : 'bg-ink-850 text-ink-300 hover:bg-ink-800'
        "
        :title="l.hint"
        @click="store.setSelectionLevel(l.id)"
      >
        {{ l.label }}
      </button>
    </div>
  </div>
</template>
