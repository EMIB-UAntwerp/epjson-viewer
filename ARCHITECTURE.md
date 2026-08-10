# ARCHITECTURE

System blueprint for `epjson-viewer`. Read this before adding a feature,
changing the data flow, or altering the data model. For usage and setup see
[README.md](README.md); for verification see [TESTING.md](TESTING.md).

Sections are targeted individually — each heading names the module it describes,
so a search for a filename lands on the right section. Read the section you
need, not the whole file.

## Tech stack

- **Vue 3.5** with `<script setup lang="ts">` throughout; **Pinia 4** for state.
- **three.js 0.185** for rendering, **earcut 3** for ear-clipping triangulation.
- **Vite 7** (`base: './'`, so the build works at any URL). Dev server uses
  polling (`vite.config.ts`) because `/mnt/c` under WSL does not propagate
  inotify events.
- **Tailwind v4, CSS-first**: design tokens live in an `@theme` block in
  `src/style.css`. There is no `tailwind.config.js`. Dark-only palette; icons
  from `lucide-vue-next`.
- **TypeScript 5.9**, `strict`, plus `noUnusedLocals`, `noUnusedParameters`,
  `isolatedModules`, and `verbatimModuleSyntax` (type-only imports **must** use
  `import type`).
- **Vitest 4** — its config is inlined in `vite.config.ts`
  (`environment: 'node'`, `include: ['tests/**/*.test.ts']`).
- **No linter or formatter is configured.** There is no ESLint, Prettier, or
  editorconfig. `vue-tsc --noEmit` (the first half of `npm run build`) is the
  only static gate. Do not go looking for a lint script.

## Directory map

```
src/
├── main.ts              app bootstrap: Pinia + mount App
├── App.vue              layout root, global drag&drop, keyboard shortcuts
├── style.css            Tailwind v4 @theme tokens, .glass utility
├── core/                pure TypeScript — no Vue, DOM or three.js imports
│   ├── types.ts         the whole data contract (EpModel, EpSurface, GroupKey…)
│   ├── parse.ts         lenient epJSON → EpModel, EnergyPlus coordinate rules
│   ├── plane.ts         Newell normal, plane basis, 2D projection, ring cleanup
│   ├── rectSurfaces.ts  azimuth/tilt → rectangle rings, surface placement frames
│   ├── triangulate.ts   ear clipping in the polygon plane + winding fix
│   ├── metrics.ts       area / tilt / azimuth, surface-set roll-ups
│   └── buildBuffers.ts  EpModel → merged GPU buffers per render group
├── worker/
│   └── modelWorker.ts   off-thread parse + build, ArrayBuffer transfer
├── three/               framework-free imperative three.js
│   ├── SceneManager.ts  the only file that touches WebGL
│   └── materials.ts     palettes, RenderMode, material factories
├── stores/
│   └── model.ts         the single Pinia store; owns the Worker
└── components/          Vue 3 UI (see "UI component map")

scripts/
├── anonymize.py         data/ → public/samples/, strips addresses, re-keys UUIDs
└── verify-render.mjs    headless Playwright render check (not wired into CI)

public/samples/          demo_house.epJSON, demo_block.epJSON (anonymized)
data/                    git-ignored — real research models with addresses
docs/references/         git-ignored — upstream EnergyPlus schema and sources
tests/                   Vitest: parse, geometry, realdata
```

## Layering contract

The layer boundaries are load-bearing, not stylistic:

- **`src/core/**` imports nothing from Vue, the DOM, or three.js.** That is what
  lets the same code run inside a Web Worker and inside Node-environment Vitest.
  A three.js import in `core/` breaks both at once.
- **`src/three/SceneManager.ts` is the only file that touches WebGL.** It knows
  nothing about Vue.
- **`ViewerCanvas.vue` is the only Vue↔three bridge** and the only holder of a
  `SceneManager` instance. Other components reach the scene through the store.
- **`src/components/**` import three.js only via `materials.ts`**, and only for
  palette colors.
- **`src/stores/model.ts` is the single store** and the only owner of the Worker.
  Panels talk to it directly — there is no props drilling and no cross-panel
  emit chain.

