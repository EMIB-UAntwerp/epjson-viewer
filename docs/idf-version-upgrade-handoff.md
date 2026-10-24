# Handoff: native IDF version upgrades in the browser

Updated: 2026-10-24. Repository: `/home/paladean/phd/2_energyplus/epjson-viewer`.

Implementation progress: the three WASM call-signature mismatches and additional
compiler/runtime layout and append-position defects are repaired. The unchanged
9.6 → 22.1 transition has Chromium/native semantic and audit parity on two
official models. See [feasibility evidence](idf-transition-feasibility.md).
Chromium passes all nine steps on both official models; Firefox passes all nine
simple-model edges. The chain, worker protocol 2, provenance and downloads are
implemented and installed locally. The full Chromium UI flow and both downloads
match native output. User visual acceptance and public artifact delivery remain
pending; see the feasibility document for validation limits.

The subsequent extension adds 8.9 and every 9.x release through 9.5, using seven
more unchanged upstream transitions. All seven pass Chromium/native parity on
two official 8.9 models and Firefox/native parity on the single-zone model.
Complete 8.9 and 9.4 UI imports/downloads match native 26.1 output. The local
registry now contains sixteen edges. See the feasibility document's extension
section and `docs/energyplus.md` for the new archive and rollback location.

The HVAC-template compatibility correction adds upstream `ConvertInputFormat`
as a converter invocation, preserving templates in epJSON without expansion.
The original engine CLI assets remain usable; transition rules and the worker
message contract are unchanged. See `docs/energyplus.md` for current candidate
installation and validation evidence.

## Objective and authorization

The user wants older IDFs, including version 9.6, to load automatically and
produce epJSON for the application's current supported EnergyPlus target.
They strongly prefer upstream native EnergyPlus logic, running on the user's
computer in the browser. Simulation remains out of scope; preserve a path to
add it later. EnergyPlus upgrades should require updating versioned build
artifacts and adapters, not maintaining object/field mappings in TypeScript.

The user has explicitly requested implementation of this handoff, including the
listed upgrade pipeline and interface extensions. Browser/native parity for the
first unchanged upstream transition is the prerequisite. No new tests, commits,
pushes or sub-agents are authorized.

Read `AGENTS.md` first. Do not create or modify tests, fixtures, helpers, or test
configuration without an explicit request for tests. Do not spawn agents unless
explicitly requested. Do not commit or push unless requested. Preserve existing
uncommitted work. No new skill is required for this task.

## Verified behavior: conversion is not version migration

Before this implementation, the browser rejected 9.6 because its registry
contained only a 26.1 converter and required a matching major/minor version. The user correctly observed that this is more restrictive
than the native IDF-to-epJSON converter.

We downloaded the official v9.6.0 `1ZoneUncontrolled.idf` and ran the official
EnergyPlus 26.1.0 binary with `--convert-only`. It exited successfully, emitted
a version-mismatch warning, and produced epJSON whose Version object was still
`{"Version 1":{"version_identifier":"9.6"}}`.

Thus some older IDFs can convert with a newer engine, but this does **not**
upgrade their version. The newer parser uses its own schema; compatibility of
one simple model does not prove compatibility of changed object layouts.
Do not remove the version guard and claim universal or upgraded support.
Do not merely rewrite the Version object.

EnergyPlus provides separate Transition programs, orchestrated by
IDFVersionUpdater, for actual model migration. The intended flow is:

```text
original IDF
  → identify source version
  → resolve a supported chain of native transitions
  → upgraded IDF at the configured target version
  → matching native EnergyPlus --convert-only
  → complete epJSON + provenance + diagnostics
  → existing geometry worker → viewer
```

Sources and local evidence:

