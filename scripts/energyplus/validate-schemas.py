"""Compare complete Node/WASM output to matching-release native conversion.

python3 scripts/energyplus/validate-schemas.py <workspace> [--native-library-path DIR]
Old releases use a native build of their pinned parser with the documented
preservation adapter; recent releases use official ConvertInputFormat binaries.
This writes evidence only. Browser parity is a separate promotion requirement.
"""
import argparse, hashlib, json, pathlib, subprocess, re
args = argparse.ArgumentParser()
args.add_argument('workspace', type=pathlib.Path)
args.add_argument('--native-library-path', type=pathlib.Path)
args.add_argument('--only', nargs='+')
args = args.parse_args()
root = pathlib.Path(__file__).resolve().parents[2]
work = args.workspace.resolve()
rows = json.loads((root/'scripts/energyplus/schema-releases.json').read_text())['releases']
shared = json.loads((work/'shared-runtime.json').read_text())['manifest']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
records = [r for r in json.loads((work/'native-parity.json').read_text()) if r['release'] not in args.only] if args.only else []
for release in reversed(rows):
    if args.only and release['tag'] not in args.only: continue
    tag = release['tag']
    legacy = 'parserSources' in release
    native = work/'native'/tag
    if legacy:
        build = json.loads((work/'legacy-build'/tag/'build.json').read_text())
        manifest_path = pathlib.Path(build['manifest'])
        executable = work/'legacy-build'/tag/'parser-native'
    else:
        manifest_path = work/'candidate'/shared
        executable = native/('ConvertInputFormat-'+tag[1:])
    manifest = json.loads(manifest_path.read_text())
    schema = native/'Energy+.schema.epJSON'
    if sha(schema) != release['schemaSha256']: raise RuntimeError('Unpinned schema')
    for model in ['1ZoneUncontrolled', '5ZoneAirCooled', 'HVACTemplate-5ZonePurchAir', 'HVACTemplate-5ZonePackagedVAV']:
        output = work/'parity'/tag/model
        output.mkdir(parents=True, exist_ok=True)
        source = native/(model+'.idf')
        # Official 9.0.1 examples declare only 9.0. Exercise explicit patch
        # selection as well, without changing the upstream examples on disk.
        if tag == 'v9.0.1':
            original = source.read_text()
            source = output/'input.idf'
            source.write_text(re.sub(r'(Version\s*,\s*)9\.0(\s*;)', r'\g<1>9.0.1\2', original, count=1, flags=re.I))
        expected, actual = output/(model+'.epJSON'), output/'browser.epJSON'
        command = [str(executable), str(schema), str(source), str(expected)] if legacy else [str(executable), '--output', str(output), str(source)]
        # Some official Ubuntu binaries require the separately provisioned libc.
        if args.native_library_path and tag in ['v24.2.0', 'v26.1.0']:
            lib = args.native_library_path.resolve()
            command = [str(lib/'ld-linux-x86-64.so.2'), '--library-path', str(lib)+':'+str(native), *command]
        a = subprocess.run(command, capture_output=True, text=True)
        (output/'native.log').write_text(a.stdout+a.stderr)
        b = subprocess.run(['node', str(root/'scripts/energyplus/run-converter.mjs'), str(manifest_path), str(schema), str(source), str(actual)], capture_output=True, text=True)
        (output/'wasm.log').write_text(b.stdout+b.stderr)
        parity = a.returncode == b.returncode == 0 and expected.exists() and actual.exists() and json.loads(expected.read_text()) == json.loads(actual.read_text())
        record = dict(release=tag, model=model, inputSha256=sha(source), schemaSha256=sha(schema), loaderSha256=manifest['loader']['sha256'], wasmSha256=manifest['wasm']['sha256'], nativeExecutableSha256=sha(executable), nativeSourceCommit=release['sourceCommit'], reference='matching-source parser with template-preservation adapter' if legacy else 'official ConvertInputFormat', nativeExit=a.returncode, wasmExit=b.returncode, nativeParity=parity)
        if legacy: record.update(nativeBuildSha256=sha(work/'legacy-build'/tag/'build.json'), parserAdapterSha256=manifest['parserAdapterSha256'])
        if expected.exists(): record['nativeOutputSha256'] = sha(expected)
        if actual.exists(): record['wasmOutputSha256'] = sha(actual)
        records.append(record)
        (work/'native-parity.json').write_text(json.dumps(records, indent=2)+'\n')
        print(tag, model, 'PASS' if parity else 'FAIL', flush=True)
if not all(record['nativeParity'] for record in records): raise SystemExit('Native parity failed; do not promote')