## Data flow

```
file drop / picker / demo fetch
  → store.loadFile → store.loadText → Worker
      → JSON.parse → parseEpjson → buildGeometry → transfer
  → store: markRaw(model), markRaw(bundle), status = 'ready'
  → ViewerCanvas.initModel → SceneManager.setModel → applyColors
      → setCategoryVisible / setHiddenZones / setInteriorVisible / setGhost
      → setEdges → select → buildGrid → applyVisibility → fitAll
```

Step by step:

1. **Load.** `DropZone`, `TopBar`, or `App.vue`'s global drop handler calls
   `store.loadFile(file)` → `file.text()` → `store.loadText(name, text)`. The
   demo buttons go through `store.loadDemo(url, name)` → `fetch` → `loadText`.
2. **Dispatch.** `loadText` sets `status = 'loading'`, increments `requestId`,
   and posts a `WorkerRequest` to the module Worker created in `ensureWorker()`.
3. **Worker** (`modelWorker.ts`) runs `JSON.parse` (10%) → `parseEpjson` (35%)
   → `buildGeometry` (60%) → transfer (90%), appending build warnings to
   `model.warnings`, then posts `{type: 'done', model, bundle}` with the
   position/normal/triSurface/edge `ArrayBuffer`s in the transfer list.
4. **Receive.** `worker.onmessage` **drops any response whose `id !== requestId`**
   — that is the staleness guard for a superseded load. Otherwise it stores
   `markRaw(msg.model)` / `markRaw(msg.bundle)`, clears `selected` and
   `hiddenZones`, and flips `status` to `'ready'`.
5. **Render.** `App.vue` swaps `DropZone` for the ready layout, `ViewerCanvas`
   mounts (or its `watch([model, bundle])` fires) and calls `initModel()`, which
   pushes every store field into the imperative scene and finishes with
   `fitAll()`.

Rendering is **on demand**: `requestRender()` raises a flag that the rAF loop
`animate()` consumes. The loop also renders while OrbitControls damping is
still settling. Nothing re-renders on a timer.

## Core data model (`src/core/types.ts`)

`types.ts` is the whole contract between the layers. The key shapes:

- **`EpSurface`** — one surface, flattened: identity (`index`, `name`, `epType`,
  `surfaceType`), grouping (`zone`, `building`), semantics (`construction`,
  `boundaryCondition`, `boundaryObject`, `hostSurface`, `isInterior`,
  `isAirBoundary`), geometry (`polygon` as flat `[x,y,z,…]`, `holes`), computed
  metrics (`area`, `netArea`, `tilt`, `azimuth`), links (`fenestration`), and
  `raw` — the original epJSON object, kept because the parse is lenient.
- **`EpZone`** — `origin`, `relativeNorth`, `ceilingHeight`, `volume`, computed
  `floorArea`, and `surfaces` (building-surface indices only).
- **`EpBuildingGroup`** — `name`, display `label`, member `zones`.
- **`SurfaceSummary`** / **`ModelStats`** — the roll-up shape; `ModelStats`
  just adds `zoneCount` and `buildingCount`.
- **`EpModelMeta`** — `epVersion`, `northAxis`, `coordinateSystem`, `site`, and
  the `center` offset applied by recentering (`original = stored + center`).
- **`EpModel`** — everything above plus `warnings`.
- **`GroupBuffers`** — one render group's `positions`, `normals`, `edges`, the
  back-maps `triSurface` (triangle → surface index) and `edgeSurface` (edge
  segment → surface index), and `ranges` (surface index → `[firstTri, triCount]`).
- **`GeometryBundle`** — `groups` keyed by `GroupKey`, plus `triangleCount`.

**`CATEGORIES` is the single source of truth** for the eight categories
(`wall`, `roof`, `floor`, `ceiling`, `window`, `door`, `airBoundary`,
`shading`); `Category` derives from it with `(typeof CATEGORIES)[number]`.
Adding a category means editing that one array.

