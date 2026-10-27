#!/usr/bin/env python3
"""Reproducible ARM64/macOS14+ native player build with the trained two-bus DSP.

Example: python3 macos/build_vocal_stream.py --ort-sdk /path/to/onnxruntime-osx-arm64-1.26.0 --model /path/to/vocal-stream.onnx --output /path/to/build
Outputs an executable and its required library/model. Does not install/run an app.
"""
import argparse,hashlib,json,subprocess,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--ort-sdk',type=Path,required=True);p.add_argument('--model',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parent;r=root/'gs-vocalrt';out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);sdk=a.ort_sdk.resolve();model=a.model.resolve()
assert (sdk/'VERSION_NUMBER').read_text().strip()=='1.26.0'
assert model.stat().st_size==11069906 and hashlib.sha256(model.read_bytes()).hexdigest()=='c08b0a2c2ee6510eb34425724e820f2302d549cd4a56acee23867a5f804f38eb'
commands=[]
def run(cmd):
    cmd=list(map(str,cmd));result=subprocess.run(cmd,capture_output=True,text=True);commands.append({'command':cmd,'exit':result.returncode,'output':result.stdout+result.stderr});(out/'build-commands.json').write_text(json.dumps(commands,indent=2));result.check_returncode()
for name,src in [('host',root/'GuestStarNativeHost.m'),('reader',r/'original_reader.m')]:
    run(['clang','-arch','arm64','-O2','-fobjc-arc','-mmacosx-version-min=14.0','-I',r,'-c',src,'-o',out/(name+'.o')])
cmd=['clang++','-arch','arm64','-std=c++17','-O3','-fobjc-arc','-pthread','-mmacosx-version-min=14.0','-Wno-deprecated-declarations','-I',r,'-I',sdk/'include',out/'host.o',out/'reader.o',r/'player_effect.mm','-L',sdk/'lib','-lonnxruntime','-Wl,-rpath,@executable_path/../Frameworks']
for framework in ['Cocoa','AVFoundation','AudioToolbox','CoreAudio','CoreGraphics','WebKit','CoreMedia','CoreVideo','QuartzCore']:cmd+=['-framework',framework]
run([*cmd,'-o',out/'GuestStarBridge'])
(out/'Frameworks').mkdir(exist_ok=True);shutil.copy2(sdk/'lib/libonnxruntime.1.26.0.dylib',out/'Frameworks/libonnxruntime.1.26.0.dylib')
alias=out/'Frameworks/libonnxruntime.1.dylib'
if not alias.exists():alias.symlink_to('libonnxruntime.1.26.0.dylib')
target=out/'Resources/bridge/stem-engine/gs-vocalrt';target.mkdir(parents=True,exist_ok=True);shutil.copy2(model,target/model.name)
for name in ['provenance.json','LICENSE-StemgenRT.txt']:
    if (model.parent/name).exists():shutil.copy2(model.parent/name,target/name)
print('Built ARM64 player, library and two-bus model:',out)
