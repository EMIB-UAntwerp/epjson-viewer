# Versioned epJSON conversion coverage

Inventory: **2026-10-25**, from all official non-draft, non-prerelease GitHub releases at or above 8.9.0. There are **19 releases across 18 families**, including both 9.0 patches. Source commits, official archive URLs and SHA-256 hashes, full schema hashes, and build-source hashes are pinned in [`schema-releases.json`](../scripts/energyplus/schema-releases.json). No runtime release discovery is used.

The schema source for every row is `Energy+.schema.epJSON` from its pinned official Linux release archive. Generated schemas used during initial investigation are not substituted for these release artifacts.

| Release | Source commit | Full schema SHA-256 | Converter | Geometry |
| --- | --- | --- | --- | --- |
| 8.9.0 | `40101eaafd1525ee63406264ae9535f25acf4805` | `cfd3f96f5b80b9df7179e933b1ab21279153431bd88145f5c5e96ad4857f5a21` | Matching-release parser | Common transforms |
| 9.0.0 | `2ef880da82464ecfcea7d29b349f6261f41682a9` | `cbd966193a9396206834e565db1448a8201ad3a424fd05c5c07ca237ff06a1d0` | Matching-release parser | Common transforms |
| 9.0.1 | `bb7ca4f0da377b9f33f4e2669fd2268650344c63` | `c2d83af62ace702534eca64e4aec38fe1090c671d47ab70d0a582e8830ca6e88` | Matching-release parser | Common transforms |
| 9.1.0 | `08d2e308bbff3894972dd4e7000364ed3cc17eff` | `8c2716f3df78f9a798743ef01bafbfe6125ff4ac05df531861890357cbf6f7c1` | Matching-release parser | Common transforms |
| 9.2.0 | `921312fa1d0c9e6fe1c1f2d10ee3bf066895b85e` | `b673261f2128a36e9e3cdd61294d1a394364d2299ead217996c043983df04cf3` | Matching-release parser | Common transforms |
| 9.3.0 | `baff08990c9c4d12d8bbde0378073018a3ea6acf` | `0a7f1a1ee78e5e1169856b1801a84a85b8f4768f08ef1996965585137aa83416` | Matching-release parser | Common transforms |
| 9.4.0 | `998c4b761e86d9e6962e90d6167296d7e94f393d` | `d2c200244de5a7c5bd3f0698dffbe84e523b884180014817dc873c30cd17472d` | Matching-release parser | Common transforms |
| 9.5.0 | `de239b2e5f504e381ef4f296893ef93ce5410215` | `4ebd018c69cb2d44bd74e142b2debb0f33bd55892c4aa2e0c6bf889039491cd3` | Matching-release parser | Common transforms |
| 9.6.0 | `f420c06a69737dddcf4ba740ad855b45a03a8ef3` | `7884a92808c92cc5bb8f91278c6954a14c0d283ec99355607918a9153cf5cdd4` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 22.1.0 | `ed759b17eef57ce5c55f8963e4b4e209f405158e` | `3629a64e2483d56a2cd11555554879eefe5d3811ba6d92e70b7b81c9434fe30f` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 22.2.0 | `c249759bad26d4b4f4badab0062643276c7cc2bf` | `18a4b2feb73e647ef0ef5bf221d608b839ad037076fe00575f235186952946f6` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 23.1.0 | `87ed9199d49e60b2e95f3927ed372ffb57ba9417` | `5983ae72b938474c23ef67d58333c70315f6f4c86787a5be1fd5c72efa6a3d57` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 23.2.0 | `7636e6b3e972dad33c41815304938b2139dde367` | `e4bfd3d67d8a4f58d560f83fc2b6ff1de86b755967ce4423aaa90e45c830828e` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 24.1.0 | `9d7789a3accef2ed968a6198a90b6218206340e5` | `d94276ce43d7673d752392f1d1fbc0f66884700ecbbba12d50bfa5f8c709bc72` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 24.2.0 | `e7ecb2d53b6b2f4666bf5a56fc9b3ba35cf34190` | `8d1739e035a49f204ad8560f15a6eb909c23dead4292bc5bb155b62bf7c44047` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 25.1.0 | `68a4a7c7744c380886913a92e061aba3d4a3fc54` | `3a35da40514f6f62da2f413c2e123ea35c9623141dab3d5c044078db1f08dbc9` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 25.2.0 | `cf7368216c73c43181e057fa33b479c4e0c86df0` | `256211b0a756913383254d986c12dcc476294098a7bd4bf524d029facfab6f36` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 26.1.0 | `6f2e40d10250a105b49966baa24d843711e61048` | `03e45cb8e8485155787a0df663868a6fd6690c04f639cbfc3c2ca8c61427638e` | Shared 26.1 parser, selected full schema | Common transforms + Spaces |
| 26.2.0 | `4bd7a1f26fb749a83257855aba6760e26c8a3c8f` | `e2062595d6245c76092c1047e778603e85ee043009582d05d8c67a7c850cb782` | Shared 26.1 parser, selected full schema | Common transforms + Spaces + assignments |

