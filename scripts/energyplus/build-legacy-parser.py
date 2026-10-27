"""Build a matching-release parser runtime; never install an unvalidated candidate.

Usage: python3 scripts/energyplus/build-legacy-parser.py <versioned-workspace> <tag>
Activate the pinned Emscripten SDK first. Sources must match sources.json and the
pinned commit in schema-releases.json. Native and WASM use the same upstream
parser and schema validator, with only the obsolete template rejection removed.
"""
import hashlib, json, pathlib, re, shutil, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[2]
work = pathlib.Path(sys.argv[1]).resolve()
tag = sys.argv[2]
release = next(r for r in json.loads((root/'scripts/energyplus/schema-releases.json').read_text())['releases'] if r['tag'] == tag)
source = work/'parser-sources'/tag
hashes = release['parserSources']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
for name, checksum in hashes.items():
    if sha(source/name) != checksum: raise RuntimeError('Changed upstream source: '+name)
compiler = subprocess.check_output(['em++','--version'], text=True)
if ' 6.0.0 ' not in compiler: raise RuntimeError('Activate pinned Emscripten 6.0.0')
out = work/'legacy-build'/tag
out.mkdir(parents=True, exist_ok=True)
parser = (source/'src/EnergyPlus/InputProcessing/IdfParser.cc').read_text()
# Before 9.6, parsing discarded template objects as a preprocessing policy.
# Removing this branch lets the unchanged schema-driven object parser retain
# them, matching the standalone converter's later template-preserving behavior.
pattern = r'else if\s*\(\s*obj_name.find\(\s*"Template"\s*\)\s*!=\s*std::string::npos\s*\)\s*\{[\s\S]*?continue;\s*\}'
parser, count = re.subn(pattern, '', parser)
if count != 1: raise RuntimeError('Review upstream template-preservation adapter')
# Modern libc++ otherwise selects string_view assignment for old JSON values.
parser = re.sub(r'name\s*=\s*name_iter.value\(\);', 'name = name_iter.value().get<std::string>();', parser)
parser = re.sub(r'extension_key\s*=\s*key.value\(\);', 'extension_key = key.value().get<std::string>();', parser)
(out/'IdfParser.cc').write_text(parser)
includes = [source/'src', source/'src/EnergyPlus', source/'third_party', source/'third_party/valijson', source/'third_party/re2', source/'third_party/nlohmann']
for folder in (source/'third_party').glob('fmt-*'):
    adapted_fmt = out/'fmt-include'
    shutil.copytree(folder/'include', adapted_fmt, dirs_exist_ok=True)
    header = adapted_fmt/'fmt/core.h'
    content = header.read_text()
    before = ': data_(s), size_(std::char_traits<Char>::length(s)) {}'
    if content.count(before) != 1: raise RuntimeError('Review fmt character-traits adapter')
    # libc++ removed generic char_traits for fmt 6's private char8_t enum.
    # Counting code units preserves the old generic char_traits semantics.
    header.write_text(content.replace(before, ': data_(s), size_(0) { while (s[size_] != Char()) ++size_; }'))
    includes.insert(0, adapted_fmt)
flags = ['-O2', '-std=c++11', '-DFMT_HEADER_ONLY', *['-I'+str(p) for p in includes]]
files = [str(root/'scripts/energyplus/parser-driver.cpp'), str(out/'IdfParser.cc'), str(source/'src/EnergyPlus/InputProcessing/InputValidation.cc')]
re2 = source/'third_party/re2'
re2_sources = re.search(r'set\(RE2_SOURCES(.*?)\)', (re2/'CMakeLists.txt').read_text(), re.S | re.I).group(1)
files += [str(re2/name) for name in re.findall(r'[a-z0-9_/]+\.cc', re2_sources)]
commands = [
    ['g++', *flags, *files, '-o', str(out/'parser-native')],
    ['em++', *flags, *files, '-fwasm-exceptions', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=worker,node', '-sINVOKE_RUN=0', '-sEXIT_RUNTIME=0', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=2147483648', '-sSTACK_SIZE=5242880', '-sFORCE_FILESYSTEM=1', "-sEXPORTED_RUNTIME_METHODS=['FS','callMain']", '-o', str(out/'parser.mjs')],
]
for command in commands:
    subprocess.run(command, check=True)
loader, wasm = out/'parser.mjs', out/'parser.wasm'
build_id = tag[1:]+'-'+hashlib.sha256(loader.read_bytes()+wasm.read_bytes()).hexdigest()[:16]
artifact = work/'candidate'/build_id
artifact.mkdir(parents=True, exist_ok=True)
for p in [loader, wasm]: shutil.copyfile(p, artifact/p.name)
shutil.copyfile(source/'LICENSE.txt', artifact/'LICENSE-EnergyPlus.txt')
shutil.copytree(source/'third_party', artifact/'notices-and-headers', dirs_exist_ok=True)
manifest = dict(protocol=3, energyPlusVersion=tag[1:], sourceCommit=release['sourceCommit'], buildId=build_id, capabilities=['convert'], invocation='schema-parser', loader=dict(file=loader.name, sha256=sha(loader)), wasm=dict(file=wasm.name, sha256=sha(wasm)), emscriptenVersion='6.0.0', recipeSha256=sha(pathlib.Path(__file__)), driverSha256=sha(root/'scripts/energyplus/parser-driver.cpp'), parserAdapterSha256=sha(out/'IdfParser.cc'), sourceHashes=hashes, compilerAdapters={str(p.relative_to(out)): sha(p) for p in (out/'fmt-include').glob('fmt/core.h')})
(artifact/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'build.json').write_text(json.dumps(dict(manifest=str(artifact/'manifest.json'), commands=commands, nativeSha256=sha(out/'parser-native')),indent=2)+'\n')
print(build_id,flush=True)
