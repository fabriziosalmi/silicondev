# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_data_files

datas = [
    ('../../models.json', '.'),  # Bundle models.json to root of dist
]
binaries = []
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',
    'uvicorn.middleware.proxy_headers',
    'uvicorn',
    'fastapi',
    'app',
    'pandas',
    # presidio is intentionally NOT listed here: it requires Pydantic V1 which is
    # incompatible with Python 3.14+. The service.py guards all imports with try/except
    # and degrades gracefully when presidio is unavailable.
]

# MLX and MLX-LM often need explicit collection
tmp_ret = collect_all('mlx')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

tmp_ret = collect_all('mlx_lm')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

tmp_ret = collect_all('uvicorn')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

tmp_ret = collect_all('fastapi')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# spaCy — collect_all handles the NLP pipeline and en_core_web_sm model correctly
try:
    tmp_ret = collect_all('spacy')
    datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
except Exception:
    pass

# scipy and sklearn are distributions, not packages — use collect_data_files
# to include their data assets without triggering "not a package" warnings
try:
    datas += collect_data_files('scipy', include_py_files=False)
except Exception:
    pass
try:
    datas += collect_data_files('sklearn', include_py_files=False)
except Exception:
    pass


block_cipher = None

a = Analysis(
    ['../main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'PyQt5',
        'PyQt6',
        'tkinter',
        'IPython',
        'matplotlib',
        'wx',
        'test',
        'pytest',
        'pip',
        'pkg_resources',
        'black',
        'isort',
        'skimage',
        'altair',
        'bokeh',
        'panel',
        'plotly',
        'notebook',
        'jupyter',
        'nbconvert',
        'nbformat',
        'torchvision',
        'torch',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='silicon_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch='arm64',
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=True,
    upx=True,
    upx_exclude=[],
    name='silicon_server',
)
