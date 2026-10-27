# EnergyPlus browser conversion

## Current delivery status

Normal IDF imports now preserve their declared version. The pinned inventory covers
19 stable releases across 18 families, from 8.9.0 through 26.2.0, including 9.0.1.
See the [schema and geometry coverage report](epjson-schema-coverage.md) and the
[implementation handoff](epjson-versioned-conversion-handoff.md).

The separate **Upgrade version…** action offers the existing validated 26.1 target
for older IDFs. It produces upgraded IDF and epJSON downloads without changing the
view or original-version downloads. No downgrade/no-op is offered for 26.1/26.2.
The optimized sixteen-edge upgrader and its original embedded-schema converter
`26.1.0-360096b1fc5a6c8d` remain available, with their rollback candidates intact.

Current validation, installation and measurements are recorded in
[versioned conversion delivery](#versioned-conversion-delivery-2026-10-26).
Earlier dated sections below describe their respective historical deliveries.

No public release is pinned in `scripts/energyplus/release.json` yet. Generated
artifacts are ignored by Git: a fresh checkout or deployment needs the build
and installation steps below, or a published release pin. Without installed
assets, IDF import reports that conversion is unavailable. epJSON import is
independent of these assets.

### HVAC-template compatibility (2026-10-24)

`energyplus --convert-only` rejects unexpanded `HVACTemplate:*` objects even
when their version is correct. Upstream `ConvertInputFormat` supports these
objects by default and preserves them in epJSON. The browser build now offers
this utility with `--format-converter`; the CI candidate workflow uses that
option. Omitting it still builds the legacy engine. No simulation or template
expansion is performed, and upstream conversion and transition sources remain
unchanged.

- Chromium and Firefox output matches native `ConvertInputFormat` for official
  `HVACTemplate-5ZonePurchAir`, `HVACTemplate-5ZonePackagedVAV`, `5ZoneAirCooled`
  and `HospitalLowEnergy` inputs. Both template families remain in the output.
- Chromium UI imports/rendering and epJSON downloads pass. Invalid templates
  produce errors while retaining the previous canvas. An original 25.2 template
  model upgrades to 26.1 and renders; both downloads match native output.
- The legacy engine manifest still executes successfully in both browsers.
  All 82 previous converter/transition assets retain their checksums, and all
  sixteen transition edges are unchanged.
- Firefox conversion and UI downloads pass. Rendering could not be validated
  in this headless environment: WebGL2 context creation is disabled, and even
  directly importing the native reference epJSON produces no canvas.
- Existing 35 focused checks, production build/typecheck and Chromium urban-block
  render/picking pass. Existing compiler and Vite chunk-size warnings remain
  visible. No new regression tests were written; adding them requires a separate
  explicit request.

The reported `Building_Two_LoWD4.idf` was unavailable locally; the reproduced
failure and correction use upstream template models. That compatibility fix left
upgrade runtime performance unchanged. Evidence, screenshots and native outputs are under
`.energyplus-build/template-compatibility/`; the new converter also includes
an asset-bound `validation.json` receipt.

The user confirmed that the compatibility fix works. The original plan is in
[the runtime-performance handoff](idf-runtime-performance-handoff.md); the
implemented optimization and measured results are documented below.

The compatibility rollback candidate includes the new converter, the previous engine
for rollback and all sixteen validated transitions:

```sh
npm run energyplus:install -- .energyplus-build/template-compatibility/candidate
```

Archive: `.energyplus-build/energyplus-browser-upgrades-8.9-to-26.1-templates.tar.gz`.
SHA-256: `06db043a17a2c0ff73f73aecc7a608fd18762af2ec30a8e4de3baa60d3641f1b`.
The prior registry is `.energyplus-build/template-compatibility/registry-before.json`;
the previous full candidate remains `.energyplus-build/transition/legacy/candidate`.
Nothing from this correction has been published, committed or pushed.

### Original engine CLI validation (2026-10-22)

- Downloaded browser epJSON matched native EnergyPlus 26.1.0 JSON values for
  upstream `1ZoneUncontrolled.idf`, `5ZoneAirCooled.idf`, and
  `HospitalLowEnergy.idf` (4.63 MB input).
- Chromium and Firefox both converted the five-zone model with matching output
  on the production build served under `/viewer/`, with no page errors.
- Chromium rendered the converted single-zone and hospital models. The existing
  render check also passed on the bundled urban block, including picking.
- Missing/duplicate/unsupported versions and malformed input produced errors;
  native diagnostics were displayed. Cancellation, retry, and retaining the
  previously displayed model were checked in the browser.
- Production build/typecheck and the 35 existing focused store/parser tests passed.

Observed local import-to-display times were approximately 2.1 seconds for the
five-zone model in Chromium, 5.8 seconds in Firefox, and 3.8 seconds for the
hospital in Chromium. These are local-server observations, not download-speed
or memory benchmarks. Mobile/Safari, memory limits, and user visual acceptance
remain unverified. New regression tests: not written; awaiting manual acceptance.

## Runtime boundary

The store calls `src/energyplus/client.ts` only for IDF input. Protocol 3 separates
`convert` from `upgrade`; each operation creates a fresh worker. Cancellation
terminates even synchronous native execution. Conversion detects exactly one
valid Version, selects its pinned full schema and converter, checks asset hashes,
and runs the upstream parser. It never fetches transition assets. Missing,
ambiguous and unsupported versions produce errors without a migration fallback.

Protocol-3 registries bind exact schemas to converter builds and native/browser
validation receipts. Short versions select their `.0` release; explicit patches
must be inventoried. Legacy registries/manifests remain readable for rollback,
but do not restore automatic upgrading. The selected schema is fetched on demand;
direct epJSON loading fetches no conversion assets.

8.9–9.5 use matching-release parsers with a documented template-preservation
adapter; 9.6–26.2 share a schema-selectable 26.1 converter. Their compatibility and
native-reference limitations are explicit in the coverage report. Neither path
runs simulations, template expansion or macro preprocessing.

Complete successful epJSON goes to the existing geometry worker. A pure adapter
resolves Space membership and 26.2 construction inheritance internally. Downloads
and raw inspector objects retain the original data. Core public types and geometry
worker messages are unchanged. Geometry remains lenient, including a warning for
unverified epJSON versions.

Optional upgrades have independent progress, diagnostics, cancellation, results
and ordered transition provenance. Jobs are bound to their source document;
new imports and closing invalidate them. Failure/retry cannot replace the current
model or its original downloads. Native diagnostics remain bounded separately
from geometry warnings. All processing stays in the browser.

## Transition candidates (2026-10-24)

The compiler/runtime ABI repairs and browser/native evidence are documented in
[idf-transition-feasibility.md](idf-transition-feasibility.md). Sixteen validated
upstream transitions now cover this explicit chain:

```text
8.9 → 9.0 → 9.1 → 9.2 → 9.3 → 9.4 → 9.5 → 9.6
    → 22.1 → 22.2 → 23.1 → 23.2 → 24.1 → 24.2 → 25.1 → 25.2 → 26.1
```

Each listed source version starts at its own position in the chain; 26.1 converts
directly. Older-than-8.9 and newer-than-26.1 input is rejected. Source versions
not listed above have no installed path.

The seven added edges have native semantic/audit parity on two official 8.9
models in Chromium and the single-zone model in Firefox. Full Chromium UI runs
from original 8.9 and 9.4 files produce native-matching upgraded IDF and epJSON
downloads and render without page errors. The existing nine transitions and
converter remain byte-for-byte unchanged. User visual acceptance is pending.

The previous extension archive (using the legacy engine converter) is
`.energyplus-build/energyplus-browser-upgrades-8.9-to-26.1.tar.gz`, SHA-256
`6e062f8a57bce665aa63f0f4e7a3f9d30783d136c58df5c18cf040583243c40e`.
It includes the unchanged converter, all sixteen transitions and their validation
receipts. It has not been published or pinned for deployment. Roll back locally:

```sh
npm run energyplus:install -- .energyplus-build/transition/legacy/candidate
```

The previous 9.6-floor candidate remains at
`.energyplus-build/transition/validated-candidate` with its original archive for
rollback. The registry before this extension is preserved in
`.energyplus-build/transition/legacy/registry-before.json`. Do not run
`energyplus:prepare` with the current null release pin; that intentionally
installs an empty registry.

Build and package an adjacent edge with the isolated patched toolchain:

```sh
npm run energyplus:build-transition -- <EnergyPlus-source> <Flang-install> 8.9 9.0
npm run energyplus:package-transition -- <build-directory> <EnergyPlus-source> <LLVM-source> <candidate-directory>
```

Omitting the two versions builds 9.6 → 22.1. Each package contains immutable
loader/WASM hashes, named support-file hashes, upstream source/build provenance,
CLI/output contracts and both license notices. Packaging does not install or
advertise a transition. A protocol-2 registry declares `targetVersion`, the
existing converter entries and explicit `transitions` edges. The installer
requires matching `validation.json` native-parity evidence for each loader,
WASM and support-file set
and complete paths to the target before replacing the registry. Older converter
assets and protocol-1 manifests remain usable and retained for rollback.

Missing chains and newer-than-target files fail explicitly. Each transition has
its own runtime/filesystem, runs unchanged upstream rules, and must produce an
IDF with the declared next Version before conversion can proceed. Cancellation
terminates the owning worker even during synchronous Fortran execution.

## Build and local installation

Use Node 22, CMake, Ninja, Python and the Emscripten version pinned in
`scripts/energyplus/build-config.json`. Activate that Emscripten SDK in the build
shell, then run:

```sh
npm run energyplus:build -- --format-converter
npm run energyplus:install -- .energyplus-build/candidate
npm run dev -- --port 5199
```

The separate `Build EnergyPlus browser runtime` GitHub Actions workflow performs
the build in its own environment and uploads a candidate artifact. It does not
publish the website or promote an engine. Its output can be extracted locally
and passed to `energyplus:install`.

The source tag and expected full commit are pinned together; the manifest
records the resolved full commit. The build includes upstream's embedded schema
from that same checkout. `browser.cmake` isolates browser-specific link options
and schema-generator settings, including compatibility with the bundled fmt
library. The build script adds one guarded platform adaptation: executable-path
discovery returns a virtual filesystem path under Emscripten. The upstream
parser and conversion logic remain unchanged. No IDF field mappings are
maintained in this repository. A build uses a static EnergyPlus API and single-threaded WASM, so it
does not require cross-origin isolation headers on GitHub Pages.

Each generated bundle has a content-derived directory name, loader/WASM SHA-256
hashes, build recipe hash, compiler version, upstream commit, and licence notices.
Generated sources and binaries are ignored by Git. Do not use research models
in a published artifact; any public sample must follow `scripts/anonymize.py`.

## Validation and promotion

Before promoting a candidate, compare its converted epJSON and diagnostics with
native `ConvertInputFormat` from exactly the same release (or
`energyplus --convert-only` for the legacy engine candidate). Compare JSON
values rather than formatting or object-key order. Confirm malformed inputs,
repeat imports, cancellation, unsupported versions, and preservation of the
displayed model. Measure cold loading, memory use and conversion time on a
representative large model. Verify Chromium and Firefox and a deployment under
a subdirectory. Run the existing checks and headless render command in
`TESTING.md`; browser visual acceptance is still required.

Follow `AGENTS.md`: no new tests or fixtures until manual acceptance and an
explicit request. After that stage, conversion parity and lifecycle checks can
become automated release gates.

After validation and authorization to publish, archive the *contents* of the
candidate directory (with `registry.json` at the archive root):

```sh
tar -czf /tmp/energyplus-browser.tar.gz -C .energyplus-build/candidate .
sha256sum /tmp/energyplus-browser.tar.gz
```

Publish it as an immutable release asset. Put its HTTPS URL and SHA-256 in
`scripts/energyplus/release.json`. `npm run energyplus:prepare` downloads that
exact archive, verifies it and each runtime asset, and installs it for Vite.
Deployment runs this preparation before bundling; ordinary site builds never
compile EnergyPlus. With no release pinned it installs an empty registry and
explicitly reports that IDF import is unavailable. A pinned download or checksum
failure stops deployment.

Local `energyplus:install` uses an extracted artifact and does not need a
published release. Do not run `energyplus:prepare` afterward unless you intend to
replace the local registry with the release pin.

## Updating EnergyPlus

1. Update the release tag, expected commit, version, and build revision in
   `build-config.json`; change the compiler pin only when needed.
2. Build the candidate. Any upstream build adjustments belong in the documented
   build adapter, not the viewer or a replacement IDF parser.
3. Complete native-output and browser validation before promoting it.
4. Publish a new immutable archive and update `release.json` in a reviewed change.
   Keep the prior archive to allow rollback by restoring the previous pin.

The registry can list several model versions, each pointing to an immutable
manifest. Combine validated engine directories and entries in a release archive
to retain older version support. A new default must never silently change which
schema converts an older IDF. Upstream build changes may still require work;
the versioned adapter limits where that work occurs.

## Future simulation

Native migration is an explicit optional action through the installed transition
graph; see [the feasibility results and build](idf-transition-feasibility.md).
The current worker exposes conversion and upgrading only. Simulation needs a
separate engine capability, weather/supporting-file handling, progress, outputs
and native parity checks. It must use the complete original model, never rebuild
a simulation input from viewer geometry.

Sources: [EnergyPlus CLI](https://github.com/NatLabRockies/EnergyPlus/blob/develop/doc/running-energyplus-from-command-line.md),
[upstream WASM discussion](https://github.com/NatLabRockies/EnergyPlus/issues/9997),
[Emscripten modular output](https://emscripten.org/docs/compiling/Modularized-Output.html).

## Assignment runtime optimization (2026-10-24)

The Flang build recipe now replaces `assign.o` with the **unchanged** pinned
LLVM 21.1.8 assignment implementation compiled by Emscripten 6.0.0 at `-O2`.
The distribution's assignment bitcode has `minsize`/`optsize` attributes;
requesting `-O2` only at final link does not remove them. The recipe records the
assignment source/object hashes alongside the existing compiler, intrinsic
module, ABI patch, append-position repair and final runtime hashes. Transition
Fortran compilation and final linking remain `-O2`, with `--fatal-warnings`.
No EnergyPlus rules, dictionaries, browser protocol or converter changed.

Three serial, alternating Chromium runs of the 9.6 → 22.1 edge produced these
native-execution measurements (seconds, median with min–max):

| Runtime | Small model | HVAC model |
| --- | ---: | ---: |
| Accepted baseline | 30.55 (30.05–33.25) | 73.27 (68.84–77.02) |
| Rebuilt assignment, `-O2` | 13.91 (13.62–16.49) | 22.91 (20.90–30.64) |
| Rebuilt assignment, `-O3` | 14.83 (14.02–21.61) | 22.75 (22.09–26.39) |

All eighteen outputs were byte-identical to the unchanged native references.
`-O2` was selected because `-O3` showed no consistent additional benefit.
These isolated-edge results are not full-import speedup claims. Diagnostic
harnesses, exact flags, hashes and raw measurements are retained locally under
`.energyplus-build/runtime-performance/`. The earlier CPU profiles remain bound
to the unchanged baseline WASM hash recorded in the performance handoff.

The local candidate reuses the accepted, hash-checked compiler/intrinsic modules
and unchanged Fortran objects, replacing only the assignment runtime object and
relinking every edge. Its evidence retains the original compilation records,
records reused-object hashes and records each new strict link invocation.
The complete source-build recipe in `scripts/energyplus/build-flang.mjs` applies
the same runtime change when rebuilding the toolchain from scratch.

Native validation on 2026-10-25 covers all sixteen new transition hashes in
Chromium and Firefox. Chromium completed both the small and HVAC models from
8.9 and 9.6; Firefox completed both models from 9.6 and the small model from
8.9. Ordered IDF objects/fields and trimmed audit lines match the unchanged
native references. Final epJSON matches native **ConvertInputFormat**; receipts
bind these comparisons to each new loader, WASM and support checksum.

Chromium's upgraded-template UI renders and supports picking. Both UI downloads
match native output in Chromium and Firefox. Chromium also retains its previous
model after cancellation, invalid input, missing assets, checksum failure and a
superseded job; retry succeeds. Firefox still cannot render in this headless
WebGL2 environment, so its downloads/conversion pass does not count as a render
pass. The original private `Building_Two_LoWD4.idf` remains unavailable.

The existing 35 focused store/parser checks, production typecheck/build and
Chromium urban-block render/picking check pass. Vite's default bundled config
loader encounters this environment's read-only `node_modules`; verification
used its supported `--configLoader runner` option (and `--no-cache` for Vitest).
No test files or configuration were changed.

Timing runs use local HTTP serving on a Linux x64 Intel Core i7-1370P, Chromium
149.0.7827.55 and Firefox 151.0. Baseline/candidate jobs run serially with
alternating order, without CPU sampling or competing build/test jobs. Every job
has a fresh worker/native state. HTTP contexts are reused for repetitions;
compiled WASM code may remain cached within a browser process. The interrupted
Chromium run resumed on October 25 with new contexts, which are recorded as cold
rather than mislabeled as cached. Browser versions, input hashes, per-phase
measurements, transfer sizes and artifact hashes are retained with the results.

Memory is the externally sampled sum of browser-process RSS at two-second
intervals, including shared pages and browser caches; it is not a unique-resident
or exact instantaneous peak. An earlier in-worker memory probe was excluded from
final timings because observing weak references could prolong runtime lifetimes.
Remote transfer/compression performance was not measured. The new transition
WASM files total 10,375,486 bytes versus 9,850,145 bytes for the baseline; support
assets and converter bytes are unchanged. No worker orchestration, persistent
model cache or native-instance reuse was introduced.

### Complete conversion measurements and local delivery (2026-10-25)

These are measured complete transition chains **plus final conversion through
output reading**, not sums extrapolated from a single edge. Each row has three
unprofiled runs per variant; seconds are median (minimum–maximum).

| Browser / input | Baseline | Optimized | Median speedup |
| --- | ---: | ---: | ---: |
| Chromium, small 9.6 → 26.1 | 173.07 (165.28–347.49) | 91.21 (72.44–182.51) | 1.90× |
| Chromium, HVAC 9.6 → 26.1 | 362.40 (361.89–495.40) | 133.10 (123.79–145.13) | 2.72× |
| Chromium, template 25.2 → 26.1 | 26.21 (25.73–35.30) | 11.43 (10.68–14.75) | 2.29× |
| Firefox, template 25.2 → 26.1 | 208.71 (203.82–210.95) | 49.49 (36.11–50.31) | 4.22× |

The proposed 2× full-chain target was exceeded for HVAC but not for the small
model. The measured 1.90× small-model result is retained without substituting
an isolated-function or best-run result. Direct 26.1 template conversion uses
the unchanged converter: medians were 0.226/0.240 s in Chromium and 1.000/0.917 s
in Firefox (baseline/candidate), with overlapping ranges.

Single-run 8.9 → 26.1 comparisons were 322.40 → 147.86 s for the small model
and 675.37 → 241.60 s for HVAC in Chromium; these are compatibility/performance
observations, not repeated medians. Firefox's candidate full chains took
407.49 s (small 9.6), 464.32 s (HVAC 9.6) and 569.81 s (small 8.9). Full-chain
Firefox baseline timings were not repeated, so no full-chain Firefox speedup
is claimed. All **43 recorded imports** passed native comparisons.

The reused HTTP contexts did **not** yield cache hits for the large 9.6 chains:
resource timing reported approximately 91.25 MB baseline / 91.55 MB candidate
transferred on each run. Do not describe those repetitions as fully cached
imports. Short template cases did report zero resource-transfer bytes on their
warm repetitions, versus about 15.64/15.67 MB on cold 25.2 imports. The largest
sampled browser-process RSS for complete Chromium chains was 1,499 MiB baseline
and 1,492 MiB candidate; this does not establish a memory optimization.

A separate run of the real application, using the production worker and UI,
reached the two-animation-frame check after canvas creation **71.86 s** after
the upload request for the small 9.6 model. Conversion-worker time was 71.68 s,
geometry-worker time 23.9 ms, and geometry completion to that frame check
107.6 ms. The screenshot was captured after the check. These single UI timings
are separate from the repeated conversion medians above; no production
instrumentation or worker-message changes were added.

The complete candidate was installed with the normal installer. Its registry
and every installed asset checksum were verified, and the production
build/typecheck passed again with the installed assets. Reinstall it with:

```sh
npm run energyplus:install -- .energyplus-build/runtime-performance/candidate
```

Local archive:
`.energyplus-build/energyplus-browser-upgrades-8.9-to-26.1-runtime.tar.gz`.
SHA-256:
`875e2139d4ed1ab9a45ff0b4c82671910f427caae8256ab139678578209f6373`.

The accepted compatibility candidate and its archive remain intact. Roll back
with:

```sh
npm run energyplus:install -- .energyplus-build/template-compatibility/candidate
```

Raw timings, environments, input/artifact hashes, native comparisons, screenshots
and the application timing trace are under `.energyplus-build/runtime-performance/`;
`summary.json` contains the aggregate timings and `parity.json` the 43 import
results. No release pin, commit, push or publication was made. Public types,
worker contracts and application data flow are unchanged.

New regression tests: not written; awaiting manual acceptance.

## Versioned conversion delivery (2026-10-26)

Implemented the version-preserving handoff and installed the candidate locally.
The official release inventory was checked on 2026-10-25: 19 stable releases,
18 families, with separate 9.0.0 and 9.0.1 schemas. Full pins and geometry
compatibility are in [the coverage report](epjson-schema-coverage.md).
The shared schema-selectable converter is `26.1.0-a09a9035d93032ae`;
8.9–9.5 use eight matching-release parser builds. Registry protocol 3 and
conversion-worker protocol 3 separate conversion from optional upgrading.
Core public types and the geometry-worker contract did not change.

### Correctness and browser behavior

- All 76 full native/WASM comparisons passed (four official models per release).
  All 152 corresponding Chromium/Firefox comparisons passed, with zero transition
  requests during normal imports. Receipts bind input, schema, loader, WASM and
  native-reference hashes. Old-release native references use the documented
  template-preservation adapter, not unmodified official template conversion.
- The additional 26.2 ConstructionAssignmentSet example and 9.6 HospitalLowEnergy
  input match native output. The assignment example renders with inherited
  constructions, skylights, operable/fixed windows and doors; picking succeeds.
- In both browsers, the 25.2 template upgrade downloads match the previously
  validated native IDF and epJSON. Original downloads and model identity survive
  cancellation, injected asset failure and retry. New imports and close invalidate
  upgrades. A 26.2 import offers no downgrade. Unknown patches, missing/duplicate
  versions and malformed versions error without fetching transitions. Direct
  epJSON imports fetch no converter/schema assets.
- Existing 68 focused store/parser/rectangle/sample checks pass. Production
  typecheck/build passes. Chromium urban-block and 26.2 assignment render/picking
  checks pass without page errors. Firefox conversion and downloads pass, but
  headless WebGL2 remains unavailable: no Firefox rendering acceptance is claimed.
- Installed registry and all 193 referenced asset checksums were verified.
  No public release pin, publication, commit or push was made. Manual visual
  acceptance remains pending; Safari/mobile and memory limits were not assessed.

Evidence is under `.energyplus-build/versioned-conversion/`: `native-parity.json`,
`browser-parity.json`, `browser-environments.json`, `ui-validation.json`,
`invalid-version-checks.json`, `assignment-reference/`, `hospital-9.6/`,
`performance.json` and `performance-summary.json`. Private models are not packaged.

### Measured imports

Three unprofiled runs per input/cache/browser; Linux x64, Intel Core i7-1370P,
Chromium 149.0.7827.55 (SwiftShader), Firefox 151.0. Each cold run starts a fresh
browser context; its warm partner reuses that context and HTTP cache but creates
fresh native/geometry workers. No builds or other validation jobs ran concurrently.
Inputs are the pinned release's official examples; exact input and runtime hashes
are retained with the evidence. Server responses were uncompressed over loopback.

Times below are seconds, median [min–max]. Chromium measures File.text through
ready plus two animation frames with a canvas; this is an observation proxy, not
a GPU presentation timestamp. Firefox uses ready plus two frames **without a
canvas**, so its times are conversion/UI readiness, not render timings.

| Browser | Release / model | Cold | Warm |
| --- | --- | --- | --- |
| Chromium | 9.6.0 / 1ZoneUncontrolled | 0.612 [0.599–0.630] | 0.579 [0.507–0.639] |
| Chromium | 9.6.0 / HospitalLowEnergy | 1.418 [1.344–2.035] | 1.261 [1.213–1.325] |
| Chromium | 9.6.0 / HVACTemplate-5ZonePurchAir | 0.614 [0.578–0.667] | 0.654 [0.612–0.677] |
| Chromium | 8.9.0 / 1ZoneUncontrolled | 0.662 [0.637–0.695] | 0.589 [0.585–0.605] |
| Chromium | 26.2.0 / 1ZoneUncontrolled | 0.616 [0.555–0.620] | 0.538 [0.526–0.589] |
| Firefox | 9.6.0 / 1ZoneUncontrolled | 1.471 [1.416–1.499] | 1.373 [1.289–1.424] |
| Firefox | 9.6.0 / HospitalLowEnergy | 4.475 [3.909–5.725] | 5.344 [4.384–5.373] |
| Firefox | 9.6.0 / HVACTemplate-5ZonePurchAir | 1.716 [1.715–1.919] | 1.852 [1.420–1.991] |
| Firefox | 8.9.0 / 1ZoneUncontrolled | 1.602 [1.440–1.718] | 1.558 [1.474–1.604] |
| Firefox | 26.2.0 / 1ZoneUncontrolled | 1.809 [1.732–1.904] | 1.474 [1.390–1.978] |

Cold conversion assets transferred 11,219,041 bytes for 9.6, 10,405,279 for 8.9
and 11,900,352 for 26.2 (including registry/manifest). Firefox warm runs transferred
zero asset-body bytes. Chromium warm runs fetched the large schema again:
9,903,021 bytes for 9.6, 9,789,090 for 8.9 and 10,584,332 for 26.2. These are server
body-byte observations, excluding HTTP headers, app assets and compression; warm
does not mean every asset was served from cache. See raw records for each run.

For the Chromium cold 9.6 small model, phase medians in milliseconds were file
reading 3.8, version detection 0.5, registry/manifest 9.7, assets plus verification
99.1, WASM initialization 11.6, conversion/output reading 287.9, output JSON parse
0.2, geometry worker dispatch-to-result 17.3 and ready-to-two-frames 11.3. The
remaining main-thread/startup/delivery gap was 174.9 ms. Phase medians need not sum
to the total median. Per-asset fetch and hash spans are parallel detail within
the assets phase, not additional additive stages. Geometry timing includes worker
startup/JSON parsing and transfer, not just triangulation. Memory was not profiled.

Optional upgrading remains expensive. The separate 25.2→26.1 UI retry took
18.28 s in Chromium (17.84 s transition) and 79.04 s in Firefox (77.66 s transition).
These are single functional runs, not repeated performance medians; their cache
state includes earlier cancellation/failure. Each transition and final conversion
phase is recorded separately. The historical sixteen-edge upgrade measurements
above remain valid historical evidence, not estimates for direct conversion.

### Build, install and rollback

Use the pinned Emscripten 6.0.0 SDK and existing build prerequisites. These commands
assemble candidates, without changing the installed registry until the final step:

```sh
python3 scripts/energyplus/fetch-schemas.py .energyplus-build/versioned-conversion
source .energyplus-build/emsdk/emsdk_env.sh
npm run energyplus:build -- --schema-converter
# Repeat for v8.9.0, v9.0.0, v9.0.1, v9.1.0, v9.2.0, v9.3.0, v9.4.0, v9.5.0:
python3 scripts/energyplus/build-legacy-parser.py .energyplus-build/versioned-conversion v8.9.0
python3 scripts/energyplus/validate-schemas.py .energyplus-build/versioned-conversion --native-library-path .energyplus-build/native-libs/usr/lib/x86_64-linux-gnu
python3 scripts/energyplus/package-schemas.py .energyplus-build/versioned-conversion .energyplus-build/runtime-performance/candidate
# Perform Chromium/Firefox parity validation and bind browser-parity.json receipts,
# then rerun package-schemas.py. The installer rejects missing/mismatched evidence.
npm run energyplus:install -- .energyplus-build/versioned-conversion/candidate
```

The native library override is needed only for the official 24.2/26.1 binaries on
this host. Do not apply it indiscriminately: some older CLI versions misinterpret
the loader's arguments. Legacy native builds use g++; browser builds use Emscripten.
Pinned upstream source hashes and adapter hashes are retained in manifests. A
shared runtime is permitted only after complete matching-release parity passes.

Archive: `.energyplus-build/energyplus-browser-versioned-8.9-to-26.2.tar.gz` (43,333,424 bytes). It contains only
registry-referenced validated runtimes, schemas and receipts; exploratory builds
remain outside the archive. SHA-256:
`c8f0fb11dc65d980d01663107c177205aee4412912e29a8374f9c3b6f6f971ed`.

The previous registry is preserved at
`.energyplus-build/versioned-conversion/registry-before.json`. To restore the
previous optimized assets:

```sh
npm run energyplus:install -- .energyplus-build/runtime-performance/candidate
```

This is an **asset rollback**: with the new application code it restores direct
26.1 conversion availability, not the old mandatory-upgrade behavior. Restoring
that older behavior also requires the previous application code. The earlier
compatibility candidate remains available as documented above. Do not run
`energyplus:prepare` while the release pin is null; it installs an empty registry.

New regression tests: not written; awaiting manual acceptance.
