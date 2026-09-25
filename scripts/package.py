"""Build a drag-and-drop ZIP with manifest.json at archive root."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
destination = root / "dist" / f"bili-breeze-{manifest['version']}.zip"
destination.parent.mkdir(exist_ok=True)
files = ["manifest.json", "background.js", "content.js", "popup.html", "popup.css", "popup.js", "history.html", "history.css", "history.js"]
files += [p.relative_to(root).as_posix() for p in sorted((root / "prompts").glob("*.js"))]
files += [f"icons/{size}.png" for size in (16, 48, 128)]
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, arcname=name)
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert "manifest.json" in archive.namelist()
    assert all("\\" not in name for name in archive.namelist())
    assert set(archive.namelist()) == set(files)
print(destination)
