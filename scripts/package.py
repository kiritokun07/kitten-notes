"""Build the distributable from the extension runtime files and verify its bytes."""
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

project = Path(__file__).resolve().parents[1]
root = project / "extension"
manifest = json.loads((root / "manifest.json").read_text())
files = [
    "manifest.json", "background.js", "selection.js", "panel.html", "panel.js",
    "panel.css", "export.js", "vendor/LICENSES.txt",
    "vendor/fflate-0.8.3.min.js", "vendor/markdown-it-15.0.3.min.js",
    "_locales/zh_CN/messages.json", *manifest["icons"].values(),
]
target = project / "release" / f'kitten-notes-{manifest["version"]}.zip'
target.parent.mkdir(exist_ok=True)
temporary = target.with_suffix(".zip.tmp")
with ZipFile(temporary, "w") as archive:
    for name in sorted(files):
        entry = ZipInfo(name)
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, (root / name).read_bytes(), compress_type=ZIP_DEFLATED)
with ZipFile(temporary) as archive:
    if archive.testzip() or archive.namelist() != sorted(files):
        raise ValueError("Archive integrity or file list mismatch")
    for name in files:
        if archive.read(name) != (root / name).read_bytes():
            raise ValueError(f"Content mismatch: {name}")
temporary.replace(target)
print(f"{target.name} ({len(files)} files, {target.stat().st_size} bytes)")
