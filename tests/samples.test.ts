/**
 * Contract tests for the bundled, committed demo models in public/samples/.
 *
 * Unlike data/ (git-ignored, real addresses), public/samples/ is committed and
 * always present in CI, so these tests never skip. They protect two things:
 *  - README's "Data privacy" guarantee: files here must have gone through
 *    scripts/anonymize.py, not be a raw research file that slipped in.
 *  - README's Features contract for what each demo button ("Demo: single
 *    house" / "Demo: urban block") loads through the public core pipeline
 *    (parseEpjson + buildGeometry), independent of incidental details of the
 *    current file content since these are regenerable artifacts.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEpjson } from '../src/core/parse'
import { buildGeometry } from '../src/core/buildBuffers'

const samplesDir = fileURLToPath(new URL('../public/samples', import.meta.url))

function loadSample(file: string) {
  const raw = readFileSync(join(samplesDir, file), 'utf-8')
  const data = JSON.parse(raw)
  return { raw, data, model: parseEpjson(data, file) }
}

describe('public/samples inventory', () => {
  it('ships exactly the two demo files DropZone offers', () => {
    // DropZone.vue hardcodes these two filenames for the demo buttons; a
    // renamed or missing file would silently break a demo button in the UI.
    const files = readdirSync(samplesDir).filter((f) => f.endsWith('.epJSON'))
    expect(files.sort()).toEqual(['demo_block.epJSON', 'demo_house.epJSON'])
  })
})

describe('public/samples anonymization contract', () => {
  const files = ['demo_house.epJSON', 'demo_block.epJSON']

  it.each(files)('%s carries no residual Dutch street-name suffixes', (file) => {
    // anonymize.py itself flags this exact pattern as a residual-leak signal
    // after scrubbing; a raw research file committed without running the
    // script would fail this the same way the script's own check would.
    const { raw } = loadSample(file)
    const residual = raw.match(/[A-Z][a-z]+(?:straat|laan|lei|plein)/g)
    expect(residual).toBeNull()
  })

  it.each(files)('%s has the anonymized Site:Location placeholder', (file) => {
    // scripts/anonymize.py unconditionally overwrites Site:Location with this
    // exact object — a real Site:Location (real city/coordinates) would fail.
    const { data } = loadSample(file)
    expect(data['Site:Location']).toEqual({
      'Demo Location': { city: 'Anonymized', reference_system: 'local coordinates' },
    })
  })

  it.each(files)('%s zone names use only the synthetic ID_<uuid>_ prefix', (file) => {
    // anonymize.py replaces every real building UUID with a sequential
    // synthetic one of the same ID_<uuid>_ shape the viewer's grouping logic
    // expects (groupZonesIntoBuildings in parse.ts); this also guards against
    // a file whose zone-naming convention no longer matches what the app
    // groups buildings on.
    const { data } = loadSample(file)
    const zoneNames: string[] = Object.keys(data.Zone ?? {})
    expect(zoneNames.length).toBeGreaterThan(0)
    const uuidRe = /^ID_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_/
    for (const name of zoneNames) {
      expect(name).toMatch(uuidRe)
    }
  })

  it.each(files)('%s Building name is the generic demo label, not a real building name', (file) => {
    const { data } = loadSample(file)
    for (const b of Object.values(data.Building ?? {}) as Array<{ name?: string }>) {
      expect(b.name).toMatch(/^Demo /)
    }
  })
})

describe('demo_house.epJSON backs "Demo: single house"', () => {
  it('parses through the public core pipeline into a single-building, multi-zone model', () => {
    const { model } = loadSample('demo_house.epJSON')

    // Single-building demo: README's selection-level rule ("Building only
    // appears when the file holds more than one building") requires this
    // stay a single-building model, so the demo exercises the Surface/Zone
    // toggle rather than Building.
    expect(model.stats.buildingCount).toBe(1)
    expect(model.buildingNames.length).toBe(1)

    // Regression guard for the regeneration described in the task: this demo
    // was a single-zone box before and must now stay a multi-floor, single
    // building — not collapse back to one zone.
    expect(model.stats.zoneCount).toBeGreaterThan(1)

    // Zone count must match the source file's own Zone block (parse fidelity),
    // derived from the file rather than hardcoded so it survives regeneration.
    const { data } = loadSample('demo_house.epJSON')
    expect(model.stats.zoneCount).toBe(Object.keys(data.Zone ?? {}).length)

    // README Features: "windows cut as real holes in their host walls".
    const fens = model.surfaces.filter((s) => s.kind === 'fenestration')
    expect(fens.length).toBeGreaterThan(0)
    for (const f of fens) {
      expect(f.hostSurface).toBeTruthy()
      expect(f.zone).toBeTruthy()
    }
    const holeCount = model.surfaces.reduce((n, s) => n + s.holes.length, 0)
    expect(holeCount).toBe(fens.length)

    expect(model.stats.counts.wall).toBeGreaterThan(0)
    expect(model.stats.counts.window).toBeGreaterThan(0)
    // A bundled demo is curated input: it must load without any lenient-parse
    // complaint. Bounding by MAX_WARNINGS would pass a demo emitting 80.
    expect(model.warnings).toEqual([])
  })

  it('builds non-empty renderable geometry', () => {
    const { model } = loadSample('demo_house.epJSON')
    const { bundle, warnings } = buildGeometry(model)
    expect(bundle.triangleCount).toBeGreaterThan(0)
    expect(warnings).toEqual([])
  })
})

describe('demo_block.epJSON backs "Demo: urban block"', () => {
  it('parses through the public core pipeline into a genuine multi-building urban model', () => {
    const { model, data } = loadSample('demo_block.epJSON')

    // README Features: buildings are grouped from urban-export zone naming;
    // an urban block demo that collapsed to one building would silently stop
    // exercising the Building selection level and building grouping in the UI.
    expect(model.stats.buildingCount).toBeGreaterThan(1)
    expect(model.buildingNames.length).toBe(model.stats.buildingCount)

    expect(model.stats.zoneCount).toBe(Object.keys(data.Zone ?? {}).length)
    // Every zone must resolve to exactly one of the reported buildings.
    const zonesFromBuildings = Object.values(model.buildings).reduce(
      (n, b) => n + b.zones.length,
      0,
    )
    expect(zonesFromBuildings).toBe(model.stats.zoneCount)

    expect(model.stats.counts.wall).toBeGreaterThan(0)
    expect(model.warnings).toEqual([])
  })

  it('builds non-empty renderable geometry at urban scale', () => {
    const { model } = loadSample('demo_block.epJSON')
    const { bundle, warnings } = buildGeometry(model)
    expect(bundle.triangleCount).toBeGreaterThan(0)
    expect(warnings).toEqual([])
  })
})
