# Native IDF transition feasibility

## Status (2026-10-24)

The three runtime signature mismatches are repaired in the isolated Flang
compiler build. Strict linking with `--fatal-warnings` succeeds. The unchanged
upstream 9.6 → 22.1 transition now executes successfully in a Chromium worker:
55 objects from `1ZoneUncontrolled` and 529 from
`PythonPluginCustomOutputVariable` match the official native output semantically;
both `Transition.audit` files match. Firefox also passes the simple model
(282 seconds locally versus 26 seconds in Chromium after optimized linking).
Evidence: `.energyplus-build/transition/chain-parity/` (the earlier first proof
is retained in `browser-parity/append-repair/`).
These models do not establish coverage of every changed migration rule.

The working 26.1 converter is unchanged. All nine transitions are installed
locally with a protocol-2 registry targeting 26.1. The worker preserves upgraded
IDF and provenance and exposes both IDF/epJSON downloads. The geometry worker
contract remains unchanged. Nothing has been published, committed or pushed.

## Demonstrated native behavior

Using the official EnergyPlus 26.1 distribution's
`PreProcess/IDFVersionUpdater/Transition-V9-6-0-to-V22-1-0`, the official 9.6
`1ZoneUncontrolled.idf` upgrades successfully (exit 0, output Version 22.1).
The reference run lives in `.energyplus-build/transition/native-9.6/`.

Run from a private working directory with these files:

- `input.idf`
- `V9-6-0-Energy+.idd`
- `V22-1-0-Energy+.idd`
- `Report Variables 9-6-0 to 22-1-0.csv`

Invoke the executable with `input.idf` as its first argument. Defaults are
`FULL YES YES`: full output, units included, incoming blanks preserved. It writes
`input.idfnew`, `input.idfold`, `Transition.audit`, and `Energy+.ini`. The native
run here needed no alternate dynamic loader. Support files are resolved from
the working directory unless the INI supplies a program directory.

The entry point uses command arguments, environment variables, formatted file
I/O and INQUIRE. The shared library uses allocatable arrays. Consequently a
numerical-only Fortran WASM demonstration is insufficient. Native success on
this simple sample does not establish parity for changed object layouts, error
handling or a complete upgrade chain.

## Compiler evaluation and observed blocker