**`GroupKey`** is the template-literal type `` `${Category}:ext` |
`${Category}:int` `` — every category splits into an exterior and an interior
render group. `groupKeyOf(surface)` is the only way to compute it.

The **worker contract** lives in `src/worker/modelWorker.ts`: `WorkerRequest`
(`id`, `fileName`, `text`) and the `WorkerResponse` union
(`progress` | `done` | `error`). Changing either is a cross-layer change.

## Coordinate frames and transforms (a known trap) — `src/core/parse.ts`

Transforms mirror EnergyPlus `SurfaceGeometry.cc` exactly. All rotation angles
are **degrees clockwise from north**, which is why every angle is negated
before being fed to `cos`/`sin`. Do not "simplify" a sign.

| Geometry | Transform |
| --- | --- |
| Relative mode, zone-anchored | rotate by `-direction_of_relative_north`, translate by zone origin, then rotate by `-(north_axis + appendix G)` |
| World mode | rotate by `-appendix G` only |
| `Shading:Building:Detailed` | rotates with the building, but has no zone frame |
| `Shading:Site:Detailed` | **never rotated** |
| `Shading:Zone:Detailed` | uses its `base_surface_name`'s zone frame |
| Rectangular surfaces | as zone-anchored, but the mode comes from `rectangular_surface_coordinate_system` — one file may be World for detailed geometry and Relative for the simple objects |
| `Shading:Site` / `Shading:Building` (rectangular) | as their `:Detailed` counterparts: never rotated / rotates with the building |
| Rectangular subsurfaces (`Window`, `Door`, `GlazedDoor`, …) | built in the **base surface's world frame** — never transformed again |
| Attached shading (`Shading:Overhang`, `Shading:Fin`, …) | built in the **window's world frame** — never transformed again |

Fenestration is transformed with **its host surface's zone**, not its own
(it has none).

Other rules in the same file:

- **Vertex winding.** `finishRing` reverses the ring when
  `GlobalGeometryRules.vertex_entry_direction` is clockwise, so everything
  downstream can assume one convention.
- **Recentering.** After all surfaces are read, every coordinate is shifted by
  `center = [bboxCenterX, bboxCenterY, minZ]`. This is what keeps float32
  precision usable at urban scale (Belgian Lambert coordinates are ~150 000 m
  from the origin). `tests/realdata.test.ts` pins it by asserting all
  coordinates stay under 4000.
- **Hole rings share the subsurface polygon array on purpose.** When a
  fenestration surface — detailed or rectangular — is attached to its host,
  `host.holes.push(polygon)` pushes *the same array object*, so the recentering
  pass shifts it exactly once. Copying it there would double-shift every window.
- **Metrics are computed after recentering** — areas and angles are
  translation-invariant, so the order is safe.
- **Building grouping** is a naming convention, not an epJSON feature (which has
  exactly one `Building` object). `groupZonesIntoBuildings` buckets zones by the
  `ID_<uuid>` prefix — the CityGML building id, the one signal every export
  agrees on — and uses the longest whole `_` segment prefix the bucket shares as
  the key, so the address stays in the key and only the zone part is left for
  `zoneLabel`. A trailing `_F<n>` is dropped so single-floor and multi-floor
  buildings key alike; a lone zone keeps its full name. Without a UUID prefix it
  falls back to the `Building` object name, which is what a conventional
  single-building file gets. Duplicate street labels are disambiguated with a
  UUID fragment.
- **Surface cross-references resolve case-insensitively.** EnergyPlus uppercases
  every name as it reads the input, so a reference whose casing differs from its
  target still resolves there; epJSON keeps the author's casing. `findSurface`
  tries the exact map first and falls back to a case-folded one. Exact match
  always wins, so nothing changes for files that are already consistent.

## Rectangular surfaces (`src/core/rectSurfaces.ts`)

Two thirds of the geometry-bearing epJSON objects give a start point, an
azimuth, a tilt and two dimensions instead of vertices. `rectSurfaces.ts` owns
that construction; `plane.ts` stays free of EnergyPlus conventions and
`parse.ts` stays free of trigonometry.

