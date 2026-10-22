"""Build installable ZIPs and Launcher update metadata using the standard library."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'klimesrenz/evejs-mods'
MODS = {
    'pi-processing': ('PIProcessing-{version}.zip', 'pi-processing-v', 'pi-processing'),
    'skyhook-pi': ('SkyhookPI-{version}.zip', 'skyhook-pi-v', 'skyhook-pi'),
    'market-search': ('MarketSearch-{version}.zip', 'market-search-v', 'market-search'),
    'tq-asteroid-belts': (
        'TQAsteroidBelts-{version}.zip',
        'tq-asteroid-belts-v',
        'tqasteroidbelts',
    ),
}


def validate_package_file(source, file):
    relative = file.relative_to(source)
    resolved_source = source.resolve(strict=True)
    resolved_file = file.resolve(strict=True)
    try:
        resolved_relative = resolved_file.relative_to(resolved_source)
    except ValueError as error:
        raise ValueError('Package path escapes source root: ' + str(file)) from error
    folded_parts = tuple(part.casefold() for part in relative.parts)
    resolved_folded_parts = tuple(part.casefold() for part in resolved_relative.parts)
    if file.is_symlink():
        raise ValueError('Unexpected package file: ' + str(file))
    if relative.name.casefold() == 'settings.json' or any(
            part in {'_local', '__pycache__'} for part in folded_parts + resolved_folded_parts):
        raise ValueError('Runtime/user package path: ' + str(file))
    allowed_special = len(relative.parts) == 1 and file.name in {'LICENSE', '.env.example'}
    allowed_manifest_data = (
        relative.as_posix() == 'data/asteroid-counts.json.gz' and
        resolved_relative.as_posix() == 'data/asteroid-counts.json.gz'
    )
    if (file.suffix not in {'.js', '.cjs', '.json', '.py', '.md'} and
            not allowed_special and not allowed_manifest_data):
        raise ValueError('Unexpected package file: ' + str(file))
    allowed_env_example = relative.as_posix() == '.env.example' and resolved_relative.as_posix() == '.env.example'
    if (any(part.startswith('.') for part in relative.parts) or
            any(part.startswith('.') for part in resolved_relative.parts)) and not allowed_env_example:
        raise ValueError('Hidden/runtime package path: ' + str(file))


def build(name, pattern, prefix, package_id):
    source = ROOT / 'mods' / name
    manifest = json.loads((source / 'evejs-launcher.mod.json').read_text(encoding='utf-8'))
    expected = dict(provider='github', repository=REPOSITORY, asset=pattern,
                    channel='stable', tagPrefix=prefix, preserveFiles=[])
    if manifest['id'] != package_id or manifest['schemaVersion'] != 3 or manifest['updates'] != expected:
        raise ValueError('Unexpected package identity or update source: ' + name)
    version = manifest['version']
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Use a stable semantic version: ' + name)
    files = sorted(p for p in source.rglob('*') if p.is_file() or p.is_symlink())
    for file in files:
        validate_package_file(source, file)
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
        if data.get('clientMenu') and data['clientMenu']['entrypoint'] not in package.namelist():
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
    parser = argparse.ArgumentParser()
    parser.add_argument('--mod', choices=sorted(MODS))
    args = parser.parse_args()
    selected = [args.mod] if args.mod else list(MODS)
    outputs = []
    for name in selected:
        pattern, prefix, package_id = MODS[name]
        outputs.extend(build(name, pattern, prefix, package_id))
    sums = ''.join(hashlib.sha256(file.read_bytes()).hexdigest() + '  ' + file.name + '\n'
                   for file in outputs)
    (ROOT / 'dist' / 'SHA256SUMS.txt').write_text(sums, encoding='ascii')
    print(sums, end='')


if __name__ == '__main__':
    main()
