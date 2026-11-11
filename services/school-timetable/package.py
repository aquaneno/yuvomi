#!/usr/bin/env python3
"""Create the small install/deployment ZIP without the full Yuvomi repository."""
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parents[2]
target = Path(sys.argv[1] if len(sys.argv) > 1 else 'yuvomi-school-timetable-1.0.0.zip').resolve()
files = sorted((root / 'modules/school-timetable').rglob('*'))
files += [root / 'services/school-timetable' / name for name in [
    'README.md', 'VALIDATION.md', 'Dockerfile', 'compose.yml', 'package.json', 'server.js', 'store.js',
    'migrate-legacy.js', 'package.py',
]]
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        if not path.is_file() or any(part.startswith('.') for part in path.relative_to(root).parts):
            continue
        info = zipfile.ZipInfo('yuvomi-school-timetable/' + path.relative_to(root).as_posix(), (2026, 11, 11, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
print(target)