- [Official versions/updating documentation](https://energyplus.readthedocs.io/en/v26.2.0/essentials/essentials.html#versions-and-updating)
- [Official transition documentation](https://energyplus.readthedocs.io/en/v26.2.0/auxiliary-programs/auxiliary-programs.html#using-older-version-input-files-transition)
- [Pinned native converter source](https://github.com/NatLabRockies/EnergyPlus/blob/v26.1.0/src/ConvertInputFormat/main.cpp)
- [Official 9.6 sample](https://raw.githubusercontent.com/NatLabRockies/EnergyPlus/v9.6.0/testfiles/1ZoneUncontrolled.idf)
- Local experiment: `.energyplus-build/parity/1ZoneUncontrolled-9.6.idf` and
  `.energyplus-build/parity/old-version/{1ZoneUncontrolled-9.6.epJSON,eplusout.err}`.
- In upstream `InputProcessing/InputProcessor.cc`, inspect `processInput` and
  `checkVersionMatch`. In `ConvertInputFormat/main.cpp`, version mismatch alone
  blocks epJSON-to-IDF, not necessarily IDF-to-epJSON.

## Existing implementation: working baseline

Branch: `feat/idf-wasm-conversion`. All implementation changes are uncommitted;
nothing has been pushed or published. `data` and `docs/references` were already
untracked workspace placeholders; do not delete, stage, or treat them as new
implementation files. Never read real model files or the large schema whole.

Read `docs/energyplus.md`, then relevant architecture sections. Responsibilities:

| Files | Current responsibility |
| --- | --- |
| `src/energyplus/types.ts` | Worker protocol 2, transition manifests/provenance; compatible protocol-1 converters |
| `src/energyplus/client.ts` | Dedicated worker per job, cancellation, termination, errors |
| `src/energyplus/worker.ts` | Version detection, explicit transition paths, checksums, isolated runtimes/filesystems, native CLI, bounded diagnostics |
| `src/stores/model.ts` | Import lifecycle, stale-job protection, original/upgraded IDF/full epJSON/provenance, previous-model retention, downloads |
| `src/components/ImportStatus.vue` | Progress/cancel, errors, conversion details, epJSON download |
| `src/components/{DropZone,TopBar}.vue`, `src/App.vue` | IDF file picker/drop integration; retain viewer during another import |
| `scripts/energyplus/` | Pinned source/compiler, native build adapter, artifact packaging/install/preparation |
| `.github/workflows/build-energyplus.yml` | Manual candidate build and artifact upload, no release publication |
| `.github/workflows/deploy.yml` | Prepare a pinned runtime before website build |

The geometry worker contract and `src/core/types.ts` are unchanged. Keep core
pure TypeScript and keep native conversion outside geometry parsing.
`sourceDocument` holds `{name, original, epjson}` separately from recentered
geometry. `convertedDocument` holds `{name, text, version}`. Preserve this
separation so future simulation uses complete input, not displayed geometry.

Pinned working runtime:

- EnergyPlus 26.1.0, commit `6f2e40d10250a105b49966baa24d843711e61048`.
- Emscripten 6.0.0; `buildRevision: 1`.
- Candidate `26.1.0-df6b27a725d576fc`; WASM size 31.3 MB before compression.
- Installed in ignored `public/energyplus/`; candidate in
  `.energyplus-build/candidate/`.
- Local archive: `.energyplus-build/energyplus-browser-26.1.0.tar.gz` (~8.3 MiB).
  SHA-256: `0362088637ca058ed03f6c61c9eb5c5731b27a5ff2176205035a31460429368c`.
- `scripts/energyplus/release.json` still has null URL/checksum. A fresh checkout
  needs a build/install or a published pin. Running `energyplus:prepare` with
  this null pin replaces the installed registry with an empty one. Do not do
  that accidentally during local work.

The full native engine is compiled, but only conversion is exposed. The build
adapter handles newer-Clang warnings, fmt 8 consteval compatibility, host schema
generation (`.cjs`, NODERAWFS, memory growth), and one guarded C++ platform patch
for executable-path discovery under Emscripten. Parser/conversion rules remain
upstream. These adjustments are documented in `docs/energyplus.md`.

26.1 is the working baseline, not a claim about today's latest EnergyPlus
release. Verify upstream releases when choosing the next target; keep the target
explicit and pinned instead of dynamically fetching “latest” at runtime.

## Main unknown: native transitions are Fortran

The pinned checkout's `src/Transition/CMakeLists.txt` declares
`project(Transition Fortran)`. It builds a shared `TransitionLib` plus one
executable per adjacent version pair from `Transition.f90` and
`CreateNewIDFUsingRulesV*.f90`. There are companion IDDs and report-variable CSVs.
The current WASM build explicitly uses `BUILD_FORTRAN=OFF`.

Do not assume enabling that flag makes transitions work with Emscripten.
The existing C++ toolchain does not establish a working Fortran-to-WASM path.
The isolated patched Flang/runtime build now compiles all nine transitions;
see the feasibility document for measured browser parity and outstanding checks.

The source version list includes this chain:

```text
9.6 → 22.1 → 22.2 → 23.1 → 23.2 → 24.1 → 24.2 → 25.1 → 25.2 → 26.1
```

Earlier source rules also exist, but their presence does not demonstrate browser
support or complete deployable dependencies. “Any version” must become an
explicit, validated support range. Reject newer-than-target models without
downgrading them.

## Implementation sequence

### 1. Establish native migration behavior and one browser transition

1. Inspect the actual transition entry point, CLI/file naming, required IDDs,
   CSVs, diagnostics, and exit behavior. Relevant upstream files are
   `src/Transition/{CMakeLists.txt,Transition.f90,platformDepUtilityRoutines.f90}`,
   `src/Transition/SupportFiles/`, `idd/versions/`, and `workflows/transition.py`.
   Start with 9.6 → 22.1 and run the shipped native transition as the reference.
2. Research maintained Fortran-to-WebAssembly compiler/runtime options using
   primary documentation. Evaluate actual support for the upstream language
   features, formatted I/O, filesystem calls, runtime dependencies and licensing.
   Do not promise a particular compiler before compiling the real transition.
3. Compile that single upstream transition to WASM in an isolated build adapter.
   Run it in a browser worker with its real supporting assets. Compare upgraded
   IDF semantics and diagnostics against the matching native executable.
4. Confirm cancellation can terminate it and a fresh invocation has no leftover
   state. Record compiler/source pins and any narrowly scoped platform patches.

This is a feasibility milestone, not an excuse to replace upstream transition
rules with handwritten JavaScript. If it fails, document the precise blocker and
practical alternatives before changing product scope. Shipping matching older
converters could preserve old-version epJSON, but would not fulfill automatic
upgrading. A local companion or remote service would need explicit agreement.

### 2. Build a versioned transition artifact chain

1. Once the proof works, package all validated steps needed from 9.6 to the
   pinned target, then extend the supported range using the same process.
2. Each step manifest should identify its exact `fromVersion`, `toVersion`,
   source commit, compiler/build recipe, loader/WASM and supporting-data hashes,
   invocation/result contract, and license notices.
3. Extend the registry with an explicit target version and transition graph.
   Resolve only complete, validated paths; do not infer adjacency by numerical
   version arithmetic. Download only the chosen chain, with immutable asset URLs.
4. Separate transition build configuration/toolchain from the working C++
   converter build. Add package/workflow entry points as needed. Preserve old
   artifacts and rollback pins. Avoid bundling every engine in the normal app JS.
5. Define compatibility/versioning for the changed manifest and worker protocol;
   reject mismatches clearly and retain support for installed conversion-only
   artifacts if practical. Do not silently reinterpret protocol 1 fields.

### 3. Integrate orchestration and provenance

Proposed files/responsibilities (confirm boundaries before editing):

- `src/energyplus/types.ts`: transition assets/capabilities and result provenance
  including source version, target version, steps/build IDs, and upgraded IDF.
- `src/energyplus/client.ts` and dedicated worker implementation(s): resolve and
  execute transitions sequentially, then invoke the target converter. Use one
  clear job owner and cancellation path; keep existing geometry-worker messages.
- `src/stores/model.ts`: retain original IDF, upgraded IDF, full converted epJSON,
  and provenance independently of geometry; retain last good model on failure.
- `src/components/ImportStatus.vue`: show meaningful progress, e.g. “Upgrading
  EnergyPlus 9.6 → 22.1”, summarize source/target versions, expose diagnostics and
  downloads. Consider offering the upgraded IDF alongside epJSON.
- Build/install/preparation scripts and `docs/energyplus.md`: package transition
  dependencies, validate manifests, document support matrix and upgrade process.

For each step, mount only its declared inputs, require successful completion,
check output existence and expected Version, and pass that complete output to
the next step. Never silently skip a failed step or hand a partial result to the
geometry parser. Keep diagnostics bounded but attribute them to the failed step.
Termination must work during downloads and synchronous native execution; stale
jobs must never overwrite a newer import. Same-target input bypasses migration.

Do not automatically run simulation, ExpandObjects, EPMacro, weather fetching,
or external-file processing. Identify unsupported dependencies clearly.

### 4. Validate the accepted production behavior

Follow the repository's staged policy. Initially use existing checks and manual
browser/native experiments; do not add regression tests or fixtures yet.

- Compare each transition and the complete 9.6 → target → epJSON path with
  the same native transition binaries and target converter. Include official
  models whose objects actually changed across releases; a simple version-only
  success is insufficient. Compare semantic output, not whitespace/timestamps.
- Check same-version imports, unsupported/future versions, missing chain/assets,
  native migration errors, missing/duplicate Version, cancellation mid-chain,
  retry/superseding imports, and preservation of the displayed model.
- Confirm downloads preserve full data and truthfully label source/target
  versions; inspect warnings about lossy/manual-action transitions.
- Check Chromium and Firefox, production subdirectory hosting, and realistic
  model sizes. Measure cold transfer, memory and timing; distinguish local
  measurements from network/browser-wide claims.
- Run the existing focused store/parser tests, build/typecheck, and headless
  render checks. Hand the result to the user for visual acceptance.
- Only after acceptance AND an explicit test request: add adversarial regression
  coverage under the repository's test-lock-in procedure.

### 5. Delivery and future updates

Prepare a concrete local candidate with provenance, support matrix, license
notices and validation results. Publishing a runtime release, committing,
pushing and website deployment have not been authorized. Do not push to main:
it deploys immediately. After publication is authorized, pin the immutable
archive URL/checksum and verify the deployed import path.

For each later EnergyPlus target: pin upstream/compiler versions, build the new
transition edge(s) and converter, validate native parity, and promote the graph
and artifacts together. The support range must reflect validated chains.
Simulation can later consume the upgraded full input through the same engine
boundary, with its own weather/files/output contract and parity validation.

## Existing validation and practical workspace commands

Already passed for conversion-only implementation:

- 35 existing tests in `tests/model.store.test.ts` and `tests/parse.test.ts`.
- Production build/typecheck, including a `/viewer/` deployment base.
- epJSON equality against native 26.1 for `1ZoneUncontrolled`,
  `5ZoneAirCooled`, and `HospitalLowEnergy` (4.63 MB input).
- Chromium/Firefox conversion and render checks, cancel/retry/error retention.

The user tried a 9.6 file and requested broader support. That is not approval to
write tests, nor evidence that new migration behavior has been accepted.
New regression tests: not written; awaiting manual acceptance.

Network/DNS, local Vite sockets, and browser execution were fixed and worked
on 2026-10-22. Earlier failures are historical, not a current blocker. `/tmp`
was cleared between sessions; important toolchains/downloads now live under
ignored `.energyplus-build/`. Check state before reinstalling or rebuilding.

```sh
git status --short --branch
npm run dev -- --port 5199 --host 127.0.0.1 --configLoader runner
npm run build -- --configLoader runner
npx vitest run tests/model.store.test.ts tests/parse.test.ts --configLoader runner

PLAYWRIGHT_BROWSERS_PATH=.energyplus-build/browsers node scripts/verify-render.mjs public/samples/demo_block.epJSON /tmp/epjson-check.png 3000 all,pick

# Resume the existing C++ converter build; this does not build transitions.
source .energyplus-build/emsdk/emsdk_env.sh
PATH="$PWD/.energyplus-build/tools:$PATH" EPLUS_BUILD_JOBS=6 npm run energyplus:build
npm run energyplus:install -- .energyplus-build/candidate
```

The loader option avoids Vite writing into read-only `node_modules` caches in
this sandbox. Chromium and Firefox are installed under `.energyplus-build/browsers`.
Dev/preview processes may not survive context/session changes; check before
assuming ports 5199 or 5200 are serving this branch.

The official Linux 26.1 binary is at `.energyplus-build/native/energyplus`.
Because its Ubuntu 24.04 library requirements exceed the host's, official Ubuntu
libraries were extracted locally; no system libraries were changed. Run it with:

```sh
.energyplus-build/native-libs/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 \
  --library-path .energyplus-build/native-libs/usr/lib/x86_64-linux-gnu:.energyplus-build/native \
  .energyplus-build/native/energyplus --convert-only \
  -d .energyplus-build/parity/native/ path/to/input.idf
```

Native transition executables/supporting files should be inspected under
`.energyplus-build/native/PreProcess/IDFVersionUpdater/`; all nine native transitions have been run successfully without an alternate
loader. Source checkout:
`.energyplus-build/26.1.0-1/source/`. Keep new exploratory downloads/builds in
ignored locations and do not copy research data into public samples.

## First action in the next context

Read this file and the feasibility evidence; the local upgrade implementation
is complete and awaiting user visual acceptance. Do not restart the completed
compiler investigation. Preserve the converter, existing edits and validation
artifacts. Public runtime publication requires explicit authorization and a
release pin; it is not part of this local implementation.
No commits, pushes, new tests or sub-agents are authorized.