From azimuth `A` (degrees clockwise from north, naming the direction the
outward normal faces) and tilt `T` (degrees from horizontal, 0 facing up):

```
n = ( sinA·sinT,  cosA·sinT,  cosT )   outward normal
u = (-cosA,       sinA,       0    )   length axis, "right" seen from outside
w = n × u                              height axis, "up" along the surface
```

and the ring from start point `P` is `[P + H·w, P, P + L·u, P + L·u + H·w]` —
upper-left, lower-left, lower-right, upper-right, the order EnergyPlus
generates.

Four things about this are load-bearing:

- **The round trip anchors the angles, but not the handedness.** That ring's
  Newell normal is exactly `+n`, so `surfaceMetrics` on a generated ring returns
  the *declared* azimuth and tilt. That catches a wrong sign in `n`, and a
  winding reversal, which surfaces as an azimuth 180° from the input.
  It cannot catch a mirrored `u`: `w` is derived as `n × u`, so it mirrors too,
  `u × w` is unchanged, and every normal, area, tilt and azimuth survives while
  the rectangle mirrors about its start point — walls run the wrong way and stop
  meeting the floors they bound. **Handedness needs a positional check**, and
  `tests/rectFixtures.test.ts` makes it the one that matters: each zone's walls
  must enclose exactly the plan extent of its floor. Treat the two as a pair;
  neither alone is sufficient.
- **`finishRing` is not applied.** `vertex_entry_direction` and
  `starting_vertex_position` govern hand-entered vertex lists only; generated
  rings are already canonical.
- **Rings are built in the local frame with the raw azimuth, then transformed
  whole.** EnergyPlus instead rotates the start point and adds the same
  rotation to the azimuth. Rotation is linear, so the two are algebraically
  identical — and this way every sign convention stays inside the one transform
  closure. Do not "simplify" it into a rotated azimuth.
- **`surfaceFrame(polygon)` is only valid before recentering.** It recovers the
  placement frame of a surface already in world coordinates so subsurfaces and
  attached shading can be laid out on it, and its `origin` is an absolute
  coordinate (the axes and dimensions are translation-invariant). Every caller
  runs in the surface passes, before the recentering pass.

`surfaceFrame` anchors offsets at the independent minimum in the `(u, w)`
plane. EnergyPlus uses the base's `Vertex(2)`; that is the same point for any
rectangle, and the minimum stays well-defined for a detailed base, whose vertex
order depends on `starting_vertex_position` and may already have been reversed
for winding.

Attached shading is not a special case — `overhangRing` and `finRings` are
`rectRingFromAxes` with substituted axes. Their axis order puts a default
overhang at tilt 0 facing up, matching EnergyPlus reporting an overhang's tilt
as the window's minus the tilt-from-window, and points each fin away from the
window it shades. Only the reported tilt and azimuth depend on that choice;
materials are double-sided. A `Shading:Fin` produces **two** surfaces named
`<Name> Left` and `<Name> Right`, so they share one `raw` object and neither
name is a key in the source epJSON.

## Triangulation and buffer building (`triangulate.ts`, `buildBuffers.ts`)

`triangulatePolygon(outer, holes)` cleans the rings, computes the Newell
normal, projects into the polygon's own plane via `planeBasis` / `projectTo2D`,
runs earcut, and normalizes winding with `orientTriangles`. When hole cutting
fails — earcut struggles with holes touching the outer ring — it retries solid
and returns `holesDropped: true` rather than dropping the surface; the caller
turns that into a warning. Degenerate polygons return `null`.

`buildGeometry(model)` merges every surface into **one `GroupBuffers` per
`GroupKey`**, recording `ranges[surfaceIndex]`, the `triSurface` back-map, and
outline line-segment pairs with their `edgeSurface` back-map.

`PAIR_OFFSET = 0.006` m nudges interior and adiabatic surfaces along
`-normal`, into their own zone. Matched pairs (party walls, floor/ceiling
between storeys) are exactly coincident in epJSON, and without the offset they
z-fight.

`surfaceTriangles(bundle, key, index)` extracts one surface's triangles for
highlighting. It is exported but currently unused — `SceneManager` inlines an
equivalent copy in `rebuildHighlight`.