## Conversion compatibility

Conversion and geometry have separate mappings. 8.9–9.5 use their own upstream parser and schema validator. The shared parser failed the old-release gate because blank-object naming changed. These releases also reject/discard templates in their parser; the build adapter removes exactly that preprocessing gate so the unchanged schema-driven object parser can preserve templates. It does not expand them. Native references for these releases are independently compiled native versions of the matching source with the same documented preservation adapter. They are **not** described as unmodified official ConvertInputFormat output.

The older build also makes two JSON-to-string conversions explicit for modern libc++; no field mapping or parsing algorithm is replaced. Matching RE2, JSON and validator sources are pinned. The 9.5 fmt adapter replaces generic character-trait length with equivalent code-unit counting for modern libc++; all legacy builds use C++11.

For 9.6–26.2 the shared runtime uses upstream 26.1 ConvertInputFormat with an external full schema and schema-derived version check. The validator selects the declared JSON Schema dialect. Native references use each release’s official ConvertInputFormat. The original embedded-schema 26.1 converter remains the optional upgrader’s final converter.

9.0.0 and 9.0.1 have identical complete schema properties; only `epJSON_schema_version` and `epJSON_schema_build` differ. Their assets remain distinct. The short `9.0` declaration selects 9.0.0; explicit `9.0.1` selects that patch. Other short versions select their sole `.0` release. Unknown explicit patches are rejected.

## Geometry compatibility audit

The audit compares all 37 object types named by the existing parser, plus Space and the 26.2 construction-assignment objects. It covers field names, defaults, references, vertex/extensible layouts and coordinate behavior in the pinned SurfaceGeometry.cc sources. The relevant rotation signs remain negative throughout: zone north; building north plus Appendix G; and Appendix G alone for World coordinates. Detailed and rectangular coordinates retain separate switches. Site shading remains unrotated; host-based subsurfaces retain the host frame. The parser’s existing winding, recentering and shared hole arrays are unchanged.

Observed differences and treatment:

- 9.0 removes shading-control fields from window objects; the viewer does not consume them.
- 9.2 introduces Construction:AirBoundary; the existing category logic already reads it.
- 9.3 tightens geometry enums and drops the Absolute synonym from schemas. The lenient parser retains Absolute handling for older input; coordinate formulas do not change.
- 9.5 changes zone convection choices and air-boundary thermal options, without changing consumed geometry fields.
- 9.6 introduces Space references. The pure adapter resolves a missing surface zone through its Space and canonicalizes the zone name for transforms/grouping.
- 22.2 adds Space ceiling/volume fields and tightens numeric types; surface coordinates are unchanged.
- 25.1 adds the Space outside boundary condition; existing interior categorization already accepts it.
- 26.2 adds FixedWindow, OperableWindow, Skylight and OverheadDoor. Existing category rules map these to windows/doors. ConstructionAssignmentSet resolution is new: explicit assignments, then Space, then Building; matched surfaces prefer the nearer assignment, with internal reverse-layer names where needed.
- Unrecognized or missing epJSON versions warn and continue. No extra hard parse failure is introduced.

The adapter copies only changed geometry objects into an internal working document. Complete input and converted epJSON downloads are retained separately and are never rewritten by this normalization. This is compatibility for the viewer’s consumed geometry, not a claim to implement every EnergyPlus simulation feature.

## Validation evidence

Native/WASM and Chromium/Firefox comparisons are required for all four official models per release: 1ZoneUncontrolled, 5ZoneAirCooled, HVACTemplate-5ZonePurchAir and HVACTemplate-5ZonePackagedVAV. Full JSON values are compared, including HVAC, extensibles and non-geometric content. Explicit 9.0.1 selection is exercised by changing only the Version declaration in an isolated native job; upstream example files remain intact.

Candidate receipts bind input, schema, native reference, loader and WASM hashes. The installer rejects protocol-3 schema entries without matching native and browser receipts. Detailed evidence is local under `.energyplus-build/versioned-conversion/`; current validation totals and UI acceptance status are recorded in [energyplus.md](energyplus.md).

New regression tests: not written; awaiting manual acceptance.
