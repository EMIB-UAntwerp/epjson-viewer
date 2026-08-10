<script setup lang="ts">
import { computed } from 'vue'
import { useModelStore, type ViewPreset } from '../stores/model'
import { CATEGORIES, type Category } from '../core/types'
import { CATEGORY_COLORS, CATEGORY_LABELS, type RenderMode } from '../three/materials'

const store = useModelStore()

const presets: { id: ViewPreset; label: string; hint: string }[] = [
  { id: 'exterior', label: 'Exterior', hint: 'Hide interior partitions and air boundaries' },
  { id: 'all', label: 'All', hint: 'Show every surface' },
  { id: 'xray', label: 'X-ray', hint: 'Ghost the shell to reveal interior zoning' },
]

const modes: { id: RenderMode; label: string; hint: string }[] = [
  { id: 'type', label: 'Surface type', hint: 'Walls, roofs, floors, windows…' },
  { id: 'boundary', label: 'Boundary condition', hint: 'Outdoors, ground, adiabatic, interior' },
  { id: 'construction', label: 'Construction', hint: 'One color per construction assembly' },
]

const rows = computed(() =>
  CATEGORIES.filter((c) => (store.model?.stats.counts[c] ?? 0) > 0).map((c: Category) => ({
    id: c,
    label: CATEGORY_LABELS[c],
    color: CATEGORY_COLORS[c],
    count: store.model?.stats.counts[c] ?? 0,
  })),
)
</script>

<template>
  <div class="h-full space-y-5 overflow-y-auto p-3.5">
    <!-- Presets -->
    <section>
      <h3 class="mb-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">View preset</h3>
      <div class="grid grid-cols-3 overflow-hidden rounded-md border border-ink-700">
        <button
          v-for="p in presets"
          :key="p.id"
          class="py-1.5 text-xs transition-colors duration-150"
          :class="
            store.preset === p.id
              ? 'bg-accent-500/20 font-medium text-accent-300'
              : 'bg-ink-850 text-ink-300 hover:bg-ink-800'
          "
          :title="p.hint"
          @click="store.applyPreset(p.id)"
        >
          {{ p.label }}
        </button>
      </div>
    </section>

    <!-- Color mode -->
    <section>
      <h3 class="mb-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Color by</h3>
      <div class="space-y-1">
        <label
          v-for="m in modes"
          :key="m.id"
          class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-800"
          :title="m.hint"
        >
          <input
            type="radio"
            name="rendermode"
            :checked="store.renderMode === m.id"
            class="h-3.5 w-3.5 accent-cyan-400"
            @change="store.renderMode = m.id"
          />
          <span class="text-xs" :class="store.renderMode === m.id ? 'text-ink-100' : 'text-ink-300'">{{
            m.label
          }}</span>
        </label>
      </div>
    </section>

    <!-- Categories -->
    <section>
      <h3 class="mb-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Layers</h3>
      <div class="space-y-0.5">
        <label
          v-for="row in rows"
          :key="row.id"
          class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-800"
        >
          <input
            v-model="store.categoryVisible[row.id]"
            type="checkbox"
            class="h-3.5 w-3.5 rounded accent-cyan-400"
          />
          <span class="h-2.5 w-2.5 rounded-[3px]" :style="{ background: row.color }" />
          <span class="text-xs text-ink-200">{{ row.label }}</span>
          <span class="ml-auto font-mono text-[10px] text-ink-400">{{ row.count.toLocaleString() }}</span>
        </label>
      </div>
    </section>

    <!-- Options -->
    <section>
      <h3 class="mb-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Options</h3>
      <div class="space-y-0.5">
        <label
          class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-800"
          title="Show partitions between zones (matched Surface pairs)"
        >
          <input v-model="store.interiorVisible" type="checkbox" class="h-3.5 w-3.5 rounded accent-cyan-400" />
          <span class="text-xs text-ink-200">Interior surfaces</span>
          <span class="ml-auto font-mono text-[10px] text-ink-400">{{
            (store.model?.surfaces.filter((s) => s.isInterior).length ?? 0).toLocaleString()
          }}</span>
        </label>
        <label
          class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-800"
          title="Ghost exterior surfaces to look inside"
        >
          <input v-model="store.xray" type="checkbox" class="h-3.5 w-3.5 rounded accent-cyan-400" />
          <span class="text-xs text-ink-200">X-ray shell</span>
        </label>
        <label
          class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-800"
          title="Draw surface outlines"
        >
          <input v-model="store.edges" type="checkbox" class="h-3.5 w-3.5 rounded accent-cyan-400" />
          <span class="text-xs text-ink-200">Edges</span>
        </label>
      </div>
    </section>
  </div>
</template>