## Metrics (`src/core/metrics.ts`)

`surfaceMetrics(polygon)` returns area, tilt (degrees from horizontal: 0 facing
up, 90 vertical, 180 facing down) and azimuth in the **EnergyPlus convention —
0 = North (+Y), 90 = East (+X), clockwise**. Azimuth is left at 0 for
near-horizontal surfaces (tilt ≤ 1° or ≥ 179°), where it is undefined.

`surfaceMetrics` is not only a reporting function: `surfaceFrame` calls it to
recover the base angles that rectangular subsurfaces and attached shading are
placed on. That makes the azimuth-zeroing above load-bearing rather than
cosmetic — a subsurface on a flat roof gets a correctly sized rectangle in the
correct plane, but its rotation *within* that plane is arbitrary. EnergyPlus has
the same ambiguity; the parser reports it once per file rather than per opening.

`summarizeSurfaces(surfaces)` rolls up counts and areas over **any** surface
set. It is deliberately used twice: once over all surfaces at parse time to
build `ModelStats`, and again over a selected zone's or building's surfaces in
`SelectionCard`. Reusing one function is what makes the panel numbers and the
model statistics agree by construction — do not write a second roll-up.

Exterior wall and window areas only count surfaces whose boundary condition
matches `/outdoors/i`; `wwr` is `null` when there are no exterior walls.

## State management philosophy (`src/stores/model.ts`)

One setup-style Pinia store, `useModelStore`. The rules that matter:

- **`model` and `bundle` are `shallowRef` + `markRaw`.** A 750-zone model has
  22 000 surfaces; deep reactivity over that would be catastrophic. Never
  assign them to a plain `ref`, and never spread them into a reactive object.
- **`hiddenZones` is a `ReadonlySet` that is always replaced, never mutated**,
  so identity-based watchers fire. It is the single source of truth for *both*
  zone and building visibility — `buildingVisibility` is derived from it
  (`visible` / `partial` / `hidden`), never stored.
- **Camera actions are one-shot request refs.** `viewRequest` and `zoomRequest`
  are set by any component and nulled by `ViewerCanvas` after it consumes them.
  This keeps imperative camera moves out of the component tree.
- **`categoryVisible` is a plain `reactive` record** keyed by `Category` — it is
  small and benefits from deep reactivity.
- The store owns the Worker (`ensureWorker`) and the `requestId` staleness
  guard. No component creates a Worker.
- `setHiddenZones` re-anchors the selection: a group selection survives while
  any member is still visible, and only clears when all of them are hidden.

## Selection model (`selectionGroup` in `src/stores/model.ts`)

**`selected` stores only the clicked anchor surface index.** Expansion to a
zone or building happens entirely in the `selectionGroup` computed, which means
the user can change the level *after* picking without re-clicking anything.

`surfacesByZone` / `surfacesByBuilding` group by the **`surface.zone` and
`surface.building` fields**, not by `EpZone.surfaces`. That is deliberate:
`EpZone.surfaces` holds building surfaces only, whereas grouping on the surface
field brings hosted fenestration and zone shading along for free.

Site shading has both fields `null`, so it never joins a group; `selectionGroup`
falls back to the single surface, and raising the level never yields an empty
selection.

`SELECTION_LEVELS` (`['surface', 'zone', 'building']`) is the ordering;
`availableSelectionLevels` filters it to what the loaded model can express —
Zone needs zones, Building needs `stats.buildingCount > 1`. Building is dropped
rather than disabled on a conventional single-building file, where it would only
mean "select everything"; a shading-only file is left with Surface alone and
`SelectionLevelToggle.vue` hides itself.

Everything reads that one computed: `setSelectionLevel` ignores a level not in
it, `cycleSelectionLevel` (the `S` key in `App.vue`) steps within it, and the
worker `done` handler clamps to `'surface'` when the incoming model does not
offer the level still held from the previous one.

## Rendering and picking (`src/three/SceneManager.ts`)

