<script setup lang="ts">
import { useModelStore } from '../stores/model'

const store = useModelStore()
</script>

<template>
  <div
    v-if="store.status === 'loading' || store.errorMsg || store.convertedDocument || store.conversionDiagnostics.length"
    class="border-b border-ink-700 bg-ink-900 px-4 py-3 text-xs"
  >
    <div v-if="store.status === 'loading'" role="status" aria-live="polite">
      <div class="flex items-center justify-between gap-4">
        <p class="min-w-0 truncate text-ink-200">{{ store.progress.phase }} — {{ store.importFileName }}</p>
        <button class="text-accent-300 hover:underline" @click="store.cancelLoad()">Cancel import</button>
      </div>
      <div class="mt-2 h-1 overflow-hidden rounded bg-ink-700" role="progressbar" :aria-valuenow="store.progress.pct" aria-valuemin="0" aria-valuemax="100" aria-label="Import progress">
        <div class="h-full bg-accent-500 transition-all" :style="{ width: store.progress.pct + '%' }" />
      </div>
    </div>
    <div v-if="store.errorMsg" role="alert" class="text-red-300">
      <p class="font-medium">Could not load {{ store.importFileName || 'file' }}</p>
      <p class="mt-1 break-words">{{ store.errorMsg }}</p>
    </div>
    <div v-if="store.convertedDocument && store.status !== 'loading'" class="flex flex-wrap items-center justify-between gap-3 text-ink-300">
      <span>
        <template v-if="store.upgradedDocument">Upgraded {{ store.upgradedDocument.provenance.sourceVersion }} → {{ store.upgradedDocument.provenance.targetVersion }} · </template>
        Converted with EnergyPlus {{ store.convertedDocument.version }}
      </span>
      <button v-if="store.upgradedDocument" class="text-accent-300 hover:underline" @click="store.downloadUpgraded()">Download upgraded IDF</button>
      <button class="text-accent-300 hover:underline" @click="store.downloadConverted()">Download epJSON</button>
    </div>
    <details v-if="store.conversionDiagnostics.length" class="mt-2 text-ink-300">
      <summary class="cursor-pointer">EnergyPlus conversion details</summary>
      <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px]">{{ store.conversionDiagnostics.join('\n') }}</pre>
    </details>
  </div>
</template>
