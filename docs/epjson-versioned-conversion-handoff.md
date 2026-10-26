# Handoff: version-preserving epJSON conversion and optional upgrades

Updated: 2026-10-25. Planning document only. Writing this handoff does not
implement or authorize the application changes below.

## Outcome and current baseline

Make normal IDF imports preserve the source version instead of upgrading every
model to the current converter version before it can be viewed:

**Read IDF → detect version → convert with its matching schema → normalize
geometry → visualize.**

Support every officially released stable epJSON schema, sharing geometry
adapters wherever equivalence is verified. Retain the existing official upgrade
pipeline as a separate, optional in-app action that produces downloads without
replacing the displayed model.

Preserve the complete original document and complete converted epJSON, including
HVAC templates and non-geometric content. Geometry normalization is an internal
viewer concern; it must not rewrite the downloadable model into another version.
All processing remains in the browser.

The current application supports IDFs from 8.9 through 26.1 by running adjacent
transitions to 26.1, then converting with upstream `ConvertInputFormat`. The
optimized assignment runtime is installed for all sixteen transition edges;
the selected converter remains `26.1.0-360096b1fc5a6c8d`.

Measured optimized Chromium 9.6 imports still take approximately **91.21 seconds
for the small model and 133.10 seconds for the HVAC model**, as medians of three
complete transition-plus-conversion runs. A separate application run took
71.86 seconds to a two-animation-frame check after canvas creation; geometry
processing took 23.9 ms. These measurements establish the upgrade bottleneck,
not the future performance of matching-version conversion.

