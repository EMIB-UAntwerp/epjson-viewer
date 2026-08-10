# Testing and Verification

This is the command-level runbook for the staged policy in `AGENTS.md`. It does
not authorize creating tests.

Running existing tests, the typecheck, and the render check is always allowed.
Never modify an expectation to make a failure pass.

## Focused verification

Run the nearest existing test for touched behavior:

```sh
npx vitest run tests/geometry.test.ts     # plane math, triangulation, metrics
npx vitest run tests/parse.test.ts        # transforms, grouping, buffers
npm run test:watch                        # watch mode while iterating
```

Typecheck without bundling:

```sh
npx vue-tsc --noEmit -p tsconfig.json
```

There is no dedicated `typecheck` script — `npm run build` runs the same command
as its first step. **No linter or formatter is configured**, so `vue-tsc` is the
only static gate; do not look for `npm run lint`.

## Visual verification

The viewer's output is pixels, so geometry, parsing, and rendering changes need
a render pass. Prerequisite once: `npx playwright install chromium`.

Start a dev server, then point the script at it:

```sh
npm run dev -- --port 5199
node scripts/verify-render.mjs public/samples/demo_block.epJSON /tmp/out.png 3000 all,pick
```

- Arguments are `<file.epJSON> <out.png> [settle-ms] [actions]`. The file may be
  the sentinel `DEMO_HOUSE` or `DEMO_BLOCK` to click the bundled demo buttons
  instead of uploading.
- Actions are comma-separated: `xray`, `all`, `display`, `pick`,
  `surface` / `zone` / `building` (set the level before `pick`), `top`,
  `boundary`, `construction`.
- The target URL defaults to `http://localhost:5199/`; override with the `URL`
  environment variable.
- The script reports collected `pageerror` and `console.error` messages. Treat
  anything other than the final `no page errors` line as a failure.
- This check is **not** wired into CI. It only runs when someone runs it.

## Real-data checks

`tests/realdata.test.ts` runs against the git-ignored `data/` directory and
pins hard numbers on real urban models (`block_9`: 55 zones, 334 paired interior
surfaces; `block_3`: 747 zones, 3246 air boundaries, 14 675 shading surfaces),
plus the float32 coordinate bound and a 30-second parse-and-build budget.

It uses `describe.skipIf(...)`, so it **silently skips** when `data/` is absent —
including in CI. When it skips, report that explicitly rather than implying the
real-data checks passed.

## Full verification

After test lock-in, or when full verification is requested:

```sh
npm test
npm run build
```

That is exactly what `.github/workflows/deploy.yml` runs before publishing to
`gh-pages`. For anything touching geometry or rendering, add a
`scripts/verify-render.mjs` pass over `public/samples/demo_block.epJSON`.

For any failure, report the failing check and whether it appears to originate in
production behavior, test code, or the environment. Report all skipped checks.
