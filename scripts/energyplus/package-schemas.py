"""Assemble version-preserving candidates; installer enforces browser validation.

python3 scripts/energyplus/package-schemas.py <workspace> <validated-upgrader>
Run again after browser-parity.json exists to bind browser evidence to receipts.
"""
import hashlib, json, pathlib, shutil, sys
root = pathlib.Path(__file__).resolve().parents[2]
work = pathlib.Path(sys.argv[1]).resolve()
upgrader = pathlib.Path(sys.argv[2]).resolve()
candidate = work/'candidate'
rows = json.loads((root/'scripts/energyplus/schema-releases.json').read_text())['releases']
native = json.loads((work/'native-parity.json').read_text())
browser_path = work/'browser-parity.json'
browsers = json.loads(browser_path.read_text()) if browser_path.exists() else []
shared = json.loads((work/'shared-runtime.json').read_text())['manifest']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
legacy = json.loads((upgrader/'registry.json').read_text())
registry = dict(protocol=3, engines=[], targetVersion=legacy['targetVersion'], upgradeManifest=legacy['engines'][0]['manifest'], transitions=legacy['transitions'])
for relative in {pathlib.Path(entry['manifest']).parent for entry in legacy['engines']+legacy['transitions']}:
    shutil.copytree(upgrader/relative, candidate/relative, dirs_exist_ok=True)
for row in reversed(rows):
    version = row['tag'][1:]
    family = '.'.join(version.split('.')[:2])
    if 'parserSources' in row:
        manifest_path = pathlib.Path(json.loads((work/'legacy-build'/row['tag']/'build.json').read_text())['manifest'])
        relative = manifest_path.relative_to(candidate).as_posix()
    else:
        relative = shared
        manifest_path = candidate/relative
    manifest = json.loads(manifest_path.read_text())
    native_cases = [case for case in native if case['release'] == row['tag']]
    if len(native_cases) != 4 or any(not case['nativeParity'] or case['schemaSha256'] != row['schemaSha256'] or case['wasmSha256'] != manifest['wasm']['sha256'] or case['loaderSha256'] != manifest['loader']['sha256'] for case in native_cases): raise RuntimeError('Missing native parity: '+version)
    browser_cases = [case for case in browsers if case['release'] == row['tag']]
    browser_ok = all(any(case['browser'] == name and case['model'] == model['model'] and case['nativeParity'] and case['inputSha256'] == model['inputSha256'] and case['schemaSha256'] == row['schemaSha256'] and case['loaderSha256'] == manifest['loader']['sha256'] and case['wasmSha256'] == manifest['wasm']['sha256'] for case in browser_cases) for name in ['chromium', 'firefox'] for model in native_cases)
    schema_relative = f'schemas/{version}/Energy.schema.epJSON'
    schema = candidate/schema_relative
    schema.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(work/'native'/row['tag']/'Energy+.schema.epJSON', schema)
    if sha(schema) != row['schemaSha256']: raise RuntimeError('Schema hash mismatch')
    shutil.copyfile(work/'native'/row['tag']/'LICENSE.txt', schema.parent/'LICENSE-EnergyPlus.txt')
    receipt_relative = f'validation/{version}.json'
    receipt = candidate/receipt_relative
    receipt.parent.mkdir(exist_ok=True)
    receipt.write_text(json.dumps(dict(schemaVersion=version, schemaSha256=row['schemaSha256'], loaderSha256=manifest['loader']['sha256'], wasmSha256=manifest['wasm']['sha256'], nativeParity=True, browserParity=browser_ok, comparisons=native_cases, browserComparisons=browser_cases), indent=2)+'\n')
    entry = dict(modelVersion=version, manifest=relative, schema=dict(file=schema_relative, sha256=row['schemaSha256'], version=version, sourceCommit=row['sourceCommit']), validation=receipt_relative)
    registry['engines'].append(entry)
    if version.endswith('.0'): registry['engines'].append(dict(entry, modelVersion=family))
(candidate/'registry.json').write_text(json.dumps(registry, indent=2)+'\n')
print('Packaged', len(rows), 'schemas; browser validation', 'complete' if browsers and all(json.loads((candidate/entry['validation']).read_text())['browserParity'] for entry in registry['engines']) else 'pending')
