<script setup lang="ts">
import { ref } from 'vue'
import { FileJson, Loader2, TriangleAlert, Upload } from 'lucide-vue-next'
import { useModelStore } from '../stores/model'

const store = useModelStore()
const fileInput = ref<HTMLInputElement>()
const dragOver = ref(false)

const demos = [
  { label: 'Demo: single house', file: 'demo_house.epJSON' },
  { label: 'Demo: urban block', file: 'demo_block.epJSON' },
]
function loadDemo(file: string): void {
  void store.loadDemo(import.meta.env.BASE_URL + 'samples/' + file, file)
}

function onDrop(e: DragEvent): void {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) void store.loadFile(file)
}
function onFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void store.loadFile(file)
  input.value = ''
}
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-6 p-6">
    <!-- Brand -->
    <div class="flex flex-col items-center gap-3">
      <svg viewBox="0 0 32 32" class="h-14 w-14">
        <rect width="32" height="32" rx="7" class="fill-ink-900" />
        <g fill="none" stroke="#22d3ee" stroke-width="1.6" stroke-linejoin="round">
          <path d="M7 25V13l9-6 9 6v12z" />
          <path d="M7 13l9 6 9-6M16 19v6" />
        </g>
      </svg>
      <div class="text-center">
        <h1 class="text-2xl font-semibold tracking-tight">epJSON <span class="text-accent-400">Viewer</span></h1>
        <p class="mt-1 text-sm text-ink-400">Inspect EnergyPlus model geometry in your browser</p>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="store.status === 'loading'" class="glass w-[26rem] max-w-full rounded-2xl p-6">
      <div class="flex items-center gap-3">
        <Loader2 class="h-5 w-5 animate-spin text-accent-400" />
        <div class="min-w-0 flex-1">
          <p class="truncate font-mono text-xs text-ink-200">{{ store.fileName }}</p>
          <p class="mt-0.5 text-xs text-ink-400">{{ store.progress.phase }}…</p>
        </div>
      </div>
      <div class="mt-4 h-1 overflow-hidden rounded-full bg-ink-800">
        <div
          class="h-full rounded-full bg-accent-500 transition-all duration-300"
          :style="{ width: store.progress.pct + '%' }"
        />
      </div>
    </div>

    <!-- Drop area -->
    <template v-else>
      <div
        class="w-[26rem] max-w-full cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors duration-150"
        :class="
          dragOver
            ? 'border-accent-500 bg-accent-500/5'
            : 'border-ink-700 bg-ink-900/40 hover:border-ink-600 hover:bg-ink-900/70'
        "
        @click="fileInput?.click()"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <Upload class="mx-auto h-8 w-8" :class="dragOver ? 'text-accent-400' : 'text-ink-400'" />
        <p class="mt-3 text-sm text-ink-200">
          Drop an <span class="font-mono text-accent-300">.epJSON</span> file here
        </p>
        <p class="mt-1 text-xs text-ink-400">or click to browse</p>
      </div>

      <div v-if="store.status === 'error'" class="flex w-[26rem] max-w-full items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5">
        <TriangleAlert class="mt-0.5 h-4 w-4 flex-none text-red-400" />
        <div class="min-w-0 text-xs">
          <p class="font-medium text-red-300">Could not load {{ store.fileName || 'file' }}</p>
          <p class="mt-0.5 break-words text-red-300/80">{{ store.errorMsg }}</p>
        </div>
      </div>

      <div class="flex gap-2">
        <button
          v-for="d in demos"
          :key="d.file"
          class="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-4 py-2 text-sm text-ink-200 transition-colors duration-150 hover:border-accent-600 hover:text-accent-300"
          title="Load a bundled demo model"
          @click="loadDemo(d.file)"
        >
          <FileJson class="h-4 w-4" />
          {{ d.label }}
        </button>
      </div>

      <div class="max-w-md text-center text-xs leading-relaxed text-ink-500">
        <p>
          Files are parsed entirely in your browser — nothing is uploaded anywhere.
        </p>
        <p class="mt-1.5">
          epJSON is the JSON input format of
          <a
            href="https://energyplus.net/"
            target="_blank"
            rel="noopener"
            class="text-ink-400 underline decoration-ink-600 underline-offset-2 transition-colors duration-150 hover:text-accent-300"
            >EnergyPlus</a
          >. Convert IDF files with
          <span class="font-mono text-ink-400">energyplus --convert-only your_file.idf</span>.
        </p>
      </div>
    </template>

    <input ref="fileInput" type="file" accept=".epJSON,.epjson,.json" class="hidden" @change="onFilePicked" />
  </div>
</template>
