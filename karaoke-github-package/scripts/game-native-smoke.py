import http.server,threading,tempfile,wave,subprocess,os,pathlib,argparse
parser=argparse.ArgumentParser();parser.add_argument('--native-build',type=pathlib.Path,required=True);parser.add_argument('--ort-sdk',type=pathlib.Path,required=True);args=parser.parse_args();root=pathlib.Path(__file__).resolve().parent.parent;native=args.native_build.resolve();sdk=args.ort_sdk.resolve();r=root/'guest-star-bridge/macos/gs-vocalrt'
with tempfile.TemporaryDirectory(prefix='gs-native-silent-') as temp:
 with wave.open(temp+'/silence.wav','wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(48000);w.writeframes(bytes(48000*2*2*3))
 class Quiet(http.server.SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=temp,**kw)
  def log_message(self,*a):pass
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Quiet);threading.Thread(target=server.serve_forever,daemon=True).start()
 cmd=['clang','-arch','arm64','-O2','-fobjc-arc','-mmacosx-version-min=14.0','-I',str(r),'-c',str(root/'guest-star-bridge/macos/game-media-native-test.m'),'-o',temp+'/smoke.o'];subprocess.run(cmd,check=True,capture_output=True)
 cmd=['clang++','-arch','arm64','-std=c++17','-O3','-fobjc-arc','-pthread','-mmacosx-version-min=14.0','-I',str(r),'-I',str(sdk/'include'),temp+'/smoke.o',str(native/'reader.o'),str(r/'player_effect.mm'),'-L',str(sdk/'lib'),'-lonnxruntime','-Wl,-rpath,'+str(sdk/'lib')]
 for f in ['Cocoa','AVFoundation','AudioToolbox','CoreAudio','CoreGraphics','WebKit','CoreMedia','CoreVideo','QuartzCore']:cmd+=['-framework',f]
 subprocess.run([*cmd,'-o',temp+'/smoke'],check=True,capture_output=True);subprocess.run([temp+'/smoke','http://127.0.0.1:'+str(server.server_port)+'/silence.wav'],check=True,timeout=20);server.shutdown()
