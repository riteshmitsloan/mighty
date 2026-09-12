#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build:extension
python3 - <<'PY'
from pathlib import Path
import json, zipfile, shutil
manifest=json.loads(Path('extension/dist/manifest.json').read_text())
version=manifest['version']
output=Path('public/downloads');output.mkdir(parents=True,exist_ok=True)
archive=output/f'mighty-extension-{version}.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for file in sorted(Path('extension/dist').rglob('*')):
        if file.is_file():
            relative=file.relative_to('extension/dist').as_posix()
            info=zipfile.ZipInfo(relative,date_time=(2026,9,12,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info,file.read_bytes())
shutil.copyfile(archive,output/'mighty-extension.zip')
print(f'Built Mighty extension {version}: {archive}')
PY
