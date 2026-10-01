from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, copy_metadata

datas = collect_data_files('faster_whisper') + collect_data_files('ctranslate2')
datas += copy_metadata('faster-whisper') + copy_metadata('huggingface-hub')
binaries = collect_dynamic_libs('ctranslate2')
analysis = Analysis(['main.py'], pathex=[SPECPATH], binaries=binaries, datas=datas,
    hiddenimports=['ctranslate2.converters.opus_mt', 'sentencepiece', 'pyaudiowpatch', 'soxr'],
    excludes=['tkinter', 'matplotlib', 'IPython', 'pytest', 'torch', 'tensorflow'])
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, [], exclude_binaries=True, name='ktalk-engine',
    debug=False, strip=False, upx=False, console=True)
bundle = COLLECT(exe, analysis.binaries, analysis.datas, strip=False, upx=False, name='ktalk-engine')
