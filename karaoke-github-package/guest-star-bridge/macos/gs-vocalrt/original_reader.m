#import "original_reader.h"
#import <CoreMedia/CoreMedia.h>
#include <stdatomic.h>
#include <math.h>
#include <os/lock.h>

// TimePitch pulls source PCM in bursts, independently of the 128-frame
// separator hop. A 128 KiB pool covers that upstream burst without decoding
// on audio render or loading a song. Initial 3 blocks are prepared off-thread.
enum { GSV_POOL=4,GSV_PCM_FRAMES=4096,GSV_MAX_PACKET_FRAMES=65536 };
static NSError* decoderError(NSString* message){return [NSError errorWithDomain:@"GS-VocalRT Decoder" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];}

@interface GSVOriginalReader(){
  AVURLAsset *_asset;AVAssetReader *_reader;AVAssetReaderTrackOutput *_output;
  AVAudioPCMBuffer *_pool[GSV_POOL];
  _Atomic(uint64_t) _generation,_tickets[GSV_POOL];
  _Atomic(bool) _closed,_prepared,_cachedStart;
  dispatch_queue_t _queue;dispatch_source_t _timer;
  __weak AVAudioPlayerNode *_player;
  GSVOriginalReader *_lifetimeHold;
  CMSampleBufferRef _pending;
  unsigned _pendingOffset,_pendingFrames,_nextSlot;
  uint64_t _nextTicket,_decodeGeneration,_decodedFrames,_peakPacketFrames;
  double _scheduledPosition;BOOL _ended;unsigned _cachedCount;
  float _scratch[GSV_PCM_FRAMES*2];
  NSError *_failure;
  void (^_readyCompletion)(BOOL, NSError *);
  uint64_t _readyGeneration;
  os_unfair_lock _scheduleLock; // decoder/control only, never audio completion
}
@property(nonatomic,readwrite) NSString *kind;
@property(nonatomic,readwrite) AVAudioFormat *format;
@property(nonatomic,readwrite) AVAudioFramePosition frameCount;
@end

