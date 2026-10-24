# EnergyPlus browser conversion

## Current delivery status

EnergyPlus 26.1.0 has been compiled with Emscripten 6.0.0 and installed locally.
Candidate `26.1.0-df6b27a725d576fc` converts IDFs in the browser using upstream
conversion code. Its WASM download is 31.3 MB before HTTP compression.

No public release is pinned in `scripts/energyplus/release.json` yet. Generated
artifacts are ignored by Git: a fresh checkout or deployment needs the build
and installation steps below, or a published release pin. Without installed
assets, IDF import reports that conversion is unavailable. epJSON import is
independent of these assets.

### Local validation (2026-10-22)

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

The store calls `src/energyplus/client.ts` only for `.idf` imports. The client
creates a dedicated worker for each job. Worker protocol 2 permits `convert`,
including a declared transition chain when installed; it provides request IDs,
progress, diagnostics, upgraded IDF and source/target/build provenance. Cancellation
terminates the worker, including a synchronous native call. A fresh worker
isolates native global state and failed runs; the browser can cache engine assets.

The worker reads the IDF Version object, resolves an explicit upgrade path from
a protocol-2 registry (or accepts the original protocol-1 converter registry),
then selects the target engine from `registry.json`,
verifies the loader and WASM checksums, loads the modular Emscripten runtime,
and runs the upstream CLI with `--convert-only`. Its filesystem contains only
that job's input and outputs. All model data stays in the browser.

Only complete successful converter output is passed to the existing epJSON
geometry worker. The original source, upgraded IDF, provenance and full epJSON are kept outside
the recentered geometry model. The UI offers both upgraded IDF and epJSON downloads. Conversion logs are separate from geometry warnings
and bounded to 80 entries. The UI retains the displayed model when an import
fails or is cancelled and offers converted epJSON even if geometry loading fails.

Native conversion is stricter than the viewer's lenient epJSON parser. It does
not itself upgrade old IDFs. Installed upstream transitions perform upgrades
before conversion. Neither path runs simulations or macro/template preprocessors.
Models requiring preprocessing must be prepared with the matching native tools.
Missing, duplicate, or unsupported Version objects receive an import error.

## Transition candidates (2026-10-24)

The compiler/runtime ABI repairs and browser/native evidence are documented in
[idf-transition-feasibility.md](idf-transition-feasibility.md). Nine strict-link
candidates cover the explicit 9.6 → 22.1 → 22.2 → 23.1 → 23.2 → 24.1 → 24.2 →
25.1 → 25.2 → 26.1 chain. All nine steps have Chromium/native parity on two
official models and Firefox/native parity on the simple model. The chain is
installed locally; the complete Chromium UI flow and both downloads match
native output. User visual acceptance remains pending.

The local delivery archive is
`.energyplus-build/energyplus-browser-upgrades-26.1.tar.gz`, SHA-256
`258e91d8c62cf3571e93c896cf5c201b87187d07421174ed2c05704c6969664c`.
It includes the unchanged converter, all nine transitions and their validation
receipts. It has not been published or pinned for deployment. Reinstall locally:

```sh
npm run energyplus:install -- .energyplus-build/transition/validated-candidate
```

The original converter-only candidate and registry backup remain available for
rollback. Do not run `energyplus:prepare` with the current null release pin;
that intentionally installs an empty registry.

Build an adjacent edge with the isolated patched toolchain:

```sh
npm run energyplus:build-transition -- <EnergyPlus-source> <Flang-install> 22.1 22.2
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
npm run energyplus:build
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
native `energyplus --convert-only` from exactly the same release. Compare JSON
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

Native version migration now runs before conversion through the installed
transition graph; see [the feasibility results and reproducible build](idf-transition-feasibility.md).
The converter itself remains the original 26.1 build. Older input reaches it
only after the declared upstream transition chain succeeds.

The build targets the full upstream EnergyPlus executable, but the browser
protocol exposes only conversion. A future `simulate` operation can reuse asset
selection, worker isolation, cancellation, original input retention, diagnostics,
and result delivery. It must add explicit weather/supporting-file handling,
progress, simulation outputs, and capability validation. It must not reconstruct
a simulation model from the viewer's geometry. Simulation and preprocessing
support need their own native parity checks before being enabled.

Sources: [EnergyPlus CLI](https://github.com/NatLabRockies/EnergyPlus/blob/develop/doc/running-energyplus-from-command-line.md),
[upstream WASM discussion](https://github.com/NatLabRockies/EnergyPlus/issues/9997),
[Emscripten modular output](https://emscripten.org/docs/compiling/Modularized-Output.html).
