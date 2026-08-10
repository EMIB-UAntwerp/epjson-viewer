<script setup lang="ts">
import { computed } from 'vue'
import { Maximize2 } from 'lucide-vue-next'
import { useModelStore } from '../stores/model'

const store = useModelStore()
const compassRotation = computed(() => -store.cameraBearing)
</script>

<template>
  <div class="absolute top-3 right-3 z-10 flex flex-col items-center gap-1.5" :class="{ 'right-[21.5rem]': store.selectedSurface }">
    <div class="glass flex flex-col overflow-hidden rounded-xl">
      <button
        class="p-2 text-ink-300 transition-colors duration-150 hover:bg-ink-800 hover:text-ink-100"
        title="Fit model in view (F)"
        @click="store.requestView('fit')"
      >
        <Maximize2 class="h-4 w-4" />
      </button>
      <button
        class="p-2 text-[10px] font-bold text-ink-300 transition-colors duration-150 hover:bg-ink-800 hover:text-ink-100"
        title="Top (plan) view"
        @click="store.requestView('top')"
      >
        TOP
      </button>
    </div>

    <!-- Compass: arrow points toward model north; click to look from the south -->
    <button
      class="glass flex h-11 w-11 items-center justify-center rounded-full"
      title="North — click to face north"
      @click="store.requestView('north')"
    >
      <svg viewBox="0 0 40 40" class="h-8 w-8 transition-transform duration-100" :style="{ transform: `rotate(${compassRotation}deg)` }">
        <polygon points="20,6 24,22 20,19 16,22" fill="#22d3ee" />
        <polygon points="20,34 24,22 20,25 16,22" fill="#5c5c6b" />
        <text x="20" y="4.5" text-anchor="middle" font-size="7" fill="#a3a3b2" font-family="Inter, sans-serif">N</text>
      </svg>
    </button>
  </div>
</template>
