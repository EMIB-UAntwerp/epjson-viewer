<script setup lang="ts">
import { ref } from 'vue'
import { ListTree, SlidersHorizontal } from 'lucide-vue-next'
import ModelTree from './ModelTree.vue'
import LayersPanel from './LayersPanel.vue'

const tab = ref<'model' | 'layers'>('model')
</script>

<template>
  <aside class="flex w-[21rem] flex-none flex-col border-r border-ink-800 bg-ink-900">
    <div class="flex flex-none border-b border-ink-800">
      <button
        class="flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-medium transition-colors duration-150"
        :class="
          tab === 'model'
            ? 'border-accent-500 text-accent-300'
            : 'border-transparent text-ink-400 hover:text-ink-200'
        "
        @click="tab = 'model'"
      >
        <ListTree class="h-3.5 w-3.5" /> Model
      </button>
      <button
        class="flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-medium transition-colors duration-150"
        :class="
          tab === 'layers'
            ? 'border-accent-500 text-accent-300'
            : 'border-transparent text-ink-400 hover:text-ink-200'
        "
        @click="tab = 'layers'"
      >
        <SlidersHorizontal class="h-3.5 w-3.5" /> Display
      </button>
    </div>
    <div class="min-h-0 flex-1">
      <ModelTree v-show="tab === 'model'" />
      <LayersPanel v-show="tab === 'layers'" />
    </div>
  </aside>
</template>
