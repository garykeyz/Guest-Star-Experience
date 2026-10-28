#import "player_effect.h"
#include "realtime_effect.hpp"
#include "onnx_vocal.hpp"
#include <thread>

struct GSVRetiredEffect {
  std::unique_ptr<gsv::RealtimeEffect> effect;
  std::unique_ptr<gsv::OnnxVocalEstimator> model;
  GSVRetiredEffect(std::unique_ptr<gsv::RealtimeEffect> e, std::unique_ptr<gsv::OnnxVocalEstimator> m)
    : effect(std::move(e)), model(std::move(m)) {}
};

struct GSVRenderGuard {
  std::atomic<unsigned>& users;
  explicit GSVRenderGuard(std::atomic<unsigned>& value):users(value){users.fetch_add(1);}
  ~GSVRenderGuard(){users.fetch_sub(1);}
};

@interface GSVAudioUnit : AUAudioUnit {
  AUAudioUnitBus *_inputBus,*_outputBus;
  AUAudioUnitBusArray *_inputs,*_outputs;
  std::unique_ptr<gsv::OnnxVocalEstimator> _model;
  std::unique_ptr<gsv::RealtimeEffect> _effect;
  std::atomic<gsv::RealtimeEffect*> _renderEffect;
  std::atomic<unsigned> _renderUsers;
  BOOL _selected;
  std::atomic<bool> _playing,_pressure,_enabled;
  std::atomic<float> _gain;
  std::array<float,4096> _scratchL,_scratchR;
  AVAudioPCMBuffer *_pullBuffer;
  AudioBufferList *_backing;
  dispatch_source_t _memoryPressure;
  NSTimer *_resourceTimer;
  BOOL _memoryWarning;
  uint64_t _lastPredictions,_lastInferenceNs;
  std::atomic<uint64_t> _renderCalls,_maxQuantum;
  std::atomic<unsigned> _latencySamples;
  unsigned _bytesPerBufferFrame;
}
- (void)transportBoundary;
- (void)selectedEngine:(BOOL)selected;
- (void)transportPlaying:(BOOL)playing;
- (void)separationEnabled:(BOOL)enabled;
- (void)vocalGain:(float)gain;
- (void)resourcePressure:(BOOL)pressure;
- (NSDictionary *)diagnostics;
@end
@implementation GSVAudioUnit
- (instancetype)initWithComponentDescription:(AudioComponentDescription)description options:(AudioComponentInstantiationOptions)options error:(NSError **)error {
  self=[super initWithComponentDescription:description options:options error:error];
  if(!self)return nil;
  AVAudioFormat* f=[[AVAudioFormat alloc] initStandardFormatWithSampleRate:44100 channels:2];
  _inputBus=[[AUAudioUnitBus alloc] initWithFormat:f error:error];_outputBus=[[AUAudioUnitBus alloc] initWithFormat:f error:error];
  if(!_inputBus||!_outputBus)return nil;
  _inputs=[[AUAudioUnitBusArray alloc] initWithAudioUnit:self busType:AUAudioUnitBusTypeInput busses:@[_inputBus]];
  _outputs=[[AUAudioUnitBusArray alloc] initWithAudioUnit:self busType:AUAudioUnitBusTypeOutput busses:@[_outputBus]];
  _playing=false;_pressure=false;_enabled=true;_gain=0;self.maximumFramesToRender=4096;
  _renderEffect=nullptr;_renderUsers=0;_selected=YES;
  _latencySamples=0;
  return self;
}
- (void)startResourceMonitoring {
  if(_resourceTimer)return;
  __weak GSVAudioUnit* weak=self;
  _memoryPressure=dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE,0,
    DISPATCH_MEMORYPRESSURE_NORMAL|DISPATCH_MEMORYPRESSURE_WARN|DISPATCH_MEMORYPRESSURE_CRITICAL,dispatch_get_main_queue());
  if(_memoryPressure) {
    dispatch_source_set_event_handler(_memoryPressure,^{GSVAudioUnit* u=weak;if(!u)return;
      u->_memoryWarning=(dispatch_source_get_data(u->_memoryPressure)&(DISPATCH_MEMORYPRESSURE_WARN|DISPATCH_MEMORYPRESSURE_CRITICAL))!=0;
      [u resourcePressure:u->_memoryWarning];});dispatch_resume(_memoryPressure);
  }
  _resourceTimer=[NSTimer scheduledTimerWithTimeInterval:2 repeats:YES block:^(__unused NSTimer* timer){
    GSVAudioUnit* u=weak;if(!u)return;double load=0;getloadavg(&load,1);
    BOOL hot=NSProcessInfo.processInfo.thermalState>=NSProcessInfoThermalStateSerious;
    BOOL busy=load/MAX(1.,double(NSProcessInfo.processInfo.activeProcessorCount))>.8;
    BOOL slow=NO;
    if(u->_effect){auto& m=u->_effect->metrics();auto count=m.predictions.load(),ns=m.inferenceNs.load();
      if(count>u->_lastPredictions)slow=double(ns-u->_lastInferenceNs)/1e9/((count-u->_lastPredictions)*128/u->_outputBus.format.sampleRate)>.8;
      u->_lastPredictions=count;u->_lastInferenceNs=ns;}
    [u resourcePressure:u->_memoryWarning||hot||busy||slow];
  }];
}
- (void)dealloc{[_resourceTimer invalidate];if(_memoryPressure)dispatch_source_cancel(_memoryPressure);}
- (AUAudioUnitBusArray*)inputBusses{return _inputs;}
- (AUAudioUnitBusArray*)outputBusses{return _outputs;}
- (NSTimeInterval)latency{return _latencySamples.load()/MAX(1.,_outputBus.format.sampleRate);}
- (BOOL)allocateRenderResourcesAndReturnError:(NSError**)error {
  if(![super allocateRenderResourcesAndReturnError:error])return NO;
  AVAudioFormat* format=_outputBus.format;
  _pullBuffer=[[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:4096];
  if(!_pullBuffer)return NO;
  _pullBuffer.frameLength=4096;
  _backing=_pullBuffer.mutableAudioBufferList;
  _bytesPerBufferFrame=_backing->mBuffers[0].mDataByteSize/4096;
  if((format.sampleRate!=44100)||format.commonFormat!=AVAudioPCMFormatFloat32||format.isInterleaved||
      (format.channelCount!=1&&format.channelCount!=2)||![_inputBus.format isEqual:format])return YES; // separation unsupported: dry audio
  [self selectedEngine:_selected];
  return YES;
}
- (void)selectedEngine:(BOOL)selected {
  _selected=selected;
  if(!selected) {
    // Publish dry first, then reclaim off the render thread. Readers entering
    // after publication see null; a prior reader owns only this bounded epoch.
    [_resourceTimer invalidate];_resourceTimer=nil;
    if(_memoryPressure){dispatch_source_cancel(_memoryPressure);_memoryPressure=nil;}
    _memoryWarning=NO;_pressure.store(false);
    _renderEffect.store(nullptr);
    _latencySamples.store(0);
    // Session shutdown can wait for an in-flight inference. Reclaim it on a
    // utility queue, after existing render readers finish, never on UI/audio.
    auto retired=std::make_shared<GSVRetiredEffect>(std::move(_effect),std::move(_model));
    GSVAudioUnit* unit=self;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{
      while(unit->_renderUsers.load())std::this_thread::sleep_for(std::chrono::microseconds(100));
      retired->effect.reset();retired->model.reset();
    });
    _lastPredictions=0;_lastInferenceNs=0;
    return;
  }
  if(_effect||!_pullBuffer)return;
  AVAudioFormat* format=_outputBus.format;
  if((format.sampleRate!=44100)||format.commonFormat!=AVAudioPCMFormatFloat32||format.isInterleaved||
    (format.channelCount!=1&&format.channelCount!=2)||![_inputBus.format isEqual:format])return;
  NSString* path=NSProcessInfo.processInfo.environment[@"GUEST_STAR_VOCALRT_MODEL"];
  try {
    _model=std::make_unique<gsv::OnnxVocalEstimator>(path.UTF8String?:"");
    _effect=std::make_unique<gsv::RealtimeEffect>(*_model,unsigned(format.sampleRate));
    _effect->gain(_gain.load());_effect->enabled(_enabled.load());_effect->playing(_playing.load());_effect->pressure(_pressure.load());
    _renderEffect.store(_effect.get());
    _latencySamples.store(_effect->latencySamples());
    [self startResourceMonitoring];
  } catch(...) {_effect.reset();_model.reset();}
}
- (void)deallocateRenderResources {
  // AVAudioEngine has stopped rendering before this lifecycle call.
  const BOOL selected=_selected;[self selectedEngine:NO];_selected=selected;
  _pullBuffer=nil;[super deallocateRenderResources];
}
- (void)transportBoundary{if(_effect)_effect->boundary();}
- (void)transportPlaying:(BOOL)playing{_playing.store(playing);if(_effect)_effect->playing(playing);}
- (void)separationEnabled:(BOOL)enabled{_enabled.store(enabled);if(_effect)_effect->enabled(enabled);}
- (void)vocalGain:(float)gain{_gain.store(gain);if(_effect)_effect->gain(gain);}
- (void)resourcePressure:(BOOL)pressure{_pressure.store(pressure);if(_effect)_effect->pressure(pressure);}
- (NSDictionary *)diagnostics {
  if(!_effect)return @{@"prototype":@NO,@"selected":@(_selected),@"allocated":@NO,@"workers":@0};
  auto& m=_effect->metrics();
  return @{@"prototype":@NO,@"model":@"vocal-stream-v1",@"stems":@2,@"model_ready":@(_model&&_model->ready()),@"model_failed":@(_model&&_model->failed()),@"model_load_ms":@(_model?_model->loadMs():0),@"selected":@(_selected),@"allocated":@YES,@"workers":@1,@"enabled":@(_enabled.load()),@"predictions":@(m.predictions.load()),@"failures":@(m.failures.load()),
    @"missed_estimate_callbacks":@(m.missedCallbacks.load()),@"missed_estimate_frames":@(m.missedFrames.load()),
    @"stale_results":@(m.staleResults.load()),@"pressure":@(_pressure.load()),@"latency_seconds":@(self.latency),
    @"render_calls":@(_renderCalls.load()),@"max_render_quantum":@(_maxQuantum.load()),
    @"guide_level":@(_gain.load()),@"gain_changes":@(m.gainChanges.load()),@"preparations":@(m.preparations.load()),@"state_resets":@(m.resets.load()),
    @"inference_ns":@(m.inferenceNs.load()),@"inference_max_ms":@(m.maxInferenceNs.load()/1e6),
    @"inference_mean_ms":@(m.predictions.load()?m.inferenceNs.load()/1e6/m.predictions.load():0),
    @"inference_p50_ms_upper_10us_bin":@(m.quantileMs(.5)),@"inference_p95_ms_upper_10us_bin":@(m.quantileMs(.95)),
    @"inference_p99_ms_upper_10us_bin":@(m.quantileMs(.99)),
    @"inference_rtf":@(m.predictions.load()?m.inferenceNs.load()/1e9/(m.predictions.load()*128/_outputBus.format.sampleRate):0)};
}
- (AUInternalRenderBlock)internalRenderBlock {
  // Unretained pointer is valid while AU owns its render resources. No ObjC
  // messages, tensor objects, model inference or locks in the render block.
  GSVAudioUnit* __unsafe_unretained unit=self;
  return ^AUAudioUnitStatus(AudioUnitRenderActionFlags* flags,const AudioTimeStamp* timestamp,AVAudioFrameCount count,
      NSInteger bus,AudioBufferList* data,const AURenderEvent* events,AURenderPullInputBlock pull) {
    if(!pull)return kAudioUnitErr_NoConnection;
    if(count>4096)return kAudioUnitErr_TooManyFramesToProcess;
    ++unit->_renderCalls;auto maximum=unit->_maxQuantum.load();
    while(maximum<count&&!unit->_maxQuantum.compare_exchange_weak(maximum,count)){}
    AudioBufferList* backing=unit->_backing;
    if(data->mNumberBuffers!=backing->mNumberBuffers)return kAudioUnitErr_FormatNotSupported;
    for(unsigned c=0;c<data->mNumberBuffers;++c) {
      if(!data->mBuffers[c].mData)data->mBuffers[c].mData=backing->mBuffers[c].mData;
      data->mBuffers[c].mDataByteSize=count*unit->_bytesPerBufferFrame;
    }
    GSVRenderGuard reader(unit->_renderUsers);
    auto* effect=unit->_renderEffect.load();
    const uint64_t sourceEpoch=effect?effect->captureEpoch():0;
    AUAudioUnitStatus status=pull(flags,timestamp,count,0,data);
    if(status!=noErr)return status; // decoder/output errors belong to Player
    if(!effect)return noErr;
    auto* left=static_cast<float*>(data->mBuffers[0].mData);
    auto* right=data->mNumberBuffers==2?static_cast<float*>(data->mBuffers[1].mData):nullptr;
    std::copy_n(left,count,unit->_scratchL.data());if(right)std::copy_n(right,count,unit->_scratchR.data());
    effect->process(unit->_scratchL.data(),right?unit->_scratchR.data():nullptr,left,right?right:unit->_scratchR.data(),count,sourceEpoch);
    *flags&=~kAudioUnitRenderAction_OutputIsSilence;
    return noErr;
  };
}
@end

