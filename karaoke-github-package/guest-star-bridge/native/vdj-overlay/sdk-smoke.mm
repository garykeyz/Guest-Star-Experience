#import <AppKit/AppKit.h>
#import <Metal/Metal.h>
#include "vdjVideo8.h"
#include <dlfcn.h>
#include <thread>
#include <chrono>
struct Callbacks : IVdjCallbacks8 {
 int parameters=0; const char *port="8787";
 HRESULT SendCommand(const char*) override{return E_NOTIMPL;}
 HRESULT GetInfo(const char*,double*) override{return E_NOTIMPL;}
 HRESULT GetStringInfo(const char*,void*,int) override{return E_NOTIMPL;}
 HRESULT DeclareParameter(void *parameter,int type,int,const char*,const char*,float size) override{parameters++;if(type==VDJPARAM_STRING)snprintf((char*)parameter,(int)size,"%s",port);return S_OK;}
 HRESULT GetSongBuffer(int,int,short**) override{return E_NOTIMPL;}
};
struct Video : IVdjVideoCallbacks8 {
 id<MTLRenderCommandEncoder> encoder=nil;
 HRESULT DrawDeck() override{return S_OK;}
 HRESULT GetDevice(EVdjVideoEngine engine,void **device) override{if(engine!=VdjVideoEngineMetal)return S_FALSE;*device=(__bridge void*)encoder;return S_OK;}
 HRESULT GetTexture(EVdjVideoEngine,void**,TVertex**) override{return E_NOTIMPL;}
};
int main(int argc,char**argv){@autoreleasepool {
 if(argc<3)return 2;
 void *lib=dlopen(argv[1],RTLD_NOW);if(!lib){fprintf(stderr,"%s\n",dlerror());return 3;}
 auto load=(HRESULT(*)(const GUID&,const GUID&,void**))dlsym(lib,"DllGetClassObject");if(!load)return 4;
 GUID cls,iid;memset(&cls,0x5a,sizeof(cls));memset(&iid,0xa5,sizeof(iid));
 cls.Data1=CLSID_VdjPlugin8.Data1;cls.Data2=CLSID_VdjPlugin8.Data2;cls.Data3=CLSID_VdjPlugin8.Data3;memcpy(cls.Data4,CLSID_VdjPlugin8.Data4,8);
 iid.Data1=IID_IVdjPluginVideoFx8.Data1;iid.Data2=IID_IVdjPluginVideoFx8.Data2;iid.Data3=IID_IVdjPluginVideoFx8.Data3;memcpy(iid.Data4,IID_IVdjPluginVideoFx8.Data4,8);
 void *object=nullptr;if(load(cls,iid,&object)!=S_OK || !object)return 5;
 auto plugin=(IVdjPluginVideoFx8*)object;Callbacks cb;if(argc>3)cb.port=argv[3];Video video;plugin->cb=&cb;plugin->vcb=&video;plugin->width=1920;plugin->height=1080;
 TVdjPluginInfo8 info={};plugin->OnGetPluginInfo(&info);if(!(info.Flags & VDJFLAG_VIDEO_OVERLAY))return 6;
 if(plugin->OnLoad()!=S_OK || cb.parameters!=11)return 7;
 id<MTLDevice> device=MTLCreateSystemDefaultDevice();id<MTLCommandQueue> queue=[device newCommandQueue];
 MTLTextureDescriptor *desc=[MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm width:1920 height:1080 mipmapped:NO];desc.usage=MTLTextureUsageRenderTarget;desc.storageMode=MTLStorageModeShared;
 id<MTLTexture> target=[device newTextureWithDescriptor:desc];plugin->OnStart();std::this_thread::sleep_for(std::chrono::seconds(6));
 id<MTLCommandBuffer> buffer=[queue commandBuffer];MTLRenderPassDescriptor *pass=[MTLRenderPassDescriptor renderPassDescriptor];pass.colorAttachments[0].texture=target;pass.colorAttachments[0].loadAction=MTLLoadActionClear;pass.colorAttachments[0].storeAction=MTLStoreActionStore;pass.colorAttachments[0].clearColor=MTLClearColorMake(0,0,0,1);
 video.encoder=[buffer renderCommandEncoderWithDescriptor:pass];HRESULT drawn=plugin->OnDraw();[video.encoder endEncoding];[buffer commit];[buffer waitUntilCompleted];video.encoder=nil;
 if(drawn!=S_OK || buffer.status!=MTLCommandBufferStatusCompleted)return 8;
 NSBitmapImageRep *rep=[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:1920 pixelsHigh:1080 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:1920*4 bitsPerPixel:32];
 [target getBytes:rep.bitmapData bytesPerRow:1920*4 fromRegion:MTLRegionMake2D(0,0,1920,1080) mipmapLevel:0];
 size_t count=0;for(size_t i=0;i<1920*1080;i++){auto p=rep.bitmapData+i*4;std::swap(p[0],p[2]);if(p[0]>20 || p[1]>20 || p[2]>20)count++;}
 if(count<500)return 9;
 [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:@(argv[2]) atomically:YES];
 plugin->OnStop();plugin->OnDeviceClose();plugin->Release();dlclose(lib);
 printf("PASS: SDK identity with nonzero padding, 11 options, worker, real Metal pipeline, %zu visible pixels, lifecycle release\n",count);return 0;
}}
