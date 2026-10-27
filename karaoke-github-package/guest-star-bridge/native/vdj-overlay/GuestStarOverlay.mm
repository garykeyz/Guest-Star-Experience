#import "Renderer.h"
#import <Metal/Metal.h>
#import <simd/simd.h>
#import <ImageIO/ImageIO.h>
#include "vdjVideo8.h"
#include <mutex>
#include <thread>
#include <condition_variable>
#include <atomic>
#include <string>

// Own shader; no proprietary shaders or host library symbols.
static NSString *shader=@"#include <metal_stdlib>\nusing namespace metal; struct Out { float4 p [[position]]; float2 uv; }; vertex Out gs_vertex(uint i [[vertex_id]],constant float2 &scale [[buffer(0)]]) { float2 p[4]={float2(-1,1),float2(1,1),float2(-1,-1),float2(1,-1)}; float2 u[4]={float2(0,0),float2(1,0),float2(0,1),float2(1,1)}; Out o; o.p=float4(p[i]*scale,0,1);o.uv=u[i];return o;} fragment float4 gs_fragment(Out in [[stage_in]],texture2d<float> t [[texture(0)]]) { constexpr sampler s(filter::linear,address::clamp_to_edge);return t.sample(s,in.uv);}";

// Validate the public boundary before any AppKit keyed access. Bad or older
// payloads never crash the host or refresh the freshness clock.
static NSDictionary *ValidatedState(id raw) {
  if(![raw isKindOfClass:NSDictionary.class] || ![raw[@"schemaVersion"] isKindOfClass:NSNumber.class] || [raw[@"schemaVersion"] intValue]!=1 || ![raw[@"state"] isKindOfClass:NSString.class] || ![raw[@"theme"] isKindOfClass:NSDictionary.class])return nil;
  NSMutableDictionary *s=[NSMutableDictionary new];
  for(NSString *key in @[@"state",@"activityName",@"hotelName",@"teamName",@"pin",@"requestUrl",@"finalMessage",@"logo",@"teamLogo"]){id value=raw[key];s[key]=[value isKindOfClass:NSString.class] ? [value substringToIndex:MIN([value length],1024UL)] : @"";}
  for(NSString *key in @[@"enabled",@"connected",@"requestsOpen"])s[key]=@([raw[key] isKindOfClass:NSNumber.class] && [raw[key] boolValue]);
  NSMutableDictionary *theme=[NSMutableDictionary new];
  for(NSString *key in @[@"primary",@"secondary",@"accent"]){id value=raw[@"theme"][key];theme[key]=[value isKindOfClass:NSString.class] && [value length]==7 ? value : @"#ffffff";}s[@"theme"]=theme;
  auto row=[](NSDictionary *input){NSMutableDictionary *r=[NSMutableDictionary new];for(NSString *key in @[@"singerName",@"displaySongTitle",@"displayArtist",@"publicMessage",@"language",@"metadataSource"]){id value=input[key];r[key]=[value isKindOfClass:NSString.class] ? [value substringToIndex:MIN([value length],280UL)] : @"";}return r;};
  if([raw[@"current"] isKindOfClass:NSDictionary.class])s[@"current"]=row(raw[@"current"]);
  NSMutableArray *next=[NSMutableArray new];if([raw[@"next"] isKindOfClass:NSArray.class])for(id value in raw[@"next"]){if([value isKindOfClass:NSDictionary.class])[next addObject:row(value)];if(next.count>=5)break;}s[@"next"]=next;
  return s;
}
static NSImage *BoundedLogo(NSData *data) {
  if(!data || data.length>2*1024*1024)return nil;
  CGImageSourceRef source=CGImageSourceCreateWithData((__bridge CFDataRef)data,(__bridge CFDictionaryRef)@{(id)kCGImageSourceShouldCache:@NO});if(!source)return nil;
  NSDictionary *p=CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source,0,NULL));
  double w=[p[(id)kCGImagePropertyPixelWidth] doubleValue],h=[p[(id)kCGImagePropertyPixelHeight] doubleValue];
  if(w<=0 || h<=0 || w>8192 || h>8192 || w*h>32000000){CFRelease(source);return nil;}
  CGImageRef image=CGImageSourceCreateThumbnailAtIndex(source,0,(__bridge CFDictionaryRef)@{(id)kCGImageSourceCreateThumbnailFromImageAlways:@YES,(id)kCGImageSourceThumbnailMaxPixelSize:@1024,(id)kCGImageSourceCreateThumbnailWithTransform:@YES});
  CFRelease(source);if(!image)return nil;NSImage *result=[[NSImage alloc] initWithCGImage:image size:NSZeroSize];CGImageRelease(image);return result;
}

