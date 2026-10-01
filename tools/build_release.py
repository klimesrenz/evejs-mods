"""Build installable ZIPs and Launcher update metadata using the standard library."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'klimesrenz/evejs-mods'
MODS = {
    'skyhook-pi': ('SkyhookPI-{version}.zip', 'skyhook-pi-v'),
    'market-search': ('MarketSearch-{version}.zip', 'market-search-v'),
}


def build(name, pattern, prefix):
    source = ROOT / 'mods' / name
    manifest = json.loads((source / 'evejs-launcher.mod.json').read_text(encoding='utf-8'))
    expected = dict(provider='github', repository=REPOSITORY, asset=pattern,
                    channel='stable', tagPrefix=prefix, preserveFiles=[])
    if manifest['id'] != name or manifest['schemaVersion'] != 3 or manifest['updates'] != expected:
        raise ValueError('Unexpected package identity or update source: ' + name)
    version = manifest['version']
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Use a stable semantic version: ' + name)
    files = sorted(p for p in source.rglob('*') if p.is_file() or p.is_symlink())
    for file in files:
        if file.is_symlink() or file.suffix not in {'.js', '.cjs', '.json', '.py', '.md'}:
            raise ValueError('Unexpected package file: ' + str(file))
        if any(part.startswith('.') or part == '__pycache__' for part in file.relative_to(source).parts):
            raise ValueError('Hidden/runtime package path: ' + str(file))
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    archive = output / pattern.replace('{version}', version)
    if archive.exists() or archive.with_suffix('.update.json').exists():
        raise FileExistsError('Release already built; review/remove dist files before rebuilding: ' + archive.name)
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for file in files:
            info = zipfile.ZipInfo(file.relative_to(source).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            package.writestr(info, file.read_bytes())
    with zipfile.ZipFile(archive) as package:
        if package.testzip() is not None:
            raise ValueError('Invalid ZIP')
        data = json.loads(package.read('evejs-launcher.mod.json'))
        if data['clientMenu']['entrypoint'] not in package.namelist():
            raise ValueError('Missing client menu entrypoint')
    metadata = dict(schemaVersion=1, id=data['id'], version=data['version'], asset=archive.name)
    versions = data.get('compatibility', {}).get('evejsVersions')
    if versions is not None:
        metadata['evejsVersions'] = versions
    sidecar = archive.with_suffix('.update.json')
    with sidecar.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(metadata, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    return archive, sidecar


def main():
    outputs = []
    for name, (pattern, prefix) in MODS.items():
        outputs.extend(build(name, pattern, prefix))
    sums = ''.join(hashlib.sha256(file.read_bytes()).hexdigest() + '  ' + file.name + '\n'
                   for file in outputs)
    (ROOT / 'dist' / 'SHA256SUMS.txt').write_text(sums, encoding='ascii')
    print(sums, end='')


if __name__ == '__main__':
    main()