The evaluated [Flang distribution](https://github.com/miinso/flang-releases/tree/v21.1.8)
provides a wasm32 Fortran runtime and documents Emscripten linking. Its pinned
Linux archive and release metadata are recorded in
`scripts/energyplus/transition-config.json`; the downloaded archive's SHA-256
matched the publisher's release metadata. This is a third-party LLVM build,
not an official EnergyPlus artifact. The upstream compiler/runtime use the
[Apache 2.0 licence with LLVM exceptions](https://github.com/llvm/llvm-project/blob/llvmorg-21.1.8/LICENSE.TXT);
any eventual package must include applicable notices alongside EnergyPlus's.

All thirteen required upstream Fortran files compiled without source changes
using Flang 21.1.8, `--target=wasm32-unknown-emscripten -c -O2`.
Linking with the supplied `libflang_rt.runtime.wasm32.a` and Emscripten 6.0.0
reported these incompatible signatures:

| Runtime symbol | Supplied runtime | Generated transition |
| --- | --- | --- |
| `_FortranAAllocatableSetBounds` | `(i32,i32,i32,i32) → void` | `(i32,i32,i64,i64) → void` |
| `_FortranAioInquireCharacter` | `(i32,i64,i32,i32) → i32` | `(i32,i32,i32,i32) → i32` |
| `_FortranAioInquireLogical` | `(i32,i64,i32) → i32` | `(i32,i32,i32) → i32` |

These columns were corrected during the follow-up investigation by inspecting
the runtime archive's LLVM bitcode and Flang's emitted LLVM IR directly. The
original interpretation of the LTO linker diagnostics had the two sides reversed.

The problem also affects descriptor layout, which the linker cannot check.
Flang's host-reflected `DescriptorModel.h` emits 64-bit `elem_len` and dimension
fields on the Linux x86-64 host. The wasm32 runtime uses 32-bit `size_t` and
`CFI_index_t` (`ptrdiff_t`). For example, the runtime reads rank at byte 12 and
dimensions at byte 16, while the original generated descriptor has a 64-bit
element length and different offsets. A three-symbol wrapper alone is therefore
insufficient.

The derived-type addendum also needs explicit layout. The wasm32 C++ layout
dump places `DescriptorAddendum::derivedType_` at offset 0 and its 64-bit `len_`
array at offset 8 (size 16). The runtime appends that block immediately after
the dimensions. Flattening the pointer and length array as independent LLVM
struct fields loses its four padding bytes for odd ranks. The compiler patch
preserves that padding and zero-initializes the complete length-field block.
The C++ layout evidence is in
`.energyplus-build/transition/runtime-layout.txt`.

The distribution's `RTBuilder.h` cross-compilation patch narrows `unsigned long`
as if every occurrence were `size_t`; on this host `uint64_t` has that same C++
type. This incorrectly narrows `InquiryKeywordHash`, which upstream defines as
`uint64_t`. Conversely, the signed host `ptrdiff_t` used for allocation bounds
remains 64-bit. The follow-up compiler experiment corrects these semantic
parameter types and descriptor element-length/dimension fields at code generation,
without changing EnergyPlus sources or the supplied wasm32 runtime. Its isolated
source and build are under `.energyplus-build/transition/llvm-project-llvmorg-21.1.8/`
and `llvm-build/`; browser parity is still required before adoption.

Additional repairs were needed beyond the linker signatures:

- Descriptor field extraction and loads now use the actual target field type,
  then extend to the requested index type. Loading 64 bits from a 32-bit field
  consumed adjacent descriptor data.
- Frontend derived-type sizing uses wasm32 descriptor sizes and pointer
  alignment. ObjectDef's emitted element size and runtime metadata now agree
  at 724 bytes, instead of metadata claiming 848 bytes.
- The internal `__fortran_builtins` and `__fortran_type_info` modules are generated
  for wasm32. C_PTR addresses must have kind 4; host-built modules used kind 8.
- Flang runtime append positioning used `INT64_MAX - 2` as an unknown record
  number. Upstream opens `audit.out` with `POSITION='APPEND'`; writing both IDDs
  overflowed the counter, then REWIND captured a negative endfile record and
  the next WRITE aborted. Instrumentation recorded record
  `-9223372036854565924` before rewind. The repair leaves half the integer range
  available for appended records, consistent with the runtime's `Sought()`.
  It does not suppress the runtime error or alter transition source.

The native CLI replaces `input.idf` with the upgraded file. Browser comparisons
must use its preserved `input.idfold` (Version 9.6), not the replaced input.
Semantic comparison covers all ordered objects/fields, ignoring comments and
numeric formatting. Native application stdout matches; Emscripten additionally
reports its ordinary exit-status/keepRuntimeAlive message.

Allowing linker warnings produced a module, but invoking `callMain(['input.idf'])`
trapped with `RuntimeError: unreachable` in Node and dedicated Chromium/Firefox
module workers. Each worker mounted the real IDDs, CSV and input in MEMFS;
after the trap only the four mounted inputs existed. Browser observations are
saved in `.energyplus-build/transition/{chromium,firefox}-feasibility.json`.
The failing experimental module remains in `wasm-9.6/` there, never in `public/`.

The production build adapter treats linker warnings as errors so these trap
stubs cannot be mistaken for a successful candidate. This finding establishes
failure of this exact compiler/runtime combination, not that Fortran in a
browser is impossible. No EnergyPlus field mappings or migration rules were
rewritten to work around it.

[LFortran](https://lfortran.org/) also provides a WASM backend and uses a BSD
licence, but documents incomplete third-party-code coverage. Its
[browser documentation](https://docs.lfortran.org/en/jupyterlite/) describes
running the compiler itself in a browser; that is not evidence that this
transition's formatted I/O and allocation behavior works. LFortran was not
compiled or validated against this transition in this milestone.

## Reproduce the build

### Compiler repair experiment

`scripts/energyplus/flang-wasm32.patch` combines the pinned distribution's
wasm32 support patch with explicit target-width allocation bounds, fixed-width
inquiry hashes, and target-width descriptor fields. It modifies only LLVM/Flang
compiler sources. LLVM's Apache 2.0 licence with LLVM exceptions applies.
The pinned runtime archive is copied and its `external-unit.o` member replaced
with a source-built append-position repair (`flang-runtime-append.patch`). The
original archive, patch, replacement object and resulting archive hashes are
recorded independently.

The separate Linux-host recipe verifies the LLVM source tarball and runtime
archive hashes before building. It requires CMake, Ninja, GNU gold, and the pinned
Emscripten SDK's host Clang. Download `llvmSourceUrl` from
`scripts/energyplus/transition-config.json`, then run:

```sh
source .energyplus-build/emsdk/emsdk_env.sh
PATH="$PWD/.energyplus-build/tools:$PATH" EPLUS_BUILD_JOBS=4 \
  npm run energyplus:build-flang -- \
  .energyplus-build/transition/llvm-project-21.1.8.tar.gz \
  .energyplus-build/transition/flang/flang+llvm-21.1.8
```

The recipe writes a separate toolchain install directory and `toolchain.json`;
it does not overwrite the downloaded compiler or the converter SDK. Its status
is deliberately `compiled-unvalidated` until transition execution and parity
have been demonstrated. The initial local experiment uses the equivalent
incremental CMake build in `llvm-build/`; the packaged recipe has not yet been
run end-to-end.

### Original transition build

The separate adapter does not modify the converter checkout or install assets.
It verifies the upstream commit and each compiled file against Git, checks
compiler versions, records compiler/runtime hashes, and builds into a fresh
directory. Each attempt writes commands, diagnostics and status to
`build-evidence.json`, including on failure.

Download the exact compiler archive URL in `transition-config.json`, verify
its SHA-256, and extract under `.energyplus-build/transition/flang/`. With the
existing pinned EnergyPlus source and Emscripten SDK:

```sh
source .energyplus-build/emsdk/emsdk_env.sh
npm run energyplus:build-transition -- \
  .energyplus-build/26.1.0-1/source \
  .energyplus-build/transition/flang/flang+llvm-21.1.8
```

Expected current result: compilation succeeds, strict linking fails on the
signatures above, process exits nonzero. Even a future successful link is
labelled `compiled-unvalidated`; it does not emit a deployable manifest.

## Chain implementation and validation

All nine adjacent transitions through 26.1 compile and link with
`--fatal-warnings` and optimized Emscripten linking; all nine link diagnostics
are empty. No EnergyPlus Fortran sources or migration rules were modified.

- Chromium: both official models pass all nine steps sequentially, comparing
  every ordered object/field and the audit against the official native chain.
- Firefox: the simple model passes all nine edges. The first edge starts with
  the original 9.6 file; later edges independently use matching native
  intermediate inputs. A complete Firefox UI chain and the plugin model have
  not been checked.
- The plugin model exercises actual field changes in Sizing:Zone, cooling coils,
  People and monthly reports on later edges. This is not exhaustive rule coverage.
- Production UI under `/viewer/`: the complete 9.6 → 26.1 → epJSON run renders;
  downloaded upgraded IDF and epJSON match native outputs. Same-version import
  bypasses migration. Missing assets, missing/duplicate/future Version errors
  preserve the scene. Cancellation followed by successful retry passes.
- Existing 35 store/parser checks, production build/typecheck and urban-block
  render with picking pass. No page errors were reported. Vite's existing
  chunk-size warning remains visible.

Evidence directories under `.energyplus-build/transition/`:

- `native-chain/{simple,plugin}/`: official native outputs and diagnostics.
- `chain-parity/{chromium,firefox}/`: browser outputs and per-edge comparisons.
- `ui-acceptance/`: production UI results and `upgraded-viewer.png`.
- `validated-candidate/`: installed immutable manifests, runtime/support assets,
  license notices, build evidence and asset-bound native-parity receipts.
- `converter-only-registry.json`: prior registry retained for rollback.
- `final-worker-validation.json`: final production worker checks for 25.2 →
  26.1 and same-version input, including converter and transition provenance.

Worker protocol 2 resolves complete declared upgrade paths, checks every output
Version, preserves source/target/transition/converter provenance, then uses the
unchanged converter. Protocol-1 converter manifests/registries remain usable.
The installer verifies all candidate hashes, native-parity receipts and paths
before changing the public registry; prior converter assets are retained.

### Performance and remaining acceptance

The local simple-model Chromium chain took approximately 389 seconds in the
per-step experiment. Individual steps took 26–55 seconds. The first Firefox
edge took 282 seconds; the remaining Firefox edges took about 463–470 seconds
each while running concurrently. Initial 180-second Firefox limits timed out;
the longer runs completed with parity. These are machine/load-specific timings,
not general browser benchmarks. Imports remain cancellable throughout.

Runtime/support assets total 116,630,836 bytes before HTTP compression;
separate gzip compression totals 19,664,536 bytes. This is a size estimate,
not a measured cold network transfer. Browser-wide memory, mobile/Safari and
large urban IDFs have not been measured. The packaged compiler recipe was not
rebuilt from scratch end-to-end; equivalent incremental compilation was used,
and both source patches apply cleanly with `--fuzz=0` to the pinned archive.

An early render check could not reach a separately launched dev server;
launching the static server and browser together passed. One intermediate
Firefox process was terminated; completed reruns supply the evidence above.

User visual acceptance is pending. No new regression tests, commits, pushes or
sub-agents were used. New regression tests: not written; awaiting manual acceptance.