class GuestStarOverlay final : public IVdjPluginVideoFx8 {
  std::mutex mutex;
  std::condition_variable wake;
  std::thread worker;
  std::atomic<bool> running{false};
  NSDictionary *__strong options=GSDefaultOptions();
  NSData *__strong pixels=nil;
  uint64_t revision=0, uploaded=0;
  int bridgePort=8787;
  id<MTLDevice> __strong device=nil;
  id<MTLRenderPipelineState> __strong pipeline=nil;
  id<MTLTexture> __strong texture=nil;
  int showQR=1,showPIN=1,showLogo=1,showNext=1,showArtist=1,showMessage=0,showExtended=0;
  float countValue=.5,modeValue=.5,qrValue=1;
  char portText[8]="8787";
  int selectedCount=3,selectedMode=1,selectedQr=2;

  NSData *get(NSURLSession *session,NSString *path,int port,NSString *etag,NSHTTPURLResponse **out) {
    NSURL *url=[NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%d%@",port,path]];
    if(!url || ![path hasPrefix:@"/api/vdj/"])return nil;
    NSMutableURLRequest *req=[NSMutableURLRequest requestWithURL:url];req.timeoutInterval=1.5;
    if(etag)[req setValue:etag forHTTPHeaderField:@"If-None-Match"];
    dispatch_semaphore_t semaphore=dispatch_semaphore_create(0);
    __block NSData *result=nil;__block NSHTTPURLResponse *response=nil;
    NSURLSessionDataTask *task=[session dataTaskWithRequest:req completionHandler:^(NSData *data,NSURLResponse *r,NSError *error){
      if(!error && [r isKindOfClass:NSHTTPURLResponse.class]) {response=(NSHTTPURLResponse*)r;if(data.length<=2*1024*1024)result=data;}
      dispatch_semaphore_signal(semaphore);
    }];[task resume];
    if(dispatch_semaphore_wait(semaphore,dispatch_time(DISPATCH_TIME_NOW,2*NSEC_PER_SEC))) {[task cancel];return nil;}
    if(out)*out=response;return result;
  }
  void loop() {
    @autoreleasepool {
      NSURLSessionConfiguration *cfg=[NSURLSessionConfiguration ephemeralSessionConfiguration];
      cfg.URLCache=nil;cfg.HTTPCookieStorage=nil;cfg.HTTPMaximumConnectionsPerHost=1;
      NSURLSession *session=[NSURLSession sessionWithConfiguration:cfg];
      NSDictionary *state=nil,*previousOptions=nil;NSString *etag=nil,*qrUrl=nil,*logoPath=nil,*teamPath=nil;
      NSImage *qr=nil,*logo=nil,*team=nil;double lastGood=0,lastLogoAttempt=0;int oldPort=0;BOOL offline=NO;
      while(running) {
        @autoreleasepool {
          NSDictionary *opts;int port;
          {std::lock_guard<std::mutex> guard(mutex);opts=options;port=bridgePort;}
          if(port<1024 || port>65535)port=8787;
          if(port!=oldPort){etag=nil;state=nil;qr=nil;logo=nil;team=nil;qrUrl=nil;logoPath=nil;teamPath=nil;lastGood=0;oldPort=port;}
          NSHTTPURLResponse *response=nil;NSData *data=get(session,@"/api/vdj/state",port,etag,&response);
          BOOL changed=![opts isEqual:previousOptions];
          if(response.statusCode==304 && state)lastGood=NSDate.timeIntervalSinceReferenceDate;
          else if(response.statusCode==200 && data.length<65536){
            NSDictionary *value=ValidatedState([NSJSONSerialization JSONObjectWithData:data options:0 error:nil]);
            if(value) {
              changed|=![state isEqual:value];state=value;etag=response.allHeaderFields[@"Etag"] ?: response.allHeaderFields[@"ETag"];lastGood=NSDate.timeIntervalSinceReferenceDate;
            }
          }
          BOOL stale=NSDate.timeIntervalSinceReferenceDate-lastGood>8;
          changed|=offline!=stale;offline=stale;
          NSDictionary *display=offline ? @{ @"offline":@YES,@"enabled":@YES } : state;
          if(!offline){
            NSString *url=state[@"requestUrl"] ?: @"";
            if(![qrUrl isEqual:url]){qrUrl=url;qr=GSQR(url);changed=YES;}
            NSString *newLogo=state[@"logo"] ?: @"",*newTeam=state[@"teamLogo"] ?: @"";
            if(![logoPath isEqual:newLogo]){logoPath=newLogo;logo=nil;lastLogoAttempt=0;changed=YES;}
            if(![teamPath isEqual:newTeam]){teamPath=newTeam;team=nil;lastLogoAttempt=0;changed=YES;}
            if([opts[@"logo"] boolValue] && NSDate.timeIntervalSinceReferenceDate-lastLogoAttempt>60 && ((!logo && logoPath.length) || (!team && teamPath.length))) {
              lastLogoAttempt=NSDate.timeIntervalSinceReferenceDate;
              if(!logo && logoPath.length){NSData *bytes=get(session,logoPath,port,nil,nullptr);logo=BoundedLogo(bytes);changed|=logo!=nil;}
              if(!team && teamPath.length){NSData *bytes=get(session,teamPath,port,nil,nullptr);team=BoundedLogo(bytes);changed|=team!=nil;}
            }
          }
          if(changed && display){
            NSBitmapImageRep *rep=GSRender(display,opts,logo,team,qr);
            NSData *bytes=[NSData dataWithBytes:rep.bitmapData length:rep.bytesPerRow*rep.pixelsHigh];
            {std::lock_guard<std::mutex> guard(mutex);pixels=bytes;revision++;}
            previousOptions=opts;
          }
        }
        std::unique_lock<std::mutex> lock(mutex);wake.wait_for(lock,std::chrono::milliseconds(offline ? 5000 : 1000),[&]{return !running;});
      }
      [session invalidateAndCancel];
    }
  }
  void stop(){running=false;wake.notify_all();if(worker.joinable())worker.join();}
public:
  ~GuestStarOverlay(){stop();}
  HRESULT VDJ_API OnGetPluginInfo(TVdjPluginInfo8 *info) override {
    info->PluginName="Guest Star Karaoke";info->Author="Guest Star Experience";
    info->Description="Native Metal overlay · localhost public display data";info->Version="1.0.2";
    info->Flags=VDJFLAG_VIDEO_OVERLAY|VDJFLAG_VIDEO_MASTERONLY|VDJFLAG_VIDEO_VISUALISATION;info->Bitmap=nullptr;return S_OK;
  }
  HRESULT VDJ_API OnLoad() override {
    DeclareParameterSwitch(&showQR,1,"Show QR","QR",true);
    DeclareParameterSwitch(&showPIN,2,"Show PIN","PIN",true);
    DeclareParameterSwitch(&showLogo,3,"Show logo","Logo",true);
    DeclareParameterSwitch(&showNext,4,"Show Next Singer","Next",true);
    DeclareParameterSwitch(&showArtist,5,"Show artist","Artist",true);
    DeclareParameterSwitch(&showMessage,6,"Show guest message (FULL)","Message",false);
    DeclareParameterSwitch(&showExtended,7,"Extended metadata (FULL)","Details",false);
    DeclareParameterSlider(&countValue,8,"Next singers: 1 / 2 / 3 / 5","Count",.5);
    DeclareParameterSlider(&modeValue,9,"MINIMAL / STANDARD / FULL","Mode",.5);
    DeclareParameterSlider(&qrValue,10,"QR: ALWAYS / BETWEEN / HIDE DURING","QR mode",1);
    DeclareParameterString(portText,11,"Guest Star localhost port","Port",sizeof(portText));
    return OnParameter(0);
  }
  HRESULT VDJ_API OnParameter(int) override {
    int counts[]={1,2,3,5};selectedCount=counts[MIN(3,MAX(0,(int)lround(countValue*3)))];
    selectedMode=MIN(2,MAX(0,(int)lround(modeValue*2)));selectedQr=MIN(2,MAX(0,(int)lround(qrValue*2)));
    {std::lock_guard<std::mutex> guard(mutex); bridgePort=atoi(portText); options=@{@"qr":@(showQR!=0),@"pin":@(showPIN!=0),@"logo":@(showLogo!=0),@"next":@(showNext!=0),@"artist":@(showArtist!=0),@"message":@(showMessage!=0),@"extended":@(showExtended!=0),@"count":@(selectedCount),@"mode":@(selectedMode),@"qrMode":@(selectedQr)};}
    return S_OK;
  }
  HRESULT VDJ_API OnGetParameterString(int id,char *out,int size) override {
    const char *modes[]={"MINIMAL","STANDARD","FULL"},*qrs[]={"ALWAYS","BETWEEN SONGS","HIDE DURING SONG"};
    if(id==8)snprintf(out,size,"%d",selectedCount);
    else if(id==9)snprintf(out,size,"%s",modes[selectedMode]);
    else if(id==10)snprintf(out,size,"%s",qrs[selectedQr]);else return E_NOTIMPL;return S_OK;
  }
  HRESULT VDJ_API OnStart() override {OnParameter(0);if(!running.exchange(true)){try{worker=std::thread([this]{loop();});}catch(...){running=false;return S_FALSE;}}return S_OK;}
  HRESULT VDJ_API OnStop() override {stop();return S_OK;}
  HRESULT VDJ_API OnDeviceClose() override {texture=nil;pipeline=nil;device=nil;uploaded=0;return S_OK;}
  HRESULT VDJ_API OnDraw() override {
    @autoreleasepool {
      // Some hosts resume the video device without another effect OnStart.
      // Recover the single worker on the first real draw after that transition.
      if(!running)OnStart();
      void *ptr=nullptr;if(GetDevice(VdjVideoEngineMetal,&ptr)!=S_OK || !ptr)return S_FALSE;
      id<MTLRenderCommandEncoder> encoder=(__bridge id<MTLRenderCommandEncoder>)ptr;
      if(device!=encoder.device){OnDeviceClose();device=encoder.device;}
      if(!pipeline){
        NSError *error=nil;id<MTLLibrary> lib=[device newLibraryWithSource:shader options:nil error:&error];if(!lib)return S_FALSE;
        MTLRenderPipelineDescriptor *p=[MTLRenderPipelineDescriptor new];p.vertexFunction=[lib newFunctionWithName:@"gs_vertex"];p.fragmentFunction=[lib newFunctionWithName:@"gs_fragment"];
        p.colorAttachments[0].pixelFormat=MTLPixelFormatBGRA8Unorm;p.colorAttachments[0].blendingEnabled=YES;
        p.colorAttachments[0].sourceRGBBlendFactor=MTLBlendFactorOne;p.colorAttachments[0].destinationRGBBlendFactor=MTLBlendFactorOneMinusSourceAlpha;
        p.colorAttachments[0].sourceAlphaBlendFactor=MTLBlendFactorOne;p.colorAttachments[0].destinationAlphaBlendFactor=MTLBlendFactorOneMinusSourceAlpha;
        pipeline=[device newRenderPipelineStateWithDescriptor:p error:&error];if(!pipeline)return S_FALSE;
      }
      NSData *bytes=nil;uint64_t rev=uploaded;
      {std::unique_lock<std::mutex> lock(mutex,std::try_to_lock);if(lock.owns_lock() && revision!=uploaded){bytes=pixels;rev=revision;}}
      if(bytes){
        // New immutable texture only on a display revision. Submitted frames keep
        // their old texture alive; never overwrite a texture in GPU use.
        MTLTextureDescriptor *d=[MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm width:1920 height:1080 mipmapped:NO];d.usage=MTLTextureUsageShaderRead;d.storageMode=MTLStorageModeShared;
        texture=[device newTextureWithDescriptor:d];[texture replaceRegion:MTLRegionMake2D(0,0,1920,1080) mipmapLevel:0 withBytes:bytes.bytes bytesPerRow:1920*4];uploaded=rev;
      }
      if(!texture || width<=0 || height<=0)return S_OK;
      float aspect=(float)width/height,canvas=1920.f/1080.f;
      simd_float2 scale={aspect>canvas ? canvas/aspect : 1.f,aspect<canvas ? aspect/canvas : 1.f};
      [encoder setRenderPipelineState:pipeline];[encoder setVertexBytes:&scale length:sizeof(scale) atIndex:0];[encoder setFragmentTexture:texture atIndex:0];[encoder setCullMode:MTLCullModeNone];
      [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];return S_OK;
    }
  }
};
extern "C" VDJ_EXPORT HRESULT VDJ_API DllGetClassObject(const GUID &cls,const GUID &iid,void **object) {
  if(!object)return CLASS_E_CLASSNOTAVAILABLE;*object=nullptr;
  auto equal=[](const GUID &a,const GUID &b){return a.Data1==b.Data1 && a.Data2==b.Data2 && a.Data3==b.Data3 && !memcmp(a.Data4,b.Data4,8);};
  if(!equal(cls,CLSID_VdjPlugin8) || !equal(iid,IID_IVdjPluginVideoFx8))return CLASS_E_CLASSNOTAVAILABLE;
  *object=new GuestStarOverlay();return S_OK;
}
