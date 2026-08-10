<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useModelStore } from '../stores/model'
import { SceneManager } from '../three/SceneManager'
import { cssToLinearRgb, surfaceColor } from '../three/materials'
import type { EpSurface, Category } from '../core/types'
import { CATEGORIES } from '../core/types'

const store = useModelStore()
const {
  model,
  bundle,
  renderMode,
  selectionGroup,
  interiorVisible,
  xray,
  edges,
  hiddenZones,
  viewRequest,
  zoomRequest,
} = storeToRefs(store)

const container = ref<HTMLElement>()
let scene: SceneManager | null = null

const colorCache = new Map<string, [number, number, number]>()
function colorOf(s: EpSurface): [number, number, number] {
  const css = surfaceColor(s, renderMode.value, store.constructionIndex)
  let c = colorCache.get(css)
  if (!c) {
    c = cssToLinearRgb(css)
    colorCache.set(css, c)
  }
  return c
}

function initModel(): void {
  if (!scene || !model.value || !bundle.value) return
  scene.setModel(model.value, bundle.value)
  scene.applyColors(colorOf)
  for (const c of CATEGORIES) scene.setCategoryVisible(c, store.categoryVisible[c])
  scene.setHiddenZones(hiddenZones.value)
  scene.setInteriorVisible(interiorVisible.value)
  scene.setGhost(xray.value)
  scene.setEdges(edges.value)
  scene.select(selectionGroup.value?.indices ?? [])
}

onMounted(() => {
  scene = new SceneManager(container.value!, {
    onPick: (i) => store.select(i),
    onCameraChange: (b) => {
      store.cameraBearing = b
    },
  })
  initModel()
})

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})

watch([model, bundle], () => {
  if (model.value && bundle.value) initModel()
  else scene?.clearModel()
})
watch(renderMode, () => scene?.applyColors(colorOf))
watch(
  () => CATEGORIES.map((c: Category) => store.categoryVisible[c]).join(''),
  () => {
    for (const c of CATEGORIES) scene?.setCategoryVisible(c, store.categoryVisible[c])
  },
)
watch(hiddenZones, (z) => scene?.setHiddenZones(z))
watch(interiorVisible, (v) => scene?.setInteriorVisible(v))
watch(xray, (v) => scene?.setGhost(v))
watch(edges, (v) => scene?.setEdges(v))
watch(selectionGroup, (g) => scene?.select(g?.indices ?? []))
watch(viewRequest, (v) => {
  if (!scene || !v) return
  if (v === 'fit') scene.fitAll()
  else if (v === 'top') scene.setTopView()
  else scene.setNorthView()
  viewRequest.value = null
})
watch(zoomRequest, (r) => {
  if (r && scene) {
    scene.zoomToSurfaces(r)
    zoomRequest.value = null
  }
})
</script>

<template>
  <div ref="container" class="absolute inset-0 overflow-hidden" />
</template>
