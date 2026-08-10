<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useModelStore } from './stores/model'
import TopBar from './components/TopBar.vue'
import SidePanel from './components/SidePanel.vue'
import ViewerCanvas from './components/ViewerCanvas.vue'
import SelectionCard from './components/SelectionCard.vue'
import LegendOverlay from './components/LegendOverlay.vue'
import ViewToolbar from './components/ViewToolbar.vue'
import StatsChip from './components/StatsChip.vue'
import SelectionLevelToggle from './components/SelectionLevelToggle.vue'
import DropZone from './components/DropZone.vue'

const store = useModelStore()

function onGlobalDrop(e: DragEvent): void {
  const file = e.dataTransfer?.files?.[0]
  if (file) void store.loadFile(file)
}

function onKeyDown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (e.key === 'Escape') store.select(null)
  else if (e.key === 'f' || e.key === 'F') store.requestView('fit')
  else if (e.key === 's' || e.key === 'S') store.cycleSelectionLevel()
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="flex h-full flex-col" @dragover.prevent @drop.prevent="onGlobalDrop">
    <template v-if="store.status === 'ready'">
      <TopBar />
      <div class="flex min-h-0 flex-1">
        <SidePanel />
        <main class="relative min-w-0 flex-1 bg-[#131318]">
          <ViewerCanvas />
          <StatsChip />
          <SelectionLevelToggle />
          <ViewToolbar />
          <LegendOverlay />
          <SelectionCard />
        </main>
      </div>
    </template>
    <DropZone v-else class="flex-1" />
  </div>
</template>