static AudioComponentDescription description() {AudioComponentDescription d{};d.componentType=kAudioUnitType_Effect;d.componentSubType='gsvr';d.componentManufacturer='Gstr';return d;}
AVAudioUnit *GSVCreatePlayerEffect(void) {
  static dispatch_once_t once;
  dispatch_once(&once,^{[AUAudioUnit registerSubclass:GSVAudioUnit.class asComponentDescription:description() name:@"Guest Star: Vocal Streaming" version:1];});
  try{@try{return [[AVAudioUnitEffect alloc] initWithAudioComponentDescription:description()];}
      @catch(__unused NSException* error){return nil;}}
  catch(...){return nil;}
}
static GSVAudioUnit* implementation(AVAudioUnit* unit) {return [unit.AUAudioUnit isKindOfClass:GSVAudioUnit.class]?(GSVAudioUnit*)unit.AUAudioUnit:nil;}
void GSVPlayerEffectSelected(AVAudioUnit* unit,BOOL v){[implementation(unit) selectedEngine:v];}
void GSVPlayerEffectBoundary(AVAudioUnit* unit){[implementation(unit) transportBoundary];}
void GSVPlayerEffectPlaying(AVAudioUnit* unit,BOOL v){[implementation(unit) transportPlaying:v];}
void GSVPlayerEffectEnabled(AVAudioUnit* unit,BOOL v){[implementation(unit) separationEnabled:v];}
void GSVPlayerEffectGain(AVAudioUnit* unit,float v){[implementation(unit) vocalGain:v];}
void GSVPlayerEffectPressure(AVAudioUnit* unit,BOOL v){[implementation(unit) resourcePressure:v];}
NSDictionary* GSVPlayerEffectDiagnostics(AVAudioUnit* unit){return [implementation(unit) diagnostics]?:@{};}