An imperative, framework-free class. Z-up (`camera.up.set(0, 0, 1)`), owning
the renderer, camera, OrbitControls, raycaster, `ResizeObserver`, `modelGroup`,
`highlightGroup` and the ground grid.

**Batching.** `setModel` builds **one `Mesh` and one `LineSegments` per
`GroupKey`** — at most 16 of each, whatever the model size. Every group gets a
writable `Uint32Array` index buffer.

**Visibility is a masking operation, never a re-mesh.** `rebuildZoneMask()`
rewrites each group's index buffer in place to skip triangles belonging to a
hidden zone, then calls `setDrawRange`. Splitting the merge into per-zone
meshes to achieve the same effect would multiply draw calls by the zone count
and is the single change most likely to destroy performance here. The rebuild
is deferred: `setHiddenZones` only sets `maskDirty`, and `applyVisibility`
performs the work. Surfaces with no zone (site and building shading) are never
hidden by the mask.

**Picking has a mandatory remap.** `handlePointerUp` ignores drags beyond
`DRAG_THRESHOLD_PX = 5`, then `pick()` raycasts against pickable meshes
(ghosted exterior groups are excluded). `hit.faceIndex` is an index into the
*drawn* faces, not the stored ones, so it must go through
`group.visibleTri[hit.faceIndex]` before indexing `buffers.triSurface`. Reading
`triSurface[hit.faceIndex]` directly appears to work until a zone is hidden,
then silently selects the wrong surface.

**Highlights cost two draw calls.** `rebuildHighlight()` runs two passes — size,
then copy — to merge every selected surface's triangles into one fill mesh and
one outline, so a 1-surface and a 500-surface selection cost the same.
Outlines are skipped past `MAX_OUTLINE_SURFACES = 2000`.

**Camera.** `fitAll`, `setTopView`, `setNorthView`, `zoomToSurfaces` all funnel
into `frameBox` / `moveCameraToDirection`. `emitCamera` reports the viewing
bearing back through `onCameraChange` → `store.cameraBearing` → the compass in
`ViewToolbar`.

## Render modes and palettes (`src/three/materials.ts`)

`RenderMode` is `'type' | 'boundary' | 'construction'`. `surfaceColor(s, mode,
constructionIndex)` dispatches to `CATEGORY_COLORS` (an OpenStudio-like
palette), `boundaryColor` (`BOUNDARY_COLORS` with `BOUNDARY_FALLBACK`, and
`SHADING_NEUTRAL` for shading), or `CONSTRUCTION_PALETTE` indexed by the
store's `constructionIndex`.

`createGroupMaterial` produces a `MeshLambertMaterial` with `vertexColors`,
`DoubleSide` and polygon offset; colors are written into the vertex-color
attribute by `applyColors`, not by swapping materials. `applyGhost` switches a
group into the x-ray look. `ViewerCanvas` caches `cssToLinearRgb` results
because the conversion runs once per surface per recolor.

## UI component map (`src/components/`)

| Component | Role |
| --- | --- |
| `App.vue` | Layout root; global drag & drop; keyboard (`Esc` deselect, `F` fit, `S` cycle selection level — all ignored while typing in an input) |
| `ViewerCanvas.vue` | The Vue↔three bridge: owns the `SceneManager`, watches each store field into it, caches colors |
| `TopBar.vue` | Brand, file chip, E+ version badge, parse-warnings popover, file picker, controls help |
| `SidePanel.vue` | Two-tab shell (Model / Display) |
| `ModelTree.vue` | Buildings → zones → surfaces → fenestration; search capped at `MATCH_CAP = 250`; eye toggles (Alt-click solos); double-click frames; auto-reveals the picked surface |
| `LayersPanel.vue` | View presets, render-mode radios, per-category checkboxes with counts, interior/x-ray/edges options |
| `SelectionCard.vue` | Inspector: group roll-up via `summarizeSurfaces` for zone/building, or full detail plus raw epJSON for a single surface |
| `SelectionLevelToggle.vue` | The Surface / Zone / Building segmented control |
| `ViewToolbar.vue` | Fit / TOP buttons and the compass driven by `cameraBearing` |
| `LegendOverlay.vue` | Adaptive legend per render mode; category rows double as visibility toggles |
| `StatsChip.vue` | Model statistics and the "N hidden" reset |
| `DropZone.vue` | Empty / loading / error state, progress bar, demo buttons, privacy copy |