See [the current runtime measurements and delivery status](energyplus.md#complete-conversion-measurements-and-local-delivery-2026-10-25).
Raw evidence is under `.energyplus-build/runtime-performance/`, including
`summary.json`, `parity.json` and `ui/application-timing.json`. Initial file
reading was not independently isolated in the existing application measurement;
the frame check is not a GPU presentation timestamp.

The [earlier runtime-performance handoff](idf-runtime-performance-handoff.md)
remains historical context. This proposal changes the default import workflow;
further acceleration of the mandatory full upgrade chain is no longer the
primary approach. Keep the optimized upgrader and its rollback artifacts.

## All schemas, with separate conversion and geometry compatibility

The first production JSON input release was
[EnergyPlus 8.9](https://github.com/NatLabRockies/EnergyPlus/releases/tag/v8.9.0).
The latest stable release verified for this handoff is
[EnergyPlus 26.2](https://github.com/NatLabRockies/EnergyPlus/releases/tag/v26.2.0).
Recheck the official release inventory when implementation begins and record
the inventory date. Do not silently limit conversion support to the installed
26.1 engine.

The initial inventory must cover these **18 release families**:

- 8.9;
- 9.0, 9.1, 9.2, 9.3, 9.4, 9.5 and 9.6;
- 22.1 and 22.2;
- 23.1 and 23.2;
- 24.1 and 24.2;
- 25.1 and 25.2;
- 26.1 and 26.2.

Audit patch releases as well. The family list is not evidence that all patch
schemas have already been inspected. For each official stable release, record
its tag, source commit, schema source and checksum, converter compatibility,
geometry family and validation status. Record any aliases and the evidence for
them. No release may disappear from the coverage matrix because its schema is
inconvenient to obtain or build. Pin the resulting inventory and assets rather
than discovering or downloading an uncontrolled "latest" release at runtime.

Maintain two independent compatibility mappings:

| Mapping | Purpose | Condition for sharing |
| --- | --- | --- |
| Source version → full schema and converter | Preserve complete IDF-to-epJSON conversion, including positional fields and extensible objects | Full conversion compatibility established against matching-release native output |
| Source version → geometry adapter family | Read supported geometry into the existing viewer model | Consumed fields, defaults, references, extensible layouts and coordinate semantics verified equivalent |

Similar geometry does **not** justify merging full conversion schemas. IDF field
positions and non-geometric object structures can differ independently. Keep
exact version-specific schemas unless full equivalence is demonstrated;
deduplicate identical schema assets when possible. Geometry adapters may be
shared across more versions, with explicit exceptions for real differences.

Compare every geometry object and field consumed by the parser, including
building/zone transforms, detailed and rectangular surfaces, fenestration,
shading, air boundaries and grouping references. Schema structure alone is not
sufficient if upstream coordinate behavior or defaults changed.

Fetch only the selected conversion assets on demand. Opening an epJSON directly
must not require downloading full conversion schemas or transition runtimes.

## Implementation sequence and interface changes

1. **Inventory and compare.** Produce the complete schema coverage matrix and
   geometry compatibility report before assigning shared adapter families.
2. **Prove matching-schema conversion.** Evaluate a shared upstream EnergyPlus
   parser/WASM runtime that accepts the selected full schema. The currently
   installed converter embeds 26.1's schema; adding schema files beside it does
   not make it version-aware. Do not implement a replacement handwritten IDF
   parser or bypass version checks while retaining the wrong schema.
3. **Gate runtime reuse on native parity.** Start with 8.9, 9.6 and the latest
   release, then verify every inventoried version against a matching-release
   native conversion reference. Use a matching-release converter for any
   version that fails the shared-runtime gate. Preserve HVAC templates and all
   model content; conversion must not invoke simulation or template expansion.
4. **Normalize geometry internally.** Implement verified adapter families in
   pure TypeScript around the existing parser. Keep original epJSON intact.
   Preserve existing core model types and geometry-worker messages unless a
   demonstrated requirement makes a change necessary.
5. **Separate conversion from upgrading.** Make matching-version conversion the
   default operation and retain transitions behind an explicit upgrade request.
   Verify the complete inventory before describing the result as supporting all
   released schemas.

Trace the real entry point and dependencies before implementation. The expected
responsibility boundaries are:

- `src/energyplus/`: registry/schema selection, converter and transition asset
  loading, worker execution, progress, cancellation and provenance. Introduce
  explicit `convert` and `upgrade` requests rather than treating `convert` as
  permission to migrate to the registry target.
- `src/energyplus/types.ts`: distinguish conversion provenance (source version,
  selected schema and converter build) from upgrade provenance (source, target
  and ordered transition steps). Version the worker contract consistently with
  its client. Preserve existing artifact-manifest compatibility for the
  retained upgrader; a legacy manifest must not restore automatic upgrading.
- `src/stores/model.ts` and `src/components/ImportStatus.vue`: preserve original
  and converted documents, expose the optional action and manage independent
  upgrade jobs/results without replacing the current view.
- `src/core/parse.ts` and any required pure helper: version-aware geometry
  adaptation. Preserve the rendering and geometry contracts in
  [AGENTS.md](../AGENTS.md), including coordinate signs, recentering, shared hole
  arrays, merged meshes, picking and lenient parsing.
- `scripts/energyplus/`: reproducible schema/converter packaging, hashes,
  version mappings and native-validation evidence for the new assets.

Before changing production code, state exact files and responsibilities and
obtain the approval required by AGENTS.md for data-flow, worker-contract, public
core-type or module-boundary changes. This handoff is not that approval.

Missing, ambiguous or unsupported IDF versions must produce a clear conversion
error without silently selecting the newest schema or starting an upgrade.
Existing lenient epJSON loading remains available, with appropriate warnings
for unverified versions; do not add hard failures for otherwise loadable data.

## Optional upgrade action

The selected product behavior is an **in-app "Upgrade version…" link** with
**downloads-only results**:

- Show the action for a loaded IDF when a validated transition path leads to a
  newer supported target. Display the target before the user starts the job.
- Run transitions only after this explicit action. Normal imports must fetch
  and execute zero transition assets, including speculative prefetching.
- Retain the optimized official adjacent transition chain, source dictionaries,
  strict linking, asset checksums and native-validation requirements.
- Keep the current visualization, original input and original-version epJSON
  download intact. Provide upgraded IDF and epJSON as separately named
  downloads, with diagnostics and ordered transition provenance.
- Give upgrades independent progress, cancellation and result state. Bind every
  job/result to its source document. Starting a new import or closing the active
  document cancels or invalidates its upgrade; late messages must not attach
  results to another model.
- Failure or cancellation must preserve the current model and original
  downloads. Retrying must start with fresh native worker state.

Two unconfirmed choices use explicit defaults: **IDF inputs only** and the
existing validated **26.1 upgrade target**. Direct conversion and viewing still
cover 26.2. Do not offer a downgrade or a no-op upgrade for 26.1/26.2 inputs.
Adding epJSON-to-IDF round trips or a 26.1 → 26.2 transition is separate work.

## Validation, delivery and boundaries

Validation must distinguish conversion correctness, geometry compatibility,
optional upgrade behavior and measured performance:

- Compare complete converted epJSON with matching-release native references for
  every supported schema version. Cover HVAC templates, extensible objects and
  non-geometric fields, not just a geometry subset. Bind receipts to exact
  input, schema, loader and WASM hashes.
- Exercise every geometry family and version-specific exception. Check surface
  placement, coordinate systems, shading, fenestration, grouping and picking.
- Confirm supported normal imports fetch and execute **zero transition assets**.
  Unsupported versions must not trigger a hidden upgrade fallback.
- Check optional-upgrade downloads against native output. Exercise cancellation,
  failure, retry and superseded jobs while preserving the active view and
  original downloads.
- Measure file reading, version detection, asset fetching/hash verification,
  WASM initialization, conversion/output reading, JSON parsing, geometry
  construction and first-frame observation. Separately record optional upgrade
  stages and each transition. Include total elapsed time and any unattributed
  gaps rather than presenting overlapping timings as additive.
- Record input/artifact hashes, browser/hardware, transfer sizes and genuine
  cold/warm-cache conditions. Use repeated unprofiled runs for representative
  small, HVAC-heavy and template models; report medians and ranges. Label
  first-frame proxies and sampled memory limitations. Do not promise a speedup
  by extrapolating direct 26.1 timings to other versions.
- Run existing focused checks, typecheck/build and the required headless render
  pass using [TESTING.md](../TESTING.md). Report any browser/rendering limitation
  honestly. Obtain manual browser acceptance before regression-test lock-in.

Do not create or modify tests, fixtures, helpers or test configuration without a
separate explicit request. Include this status in the implementation handoff:

**New regression tests: not written; awaiting manual acceptance.**

Keep current candidates and evidence available for rollback. Installation,
archive checksums and rollback commands are in [energyplus.md](energyplus.md).
Do not run `energyplus:prepare` while the release pin is null; it installs an
empty registry. Validate new candidates before replacing installed assets.

"All schemas" means official stable releases, including distinct patch schemas;
experimental/prerelease formats are excluded. Support below 8.9 remains a
separate extension: if added later, transition only to the earliest supported
epJSON version before converting. Do not imply those older transition binaries
already exist in this application.

No server conversion, simulation, geometry-only conversion, publication,
commits, pushes or sub-agents are included in this handoff task. Keep private
models and generated evidence out of public artifacts. Recheck the worktree and
read the relevant [architecture sections](../ARCHITECTURE.md) before starting
implementation; preserve intervening user changes.
