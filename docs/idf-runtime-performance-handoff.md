# Handoff: faster browser upgrades for older IDFs

Updated: 2026-10-24. Planning only; no performance implementation is authorized
by this document. The user has confirmed that the compatibility fix works and
wants outdated-IDF imports to complete more efficiently.

## Outcome to pursue

Reduce the time from selecting an older IDF to a usable model and downloadable
upgraded IDF/epJSON. Keep everything in the browser, preserve complete model
content, and retain the official EnergyPlus migration rules.

Start with the Flang/WASM assignment bottleneck identified below. Establish a
fresh baseline before making changes. A **2× reduction in median full-chain
execution time** on the representative small and HVAC models is a proposed
engineering target, not an established speedup or a promise. Report actual
results if that target proves unrealistic; do not equate a faster isolated
function with a faster import.

## Working baseline and constraints

At handoff creation, branch `feat/idf-wasm-conversion` was at `8b0b5c6`, with a
clean tracked worktree. Recheck the branch and diff before future work; preserve
any intervening user changes. Read [AGENTS.md](../AGENTS.md), then the relevant
data-flow section of [ARCHITECTURE.md](../ARCHITECTURE.md).

- Supported source versions: 8.9, 9.0–9.6, 22.1–22.2, 23.1–23.2, 24.1–24.2,
  25.1–25.2 and 26.1. The registry has sixteen adjacent upgrade edges.
- The selected converter is **`26.1.0-360096b1fc5a6c8d`**, upstream
  `ConvertInputFormat` with manifest `invocation: "convert-input-format"`.
  Preserve `HVACTemplate:*` objects. Do not revert to the old engine CLI path:
  `energyplus --convert-only` rejects these otherwise supported inputs.
- Source EnergyPlus commit: `6f2e40d10250a105b49966baa24d843711e61048`.
  Flang/LLVM 21.1.8 and Emscripten 6.0.0 are pinned in
  [transition-config.json](../scripts/energyplus/transition-config.json).
- Preserve the existing compiler ABI/layout fixes and runtime append-position
  fix. Keep strict transition linking with `--fatal-warnings`; do not suppress
  linker warnings, weaken checksums, or bypass native-parity receipts.
- Do not rewrite EnergyPlus migration rules, skip intermediate transitions,
  change only the Version object, or parse old fields using the 26.1 schema.
- Do not introduce server conversion, simulation, ExpandObjects, EPMacro, or
  geometry-only conversion. Preserve original input, upgraded IDF, full epJSON,
  diagnostics, provenance, cancellation and previous-model retention.
- No new tests, fixtures, test helpers, commits, pushes or sub-agents unless
  separately requested. Existing checks and manual browser/native experiments
  are allowed. User models must remain private and outside public artifacts.
- Before an implementation, state exact files and responsibilities. Changes to
  data flow, `core/types.ts`, worker messages or module boundaries require the
  approval described in AGENTS.md. Initial experiments should stay within the
  compiler/runtime build boundary.