@implementation GSVOriginalReader
+ (void)prepareURL:(NSURL*)url completion:(void (^)(GSVOriginalReader*,NSError*))completion {
  // Metadata and initial three PCM blocks are prepared on a serial decoder
  // queue. No download, M4A export or whole-song expansion takes place.
  GSVOriginalReader* r=[GSVOriginalReader new];
  r->_queue=dispatch_queue_create("com.gstarxp.vocalrt.original-decoder",dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL,QOS_CLASS_USER_INITIATED,0));
  r->_asset=[AVURLAsset URLAssetWithURL:url options:nil];r.kind=@"original";
  r->_scheduleLock=OS_UNFAIR_LOCK_INIT;
  r.format=[[AVAudioFormat alloc] initStandardFormatWithSampleRate:44100 channels:2];
  atomic_init(&r->_generation,1);atomic_init(&r->_closed,false);atomic_init(&r->_prepared,false);
  atomic_init(&r->_cachedStart,false);
  for(unsigned i=0;i<GSV_POOL;i++)atomic_init(&r->_tickets[i],0);
  [r->_asset loadValuesAsynchronouslyForKeys:@[@"tracks",@"duration"] completionHandler:^{
    dispatch_async(r->_queue,^{
      double duration=CMTimeGetSeconds(r->_asset.duration);
      if(!isfinite(duration)||duration<=0||[r->_asset tracksWithMediaType:AVMediaTypeAudio].count==0){completion(nil,decoderError(@"La fuente no contiene audio local válido."));return;}
      r.frameCount=(AVAudioFramePosition)llround(duration*44100);
      for(unsigned i=0;i<GSV_POOL;i++){
        r->_pool[i]=[[AVAudioPCMBuffer alloc] initWithPCMFormat:r.format frameCapacity:GSV_PCM_FRAMES];
        if(!r->_pool[i]){completion(nil,decoderError(@"No se pudo reservar el buffer PCM."));return;}
      }
      if(![r openAt:0]){completion(nil,r->_failure);return;}
      for(unsigned i=0;i<3;i++){if(![r decodeInto:r->_pool[i]])break;r->_cachedCount++;}
      if(r->_cachedCount==0){completion(nil,r->_failure?:decoderError(@"No se pudo decodificar el comienzo del audio."));return;}
      atomic_store(&r->_cachedStart,true);r->_lifetimeHold=r;
      r->_timer=dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER,0,0,r->_queue);
      __weak GSVOriginalReader* weak=r;
      dispatch_source_set_timer(r->_timer,dispatch_time(DISPATCH_TIME_NOW,0),2*NSEC_PER_MSEC,NSEC_PER_MSEC);
      dispatch_source_set_event_handler(r->_timer,^{[weak refill];});dispatch_resume(r->_timer);
      completion(r,nil);
    });
  }];
}
- (BOOL)openAt:(double)position {
  if(_pending){CFRelease(_pending);_pending=NULL;}
  [_reader cancelReading];_reader=nil;_output=nil;_ended=NO;_failure=nil;_nextSlot=0;
  NSError* error=nil;_reader=[[AVAssetReader alloc] initWithAsset:_asset error:&error];
  if(!_reader){_failure=error;return NO;}
  NSDictionary* settings=@{AVFormatIDKey:@(kAudioFormatLinearPCM),AVSampleRateKey:@44100,AVNumberOfChannelsKey:@2,
    AVLinearPCMBitDepthKey:@32,AVLinearPCMIsFloatKey:@YES,AVLinearPCMIsBigEndianKey:@NO,AVLinearPCMIsNonInterleaved:@NO};
  AVAssetTrack* track=[_asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
  _output=[[AVAssetReaderTrackOutput alloc] initWithTrack:track outputSettings:settings];_output.alwaysCopiesSampleData=NO;
  if(![_reader canAddOutput:_output]){_failure=decoderError(@"El decoder no acepta la pista de audio.");return NO;}
  [_reader addOutput:_output];
  CMTime start=CMTimeMakeWithSeconds(position,44100);
  _reader.timeRange=CMTimeRangeMake(start,CMTimeSubtract(_asset.duration,start));
  if(![_reader startReading]){_failure=_reader.error?:decoderError(@"No se pudo iniciar el decoder local.");return NO;}
  return YES;
}
- (BOOL)decodeInto:(AVAudioPCMBuffer*)buffer {
  unsigned filled=0,packets=0;
  while(filled<GSV_PCM_FRAMES&&!_ended&&!atomic_load(&_closed)){
    if(!_pending){
      if(++packets>32){_failure=decoderError(@"Demasiados packets vacíos de audio.");_ended=YES;break;}
      _pending=[_output copyNextSampleBuffer];_pendingOffset=0;
      if(!_pending){_ended=YES;_failure=_reader.status==AVAssetReaderStatusFailed?_reader.error:nil;break;}
      _pendingFrames=(unsigned)CMSampleBufferGetNumSamples(_pending);_peakPacketFrames=MAX(_peakPacketFrames,_pendingFrames);
      if(_pendingFrames==0){CFRelease(_pending);_pending=NULL;continue;}
      if(_pendingFrames>GSV_MAX_PACKET_FRAMES){_failure=decoderError(@"El packet PCM superó el límite de memoria.");_ended=YES;break;}
      // AVAssetReader applies its timeRange at seek; require finite PTS.
      if(!CMTIME_IS_NUMERIC(CMSampleBufferGetPresentationTimeStamp(_pending))){_failure=decoderError(@"El audio tiene timestamps inválidos.");_ended=YES;break;}
    }
    unsigned n=MIN(GSV_PCM_FRAMES-filled,_pendingFrames-_pendingOffset);
    CMBlockBufferRef data=CMSampleBufferGetDataBuffer(_pending);
    if(!data||CMBlockBufferCopyDataBytes(data,_pendingOffset*2*sizeof(float),n*2*sizeof(float),_scratch)!=kCMBlockBufferNoErr){_failure=decoderError(@"No se pudo leer PCM estéreo.");_ended=YES;break;}
    BOOL valid=YES;for(unsigned i=0;i<n*2;i++)valid=valid&&isfinite(_scratch[i]);
    if(!valid){_failure=decoderError(@"El audio contiene PCM no finito.");_ended=YES;break;}
    for(unsigned i=0;i<n;i++)for(unsigned c=0;c<2;c++)buffer.floatChannelData[c][filled+i]=_scratch[i*2+c];
    filled+=n;_pendingOffset+=n;
    if(_pendingOffset==_pendingFrames){CFRelease(_pending);_pending=NULL;}
  }
  buffer.frameLength=filled;_decodedFrames+=filled;return filled>0;
}
- (void)scheduleBuffer:(unsigned)slot player:(AVAudioPlayerNode*)player {
  uint64_t ticket=++_nextTicket;atomic_store(&_tickets[slot],ticket);
  // Lifetime is retained by the decoder until close + every queued slot is
  // returned. This completion does exactly one lock-free atomic operation.
  __unsafe_unretained GSVOriginalReader* r=self;
  [player scheduleBuffer:_pool[slot] completionCallbackType:AVAudioPlayerNodeCompletionDataConsumed completionHandler:^(__unused AVAudioPlayerNodeCompletionCallbackType type){
    uint64_t expected=ticket;atomic_compare_exchange_strong(&r->_tickets[slot],&expected,0);
  }];
}
- (BOOL)scheduleFromPosition:(double)position player:(AVAudioPlayerNode*)player error:(NSError**)error {
  if(atomic_load(&_closed)||!isfinite(position)||position<0||position>=self.frameCount/44100.)return NO;
  uint64_t gen=atomic_fetch_add(&_generation,1)+1;_player=player;_scheduledPosition=position;atomic_store(&_prepared,false);
  if(position==0&&atomic_load(&_cachedStart)){
    _decodeGeneration=gen;
    for(unsigned i=0;i<_cachedCount;i++)[self scheduleBuffer:i player:player];_nextSlot=_cachedCount;atomic_store(&_prepared,true);
    atomic_store(&_cachedStart,false); // publish the cache handoff last
    return YES;
  }
  atomic_store(&_cachedStart,false);
  dispatch_async(_queue,^{
    if(gen!=atomic_load(&self->_generation)||atomic_load(&self->_closed))return;
    // stop/seek returns previous tickets before the PCM buffers are reused.
    self->_decodeGeneration=gen;
    if([self openAt:position])[self refill];
  });
  return YES;
}
- (BOOL)isPreparedForPosition:(double)position{return atomic_load(&_prepared)&&fabs(_scheduledPosition-position)<1e-6;}
- (void)completePreparationIfReady {
  if (!_readyCompletion) return;
  BOOL cancelled = _readyGeneration != atomic_load(&_generation) || atomic_load(&_closed);
  BOOL ready = atomic_load(&_prepared);
  if (!cancelled && !ready && !_failure && !_ended) return;
  void (^completion)(BOOL, NSError *) = _readyCompletion;
  _readyCompletion = nil;
  NSError *error = cancelled ? decoderError(@"La preparación fue sustituida.") :
    ready ? nil : (_failure ?: decoderError(@"No hay samples disponibles en esta posición."));
  dispatch_async(dispatch_get_main_queue(), ^{ completion(!cancelled && ready, error); });
}
- (void)whenPreparedForPosition:(double)position completion:(void (^)(BOOL, NSError *))completion {
  if (!completion) return;
  uint64_t generation = atomic_load(&_generation);
  dispatch_async(_queue, ^{
    // One bounded readiness waiter per source generation; superseding work
    // cancels its owner instead of polling the UI run loop every 2ms.
    if (self->_readyCompletion) {
      void (^previous)(BOOL, NSError *) = self->_readyCompletion;
      dispatch_async(dispatch_get_main_queue(), ^{ previous(NO, decoderError(@"La preparación fue sustituida.")); });
    }
    self->_readyGeneration = generation;
    self->_readyCompletion = completion;
    if (fabs(self->_scheduledPosition-position)>1e-6) {
      self->_readyGeneration = 0;
    }
    [self completePreparationIfReady];
  });
}
- (void)refill {
  [self completePreparationIfReady];
  if(atomic_load(&_closed)){
    [_reader cancelReading];
    BOOL free=YES;for(unsigned i=0;i<GSV_POOL;i++)free=free&&atomic_load(&_tickets[i])==0;
    if(free){dispatch_source_cancel(_timer);_timer=nil;_lifetimeHold=nil;}return;
  }
  if(!_player||atomic_load(&_cachedStart)||_ended||_decodeGeneration!=atomic_load(&_generation))return;
  for(unsigned n=0;n<GSV_POOL;n++){
    unsigned slot=_nextSlot;
    if(atomic_load(&_tickets[slot])!=0)return;
    uint64_t gen=_decodeGeneration;
    if(![self decodeInto:_pool[slot]]){
      os_unfair_lock_lock(&_scheduleLock);
      if(_ended&&!_failure&&gen==atomic_load(&_generation)&&!atomic_load(&_closed)){
        unsigned queued=0;for(unsigned i=0;i<GSV_POOL;i++)queued+=atomic_load(&_tickets[i])!=0;if(queued)atomic_store(&_prepared,true);
      }
      os_unfair_lock_unlock(&_scheduleLock);
      [self completePreparationIfReady];
      return;
    }
    os_unfair_lock_lock(&_scheduleLock);
    if(gen!=atomic_load(&_generation)||atomic_load(&_closed)){os_unfair_lock_unlock(&_scheduleLock);return;}
    [self scheduleBuffer:slot player:_player];_nextSlot=(slot+1)%GSV_POOL;
    unsigned queued=0;for(unsigned i=0;i<GSV_POOL;i++)queued+=atomic_load(&_tickets[i])!=0;
    // A valid final partial block is playable even when fewer than three
    // pool slots remain. Publish ready before resolving an EOF waiter.
    if(queued>=3||(_ended&&!_failure&&queued>0))atomic_store(&_prepared,true);
    os_unfair_lock_unlock(&_scheduleLock);
    [self completePreparationIfReady];
  }
}
- (void)invalidate{os_unfair_lock_lock(&_scheduleLock);atomic_fetch_add(&_generation,1);atomic_store(&_prepared,false);os_unfair_lock_unlock(&_scheduleLock);
  dispatch_async(_queue, ^{ [self completePreparationIfReady]; });
}
- (void)close{[self invalidate];atomic_store(&_closed,true);}
- (NSDictionary*)diagnostics{
  __block NSDictionary* snapshot=nil;
  // Read only from control/test threads; never used inside the audio callback.
  dispatch_sync(_queue,^{snapshot=@{@"decoded_frames":@(self->_decodedFrames),@"peak_packet_frames":@(self->_peakPacketFrames),
    @"pcm_pool_bytes":@(GSV_POOL*GSV_PCM_FRAMES*2*sizeof(float)),@"rate":@44100,@"full_song_buffered":@NO,
    @"closed":@(atomic_load(&self->_closed)),@"lifetime_hold":@(self->_lifetimeHold!=nil),
    @"queued_slots":@((atomic_load(&self->_tickets[0])!=0)+(atomic_load(&self->_tickets[1])!=0)+(atomic_load(&self->_tickets[2])!=0)+(atomic_load(&self->_tickets[3])!=0)),
    @"error":self->_failure.localizedDescription?:@""};});return snapshot;
}
- (void)dealloc{if(_pending)CFRelease(_pending);[_reader cancelReading];if(_timer)dispatch_source_cancel(_timer);}
@end

void GSVPrepareOriginalSource(NSURL* mediaURL,void (^completion)(NSDictionary*,NSError*)){
  NSURLComponents* parts=[NSURLComponents componentsWithURL:mediaURL resolvingAgainstBaseURL:NO];
  parts.queryItems=@[[NSURLQueryItem queryItemWithName:@"nativeSource" value:@"1"]];
  NSMutableURLRequest* request=[NSMutableURLRequest requestWithURL:parts.URL];request.timeoutInterval=5;
  [request setValue:@"bytes=0-8191" forHTTPHeaderField:@"Range"];
  [[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData* data,NSURLResponse* response,NSError* error){
    if(error||data.length>8192||![response.MIMEType isEqualToString:@"application/json"]){completion(nil,error?:decoderError(@"El descriptor local de audio no está disponible."));return;}
    id parsed=[NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
    if(![parsed isKindOfClass:NSDictionary.class]){completion(nil,error?:decoderError(@"El descriptor local no es válido."));return;}
    NSDictionary* descriptor=parsed;
    NSString* path=[descriptor[@"path"] isKindOfClass:NSString.class]?descriptor[@"path"]:@"";
    if(![descriptor[@"nativeSource"] isEqual:@YES]||![path isAbsolutePath]||![[NSFileManager defaultManager] isReadableFileAtPath:path]){
      completion(nil,error?:decoderError(@"La fuente local fue rechazada."));return;
    }
    [GSVOriginalReader prepareURL:[NSURL fileURLWithPath:path] completion:^(GSVOriginalReader* reader,NSError* failure){
      if(!reader){completion(nil,failure);return;}
      completion(@{@"slot":@"vocalrt-original",@"gsxReaders":@{@"original":reader}},nil);
    }];
  }] resume];
}
