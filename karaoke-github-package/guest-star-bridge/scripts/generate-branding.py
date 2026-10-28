#!/usr/bin/env python3
"""Regenerate deployment copies and app icon sizes from official PNG masters only."""
from pathlib import Path
import base64
import importlib.util
import shutil
import tempfile
from PIL import Image
bridge = Path(__file__).resolve().parent.parent
assets = bridge / 'public/branding'
web = bridge.parent
with Image.open(assets / 'app-icon-master.png') as master:
    assert master.mode == 'RGBA' and master.width == master.height
    for size, name in [(16,'favicon-16.png'),(32,'favicon-32.png'),(180,'apple-touch-icon.png'),(192,'app-icon-192.png'),(512,'app-icon-512.png')]:
        master.resize((size,size), Image.Resampling.LANCZOS).save(assets/name)
    master.save(bridge/'public/favicon.ico',format='ICO',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
encoded = base64.b64encode((assets/'app-icon-master.png').read_bytes()).decode()
(bridge/'public/favicon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254"><image width="1254" height="1254" href="data:image/png;base64,{encoded}"/></svg>\n')
(web/'public/branding').mkdir(parents=True,exist_ok=True)
for source in assets.glob('*.png'):
    shutil.copy2(source, web/'public/branding'/source.name)
for source, name in [(assets/'favicon-32.png','icon.png'),(assets/'apple-touch-icon.png','apple-icon.png'),(bridge/'public/favicon.ico','favicon.ico')]:
    shutil.copy2(source, web/'app'/name)
spec = importlib.util.spec_from_file_location('installer', bridge/'macos/build_installer.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
(bridge/'macos/assets').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as work:
    installer.write_icns(bridge/'macos/assets/AppIcon.icns', Path(work))
print('Official masters preserved; web and macOS icons regenerated.')
