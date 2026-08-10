<script setup lang="ts">
import { ref } from 'vue'
import { CircleHelp, Info, TriangleAlert, Upload, X } from 'lucide-vue-next'
import { useModelStore } from '../stores/model'

const store = useModelStore()
const fileInput = ref<HTMLInputElement>()
const helpOpen = ref(false)
const warningsOpen = ref(false)
const aboutOpen = ref(false)

function onFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void store.loadFile(file)
  input.value = ''
}
</script>

<template>
  <header class="flex h-12 flex-none items-center gap-3 border-b border-ink-800 bg-ink-900 px-4">
    <!-- Brand -->
    <div class="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" class="h-6 w-6 rounded-md">
        <rect width="32" height="32" rx="7" class="fill-ink-950" />
        <g fill="none" stroke="#22d3ee" stroke-width="1.8" stroke-linejoin="round">
          <path d="M7 25V13l9-6 9 6v12z" />
          <path d="M7 13l9 6 9-6M16 19v6" />
        </g>
      </svg>
      <div class="leading-tight">
        <span class="text-[15px] font-semibold tracking-tight">epJSON <span class="text-accent-400">Viewer</span></span>
        <span class="ml-2 hidden text-xs text-ink-400 lg:inline">EnergyPlus geometry inspector</span>
      </div>
    </div>

    <a
      href="https://www.uantwerpen.be/en/research-groups/emib/"
      target="_blank"
      rel="noopener noreferrer"
      class="ml-1 hidden text-xs text-ink-400 transition-colors duration-150 hover:text-accent-400 xl:inline"
      title="Energy and Materials in Infrastructure and Buildings (EMIB) Research Group, University of Antwerp"
      >EMIB · University of Antwerp</a
    >

    <div class="mx-1 h-5 w-px bg-ink-800" />

    <!-- File chip -->
    <div
      v-if="store.fileName"
      class="flex min-w-0 items-center gap-2 rounded-md border border-ink-700 bg-ink-850 py-1 pr-1 pl-2.5"
    >
      <span class="truncate font-mono text-xs text-ink-200" :title="store.fileName">{{ store.fileName }}</span>
      <span
        v-if="store.model?.meta.epVersion"
        class="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] font-medium text-ink-300"
        title="EnergyPlus version"
        >E+ {{ store.model.meta.epVersion }}</span
      >
      <button
        class="rounded p-0.5 text-ink-400 transition-colors duration-150 hover:bg-ink-700 hover:text-ink-100"
        title="Close model"
        @click="store.close()"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <div class="flex-1" />

    <!-- Warnings -->
    <div v-if="store.model && store.model.warnings.length" class="relative">
      <button
        class="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 transition-colors duration-150 hover:bg-amber-500/20"
        title="Parse warnings"
        @click="warningsOpen = !warningsOpen"
      >
        <TriangleAlert class="h-3.5 w-3.5" />
        {{ store.model.warnings.length }}
      </button>
      <div v-if="warningsOpen" class="fixed inset-0 z-40" @click="warningsOpen = false" />
      <div
        v-if="warningsOpen"
        class="glass absolute top-10 right-0 z-50 max-h-80 w-96 overflow-y-auto rounded-lg p-3"
      >
        <p class="mb-2 text-xs font-semibold text-amber-300">Parse warnings</p>
        <ul class="space-y-1.5">
          <li v-for="(w, i) in store.model.warnings" :key="i" class="font-mono text-[11px] leading-snug text-ink-300">
            {{ w }}
          </li>
        </ul>
      </div>
    </div>

    <!-- Actions -->
    <button
      class="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-ink-200 transition-colors duration-150 hover:border-ink-600 hover:bg-ink-800"
      title="Open another epJSON file"
      @click="fileInput?.click()"
    >
      <Upload class="h-3.5 w-3.5" /> Open
    </button>

    <div class="relative">
      <button
        class="flex items-center rounded-md border border-ink-700 bg-ink-850 p-1.5 text-ink-200 transition-colors duration-150 hover:border-ink-600 hover:bg-ink-800"
        title="Controls help"
        @click="helpOpen = !helpOpen"
      >
        <CircleHelp class="h-4 w-4" />
      </button>
      <div v-if="helpOpen" class="fixed inset-0 z-40" @click="helpOpen = false" />
      <div v-if="helpOpen" class="glass absolute top-10 right-0 z-50 w-72 rounded-lg p-4">
        <p class="mb-3 text-xs font-semibold tracking-wide text-ink-200 uppercase">Controls</p>
        <dl class="space-y-2 text-xs">
          <div class="flex justify-between gap-4">
            <dt class="text-ink-400">Orbit</dt>
            <dd class="text-ink-200">Left-drag</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-ink-400">Pan</dt>
            <dd class="text-ink-200">Right-drag</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-ink-400">Zoom</dt>
            <dd class="text-ink-200">Scroll</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-ink-400">Select surface</dt>
            <dd class="text-ink-200">Click</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-ink-400">Selection level</dt>
            <dd class="font-mono text-ink-200">S</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-ink-400">Fit view</dt>
            <dd class="font-mono text-ink-200">F</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-ink-400">Deselect</dt>
            <dd class="font-mono text-ink-200">Esc</dd>
          </div>
        </dl>
        <p class="mt-3 border-t border-ink-800 pt-2.5 text-[11px] leading-snug text-ink-400">
          Files are parsed locally in your browser — nothing is uploaded.
        </p>
      </div>
    </div>

    <!-- About / credits -->
    <div class="relative">
      <button
        class="flex items-center rounded-md border border-ink-700 bg-ink-850 p-1.5 text-ink-200 transition-colors duration-150 hover:border-ink-600 hover:bg-ink-800"
        title="About this viewer"
        @click="aboutOpen = !aboutOpen"
      >
        <Info class="h-4 w-4" />
      </button>
      <div v-if="aboutOpen" class="fixed inset-0 z-40" @click="aboutOpen = false" />
      <div v-if="aboutOpen" class="glass absolute top-10 right-0 z-50 w-80 rounded-lg p-4">
        <p class="mb-3 text-xs font-semibold tracking-wide text-ink-200 uppercase">About</p>
        <p class="text-xs leading-relaxed text-ink-300">
          <span class="font-medium text-ink-100">epJSON Viewer</span> renders EnergyPlus model geometry directly from
          the simulation input, entirely in your browser.
        </p>
        <dl class="mt-3 space-y-2 border-t border-ink-800 pt-3 text-xs">
          <div>
            <dt class="text-ink-400">Developed by</dt>
            <dd class="mt-0.5">
              <a
                href="https://richarddeanmorales.com"
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent-400 transition-colors duration-150 hover:text-accent-300 hover:underline"
                >Richard Dean Morales</a
              >
            </dd>
          </div>
          <div>
            <dt class="text-ink-400">Research group</dt>
            <dd class="mt-0.5 leading-snug">
              <a
                href="https://www.uantwerpen.be/en/research-groups/emib/"
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent-400 transition-colors duration-150 hover:text-accent-300 hover:underline"
                >Energy and Materials in Infrastructure and Buildings (EMIB)</a
              >
              <span class="text-ink-400"> — University of Antwerp</span>
            </dd>
          </div>
        </dl>
        <p class="mt-3 border-t border-ink-800 pt-2.5 text-[11px] leading-snug text-ink-400">
          &copy; 2026 EMIB Research Group, University of Antwerp. Licensed under the
          <span class="text-ink-300">Apache&nbsp;License&nbsp;2.0</span> — see the
          <span class="font-mono text-ink-300">LICENSE</span> and <span class="font-mono text-ink-300">NOTICE</span>
          files distributed with this software.
        </p>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".epJSON,.epjson,.json" class="hidden" @change="onFilePicked" />
  </header>
</template>