## View presets (`applyPreset`)

`ViewPreset` is `'exterior' | 'all' | 'xray'`. Each preset resets **all**
categories to visible first, then applies its own overrides: `exterior` hides
interior surfaces and air boundaries; `all` shows everything; `xray` ghosts the
shell, keeps interiors, and hides shading (context shading only obscures the
inside of the model).

## Warnings and robustness

Parsing is **deliberately lenient** and must stay that way. Unknown fields are
ignored; nothing is validated against the schema; real-world files carry
non-schema keys. Problems become strings in `model.warnings`, surfaced in the
`TopBar` popover.

Only **two hard throws** exist, both in `parseEpjson`: a non-object top level,
and a file with no surface objects at all. Do not add a third for
odd-but-loadable data — degrade and warn instead. A rectangular subsurface or
attached shade whose base is missing is skipped with a warning, because unlike
`FenestrationSurface:Detailed` it carries no vertices of its own and there is
nothing to place.

Two warnings are **aggregated** rather than emitted per object, so a large but
uninteresting file cannot exhaust the budget: the count of rectangular
subsurfaces placed on a near-horizontal base, and (from `buildBuffers`) the
count of surfaces rendered without their window cut-outs. A third fires at most
once per file, when `coordinate_system` and `rectangular_surface_coordinate_system`
disagree *and* the file actually contains rectangular geometry.

Silent by design: a fin side with zero depth (EnergyPlus drops it too, and a
file full of one-sided fins would flood), an ignored subsurface `multiplier`,
and a subsurface that is not geometrically contained in its base.

Warnings are capped at `MAX_WARNINGS = 80` with a
`'… further warnings suppressed'` sentinel. The cap is implemented **twice**,
in `parse.ts` and in `buildBuffers.ts`, because the two run in separate passes;
the worker concatenates them.

`buildBuffers` deliberately does **not** warn about a surface it failed to
triangulate when `s.area < ZERO_AREA_EPS` — `parse.ts` already reported it as
zero-area, and a duplicate warning per surface would flood the popover on a bad
file. There is a test pinning exactly this.

## Performance invariants

Break these and the urban-scale models stop being usable. They are listed here
so a change can be checked against them without reading every file:

- **≤16 merged meshes + ≤16 line objects**, one pair per `GroupKey`, regardless
  of model size.
- **Hide subsets by rewriting the index buffer and `setDrawRange`**, never by
  splitting the merge into per-zone meshes.
- **Selection highlights merge into two draw calls**; outlines cut off at
  `MAX_OUTLINE_SURFACES = 2000`.
- **Parsing and triangulation run in a Worker**, with buffers transferred rather
  than copied.
- **Coordinates are recentered at parse time** for float32 precision.
- **Rendering is on demand** (`requestRender` + rAF), and the pixel ratio is
  clamped to `min(devicePixelRatio, 2)`.
- `ModelTree` caps search matches at `MATCH_CAP = 250`; `ViewerCanvas` caches
  css → linear color conversions.
- Large payloads stay out of Vue's reactivity via `shallowRef` + `markRaw`.

## Verification

Commands are in [TESTING.md](TESTING.md). In short: `npm test` runs the Vitest
suites against `src/core/*` only (there is no jsdom or component-test harness),
and `npm run build` runs `vue-tsc` before bundling.

`tests/realdata.test.ts` is an integration check against the git-ignored
`data/` directory. It uses `describe.skipIf(!hasData)`, so it **silently skips**
when the data is absent — including in CI. When it skips, say so rather than
reporting a clean run. It pins hard numbers (`block_9`: 55 zones, 334 interior
building surfaces with mutual pairing; `block_3`: 747 zones, 3246 air
boundaries, 14 675 shading surfaces), the float32 coordinate bound, and a
30-second parse-plus-build budget.