The accepted combined candidate is
`.energyplus-build/template-compatibility/candidate`. Its archive, checksum,
validation evidence and installation instructions are in
[energyplus.md](energyplus.md#hvac-template-compatibility-2026-10-24).
Keep it available for rollback. Do not run `energyplus:prepare` while the
release pin is null: that deliberately installs an empty registry.

## Measurements already obtained

These are local Chromium measurements of the unchanged transition assets,
before the HVAC-template converter replacement. They are not a fresh benchmark
of the complete current application or a measurement of remote download speed.

| Operation | Fetch + checksum | WASM initialization | Program execution |
| --- | ---: | ---: | ---: |
| 9.6 → 22.1, single-zone model, cold browser context | 0.149 s | 0.017 s | 23.720 s |
| Same operation with cached assets | 0.077 s | 0.008 s | 23.415 s |
| 9.6 → 22.1, Version-only diagnostic input | 0.063 s | 0.007 s | 18.088 s |
| 25.2 → 26.1, single-zone intermediate | 0.085 s | 0.006 s | 23.939 s |
| 9.6 → 22.1, HVAC model, CPU sampling enabled | 0.088 s | 0.013 s | 61.960 s |

The single-zone input has 55 objects. The HVAC input has 357 objects and comes
from the official 8.9 `5ZoneAirCooled` model upgraded natively to 9.6. The
Version-only input is deliberately invalid and produces missing-object errors;
it demonstrates baseline work, not successful valid-model compatibility.

Fresh native transition runs on the small model took 8.072 s for 9.6 → 22.1 and
7.590 s for 25.2 → 26.1. The current browser implementation was roughly 3× slower
on these samples. Native processing also has substantial cost on this machine;
do not promise instantaneous upgrades merely by matching native speed.

The old engine's final IDF → epJSON call took 0.332 s on the small model. This
number belongs to the **previous converter**; remeasure `ConvertInputFormat`
separately. Its compatibility correction did not change transition execution.

### What the profiles establish

- `Fortran::runtime::WorkQueue::BeginAssign` accounts for approximately **78%**
  of sampled self time on the small model and **88%** on the HVAC model.
- `InputProcessor::ProcessDataDicFile` accounts for 73% inclusive time on the
  small model. Dictionary processing and assignment percentages overlap;
  they must not be added.
- The HVAC run spends about 21.6 seconds preparing dictionaries/comparison
  state, then substantial additional time assigning arrays during model
  processing. Optimizing only dictionary startup would leave that latter cost.
- Local fetch, checksum and module startup are small compared with CPU
  execution. Cached assets barely change the measured transition duration.

`BeginAssign` contains inlined implementation. Sampling identifies an expensive
function family, **not yet a specific faulty loop, missing optimization, or
compiler bug**. Possible causes to distinguish include character padding and
scalar expansion, descriptor traversal, temporary copies and derived-type
assignment. Do not claim that all expensive assignments can safely be replaced
by `memcpy`.

The profiles were symbolized by relinking existing objects with
`--emit-symbol-map`; the resulting WASM was byte-identical to the measured
installed 9.6 → 22.1 module:
`e4b4bdc798f8c4582ef0e2736c5877e985a5769094519fbf2fde2b811bdb3aa7`.
The profiled small run took 22.871 s, close to the unprofiled measurements.

### Evidence and reproduction inputs

Existing diagnostic artifacts were copied out of `/tmp` into the ignored local
directory `.energyplus-build/transition/performance-baseline/`:

- `report.md`, `timings.json`, `native-timings.json`, `profile-summary.json`.
- `9.6-simple-profile.cpuprofile`, `transition.mjs.symbols`, `parity.json`.
- `hvac/`: corresponding timing, profile and parity evidence.
- `profile.mjs`, `native.mjs`, `hvac-profile.mjs`: copies of the existing manual
  diagnostic harnesses. Their temporary output paths and engine-CLI invocation
  reflect the inspection at that time; review them before reuse.

These artifacts are local, not part of a fresh Git checkout. This document
retains the key findings if the artifacts are unavailable. Reuse the official
inputs and native references under:

- `.energyplus-build/transition/native-chain/simple/`.
- `.energyplus-build/transition/legacy/native-chain/5ZoneAirCooled-8.9/`.
- `.energyplus-build/template-compatibility/` for template conversion and the
  original 25.2 template upgrade case.

Native transitions overwrite their input: use `input.idfold` as the source and
`input.idfnew` as the output when these files exist. Never accidentally benchmark
an already upgraded file as an old input. Source URLs/hashes are recorded in
the earlier parity/build evidence. `Building_Two_LoWD4.idf` was not available
locally during inspection; include it privately if the user makes it available.

## Implementation sequence

### 1. Establish a reproducible baseline on the accepted converter

Trace `client.ts` → `worker.ts` → manifest-selected modules → native entry
points. Capture separate timings for manifest loading, asset fetching,
SHA-256 verification, loader import, WASM initialization, virtual filesystem
setup, native execution, output reading, final conversion and geometry/rendering.
Use temporary diagnostics; no worker protocol or production telemetry change is
needed just to measure these phases.

Start with 9.6 → 22.1 and 25.2 → 26.1, using the small and HVAC inputs. Measure
26.1 direct template conversion separately to guard the compatibility baseline.
Then measure full 9.6 → 26.1 and 8.9 → 26.1 imports, plus the 25.2 template case.

For comparisons, run baseline/candidate serially on the same machine, alternating
their order. Use at least three unprofiled runs per important case; report the
median and range. Record browser version, CPU/environment, input and artifact
hashes, optimization flags, cold versus cached state, bytes transferred and
peak memory where measurable. Separate HTTP caching from WASM compilation and
native state. Do not benchmark while another compiler or transition job is
competing for CPU. Use CPU sampling for diagnosis, not final speed claims.

Repeat conversion measurements in Chromium and Firefox. Firefox WebGL2 is
unavailable in the current headless environment; worker conversion and downloads
can still be checked, while Chromium supplies the render check. Record this
limitation instead of treating a missing Firefox canvas as successful rendering.

**Deliverable:** an asset-bound baseline table and profiles with a measured
full-chain total, not a sum extrapolated from one edge.

### 2. Optimize the compiler/runtime path first

Inspect the generated code and runtime objects for the hot assignment paths.
Relevant files and responsibilities:

| Location | Responsibility |
| --- | --- |
| `scripts/energyplus/build-flang.mjs` | Patched compiler, intrinsic modules, runtime archive and provenance |
| `scripts/energyplus/build-transition.mjs` | Unchanged Fortran compilation, strict linking and build evidence |
| `scripts/energyplus/flang-wasm32.patch` | Existing ABI/layout repairs that must survive optimization |
| `scripts/energyplus/flang-runtime-append.patch` | Existing append-position repair |
| LLVM `flang-rt/lib/runtime/assign.cpp` | Generic assignment, copying and character padding |
| LLVM `flang-rt/include/flang-rt/runtime/work-queue.h` | Assignment dispatch and inlined execution |
| EnergyPlus `src/Transition/InputProcessor.f90` | Dictionary copying and field-array setup; inspect without editing |

The current transition build already requests `-O2`. The host compiler itself
is built with `-O1` to control build resource use; that does **not** mean emitted
transition code is only optimized at `-O1`. More importantly, the runtime archive
is copied from the pinned distribution, with only `external-unit.o` replaced.
Do not assume that final link optimization fully optimizes that archive.

Run one controlled experiment at a time, in a separate candidate directory:

1. Determine which assignment categories dominate with finer diagnostics or
   generated-code inspection. Measure copy/fill volume and allocation overhead
   where practical; remove diagnostic instrumentation for timing comparisons.
2. Check the runtime object's actual optimization/code generation. Evaluate
   recompiling the relevant unchanged runtime implementation for wasm32 with
   matching patched headers, ABI and supported optimized build flags. Compare
   the existing `-O2` baseline with an isolated `-O3` variant where appropriate.
   Keep compiler, runtime and final-link changes separate so gains are attributable.
3. If necessary, investigate a narrowly scoped compiler or Flang-runtime
   optimization for the measured case. Fast paths must preserve aliasing,
   non-contiguous arrays, character lengths/padding, allocation and finalization
   semantics. Preserve the generic fallback. Do not modify EnergyPlus's rules
   or dictionary contents to make the workload smaller.

Do not use fast-math or altered numeric behavior as a shortcut. Keep full source,
flags and patch hashes in the recipe/toolchain evidence; introduce new immutable
build IDs and parity receipts. Respect the existing provenance checks rather than
disabling them when replacing runtime objects.

**First decision gate:** does the candidate materially reduce unprofiled native
execution on both small and HVAC cases while preserving outputs? Reject noisy
or incorrect variants. Only then rebuild and validate the other transition edges.
If compilation changes alone are insufficient, document the remaining hot path
before choosing a more invasive approach.

### 3. Address transfer and memory costs where measurements justify it

After the CPU work, inspect remote cold-load cost and memory across a whole
chain. Candidates include sharing verified support bytes by checksum within a
job, content-addressed support assets, bounded look-ahead fetching/compilation,
and effective HTTP compression/caching for immutable artifacts.

Measure each independently. Byte reuse can reduce repeated dictionary downloads
without changing their contents; it does not remove dictionary parsing or array
assignment. Avoid initializing all sixteen runtimes together. Check that completed
step instances and buffers are no longer retained; measure peak memory rather
than assuming garbage collection happens immediately.

Transitions for one model depend on the preceding output and must execute in
order. HTTP cache reuse is different from reusing initialized Fortran state.
Do not reuse one native instance across files or serialize parsed dictionary
state without a separately reviewed lifecycle design: globals, allocatables,
files and error state must remain isolated. Persistent caching of user models
is outside this plan.

Changes here may touch packaging, manifests or worker orchestration; apply the
repository's data-flow/interface approval rule before implementing them.

### 4. Validate and promote the complete result

Any shared runtime change affects all sixteen transitions. Rebuild affected
artifacts and generate new asset-bound validation receipts; old receipts do not
validate new WASM hashes. Reuse existing official models/native intermediate
inputs for manual comparisons, including cases exercising real field changes.

Acceptance requires:

- All affected edges exit successfully with the expected output Version.
  Compare ordered objects/fields and transition audits with unchanged native
  references. Limit normalization to the already justified formatting/numeric
  representation differences; never hide lost or reordered fields.
- Full 8.9 and 9.6 chains produce native-matching upgraded IDFs and epJSON.
  Template-containing direct and upgraded imports retain templates and match
  native **`ConvertInputFormat`**, including downloadable documents.
- Chromium and Firefox conversion still work. Chromium imports/rendering and
  picking pass; any unsupported rendering environment is reported explicitly.
- Cancellation/retry, invalid input, missing assets, hash failures and stale-job
  protection retain the previous model. Verify any path affected by the chosen
  optimization without adding regression tests at this stage.
- Unprofiled full-chain timing shows a repeatable improvement, with cold/cached
  results and memory recorded. Investigate material regressions in another
  browser or input class; do not average them away.
- Existing focused store/parser checks, production build/typecheck and the
  headless render check pass. See [TESTING.md](../TESTING.md) for commands.

Keep the accepted converter and rollback candidate intact until validation
passes. Use the normal installer to promote a complete candidate, then confirm
the installed registry and hashes, produce a local archive and update
`docs/energyplus.md` with measured results and limitations. Do not publish,
commit or push without a separate request.

Hand the candidate to the user for browser acceptance. New regression tests
remain a later stage requiring an explicit request. Report:
`New regression tests: not written; awaiting manual acceptance.`

## Starting point for the next implementation session

First preserve the accepted candidate and remeasure 9.6 → 22.1 on the small and
HVAC inputs with the current application. Then inspect/rebuild the hot Flang
assignment implementation in isolation. Leave the working `ConvertInputFormat`
converter and EnergyPlus transition sources untouched during that experiment.
