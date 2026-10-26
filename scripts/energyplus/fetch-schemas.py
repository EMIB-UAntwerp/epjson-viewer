"""Fetch pinned official schemas and native references, without installing assets.

python3 scripts/energyplus/fetch-schemas.py <workspace> [v8.9.0 ...]
The release inventory is explicit; this command never discovers a latest release.
"""
import concurrent.futures, hashlib, json, pathlib, subprocess, sys, tarfile
root = pathlib.Path(__file__).resolve().parents[2]
work = pathlib.Path(sys.argv[1]).resolve()
work.mkdir(parents=True, exist_ok=True)
rows = json.loads((root/'scripts/energyplus/schema-releases.json').read_text())['releases']
requested = set(sys.argv[2:])
if requested - {row['tag'] for row in rows}: raise RuntimeError('Unknown pinned release')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
def fetch(url, destination, checksum):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        subprocess.run(['curl', '-fLsS', '--retry', '3', url, '-o', str(destination)], check=True)
    if sha(destination) != checksum: raise RuntimeError('Checksum mismatch: '+str(destination))

def release(row):
    tag = row['tag']
    archive = work/(tag+'.tar.gz')
    fetch(row['url'], archive, row['archiveSha256'])
    output = work/'native'/tag
    output.mkdir(parents=True, exist_ok=True)
    records = {}
    with tarfile.open(archive) as package:
        for member in package:
            name = pathlib.PurePosixPath(member.name).name
            if not member.isfile(): continue
            if name in ['Energy+.schema.epJSON', 'Energy+.idd', 'LICENSE.txt', '1ZoneUncontrolled.idf', '5ZoneAirCooled.idf', 'HVACTemplate-5ZonePurchAir.idf', 'HVACTemplate-5ZonePackagedVAV.idf'] or name.startswith(('ConvertInputFormat-', 'energyplus-', 'libenergyplusapi')):
                path = output/name
                path.write_bytes(package.extractfile(member).read())
                path.chmod(member.mode)
                records[name] = sha(path)
    if records.get('Energy+.schema.epJSON') != row['schemaSha256']: raise RuntimeError('Unexpected released schema')
    (output/'reference.json').write_text(json.dumps(dict(archiveSha256=row['archiveSha256'], files=records), indent=2)+'\n')
    base = 'https://raw.githubusercontent.com/NatLabRockies/EnergyPlus/'+row['sourceCommit']+'/'
    source = work/'parser-sources'/tag
    def get(item):
        name, checksum = item
        fetch(base+name, source/name, checksum)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(get, row.get('parserSources', {}).items()))
    if row.get('parserSources'):
        (source/'sources.json').write_text(json.dumps(row['parserSources'], indent=2)+'\n')
    fetch(base+'src/EnergyPlus/SurfaceGeometry.cc', work/'sources'/tag/'src/EnergyPlus/SurfaceGeometry.cc', row['geometrySourceSha256'])
    print(tag, 'verified', flush=True)

for row in rows:
    if not requested or row['tag'] in requested: release(row)
