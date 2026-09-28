#import <Cocoa/Cocoa.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreGraphics/CoreGraphics.h>
#import <WebKit/WebKit.h>

#include <signal.h>
#include <unistd.h>
#include <mach/mach_time.h>
#include "GSLobbyWaveform.h"

static NSString *const GSPanelURLString = @"http://127.0.0.1:8787";
static NSString *const GSNativeHandlerName = @"guestStarNative";
static NSString *const GSDisplaysEventName = @"gueststar:native-displays";
static NSString *const GSStarScreenResultEventName = @"gueststar:native-star-screen-result";
static NSString *const GSOpenPreferencesEventName = @"gueststar:open-preferences";
static NSString *const GSReportProblemEventName = @"gueststar:report-problem";
static NSString *const GSMarkDiagnosticEventName = @"gueststar:mark-diagnostic";
static NSString *const GSAudioResultEventName = @"gueststar:native-audio-result";
static NSString *const GSAudioDevicesChangedEventName = @"gueststar:native-audio-devices-changed";
static NSString *const GSAudioStateEventName = @"gueststar:native-audio-state";
static NSString *const GSOutputMeterEventName = @"gueststar:native-output-meter";
static NSString *const GSBackgroundWaveformEventName = @"gueststar:native-background-waveform";

// Existing mixer AudioUnits support a sample-accurate linear volume ramp.
// Scheduling it on the render thread also reaches exact zero without a DSP
// replacement, timer-driven gain steps or changes to either deck's transport.
static void GSRampMixerVolume(AVAudioMixerNode *mixer, float gain, double seconds) {
  gain = MAX(0.0f, MIN(1.0f, gain));
  AUAudioUnit *unit = mixer.AUAudioUnit;
  AUParameter *volume = [unit.parameterTree parameterWithID:kMultiChannelMixerParam_Volume
                                                    scope:kAudioUnitScope_Output element:0];
  if (volume != nil && (volume.flags & kAudioUnitParameterFlag_CanRamp) && unit.scheduleParameterBlock != nil) {
    double sampleRate = [mixer outputFormatForBus:0].sampleRate;
    AUAudioFrameCount frames = (AUAudioFrameCount)MAX(1, sampleRate * seconds);
    unit.scheduleParameterBlock(AUEventSampleTimeImmediate, frames, volume.address, gain);
    // The v2 mixer can retain the last interpolated sample rather than the
    // endpoint. Commit it explicitly on the same audio timeline, including 0.
    unit.scheduleParameterBlock(AUEventSampleTimeImmediate + frames, 0, volume.address, gain);
  } else mixer.outputVolume = gain;
}

typedef void (^GSAudioDeckLoadCompletion)(BOOL ok, NSString *error, NSTimeInterval duration);

// AudioFile callbacks expose one bounded M4A stream embedded in a GSXS file.
// Core Audio sees a normal file beginning at byte zero while every read remains
// inside that stream's declared range. No stem is extracted to disk or loaded
// completely into memory.
@interface GSXSubrangeContext : NSObject
@property(nonatomic, strong) NSFileHandle *handle;
@property(nonatomic) SInt64 offset;
@property(nonatomic) SInt64 length;
@end

@implementation GSXSubrangeContext
@end

static OSStatus GSXReadProc(void *clientData, SInt64 position, UInt32 requestCount,
                            void *buffer, UInt32 *actualCount) {
  @autoreleasepool {
    GSXSubrangeContext *context = (__bridge GSXSubrangeContext *)clientData;
    if (context == nil || position < 0 || position >= context.length) {
      if (actualCount != NULL) *actualCount = 0;
      return noErr;
    }
    UInt32 bounded = (UInt32)MIN((SInt64)requestCount, context.length - position);
    @try {
      NSData *data;
      @synchronized (context) {
        [context.handle seekToFileOffset:(unsigned long long)(context.offset + position)];
        data = [context.handle readDataOfLength:bounded];
      }
      if (data.length > 0) memcpy(buffer, data.bytes, data.length);
      if (actualCount != NULL) *actualCount = (UInt32)data.length;
      return noErr;
    } @catch (__unused NSException *exception) {
      if (actualCount != NULL) *actualCount = 0;
      return kAudioFileUnspecifiedError;
    }
  }
}

static SInt64 GSXGetSizeProc(void *clientData) {
  GSXSubrangeContext *context = (__bridge GSXSubrangeContext *)clientData;
  return context != nil ? context.length : 0;
}

@interface GSXStemReader : NSObject
@property(nonatomic, copy) NSString *kind;
@property(nonatomic, strong) GSXSubrangeContext *context;
@property(nonatomic) AudioFileID audioFile;
@property(nonatomic) ExtAudioFileRef decoder;
@property(nonatomic, strong) AVAudioFormat *format;
@property(nonatomic) AVAudioFramePosition frameCount;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) BOOL ended;
@property(nonatomic) dispatch_queue_t decodeQueue;
- (instancetype)initWithURL:(NSURL *)url kind:(NSString *)kind offset:(SInt64)offset
                     length:(SInt64)length sampleRate:(double)sampleRate
                   channels:(AVAudioChannelCount)channels error:(NSError **)error;
- (BOOL)scheduleFromPosition:(NSTimeInterval)position player:(AVAudioPlayerNode *)player error:(NSError **)error;
- (void)invalidate;
- (void)close;
@end

@implementation GSXStemReader

- (instancetype)initWithURL:(NSURL *)url kind:(NSString *)kind offset:(SInt64)offset
                     length:(SInt64)length sampleRate:(double)sampleRate
                   channels:(AVAudioChannelCount)channels error:(NSError **)error {
  self = [super init];
  if (self == nil) return nil;
  _kind = [kind copy];
  _decodeQueue = dispatch_queue_create([[NSString stringWithFormat:@"com.gstarxp.gsx.%@", kind] UTF8String], DISPATCH_QUEUE_SERIAL);
  NSError *openError = nil;
  NSFileHandle *handle = [NSFileHandle fileHandleForReadingFromURL:url error:&openError];
  if (handle == nil || offset < 128 || length < 1024) {
    if (error != NULL) *error = openError ?: [NSError errorWithDomain:@"GuestStarGSX" code:10 userInfo:@{NSLocalizedDescriptionKey: @"El stream GSX no es válido."}];
    return nil;
  }
  _context = [[GSXSubrangeContext alloc] init];
  _context.handle = handle;
  _context.offset = offset;
  _context.length = length;
  OSStatus status = AudioFileOpenWithCallbacks((__bridge void *)_context, GSXReadProc, NULL, GSXGetSizeProc, NULL, kAudioFileM4AType, &_audioFile);
  if (status == noErr) status = ExtAudioFileWrapAudioFileID(_audioFile, false, &_decoder);
  _format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:sampleRate channels:channels];
  if (status == noErr && _format != nil) {
    AudioStreamBasicDescription description = *_format.streamDescription;
    status = ExtAudioFileSetProperty(_decoder, kExtAudioFileProperty_ClientDataFormat,
                                     sizeof(description), &description);
  }
  SInt64 fileFrames = 0;
  UInt32 frameSize = sizeof(fileFrames);
  if (status == noErr) status = ExtAudioFileGetProperty(_decoder, kExtAudioFileProperty_FileLengthFrames, &frameSize, &fileFrames);
  if (status != noErr || fileFrames <= 0 || _format == nil) {
    [self close];
    if (error != NULL) *error = [NSError errorWithDomain:@"GuestStarGSX" code:status userInfo:@{NSLocalizedDescriptionKey: @"Core Audio no pudo abrir el stream AAC del archivo GSX."}];
    return nil;
  }
  _frameCount = fileFrames;
  return self;
}

- (AVAudioPCMBuffer *)readBuffer:(AVAudioFrameCount)capacity error:(OSStatus *)error {
  AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:self.format frameCapacity:capacity];
  if (buffer == nil) { if (error != NULL) *error = memFullErr; return nil; }
  buffer.frameLength = capacity;
  UInt32 frames = capacity;
  OSStatus status = ExtAudioFileRead(self.decoder, &frames, buffer.mutableAudioBufferList);
  if (error != NULL) *error = status;
  if (status != noErr || frames == 0) return nil;
  buffer.frameLength = frames;
  return buffer;
}

- (void)scheduleNextForPlayer:(AVAudioPlayerNode *)player generation:(NSUInteger)generation {
  if (generation != self.generation || self.ended || self.decoder == NULL) return;
  OSStatus status = noErr;
  AVAudioPCMBuffer *buffer = [self readBuffer:4096 error:&status];
  if (buffer == nil) { self.ended = YES; return; }
  __weak GSXStemReader *weakSelf = self;
  [player scheduleBuffer:buffer completionCallbackType:AVAudioPlayerNodeCompletionDataRendered completionHandler:^(__unused AVAudioPlayerNodeCompletionCallbackType type) {
    GSXStemReader *reader = weakSelf;
    if (reader == nil) return;
    dispatch_async(reader.decodeQueue, ^{ [reader scheduleNextForPlayer:player generation:generation]; });
  }];
}

- (BOOL)scheduleFromPosition:(NSTimeInterval)position player:(AVAudioPlayerNode *)player error:(NSError **)error {
  if (self.decoder == NULL || self.format.sampleRate <= 0) return NO;
  __block OSStatus status = noErr;
  dispatch_sync(self.decodeQueue, ^{
    self.generation += 1;
    self.ended = NO;
    AVAudioFramePosition frame = (AVAudioFramePosition)floor(MAX(0, position) * self.format.sampleRate);
    frame = MIN(frame, self.frameCount);
    status = ExtAudioFileSeek(self.decoder, frame);
    if (status != noErr) return;
    const NSUInteger generation = self.generation;
    // Roughly one second at 44.1 kHz, filled asynchronously after a short
    // initial prebuffer. Both stereo stems remain below 1 MB.
    // Two blocks make the first frame audible immediately. Fill the remaining
    // bounded reservoir off the main thread rather than decoding a whole
    // second synchronously on every scrub.
    for (NSUInteger index = 0; index < 2 && !self.ended; index += 1) {
      [self scheduleNextForPlayer:player generation:generation];
    }
    dispatch_async(self.decodeQueue, ^{
      for (NSUInteger index = 0; index < 10 && !self.ended && generation == self.generation; index += 1) {
        [self scheduleNextForPlayer:player generation:generation];
      }
    });
  });
  if (status != noErr && error != NULL) {
    *error = [NSError errorWithDomain:@"GuestStarGSX" code:status userInfo:@{NSLocalizedDescriptionKey: @"No se pudo posicionar el decoder GSX."}];
  }
  return status == noErr;
}

- (void)invalidate {
  if (self.decodeQueue == nil) return;
  dispatch_sync(self.decodeQueue, ^{ self.generation += 1; self.ended = YES; });
}

- (void)close {
  [self invalidate];
  if (_decoder != NULL) { ExtAudioFileDispose(_decoder); _decoder = NULL; }
  if (_audioFile != NULL) { AudioFileClose(_audioFile); _audioFile = NULL; }
  [_context.handle closeFile];
  _context = nil;
}

- (void)dealloc { [self close]; }

@end

// Each deck owns a complete, independent native signal path.  The player nodes
// are deliberately fed from local loopback URLs, never from arbitrary network
// locations or WebKit audio output.  This keeps AVAudioUnitTimePitch as the
// only audible time-stretcher while the WKWebView remains responsible for video.
@interface GSAudioDeck : NSObject {
  GSLobbyWaveform _lobbyWaveform;
}
@property(nonatomic, copy) NSString *name;
@property(nonatomic, weak) AVAudioEngine *engine;
@property(nonatomic, strong) AVAudioPlayerNode *originalPlayer;
@property(nonatomic, strong) AVAudioPlayerNode *instrumentalPlayer;
@property(nonatomic, strong) AVAudioPlayerNode *vocalsPlayer;
@property(nonatomic, strong) AVAudioMixerNode *originalMix;
@property(nonatomic, strong) AVAudioMixerNode *instrumentalMix;
@property(nonatomic, strong) AVAudioMixerNode *vocalsMix;
@property(nonatomic, strong) AVAudioMixerNode *inputMix;
@property(nonatomic, strong) AVAudioUnitEQ *autoGain;
@property(nonatomic, strong) AVAudioUnitTimePitch *timePitch;
@property(nonatomic, strong) AVAudioUnitEQ *equalizer;
@property(nonatomic, strong) AVAudioMixerNode *masterMix;
@property(nonatomic, strong) NSMutableDictionary<NSString *, AVAudioFile *> *files;
@property(nonatomic, strong) NSMutableDictionary<NSString *, GSXStemReader *> *gsxReaders;
@property(nonatomic, strong) NSMutableArray<NSURL *> *cacheFiles;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) NSUInteger lastSeekRevision;
@property(nonatomic) BOOL playing;
@property(nonatomic) NSTimeInterval duration;
@property(nonatomic) NSTimeInterval anchorPosition;
@property(nonatomic) NSTimeInterval lastRenderedPosition;
@property(nonatomic) BOOL hasRenderedSamples;
@property(nonatomic) uint64_t scheduledHostTime;
@property(nonatomic) float rate;
@property(nonatomic) float pitchCents;
@property(nonatomic) float meter;
@property(nonatomic) float autoGainDb;
@property(nonatomic) float vocalLevel;
- (instancetype)initWithName:(NSString *)name engine:(AVAudioEngine *)engine destination:(AVAudioNode *)destination;
- (void)loadSources:(NSArray<NSDictionary *> *)sources
            position:(NSTimeInterval)position
          completion:(GSAudioDeckLoadCompletion)completion;
- (BOOL)playAtPosition:(NSTimeInterval)position error:(NSError **)error;
- (void)integrateStemSources:(NSArray<NSDictionary *> *)sources completion:(GSAudioDeckLoadCompletion)completion;
- (void)pause;
- (void)seek:(NSTimeInterval)position;
- (void)cancelPendingLoadsAndStop;
- (void)stopAndClear;
- (void)setTempoPercent:(float)percent;
- (void)setPitchSemitones:(float)semitones;
- (void)setAutoGainDb:(float)gainDb;
- (void)setVolume:(float)volume;
- (void)setVocalLevel:(float)level;
- (void)setEqualizerLow:(float)low mid:(float)mid high:(float)high;
- (NSTimeInterval)currentPosition;
- (NSDictionary *)state;
- (NSDictionary *)lobbyWaveformState;
@end

@implementation GSAudioDeck

- (instancetype)initWithName:(NSString *)name engine:(AVAudioEngine *)engine destination:(AVAudioNode *)destination {
  self = [super init];
  if (self == nil) return nil;
  _name = [name copy];
  GSLobbyWaveformInit(&_lobbyWaveform);
  _engine = engine;
  _files = [NSMutableDictionary dictionary];
  _gsxReaders = [NSMutableDictionary dictionary];
  _cacheFiles = [NSMutableArray array];
  _rate = 1.0f;
  _pitchCents = 0.0f;
  _originalPlayer = [[AVAudioPlayerNode alloc] init];
  _instrumentalPlayer = [[AVAudioPlayerNode alloc] init];
  _vocalsPlayer = [[AVAudioPlayerNode alloc] init];
  _originalMix = [[AVAudioMixerNode alloc] init];
  _instrumentalMix = [[AVAudioMixerNode alloc] init];
  _vocalsMix = [[AVAudioMixerNode alloc] init];
  _inputMix = [[AVAudioMixerNode alloc] init];
  _autoGain = [[AVAudioUnitEQ alloc] initWithNumberOfBands:0];
  _autoGain.globalGain = 0.0f;
  _timePitch = [[AVAudioUnitTimePitch alloc] init];
  _timePitch.rate = 1.0f;
  _timePitch.pitch = 0.0f;
  // A little more overlap than the platform default favours intelligibility at
  // slower tempos without increasing the graph or introducing a second DSP.
  _timePitch.overlap = 12.0f;
  _equalizer = [[AVAudioUnitEQ alloc] initWithNumberOfBands:3];
  _equalizer.bands[0].filterType = AVAudioUnitEQFilterTypeLowShelf;
  _equalizer.bands[0].frequency = 180.0f;
  _equalizer.bands[0].bypass = NO;
  _equalizer.bands[1].filterType = AVAudioUnitEQFilterTypeParametric;
  _equalizer.bands[1].frequency = 1100.0f;
  _equalizer.bands[1].bandwidth = 1.2f;
  _equalizer.bands[1].bypass = NO;
  _equalizer.bands[2].filterType = AVAudioUnitEQFilterTypeHighShelf;
  _equalizer.bands[2].frequency = 6500.0f;
  _equalizer.bands[2].bypass = NO;
  _masterMix = [[AVAudioMixerNode alloc] init];
  for (AVAudioNode *node in @[
    _originalPlayer, _instrumentalPlayer, _vocalsPlayer,
    _originalMix, _instrumentalMix, _vocalsMix, _inputMix,
    _autoGain, _timePitch, _equalizer, _masterMix
  ]) [engine attachNode:node];
  [engine connect:_originalPlayer to:_originalMix format:nil];
  [engine connect:_instrumentalPlayer to:_instrumentalMix format:nil];
  [engine connect:_vocalsPlayer to:_vocalsMix format:nil];
  [engine connect:_originalMix to:_inputMix format:nil];
  [engine connect:_instrumentalMix to:_inputMix format:nil];
  [engine connect:_vocalsMix to:_inputMix format:nil];
  [engine connect:_inputMix to:_autoGain format:nil];
  [engine connect:_autoGain to:_timePitch format:nil];
  [engine connect:_timePitch to:_equalizer format:nil];
  [engine connect:_equalizer to:_masterMix format:nil];
  [engine connect:_masterMix to:destination format:nil];
  // The panel's waveform receives this native post-EQ level.  WebKit has no
  // audible graph in this mode, so its analyser would otherwise be silent.
  __weak GSAudioDeck *weakSelf = self;
  const BOOL observeBackgroundWaveform = [name isEqualToString:@"background"];
  [_masterMix installTapOnBus:0 bufferSize:512 format:nil block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
    (void)when;
    float *const *channels = buffer.floatChannelData;
    if (channels == NULL || buffer.frameLength == 0) return;
    float peak = 0.0f;
    for (AVAudioChannelCount channel = 0; channel < buffer.format.channelCount; channel += 1) {
      const float *samples = channels[channel];
      for (AVAudioFrameCount frame = 0; frame < buffer.frameLength; frame += 1) peak = MAX(peak, fabsf(samples[frame]));
    }
    GSAudioDeck *deck = weakSelf;
    if (deck != nil) deck.meter = MIN(1.0f, peak * 2.5f);
    if (deck != nil && observeBackgroundWaveform) {
      GSLobbyWaveformCapture(&deck->_lobbyWaveform, channels, buffer.format.channelCount, buffer.frameLength);
    }
  }];
  _originalMix.outputVolume = 1.0f;
  _instrumentalMix.outputVolume = 0.0f;
  _vocalsMix.outputVolume = 0.0f;
  _masterMix.outputVolume = 1.0f;
  return self;
}

- (AVAudioPlayerNode *)playerForSlot:(NSString *)slot {
  if ([slot isEqualToString:@"instrumental"]) return self.instrumentalPlayer;
  if ([slot isEqualToString:@"vocals"]) return self.vocalsPlayer;
  return self.originalPlayer;
}

- (AVAudioMixerNode *)mixForSlot:(NSString *)slot {
  if ([slot isEqualToString:@"instrumental"]) return self.instrumentalMix;
  if ([slot isEqualToString:@"vocals"]) return self.vocalsMix;
  return self.originalMix;
}

- (NSArray<NSString *> *)activeSlots {
  NSMutableOrderedSet<NSString *> *slots = [NSMutableOrderedSet orderedSetWithArray:self.files.allKeys];
  [slots addObjectsFromArray:self.gsxReaders.allKeys];
  return slots.array;
}

- (void)removeCacheFiles {
  NSFileManager *manager = NSFileManager.defaultManager;
  for (NSURL *url in self.cacheFiles) [manager removeItemAtURL:url error:nil];
  [self.cacheFiles removeAllObjects];
}

- (void)prepareLocalAudioAtURL:(NSURL *)url completion:(void (^)(AVAudioFile *file, NSURL *cacheURL, NSError *error))completion {
  NSError *fileError = nil;
  AVAudioFile *file = [[AVAudioFile alloc] initForReading:url error:&fileError];
  if (file != nil) { completion(file, url, nil); return; }

  // AVAudioFile does not accept every movie container.  Extract only the audio
  // track to an M4A cache file through AVFoundation, preserving the original
  // media URL for WebKit's muted video playback.
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
  AVAssetExportSession *session = [[AVAssetExportSession alloc]
      initWithAsset:asset presetName:AVAssetExportPresetAppleM4A];
  if (session == nil) {
    completion(nil, nil, fileError ?: [NSError errorWithDomain:@"GuestStarNativeAudio" code:1 userInfo:@{ NSLocalizedDescriptionKey: @"AVFoundation no pudo extraer el audio de este archivo." }]);
    return;
  }
  NSURL *directory = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:@"GuestStarNativeAudio"] isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:nil];
  NSURL *output = [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"%@-%@.m4a", self.name, NSUUID.UUID.UUIDString]];
  [session setOutputURL:output];
  [session setOutputFileType:AVFileTypeAppleM4A];
  [session exportAsynchronouslyWithCompletionHandler:^{
    NSError *exportError = session.error;
    if (session.status != AVAssetExportSessionStatusCompleted) {
      [[NSFileManager defaultManager] removeItemAtURL:output error:nil];
      completion(nil, nil, exportError ?: [NSError errorWithDomain:@"GuestStarNativeAudio" code:2 userInfo:@{ NSLocalizedDescriptionKey: @"AVFoundation no pudo preparar la pista de audio." }]);
      return;
    }
    NSError *openError = nil;
    AVAudioFile *exported = [[AVAudioFile alloc] initForReading:output error:&openError];
    completion(exported, output, openError);
  }];
}

- (void)prepareGSXSource:(NSDictionary *)source completion:(void (^)(NSDictionary *prepared, NSError *error))completion {
  NSURL *descriptorURL = [NSURL URLWithString:[source[@"url"] isKindOfClass:NSString.class] ? source[@"url"] : @""];
  if (descriptorURL == nil) {
    completion(nil, [NSError errorWithDomain:@"GuestStarGSX" code:20 userInfo:@{NSLocalizedDescriptionKey: @"La referencia GSX no es válida."}]);
    return;
  }
  NSURLSessionDataTask *task = [NSURLSession.sharedSession dataTaskWithURL:descriptorURL completionHandler:^(NSData *data, NSURLResponse *response, NSError *networkError) {
    (void)response;
    if (networkError != nil || data.length == 0) { completion(nil, networkError); return; }
    NSError *jsonError = nil;
    NSDictionary *descriptor = [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError];
    NSString *rawPath = [descriptor[@"path"] isKindOfClass:NSString.class] ? descriptor[@"path"] : @"";
    NSString *safePath = rawPath.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    if (![descriptor[@"format"] isEqual:@"gsx"] || [descriptor[@"formatVersion"] integerValue] != 1 ||
        ![safePath containsString:@"/.guest-star-stems/v4/"] || ![safePath.pathExtension isEqualToString:@"gsxstems"]) {
      completion(nil, jsonError ?: [NSError errorWithDomain:@"GuestStarGSX" code:21 userInfo:@{NSLocalizedDescriptionKey: @"El descriptor GSX fue rechazado."}]);
      return;
    }
    NSURL *fileURL = [NSURL fileURLWithPath:safePath];
    NSFileHandle *headerHandle = [NSFileHandle fileHandleForReadingFromURL:fileURL error:&jsonError];
    NSData *header = [headerHandle readDataOfLength:128];
    [headerHandle closeFile];
    if (header.length < 128 || memcmp(header.bytes, "GSXS", 4) != 0) {
      completion(nil, jsonError ?: [NSError errorWithDomain:@"GuestStarGSX" code:22 userInfo:@{NSLocalizedDescriptionKey: @"El encabezado GSX no es válido."}]);
      return;
    }
    const uint8_t *bytes = header.bytes;
    uint16_t version = 0;
    memcpy(&version, bytes + 4, sizeof(version));
    version = CFSwapInt16LittleToHost(version);
    if (version != 1) {
      completion(nil, [NSError errorWithDomain:@"GuestStarGSX" code:23 userInfo:@{NSLocalizedDescriptionKey: @"Esta versión de GSX no está soportada."}]);
      return;
    }
    NSDictionary *streams = [descriptor[@"streams"] isKindOfClass:NSDictionary.class] ? descriptor[@"streams"] : @{};
    NSMutableDictionary<NSString *, GSXStemReader *> *readers = [NSMutableDictionary dictionary];
    __block NSError *readerError = nil;
    for (NSString *kind in @[ @"instrumental", @"vocals" ]) {
      NSDictionary *stream = [streams[kind] isKindOfClass:NSDictionary.class] ? streams[kind] : @{};
      GSXStemReader *reader = [[GSXStemReader alloc]
          initWithURL:fileURL
          kind:kind
          offset:[stream[@"offset"] longLongValue]
          length:[stream[@"length"] longLongValue]
          sampleRate:[stream[@"sampleRate"] doubleValue]
          channels:(AVAudioChannelCount)[stream[@"channels"] unsignedIntValue]
          error:&readerError];
      if (reader == nil) break;
      readers[kind] = reader;
    }
    if (readerError != nil || readers.count != 2) {
      for (GSXStemReader *reader in readers.allValues) [reader close];
      completion(nil, readerError ?: [NSError errorWithDomain:@"GuestStarGSX" code:24 userInfo:@{NSLocalizedDescriptionKey: @"GSX no contiene ambos stems."}]);
      return;
    }
    completion(@{
      @"slot": @"gsx",
      @"gsxReaders": readers,
      @"duration": descriptor[@"durationSeconds"] ?: @0,
      @"gain": @1
    }, nil);
  }];
  [task resume];
}

- (void)prepareSource:(NSDictionary *)source completion:(void (^)(NSDictionary *prepared, NSError *error))completion {
  NSString *slot = [source[@"slot"] isKindOfClass:NSString.class] ? source[@"slot"] : @"original";
  if ([slot isEqualToString:@"gsx"]) {
    [self prepareGSXSource:source completion:completion];
    return;
  }
  NSString *rawURL = [source[@"url"] isKindOfClass:NSString.class] ? source[@"url"] : @"";
  NSURL *remoteURL = [NSURL URLWithString:rawURL];
  if (remoteURL == nil) {
    completion(nil, [NSError errorWithDomain:@"GuestStarNativeAudio" code:3 userInfo:@{ NSLocalizedDescriptionKey: @"La fuente de audio nativa no es válida." }]);
    return;
  }
  NSURLSessionDownloadTask *task = [NSURLSession.sharedSession downloadTaskWithURL:remoteURL completionHandler:^(NSURL *location, NSURLResponse *response, NSError *downloadError) {
    (void)response;
    if (downloadError != nil || location == nil) {
      completion(nil, downloadError ?: [NSError errorWithDomain:@"GuestStarNativeAudio" code:4 userInfo:@{ NSLocalizedDescriptionKey: @"No se pudo obtener el archivo de audio local." }]);
      return;
    }
    NSString *extension = remoteURL.pathExtension.length ? remoteURL.pathExtension : @"media";
    NSURL *directory = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:@"GuestStarNativeAudio"] isDirectory:YES];
    [[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:nil];
    NSURL *downloaded = [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"%@-%@.%@", self.name, NSUUID.UUID.UUIDString, extension]];
    NSError *moveError = nil;
    [[NSFileManager defaultManager] moveItemAtURL:location toURL:downloaded error:&moveError];
    if (moveError != nil) { completion(nil, moveError); return; }
    [self prepareLocalAudioAtURL:downloaded completion:^(AVAudioFile *file, NSURL *cacheURL, NSError *openError) {
      if (file == nil) {
        [[NSFileManager defaultManager] removeItemAtURL:downloaded error:nil];
        completion(nil, openError);
        return;
      }
      completion(@{ @"slot": slot, @"file": file, @"downloaded": downloaded, @"cache": cacheURL ?: downloaded, @"gain": source[@"gain"] ?: @1 }, nil);
    }];
  }];
  [task resume];
}

- (void)loadSources:(NSArray<NSDictionary *> *)sources position:(NSTimeInterval)position completion:(GSAudioDeckLoadCompletion)completion {
  self.generation += 1;
  self.lastSeekRevision = 0;
  const NSUInteger generation = self.generation;
  [self stopAndClear];
  if (sources.count == 0) {
    completion(NO, @"No hay una fuente de audio nativa para este reproductor.", 0);
    return;
  }
  dispatch_group_t group = dispatch_group_create();
  NSMutableArray<NSDictionary *> *prepared = [NSMutableArray array];
  __block NSError *failure = nil;
  for (NSDictionary *source in sources) {
    dispatch_group_enter(group);
    [self prepareSource:source completion:^(NSDictionary *entry, NSError *error) {
      @synchronized (prepared) {
        if (error != nil && failure == nil) failure = error;
        if (entry != nil) [prepared addObject:entry];
      }
      dispatch_group_leave(group);
    }];
  }
  dispatch_group_notify(group, dispatch_get_main_queue(), ^{
    void (^removePreparedCaches)(void) = ^{
      NSFileManager *manager = NSFileManager.defaultManager;
      NSMutableSet<NSURL *> *urls = [NSMutableSet set];
      for (NSDictionary *entry in prepared) {
        NSURL *downloaded = entry[@"downloaded"];
        NSURL *cache = entry[@"cache"];
        if (downloaded != nil) [urls addObject:downloaded];
        if (cache != nil) [urls addObject:cache];
      }
      for (NSURL *url in urls) [manager removeItemAtURL:url error:nil];
    };
    // A new load supersedes every pending export/download for this deck.  Do
    // not leave its JS request waiting for a timeout, and remove files that
    // never became part of the active deck.
    if (generation != self.generation) {
      removePreparedCaches();
      completion(NO, @"La carga nativa fue sustituida por otra canción.", 0);
      return;
    }
    if (failure != nil) {
      removePreparedCaches();
      [self stopAndClear];
      completion(NO, failure.localizedDescription ?: @"No se pudo preparar el audio nativo.", 0);
      return;
    }
    [self.files removeAllObjects];
    for (GSXStemReader *reader in self.gsxReaders.allValues) [reader close];
    [self.gsxReaders removeAllObjects];
    [self removeCacheFiles];
    self.duration = 0;
    for (NSDictionary *entry in prepared) {
      NSString *slot = entry[@"slot"];
      NSDictionary<NSString *, GSXStemReader *> *readers = [entry[@"gsxReaders"] isKindOfClass:NSDictionary.class] ? entry[@"gsxReaders"] : nil;
      if ([slot isEqualToString:@"gsx"] && readers.count == 2) {
        [self.gsxReaders addEntriesFromDictionary:readers];
        self.instrumentalMix.outputVolume = 1.0f;
        self.vocalsMix.outputVolume = 1.0f;
        for (GSXStemReader *reader in readers.allValues) {
          NSTimeInterval streamDuration = reader.format.sampleRate > 0 ? (NSTimeInterval)reader.frameCount / reader.format.sampleRate : 0;
          self.duration = MAX(self.duration, streamDuration);
        }
        continue;
      }
      AVAudioFile *file = entry[@"file"];
      if (slot.length == 0 || file == nil) continue;
      self.files[slot] = file;
      NSURL *downloaded = entry[@"downloaded"];
      NSURL *cache = entry[@"cache"];
      if (downloaded != nil) [self.cacheFiles addObject:downloaded];
      if (cache != nil && ![cache isEqual:downloaded]) [self.cacheFiles addObject:cache];
      AVAudioMixerNode *mix = [self mixForSlot:slot];
      mix.outputVolume = MAX(0.0f, MIN(1.0f, [entry[@"gain"] floatValue]));
      NSTimeInterval sourceDuration = file.processingFormat.sampleRate > 0
          ? (NSTimeInterval)file.length / file.processingFormat.sampleRate : 0;
      self.duration = MAX(self.duration, sourceDuration);
    }
    if ((self.files.count == 0 && self.gsxReaders.count == 0) || self.duration <= 0) { [self stopAndClear]; completion(NO, @"AVFoundation no encontró audio reproducible en la fuente.", 0); return; }
    [self seek:position];
    completion(YES, @"", self.duration);
  });
}

// Prepare new stem files/readers while the original node continues rendering.
// Only unused instrumental/vocal nodes are scheduled. The silent original is
// retained as the common timeline, including later pause/resume/seek commands.
- (void)integrateStemSources:(NSArray<NSDictionary *> *)sources completion:(GSAudioDeckLoadCompletion)completion {
  const NSUInteger generation = self.generation;
  if (self.files[@"original"] == nil || self.gsxReaders.count || self.files[@"instrumental"] != nil) {
    completion(NO, @"El deck ya tiene stems o fue sustituido.", self.duration); return;
  }
  dispatch_group_t group = dispatch_group_create();
  NSMutableArray<NSDictionary *> *prepared = [NSMutableArray array];
  __block NSError *failure = nil;
  for (NSDictionary *source in sources) {
    dispatch_group_enter(group);
    [self prepareSource:source completion:^(NSDictionary *entry, NSError *error) {
      @synchronized (prepared) {
        if (error != nil) failure = error;
        if (entry != nil) [prepared addObject:entry];
      }
      dispatch_group_leave(group);
    }];
  }
  dispatch_group_notify(group, dispatch_get_main_queue(), ^{
    void (^discard)(void) = ^{
      for (NSDictionary *entry in prepared) {
        for (GSXStemReader *reader in [entry[@"gsxReaders"] allValues]) [reader close];
        for (NSString *key in @[@"downloaded", @"cache"]) {
          NSURL *url = entry[key];
          if (url != nil) [NSFileManager.defaultManager removeItemAtURL:url error:nil];
        }
      }
    };
    if (generation != self.generation || self.files[@"original"] == nil || failure != nil) {
      discard(); completion(NO, failure.localizedDescription ?: @"La canción cambió durante la preparación de stems.", 0); return;
    }
    NSMutableDictionary *readers = [NSMutableDictionary dictionary];
    NSMutableDictionary *files = [NSMutableDictionary dictionary];
    for (NSDictionary *entry in prepared) {
      if (entry[@"gsxReaders"] != nil) [readers addEntriesFromDictionary:entry[@"gsxReaders"]];
      else if (entry[@"file"] != nil) files[entry[@"slot"]] = entry[@"file"];
    }
    if ((readers[@"instrumental"] == nil || readers[@"vocals"] == nil) &&
        (files[@"instrumental"] == nil || files[@"vocals"] == nil)) {
      discard(); completion(NO, @"No están disponibles ambos stems.", 0); return;
    }
    const BOOL playing = self.playing;
    const double lead = 0.04;
    AVAudioTime *renderTime = self.originalPlayer.lastRenderTime;
    AVAudioTime *playerTime = renderTime != nil ? [self.originalPlayer playerTimeForNodeTime:renderTime] : nil;
    // Rendered sample time is ahead of the audible clock by output latency.
    double position = playing && playerTime.sampleTimeValid && playerTime.sampleRate > 0
        ? self.anchorPosition + (double)playerTime.sampleTime / playerTime.sampleRate + lead * self.rate
        : [self currentPosition];
    uint64_t hostTime = renderTime.hostTimeValid ? renderTime.hostTime : mach_absolute_time();
    AVAudioTime *startTime = [AVAudioTime timeWithHostTime:hostTime + [AVAudioTime hostTimeForSeconds:lead]];
    self.instrumentalMix.outputVolume = 0;
    self.vocalsMix.outputVolume = 0;
    NSError *decodeError = nil;
    for (NSString *slot in @[@"instrumental", @"vocals"]) {
      AVAudioPlayerNode *player = [self playerForSlot:slot];
      [player stop];
      if (readers[slot] != nil) {
        if (![readers[slot] scheduleFromPosition:position player:player error:&decodeError]) break;
      } else {
        AVAudioFile *file = files[slot];
        AVAudioFramePosition frame = MIN(file.length, (AVAudioFramePosition)(position * file.processingFormat.sampleRate));
        if (frame < file.length) [player scheduleSegment:file startingFrame:frame frameCount:(AVAudioFrameCount)MIN(UINT32_MAX, file.length - frame) atTime:nil completionHandler:nil];
      }
    }
    if (decodeError != nil || (playing && mach_absolute_time() >= startTime.hostTime)) {
      [self.instrumentalPlayer stop]; [self.vocalsPlayer stop];
      discard(); completion(NO, decodeError.localizedDescription ?: @"La preparación no alcanzó el siguiente frame de audio; se conserva el original.", 0); return;
    }
    [self.gsxReaders addEntriesFromDictionary:readers];
    [self.files addEntriesFromDictionary:files];
    for (NSDictionary *entry in prepared) {
      for (NSString *key in @[@"downloaded", @"cache"]) {
        NSURL *url = entry[key];
        if (url != nil && ![self.cacheFiles containsObject:url]) [self.cacheFiles addObject:url];
      }
    }
    if (playing) {
      [self.instrumentalPlayer playAtTime:startTime]; [self.vocalsPlayer playAtTime:startTime];
    }
    // Return before the short crossfade; the render clock and original node
    // never stop. A pause/seek/song change during the lead cancels the fade.
    const NSUInteger seekRevision = self.lastSeekRevision;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(lead * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (generation != self.generation) return;
      if (seekRevision != self.lastSeekRevision || playing != self.playing) {
        self.originalMix.outputVolume = 0;
        self.instrumentalMix.outputVolume = 1;
        self.vocalsMix.outputVolume = self.vocalLevel;
      } else {
        GSRampMixerVolume(self.originalMix, 0, 0.012);
        GSRampMixerVolume(self.instrumentalMix, 1, 0.012);
        GSRampMixerVolume(self.vocalsMix, self.vocalLevel, 0.012);
      }
    });
    completion(YES, @"", self.duration);
  });
}

- (BOOL)scheduleAt:(NSTimeInterval)position error:(NSError **)error {
  NSTimeInterval bounded = MAX(0, MIN(position, self.duration));
  // Invalidate decoder callbacks before stop delivers old buffer completions.
  // Otherwise a completed old buffer can enqueue pre-seek PCM after stop.
  for (GSXStemReader *reader in self.gsxReaders.allValues) [reader invalidate];
  for (NSString *slot in [self activeSlots]) [[self playerForSlot:slot] stop];
  for (NSString *slot in self.files) {
    if (self.gsxReaders[slot] != nil) continue;
    AVAudioFile *file = self.files[slot];
    AVAudioPlayerNode *player = [self playerForSlot:slot];
    AVAudioFramePosition start = (AVAudioFramePosition)floor(bounded * file.processingFormat.sampleRate);
    if (start >= file.length) continue;
    AVAudioFrameCount frames = (AVAudioFrameCount)MIN((AVAudioFramePosition)UINT32_MAX, file.length - start);
    [player scheduleSegment:file startingFrame:start frameCount:frames atTime:nil completionHandler:nil];
  }
  for (NSString *slot in self.gsxReaders) {
    GSXStemReader *reader = self.gsxReaders[slot];
    NSError *decodeError = nil;
    if (![reader scheduleFromPosition:bounded player:[self playerForSlot:slot] error:&decodeError]) {
      for (NSString *activeSlot in [self activeSlots]) [[self playerForSlot:activeSlot] stop];
      if (error != NULL) *error = decodeError ?: [NSError errorWithDomain:@"GuestStarGSX" code:25 userInfo:@{NSLocalizedDescriptionKey: @"No se pudo preparar el audio GSX."}];
      return NO;
    }
  }
  self.anchorPosition = bounded;
  self.lastRenderedPosition = bounded;
  self.hasRenderedSamples = NO;
  self.scheduledHostTime = mach_absolute_time();
  return YES;
}

- (BOOL)playAtPosition:(NSTimeInterval)position error:(NSError **)error {
  if (self.files.count == 0 && self.gsxReaders.count == 0) {
    if (error != NULL) *error = [NSError errorWithDomain:@"GuestStarNativeAudio" code:5 userInfo:@{ NSLocalizedDescriptionKey: @"El deck nativo aún no está preparado." }];
    return NO;
  }
  if (![self scheduleAt:position error:error]) return NO;
  if (!self.engine.isRunning && ![self.engine startAndReturnError:error]) return NO;
  // A common host timestamp starts the vocal and instrumental nodes on the
  // same render boundary. Sequential -play calls can start on different pulls.
  NSArray<NSString *> *slots = [self activeSlots];
  AVAudioTime *startTime = slots.count > 1
      ? [AVAudioTime timeWithHostTime:mach_absolute_time() + [AVAudioTime hostTimeForSeconds:0.02]]
      : nil;
  for (NSString *slot in slots) [[self playerForSlot:slot] playAtTime:startTime];
  self.playing = YES;
  return YES;
}

- (NSTimeInterval)currentPosition {
  if (!self.playing) return self.anchorPosition;
  // Derive the master timeline from samples actually rendered by the player.
  // NSDate alone runs through stalls, device changes and decoder starvation.
  NSTimeInterval latency = MAX(0, self.engine.outputNode.presentationLatency);
  AVAudioPlayerNode *clockPlayer = self.files[@"original"] ? self.originalPlayer :
      (self.files[@"instrumental"] || self.gsxReaders[@"instrumental"]) ? self.instrumentalPlayer : self.vocalsPlayer;
  AVAudioTime *renderTime = [clockPlayer lastRenderTime];
  AVAudioTime *playerTime = renderTime.hostTimeValid && renderTime.hostTime >= self.scheduledHostTime
      ? [clockPlayer playerTimeForNodeTime:renderTime] : nil;
  NSTimeInterval position;
  if (playerTime != nil && playerTime.sampleTimeValid && playerTime.sampleRate > 0) {
    NSTimeInterval elapsed = MAX(0, (NSTimeInterval)playerTime.sampleTime / playerTime.sampleRate - latency * self.rate);
    position = MIN(self.duration, self.anchorPosition + elapsed);
    self.lastRenderedPosition = position;
    self.hasRenderedSamples = YES;
  } else if (self.hasRenderedSamples) {
    // Once render has started, a missing player time is a stalled engine,
    // never permission to advance the UI from a separate wall clock.
    position = self.lastRenderedPosition;
  } else position = self.anchorPosition;
  if (position >= self.duration) {
    self.playing = NO;
    for (NSString *slot in [self activeSlots]) [[self playerForSlot:slot] stop];
  }
  return position;
}

- (void)pause {
  self.anchorPosition = [self currentPosition];
  for (NSString *slot in [self activeSlots]) [[self playerForSlot:slot] pause];
  self.playing = NO;
}

- (void)seek:(NSTimeInterval)position {
  BOOL resume = self.playing;
  if (resume) [self pause];
  if (resume) {
    NSError *error = nil;
    [self playAtPosition:position error:&error];
  } else [self scheduleAt:position error:nil];
}

- (void)stopAndClear {
  self.playing = NO;
  for (GSXStemReader *reader in self.gsxReaders.allValues) [reader invalidate];
  for (AVAudioPlayerNode *player in @[ self.originalPlayer, self.instrumentalPlayer, self.vocalsPlayer ]) [player stop];
  [self.files removeAllObjects];
  for (GSXStemReader *reader in self.gsxReaders.allValues) [reader close];
  [self.gsxReaders removeAllObjects];
  [self removeCacheFiles];
  self.duration = 0;
  self.anchorPosition = 0;
  self.lastRenderedPosition = 0;
  self.hasRenderedSamples = NO;
}

- (void)cancelPendingLoadsAndStop {
  // stopAndClear only resets the scheduled players.  A local video can still
  // be downloading or exporting in prepareSource, so explicit Stop must also
  // invalidate that asynchronous generation.  Otherwise its completion can
  // install yesterday's row after the UI has selected the next video.
  self.generation += 1;
  self.lastSeekRevision = 0;
  [self stopAndClear];
}

- (void)setTempoPercent:(float)percent {
  self.rate = MAX(0.5f, MIN(1.5f, percent / 100.0f));
  self.timePitch.rate = self.rate;
  // Keep the scheduled sample origin intact. Re-anchoring while a player node
  // is running adds its already-rendered sample time a second time.
}

- (void)setPitchSemitones:(float)semitones {
  self.pitchCents = MAX(-1200.0f, MIN(1200.0f, semitones * 100.0f));
  self.timePitch.pitch = self.pitchCents;
}

- (void)setAutoGainDb:(float)gainDb {
  // This method is the property's setter; assigning through self here would
  // recurse.  Store the clamped value directly, then update the audio unit.
  _autoGainDb = MAX(-24.0f, MIN(12.0f, gainDb));
  self.autoGain.globalGain = _autoGainDb;
}

- (void)setVolume:(float)volume { self.masterMix.outputVolume = MAX(0.0f, MIN(1.0f, volume)); }

// This is deliberately a dedicated mixer gain, after the voice source has
// been decoded but before the common time/pitch, EQ and master path.  It must
// never share the master gain: Hosts can therefore change Voz guía IA without
// changing karaoke volume, tempo, pitch/key, EQ, fades or the selected output.
- (void)setVocalLevel:(float)level {
  _vocalLevel = MAX(0.0f, MIN(1.0f, level));
  GSRampMixerVolume(self.vocalsMix, _vocalLevel, 0.012);
}

- (void)setEqualizerLow:(float)low mid:(float)mid high:(float)high {
  self.equalizer.bands[0].gain = MAX(-12.0f, MIN(12.0f, low));
  self.equalizer.bands[1].gain = MAX(-12.0f, MIN(12.0f, mid));
  self.equalizer.bands[2].gain = MAX(-12.0f, MIN(12.0f, high));
}

- (NSDictionary *)lobbyWaveformState {
  float peaks[GS_LOBBY_WAVEFORM_BARS];
  const uint32_t sequence = GSLobbyWaveformRead(&_lobbyWaveform, peaks);
  if (!sequence) return nil;
  NSMutableArray *samples = [NSMutableArray arrayWithCapacity:GS_LOBBY_WAVEFORM_BARS];
  for (NSUInteger bin = 0; bin < GS_LOBBY_WAVEFORM_BARS; bin++) [samples addObject:@(peaks[bin])];
  return @{ @"samples": samples, @"frame": @(sequence), @"playing": @(self.playing) };
}

- (NSDictionary *)state {
  return @{
    @"deck": self.name ?: @"",
    @"engine": @"AVAudioEngine",
    @"timePitch": @"AVAudioUnitTimePitch",
    @"timePitchNodes": @1,
    @"position": @([self currentPosition]),
    @"duration": @(self.duration),
    @"playing": @(self.playing),
    @"tempoPercent": @(self.rate * 100.0f),
    @"pitchCents": @(self.pitchCents),
    @"autoGainDb": @(self.autoGainDb),
    @"meter": @(self.meter),
    @"outputLatency": @(MAX(0, self.engine.outputNode.presentationLatency)),
    @"sources": @(self.files.count + self.gsxReaders.count),
    @"sourceFormat": self.gsxReaders.count > 0 ? @"gsx" : @"legacy",
    @"hasVocalsSource": @(self.files[@"vocals"] != nil || self.gsxReaders[@"vocals"] != nil),
    @"vocalsGain": @(self.vocalsMix.outputVolume)
  };
}

@end

@interface GSAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKScriptMessageHandler>
@property(nonatomic, strong) NSWindow *mainWindow;
@property(nonatomic, strong) WKWebView *mainWebView;
@property(nonatomic, strong) NSWindow *starWindow;
@property(nonatomic, strong) WKWebView *starWebView;
@property(nonatomic, strong) NSTask *helperTask;
@property(nonatomic, strong) NSTimer *readinessTimer;
@property(nonatomic, strong) NSDate *launchDeadline;
@property(nonatomic, copy) NSString *requestedStarDisplayID;
@property(nonatomic, copy) NSString *starURLString;
@property(nonatomic) BOOL starPreview;
@property(nonatomic) BOOL starPresentationActive;
@property(nonatomic) NSApplicationPresentationOptions previousStarPresentationOptions;
@property(nonatomic) BOOL pollInFlight;
@property(nonatomic) BOOL backendReady;
@property(nonatomic) BOOL mainPageReady;
@property(nonatomic) BOOL pendingPreferences;
@property(nonatomic) BOOL fatalErrorPresented;
@property(nonatomic) BOOL terminating;
@property(nonatomic) BOOL terminationReplyPending;
@property(nonatomic, strong) AVAudioEngine *nativeAudioEngine;
@property(nonatomic, strong) GSAudioDeck *karaokeAudioDeck;
@property(nonatomic, strong) GSAudioDeck *backgroundAudioDeck;
@property(nonatomic, strong) AVAudioMixerNode *nativeOutputMix;
@property(nonatomic, strong) AVAudioUnitEQ *nativeMasterGain;
@property(nonatomic, strong) AVAudioMixerNode *nativeMeterMix;
@property(nonatomic, strong) NSTimer *nativeAudioStateTimer;
@property(nonatomic, strong) NSTimer *nativeAudioMeterTimer;
@property(nonatomic, strong) NSTimer *backgroundWaveformTimer;
@property(nonatomic) uint32_t lastBackgroundWaveformFrame;
@property(nonatomic, copy) NSString *nativeAudioOutputID;
@property(nonatomic) float nativeMasterDb;
@property(nonatomic) float outputRmsLeft;
@property(nonatomic) float outputRmsRight;
@property(nonatomic) float outputPeakLeft;
@property(nonatomic) float outputPeakRight;
- (void)updateStarScreenDisplayWithPayload:(NSDictionary *)payload;
- (void)emitAudioDevicesWithRequestID:(NSString *)requestID;
- (void)setAudioOutputWithPayload:(NSDictionary *)payload;
- (void)observeAudioDeviceChanges;
 - (void)emitNativeAudioState;
@end

@implementation GSAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  [self buildMainMenu];
  [self buildMainWindow];
  [self observeAudioDeviceChanges];
  // Ten small snapshots per second keep the rendered audio clock fresh.
  // Player forwards transport only at this rate; its full UI stays at 4 Hz.
  self.nativeAudioStateTimer = [NSTimer scheduledTimerWithTimeInterval:0.1
                                                                  target:self
                                                                selector:@selector(nativeAudioStateTick:)
                                                                userInfo:nil
                                                                 repeats:YES];
  self.nativeAudioMeterTimer = [NSTimer scheduledTimerWithTimeInterval:(1.0 / 30.0)
                                                                  target:self
                                                                selector:@selector(nativeAudioMeterTick:)
                                                                userInfo:nil
                                                                 repeats:YES];
  // Visual telemetry only; the four-per-second transport clock is unchanged.
  self.backgroundWaveformTimer = [NSTimer scheduledTimerWithTimeInterval:0.05
                                                                target:self
                                                              selector:@selector(backgroundWaveformTick:)
                                                              userInfo:nil
                                                               repeats:YES];

  [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(screenParametersChanged:)
             name:NSApplicationDidChangeScreenParametersNotification
           object:nil];

  [self.mainWindow makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];

  NSString *bundlePath = NSBundle.mainBundle.bundlePath;
  if ([bundlePath hasPrefix:@"/Volumes/"]) {
    [self showInstallRequiredAlert];
    return;
  }
  [self startBackendHelper];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  (void)sender;
  // Closing the sole window is a presentation action, not an audio-stop
  // command.  Keep the native background deck and its local bridge alive;
  // explicit Quit remains the only application-wide termination path.
  return NO;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)hasVisibleWindows {
  (void)sender;
  if (!hasVisibleWindows) [self.mainWindow makeKeyAndOrderFront:nil];
  return YES;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
  (void)sender;
  if (self.terminationReplyPending) return NSTerminateLater;
  self.terminating = YES;
  [self.readinessTimer invalidate];
  self.readinessTimer = nil;

  NSTask *task = self.helperTask;
  if (task == nil || !task.running) return NSTerminateNow;

  self.terminationReplyPending = YES;
  task.terminationHandler = nil;
  pid_t helperPID = task.processIdentifier;
  [task terminate];

  __weak typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    for (NSUInteger attempt = 0; attempt < 30 && task.running; attempt += 1) {
      usleep(100000);
    }
    if (task.running && helperPID > 0) kill(helperPID, SIGKILL);
    dispatch_async(dispatch_get_main_queue(), ^{
      GSAppDelegate *strongSelf = weakSelf;
      if (strongSelf == nil) return;
      strongSelf.terminationReplyPending = NO;
      [NSApp replyToApplicationShouldTerminate:YES];
    });
  });
  return NSTerminateLater;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  (void)notification;
  [self restoreStarPresentation];
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [self.readinessTimer invalidate];
  [self.nativeAudioStateTimer invalidate];
  [self.nativeAudioMeterTimer invalidate];
  [self.backgroundWaveformTimer invalidate];
  [self.karaokeAudioDeck stopAndClear];
  [self.backgroundAudioDeck stopAndClear];
  [self.mainWebView.configuration.userContentController
      removeScriptMessageHandlerForName:GSNativeHandlerName];
}

#pragma mark - Application setup

- (void)buildMainWindow {
  NSRect frame = NSMakeRect(0, 0, 1440, 900);
  NSWindowStyleMask style = NSWindowStyleMaskTitled |
      NSWindowStyleMaskClosable |
      NSWindowStyleMaskMiniaturizable |
      NSWindowStyleMaskResizable;
  self.mainWindow = [[NSWindow alloc]
      initWithContentRect:frame
                styleMask:style
                  backing:NSBackingStoreBuffered
                    defer:NO];
  self.mainWindow.title = @"Guest Star";
  self.mainWindow.releasedWhenClosed = NO;
  // Only the Host window limit changes. WebKit autoresizes the same live view;
  // no media, audio graph, deck, or external Star Screen is rebuilt on resize.
  self.mainWindow.minSize = NSMakeSize(320, 260);
  self.mainWindow.delegate = self;
  [self.mainWindow center];

  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.preferences.javaScriptCanOpenWindowsAutomatically = NO;
  [configuration.userContentController addScriptMessageHandler:self
                                                            name:GSNativeHandlerName];
  self.mainWebView = [[WKWebView alloc]
      initWithFrame:self.mainWindow.contentView.bounds
      configuration:configuration];
  self.mainWebView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.mainWebView.navigationDelegate = self;
  if (@available(macOS 12.0, *)) {
    self.mainWebView.underPageBackgroundColor =
        [NSColor colorWithCalibratedRed:0.035 green:0.027 blue:0.043 alpha:1.0];
  }
  [self.mainWindow.contentView addSubview:self.mainWebView];
}

- (NSMenuItem *)menuItemWithTitle:(NSString *)title
                           action:(SEL)action
                              key:(NSString *)key
                           target:(id)target {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title
                                                action:action
                                         keyEquivalent:key ?: @""];
  item.target = target;
  if (action == @selector(markDiagnostic:)) {
    item.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
  }
  return item;
}

- (void)addMenuWithTitle:(NSString *)title
                   items:(NSArray *)items
                   toBar:(NSMenu *)menuBar {
  NSMenuItem *root = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
  NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
  for (id entry in items) {
    if (entry == NSNull.null) {
      [menu addItem:NSMenuItem.separatorItem];
    } else {
      [menu addItem:(NSMenuItem *)entry];
    }
  }
  root.submenu = menu;
  [menuBar addItem:root];
}

- (void)buildMainMenu {
  NSMenu *menuBar = [[NSMenu alloc] initWithTitle:@"Guest Star"];
  [self addMenuWithTitle:@"Guest Star"
                   items:@[
                     [self menuItemWithTitle:@"Acerca de Guest Star"
                                      action:@selector(showAbout:)
                                         key:@""
                                      target:self],
                     [self menuItemWithTitle:@"Preferencias…"
                                      action:@selector(openPreferences:)
                                         key:@","
                                      target:self],
                     NSNull.null,
                     [self menuItemWithTitle:@"Salir de Guest Star"
                                      action:@selector(terminate:)
                                         key:@"q"
                                      target:NSApp]
                   ]
                   toBar:menuBar];
  [self addMenuWithTitle:@"Actividad"
                   items:@[
                     [self menuItemWithTitle:@"Modo Host"
                                      action:@selector(openLiveEvent:)
                                         key:@"l"
                                      target:self],
                     [self menuItemWithTitle:@"Cambiar actividad…"
                                      action:@selector(switchActivity:)
                                         key:@"k"
                                      target:self],
                     [self menuItemWithTitle:@"Administración Superhost"
                                      action:@selector(openAdministration:)
                                         key:@"h"
                                      target:self]
                   ]
                   toBar:menuBar];
  [self addMenuWithTitle:@"Edición"
                   items:@[
                     [self menuItemWithTitle:@"Cortar" action:@selector(cut:) key:@"x" target:nil],
                     [self menuItemWithTitle:@"Copiar" action:@selector(copy:) key:@"c" target:nil],
                     [self menuItemWithTitle:@"Pegar" action:@selector(paste:) key:@"v" target:nil],
                     [self menuItemWithTitle:@"Seleccionar todo"
                                      action:@selector(selectAll:)
                                         key:@"a"
                                      target:nil]
                   ]
                   toBar:menuBar];
  [self addMenuWithTitle:@"Visualización"
                   items:@[
                     [self menuItemWithTitle:@"Recargar"
                                      action:@selector(reloadPage:)
                                         key:@"r"
                                      target:self],
                     [self menuItemWithTitle:@"Pantalla completa"
                                      action:@selector(toggleFullScreen:)
                                         key:@"f"
                                      target:self]
                   ]
                   toBar:menuBar];
  [self addMenuWithTitle:@"Ventana"
                   items:@[
                     [self menuItemWithTitle:@"Minimizar"
                                      action:@selector(performMiniaturize:)
                                         key:@"m"
                                      target:nil],
                     [self menuItemWithTitle:@"Zoom"
                                      action:@selector(performZoom:)
                                         key:@""
                                      target:nil],
                     [self menuItemWithTitle:@"Traer todo al frente"
                                      action:@selector(arrangeInFront:)
                                         key:@""
                                      target:NSApp]
                   ]
                   toBar:menuBar];
  [self addMenuWithTitle:@"Ayuda"
                   items:@[
                     [self menuItemWithTitle:@"Reportar un problema…"
                                      action:@selector(reportProblem:)
                                         key:@""
                                      target:self],
                     [self menuItemWithTitle:@"Capturar diagnóstico"
                                      action:@selector(markDiagnostic:)
                                         key:@"d"
                                      target:self],
                     NSNull.null,
                     [self menuItemWithTitle:@"Abrir registro de diagnóstico"
                                      action:@selector(openLog:)
                                         key:@""
                                      target:self]
                   ]
                   toBar:menuBar];
  NSApp.mainMenu = menuBar;
}

#pragma mark - Backend lifecycle

- (void)startBackendHelper {
  NSString *helperPath = [NSBundle.mainBundle.bundlePath
      stringByAppendingPathComponent:@"Contents/MacOS/GuestStarBridge.sh"];
  if (![[NSFileManager defaultManager] isExecutableFileAtPath:helperPath]) {
    [self showFatalError:@"No se encontró el supervisor interno de Guest Star."];
    return;
  }

  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:@"/bin/bash"];
  task.arguments = @[ helperPath ];
  NSMutableDictionary<NSString *, NSString *> *environment =
      [NSProcessInfo.processInfo.environment mutableCopy];
  environment[@"GUEST_STAR_NATIVE_HOST"] = @"1";
  task.environment = environment;
  NSFileHandle *nullHandle = [NSFileHandle fileHandleForWritingAtPath:@"/dev/null"];
  task.standardOutput = nullHandle;
  task.standardError = nullHandle;

  __weak typeof(self) weakSelf = self;
  task.terminationHandler = ^(NSTask *finishedTask) {
    int status = finishedTask.terminationStatus;
    dispatch_async(dispatch_get_main_queue(), ^{
      GSAppDelegate *strongSelf = weakSelf;
      if (strongSelf == nil || strongSelf.terminating) return;
      NSString *message = strongSelf.backendReady
          ? @"El servidor local de Guest Star se detuvo inesperadamente."
          : @"Guest Star no pudo iniciar su servidor local.";
      if (status != 0) {
        message = [message stringByAppendingString:
            @" Consulta Library/Logs/Guest Star.log para más detalles."];
      }
      [strongSelf showFatalError:message];
    });
  };

  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    [self showFatalError:[NSString stringWithFormat:
        @"No se pudo iniciar Guest Star: %@", error.localizedDescription]];
    return;
  }
  self.helperTask = task;
  self.launchDeadline = [NSDate dateWithTimeIntervalSinceNow:15.0];
  self.readinessTimer = [NSTimer scheduledTimerWithTimeInterval:0.25
                                                        target:self
                                                      selector:@selector(pollBackend:)
                                                      userInfo:nil
                                                       repeats:YES];
  [self pollBackend:self.readinessTimer];
}

- (void)pollBackend:(NSTimer *)timer {
  (void)timer;
  if (self.backendReady || self.pollInFlight || self.terminating) return;
  if ([self.launchDeadline timeIntervalSinceNow] <= 0) {
    [self showFatalError:
        @"Guest Star no pudo iniciar el servidor local en el puerto 8787. Consulta Library/Logs/Guest Star.log."];
    return;
  }

  self.pollInFlight = YES;
  NSURL *stateURL = [NSURL URLWithString:@"/api/state"
                           relativeToURL:[NSURL URLWithString:GSPanelURLString]];
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:stateURL];
  request.timeoutInterval = 1.0;
  request.cachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
  __weak typeof(self) weakSelf = self;
  NSURLSessionDataTask *dataTask = [NSURLSession.sharedSession
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
          (void)data;
          dispatch_async(dispatch_get_main_queue(), ^{
            GSAppDelegate *strongSelf = weakSelf;
            if (strongSelf == nil) return;
            strongSelf.pollInFlight = NO;
            NSHTTPURLResponse *http = [response isKindOfClass:NSHTTPURLResponse.class]
                ? (NSHTTPURLResponse *)response
                : nil;
            if (error == nil && http.statusCode >= 200 && http.statusCode < 500) {
              [strongSelf backendBecameReady];
            }
          });
        }];
  [dataTask resume];
}

- (void)backendBecameReady {
  if (self.backendReady) return;
  self.backendReady = YES;
  [self.readinessTimer invalidate];
  self.readinessTimer = nil;
  NSURL *panelURL = [NSURL URLWithString:GSPanelURLString];
  [self.mainWebView loadRequest:[NSURLRequest requestWithURL:panelURL]];
}

#pragma mark - Native menu actions

- (void)runMainJavaScript:(NSString *)script {
  if (!self.mainPageReady) return;
  [self.mainWebView evaluateJavaScript:script completionHandler:nil];
}

- (void)showAbout:(id)sender {
  (void)sender;
  [NSApp orderFrontStandardAboutPanelWithOptions:@{
    @"ApplicationName": @"Guest Star"
  }];
}

- (void)openPreferences:(id)sender {
  (void)sender;
  [self.mainWindow makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  if (!self.mainPageReady) {
    self.pendingPreferences = YES;
    return;
  }
  [self dispatchEvent:GSOpenPreferencesEventName detail:@{} inWebView:self.mainWebView];
}

- (void)openLiveEvent:(id)sender {
  (void)sender;
  [self runMainJavaScript:@"window.dispatchEvent(new CustomEvent('gueststar:open-host'))"];
}

- (void)switchActivity:(id)sender {
  (void)sender;
  [self runMainJavaScript:@"document.querySelector('#switchActivity')?.click()"];
}

- (void)openAdministration:(id)sender {
  (void)sender;
  [self runMainJavaScript:@"window.dispatchEvent(new CustomEvent('gueststar:open-superhost'))"];
}

- (void)reloadPage:(id)sender {
  (void)sender;
  [self.mainWebView reload];
}

- (void)toggleFullScreen:(id)sender {
  (void)sender;
  [self.mainWindow toggleFullScreen:nil];
}

- (void)openLog:(id)sender {
  (void)sender;
  NSString *path = [NSHomeDirectory()
      stringByAppendingPathComponent:@"Library/Logs/Guest Star.log"];
  [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:path]];
}

- (void)reportProblem:(id)sender {
  (void)sender;
  [self.mainWindow makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  [self dispatchEvent:GSReportProblemEventName detail:@{} inWebView:self.mainWebView];
}

- (void)markDiagnostic:(id)sender {
  (void)sender;
  [self dispatchEvent:GSMarkDiagnosticEventName detail:@{} inWebView:self.mainWebView];
}

#pragma mark - WebKit bridge

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
  (void)userContentController;
  if (![message.name isEqualToString:GSNativeHandlerName] ||
      message.webView != self.mainWebView ||
      ![self isLocalURL:message.frameInfo.request.URL]) {
    return;
  }

  NSDictionary *payload = [message.body isKindOfClass:NSDictionary.class]
      ? (NSDictionary *)message.body
      : @{};
  NSString *action = nil;
  if ([message.body isKindOfClass:NSString.class]) {
    action = (NSString *)message.body;
  } else {
    id value = payload[@"action"] ?: payload[@"type"] ?: payload[@"command"];
    if ([value isKindOfClass:NSString.class]) action = value;
  }

  if ([action isEqualToString:@"listDisplays"]) {
    [self emitDisplays];
  } else if ([action isEqualToString:@"openStarScreen"]) {
    [self openStarScreenWithPayload:payload];
  } else if ([action isEqualToString:@"setStarScreenDisplay"]) {
    [self updateStarScreenDisplayWithPayload:payload];
  } else if ([action isEqualToString:@"listAudioOutputs"]) {
    [self emitAudioDevicesWithRequestID:[payload[@"requestId"] isKindOfClass:NSString.class] ? payload[@"requestId"] : @""];
  } else if ([action isEqualToString:@"setAudioOutput"]) {
    [self setAudioOutputWithPayload:payload];
  } else if ([action isEqualToString:@"nativeAudioLoad"]) {
    [self loadNativeAudioDeckWithPayload:payload];
  } else if ([action isEqualToString:@"nativeAudioStems"]) {
    [self integrateNativeStemsWithPayload:payload];
  } else if ([action isEqualToString:@"nativeAudioPlay"]) {
    [self playNativeAudioDeckWithPayload:payload];
  } else if ([action isEqualToString:@"nativeAudioPause"]) {
    [self pauseNativeAudioDeckWithPayload:payload];
  } else if ([action isEqualToString:@"nativeAudioSeek"]) {
    [self seekNativeAudioDeckWithPayload:payload];
  } else if ([action isEqualToString:@"nativeAudioConfigure"]) {
    [self configureNativeAudioDeckWithPayload:payload];
  } else if ([action isEqualToString:@"nativeAudioMaster"]) {
    float requested = payload[@"masterDb"] != nil ? [payload[@"masterDb"] floatValue] : 0.0f;
    float gain = payload[@"gain"] != nil ? MAX(0.0f, MIN(1.0f, [payload[@"gain"] floatValue]))
        : requested <= -60 ? 0 : powf(10, MAX(-60.0f, MIN(0.0f, requested)) / 20);
    [self applyNativeMasterGain:gain];
    [self emitNativeAudioSuccessForPayload:payload action:@"nativeAudioMaster" detail:@{ @"masterDb": @(self.nativeMasterDb) }];
  } else if ([action isEqualToString:@"nativeAudioStop"]) {
    [self stopNativeAudioDeckWithPayload:payload];
  } else if ([action isEqualToString:@"nativeAudioStatus"]) {
    [self emitAudioResult:@{ @"requestId": [payload[@"requestId"] isKindOfClass:NSString.class] ? payload[@"requestId"] : @"", @"action": @"nativeAudioStatus", @"ok": @YES, @"state": [self nativeAudioStatePayload] }];
  }
}

- (BOOL)isLocalURL:(NSURL *)url {
  if (url == nil || ![url.scheme.lowercaseString isEqualToString:@"http"]) return NO;
  NSString *host = url.host.lowercaseString;
  if (!([host isEqualToString:@"127.0.0.1"] || [host isEqualToString:@"localhost"])) {
    return NO;
  }
  return url.port.integerValue == 8787;
}

- (NSURL *)localURLFromValue:(id)value {
  NSString *string = [value isKindOfClass:NSString.class] ? (NSString *)value : nil;
  if (string.length == 0) string = @"/star-screen.html?display=1";
  NSURL *baseURL = [NSURL URLWithString:GSPanelURLString];
  NSURL *url = [NSURL URLWithString:string relativeToURL:baseURL].absoluteURL;
  return [self isLocalURL:url] ? url : nil;
}

- (NSString *)JSONStringForObject:(id)object {
  if (![NSJSONSerialization isValidJSONObject:object]) return @"{}";
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"{}";
}

- (void)dispatchEvent:(NSString *)eventName
                detail:(NSDictionary *)detail
             inWebView:(WKWebView *)webView {
  if (webView == nil) return;
  NSString *json = [self JSONStringForObject:detail ?: @{}];
  NSString *script = [NSString stringWithFormat:
      @"window.dispatchEvent(new CustomEvent('%@',{detail:%@}));", eventName, json];
  [webView evaluateJavaScript:script completionHandler:nil];
}

#pragma mark - Native AVAudioEngine playback

- (void)applyNativeMasterGain:(float)gain {
  gain = MAX(0, MIN(1, gain));
  self.nativeMasterDb = gain > 0 ? 20 * log10f(gain) : -60;
  self.nativeMasterGain.globalGain = 0;
  GSRampMixerVolume(self.nativeOutputMix, gain, 0.012);
}

- (BOOL)isAllowedNativeAudioURL:(NSString *)rawURL {
  NSURL *url = [NSURL URLWithString:rawURL ?: @""];
  if (url == nil || ![url.scheme.lowercaseString isEqualToString:@"http"]) return NO;
  NSString *host = url.host.lowercaseString;
  if (!([host isEqualToString:@"127.0.0.1"] || [host isEqualToString:@"localhost"])) return NO;
  if (url.port.integerValue != 8787) return NO;
  NSString *path = url.path ?: @"";
  return [path hasPrefix:@"/api/player/media/"] ||
      [path hasPrefix:@"/api/player/background/media/"] ||
      [path hasPrefix:@"/api/player/stems/"] ||
      [path hasPrefix:@"/api/player/library-media/"];
}

- (BOOL)ensureNativeAudioEngine:(NSError **)error {
  if (self.nativeAudioEngine != nil) {
    if (self.nativeAudioEngine.isRunning || [self.nativeAudioEngine startAndReturnError:error]) return YES;
    return NO;
  }
  AVAudioEngine *engine = [[AVAudioEngine alloc] init];
  self.nativeAudioEngine = engine;
  self.nativeOutputMix = [[AVAudioMixerNode alloc] init];
  self.nativeMasterGain = [[AVAudioUnitEQ alloc] initWithNumberOfBands:0];
  self.nativeMasterGain.globalGain = 0;
  self.nativeOutputMix.outputVolume = self.nativeMasterDb <= -60 ? 0 : powf(10, self.nativeMasterDb / 20);
  self.nativeMeterMix = [[AVAudioMixerNode alloc] init];
  [engine attachNode:self.nativeOutputMix];
  [engine attachNode:self.nativeMasterGain];
  [engine attachNode:self.nativeMeterMix];
  self.karaokeAudioDeck = [[GSAudioDeck alloc] initWithName:@"karaoke" engine:engine destination:self.nativeOutputMix];
  self.backgroundAudioDeck = [[GSAudioDeck alloc] initWithName:@"background" engine:engine destination:self.nativeOutputMix];
  [engine connect:self.nativeOutputMix to:self.nativeMasterGain format:nil];
  [engine connect:self.nativeMasterGain to:self.nativeMeterMix format:nil];
  [engine connect:self.nativeMeterMix to:engine.mainMixerNode format:nil];
  __weak typeof(self) weakSelf = self;
  [self.nativeMeterMix installTapOnBus:0 bufferSize:1024 format:nil block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
    (void)when;
    float *const *channels = buffer.floatChannelData;
    AVAudioFrameCount frames = buffer.frameLength;
    if (channels == NULL || frames == 0) return;
    AVAudioChannelCount count = buffer.format.channelCount;
    float rms[2] = { 0.0f, 0.0f };
    float peak[2] = { 0.0f, 0.0f };
    for (NSUInteger side = 0; side < 2; side += 1) {
      AVAudioChannelCount channel = count > 1 ? (AVAudioChannelCount)side : 0;
      if (channel >= count || channels[channel] == NULL) continue;
      double energy = 0.0;
      for (AVAudioFrameCount frame = 0; frame < frames; frame += 1) {
        float sample = channels[channel][frame];
        energy += (double)sample * sample;
        peak[side] = MAX(peak[side], fabsf(sample));
      }
      rms[side] = sqrtf((float)(energy / frames));
    }
    GSAppDelegate *delegate = weakSelf;
    if (delegate != nil) {
      delegate.outputRmsLeft = rms[0];
      delegate.outputRmsRight = rms[1];
      delegate.outputPeakLeft = peak[0];
      delegate.outputPeakRight = peak[1];
    }
  }];
  [engine prepare];
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(nativeAudioEngineConfigurationChanged:)
                                               name:AVAudioEngineConfigurationChangeNotification
                                             object:engine];
  if (self.nativeAudioOutputID.length > 0) {
    AudioDeviceID selected = [self audioDeviceIDForUID:self.nativeAudioOutputID];
    if (selected != kAudioObjectUnknown && ![self applyNativeAudioDevice:selected error:error]) return NO;
  }
  return [engine startAndReturnError:error];
}

- (GSAudioDeck *)nativeDeckForPayload:(NSDictionary *)payload error:(NSString **)message {
  NSString *name = [payload[@"deck"] isKindOfClass:NSString.class] ? payload[@"deck"] : @"";
  if ([name isEqualToString:@"karaoke"]) return self.karaokeAudioDeck;
  if ([name isEqualToString:@"background"]) return self.backgroundAudioDeck;
  if (message != NULL) *message = @"El deck de audio nativo no es válido.";
  return nil;
}

- (NSDictionary *)nativeAudioStatePayload {
  return @{
    @"engine": @"AVAudioEngine",
    @"audioEngineCount": @(self.nativeAudioEngine != nil ? 1 : 0),
    @"audioContextCount": @0,
    @"timePitchNodeCount": @(self.nativeAudioEngine != nil ? 2 : 0),
    @"running": @(self.nativeAudioEngine.isRunning),
    @"masterDb": @(self.nativeMasterDb),
    @"outputDeviceId": self.nativeAudioOutputID ?: @"",
    @"decks": @[
      self.karaokeAudioDeck != nil ? [self.karaokeAudioDeck state] : @{ @"deck": @"karaoke", @"engine": @"AVAudioEngine", @"playing": @NO },
      self.backgroundAudioDeck != nil ? [self.backgroundAudioDeck state] : @{ @"deck": @"background", @"engine": @"AVAudioEngine", @"playing": @NO }
    ]
  };
}

- (void)emitNativeAudioState {
  if (!self.mainPageReady || self.terminating) return;
  [self dispatchEvent:GSAudioStateEventName detail:[self nativeAudioStatePayload] inWebView:self.mainWebView];
}

- (void)backgroundWaveformTick:(NSTimer *)timer {
  (void)timer;
  if (!self.mainPageReady || self.terminating || !self.nativeAudioEngine.isRunning || !self.backgroundAudioDeck.playing) return;
  NSDictionary *snapshot = [self.backgroundAudioDeck lobbyWaveformState];
  const uint32_t frame = [snapshot[@"frame"] unsignedIntValue];
  if (!snapshot || frame == self.lastBackgroundWaveformFrame) return;
  self.lastBackgroundWaveformFrame = frame;
  [self dispatchEvent:GSBackgroundWaveformEventName detail:snapshot inWebView:self.mainWebView];
}

- (void)nativeAudioStateTick:(NSTimer *)timer {
  (void)timer;
  if (self.nativeAudioEngine != nil &&
      (self.karaokeAudioDeck.playing || self.backgroundAudioDeck.playing)) {
    [self emitNativeAudioState];
  }
}

- (void)nativeAudioMeterTick:(NSTimer *)timer {
  (void)timer;
  if (!self.mainPageReady || self.terminating || self.nativeAudioEngine == nil) return;
  if (!(self.karaokeAudioDeck.playing || self.backgroundAudioDeck.playing)) return;
  [self dispatchEvent:GSOutputMeterEventName detail:@{
    @"rmsL": @(self.outputRmsLeft),
    @"rmsR": @(self.outputRmsRight),
    @"peakL": @(self.outputPeakLeft),
    @"peakR": @(self.outputPeakRight)
  } inWebView:self.mainWebView];
}

- (void)emitNativeAudioSuccessForPayload:(NSDictionary *)payload action:(NSString *)action detail:(NSDictionary *)detail {
  NSString *requestID = [payload[@"requestId"] isKindOfClass:NSString.class] ? payload[@"requestId"] : @"";
  NSMutableDictionary *result = [@{ @"requestId": requestID, @"action": action, @"ok": @YES } mutableCopy];
  if (detail != nil) [result addEntriesFromDictionary:detail];
  // Fire-and-forget mixer updates happen during fades.  Sending a JavaScript
  // result plus a clock snapshot for every frame starves WKWebView's video
  // compositor, so only explicit requests receive an immediate IPC reply.
  if (requestID.length > 0) {
    [self emitAudioResult:result];
    [self emitNativeAudioState];
  }
}

- (void)emitNativeAudioFailureForPayload:(NSDictionary *)payload action:(NSString *)action error:(NSString *)message {
  NSString *requestID = [payload[@"requestId"] isKindOfClass:NSString.class] ? payload[@"requestId"] : @"";
  if (requestID.length > 0) {
    [self emitAudioResult:@{
      @"requestId": requestID,
      @"action": action,
      @"ok": @NO,
      @"error": message.length ? message : @"El motor nativo de audio falló."
    }];
    [self emitNativeAudioState];
  }
}

- (void)loadNativeAudioDeckWithPayload:(NSDictionary *)payload {
  NSError *engineError = nil;
  if (![self ensureNativeAudioEngine:&engineError]) {
    [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioLoad" error:engineError.localizedDescription];
    return;
  }
  NSString *deckError = nil;
  GSAudioDeck *deck = [self nativeDeckForPayload:payload error:&deckError];
  NSArray *rawSources = [payload[@"sources"] isKindOfClass:NSArray.class] ? payload[@"sources"] : @[];
  NSMutableArray<NSDictionary *> *sources = [NSMutableArray array];
  for (id value in rawSources) {
    if (![value isKindOfClass:NSDictionary.class]) continue;
    NSString *url = [value[@"url"] isKindOfClass:NSString.class] ? value[@"url"] : @"";
    if (![self isAllowedNativeAudioURL:url]) {
      [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioLoad" error:@"El bridge nativo rechazó una fuente que no pertenece al servidor local."];
      return;
    }
    NSString *slot = [value[@"slot"] isKindOfClass:NSString.class] ? value[@"slot"] : @"original";
    if (!([slot isEqualToString:@"original"] || [slot isEqualToString:@"instrumental"] || [slot isEqualToString:@"vocals"] || [slot isEqualToString:@"gsx"])) continue;
    [sources addObject:@{ @"url": url, @"slot": slot, @"gain": value[@"gain"] ?: @1 }];
  }
  if (deck == nil || sources.count == 0) {
    [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioLoad" error:deckError ?: @"No hay fuentes locales de audio para cargar."];
    return;
  }
  [deck setTempoPercent:MAX(50.0f, MIN(150.0f, [payload[@"tempoPercent"] floatValue] ?: 100.0f))];
  [deck setPitchSemitones:MAX(-6.0f, MIN(6.0f, [payload[@"pitchSemitones"] floatValue]))];
  [deck setVolume:MAX(0.0f, MIN(1.0f, [payload[@"volume"] floatValue]))];
  [deck setAutoGainDb:MAX(-24.0f, MIN(12.0f, [payload[@"autoGainDb"] floatValue]))];
  NSDictionary *eq = [payload[@"eq"] isKindOfClass:NSDictionary.class] ? payload[@"eq"] : @{};
  [deck setEqualizerLow:[eq[@"low"] floatValue] mid:[eq[@"mid"] floatValue] high:[eq[@"high"] floatValue]];
  NSTimeInterval position = MAX(0.0, [payload[@"position"] doubleValue]);
  [deck loadSources:sources position:position completion:^(BOOL ok, NSString *error, NSTimeInterval duration) {
    if (!ok) { [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioLoad" error:error]; return; }
    // loadSources applies each source's neutral transport gain.  Apply the
    // user-controlled voice gain only after that work, so the visual slider and
    // the actual AVAudioMixerNode always agree from the first audible frame.
    if (payload[@"vocalLevel"] != nil) {
      [deck setVocalLevel:MAX(0.0f, MIN(1.0f, [payload[@"vocalLevel"] floatValue]))];
    }
    [self emitNativeAudioSuccessForPayload:payload action:@"nativeAudioLoad" detail:@{
      @"deck": deck.name,
      @"duration": @(duration),
      @"engine": @"AVAudioEngine",
      @"timePitch": @"AVAudioUnitTimePitch"
    }];
  }];
}

- (void)integrateNativeStemsWithPayload:(NSDictionary *)payload {
  NSString *deckError = nil;
  GSAudioDeck *deck = [self nativeDeckForPayload:payload error:&deckError];
  NSArray *sources = [payload[@"sources"] isKindOfClass:NSArray.class] ? payload[@"sources"] : @[];
  if (deck == nil || sources.count == 0) {
    [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioStems" error:deckError ?: @"No hay stems para integrar."]; return;
  }
  for (NSDictionary *source in sources) {
    if (![source isKindOfClass:NSDictionary.class] || ![self isAllowedNativeAudioURL:source[@"url"]] ||
        ![@[@"gsx", @"instrumental", @"vocals"] containsObject:source[@"slot"]]) {
      [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioStems" error:@"La fuente de stems no pertenece al servidor local."]; return;
    }
  }
  [deck integrateStemSources:sources completion:^(BOOL ok, NSString *error, NSTimeInterval duration) {
    if (!ok) [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioStems" error:error];
    else [self emitNativeAudioSuccessForPayload:payload action:@"nativeAudioStems" detail:@{@"duration": @(duration), @"position": @([deck currentPosition])}];
  }];
}

- (void)playNativeAudioDeckWithPayload:(NSDictionary *)payload {
  NSError *engineError = nil;
  if (![self ensureNativeAudioEngine:&engineError]) { [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioPlay" error:engineError.localizedDescription]; return; }
  NSString *deckError = nil;
  GSAudioDeck *deck = [self nativeDeckForPayload:payload error:&deckError];
  NSError *playError = nil;
  if (deck == nil || ![deck playAtPosition:MAX(0.0, [payload[@"position"] doubleValue]) error:&playError]) {
    [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioPlay" error:deckError ?: playError.localizedDescription];
    return;
  }
  [self emitNativeAudioSuccessForPayload:payload action:@"nativeAudioPlay" detail:@{ @"deck": deck.name, @"position": @([deck currentPosition]) }];
}

- (void)pauseNativeAudioDeckWithPayload:(NSDictionary *)payload {
  NSString *deckError = nil;
  GSAudioDeck *deck = [self nativeDeckForPayload:payload error:&deckError];
  if (deck == nil) { [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioPause" error:deckError]; return; }
  [deck pause];
  [self emitNativeAudioSuccessForPayload:payload action:@"nativeAudioPause" detail:@{ @"deck": deck.name, @"position": @([deck currentPosition]) }];
}

- (void)seekNativeAudioDeckWithPayload:(NSDictionary *)payload {
  NSString *deckError = nil;
  GSAudioDeck *deck = [self nativeDeckForPayload:payload error:&deckError];
  if (deck == nil) { [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioSeek" error:deckError]; return; }
  NSUInteger revision = [payload[@"revision"] respondsToSelector:@selector(unsignedIntegerValue)]
      ? [payload[@"revision"] unsignedIntegerValue] : 0;
  if (revision > 0 && revision < deck.lastSeekRevision) {
    [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioSeek" error:@"El seek fue sustituido por uno más reciente."];
    return;
  }
  if (revision > 0) deck.lastSeekRevision = revision;
  [deck seek:MAX(0.0, [payload[@"position"] doubleValue])];
  [self emitNativeAudioSuccessForPayload:payload action:@"nativeAudioSeek" detail:@{ @"deck": deck.name, @"position": @([deck currentPosition]) }];
}

- (void)configureNativeAudioDeckWithPayload:(NSDictionary *)payload {
  NSString *deckError = nil;
  GSAudioDeck *deck = [self nativeDeckForPayload:payload error:&deckError];
  if (deck == nil) { [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioConfigure" error:deckError]; return; }
  if (payload[@"tempoPercent"] != nil) [deck setTempoPercent:MAX(50.0f, MIN(150.0f, [payload[@"tempoPercent"] floatValue]))];
  if (payload[@"pitchSemitones"] != nil) [deck setPitchSemitones:MAX(-6.0f, MIN(6.0f, [payload[@"pitchSemitones"] floatValue]))];
  if (payload[@"volume"] != nil) [deck setVolume:MAX(0.0f, MIN(1.0f, [payload[@"volume"] floatValue]))];
  if (payload[@"autoGainDb"] != nil) [deck setAutoGainDb:MAX(-24.0f, MIN(12.0f, [payload[@"autoGainDb"] floatValue]))];
  if (payload[@"vocalLevel"] != nil) [deck setVocalLevel:MAX(0.0f, MIN(1.0f, [payload[@"vocalLevel"] floatValue]))];
  NSDictionary *eq = [payload[@"eq"] isKindOfClass:NSDictionary.class] ? payload[@"eq"] : nil;
  if (eq != nil) [deck setEqualizerLow:[eq[@"low"] floatValue] mid:[eq[@"mid"] floatValue] high:[eq[@"high"] floatValue]];
  [self emitNativeAudioSuccessForPayload:payload action:@"nativeAudioConfigure" detail:@{ @"deck": deck.name, @"state": [deck state] }];
}

- (void)stopNativeAudioDeckWithPayload:(NSDictionary *)payload {
  NSString *deckError = nil;
  GSAudioDeck *deck = [self nativeDeckForPayload:payload error:&deckError];
  if (deck == nil) { [self emitNativeAudioFailureForPayload:payload action:@"nativeAudioStop" error:deckError]; return; }
  [deck cancelPendingLoadsAndStop];
  [self emitNativeAudioSuccessForPayload:payload action:@"nativeAudioStop" detail:@{ @"deck": deck.name }];
}

- (void)nativeAudioEngineConfigurationChanged:(NSNotification *)notification {
  (void)notification;
  if (self.nativeAudioEngine == nil || self.terminating) return;
  BOOL karaokePlaying = self.karaokeAudioDeck.playing;
  BOOL backgroundPlaying = self.backgroundAudioDeck.playing;
  NSTimeInterval karaokePosition = [self.karaokeAudioDeck currentPosition];
  NSTimeInterval backgroundPosition = [self.backgroundAudioDeck currentPosition];
  [self.nativeAudioEngine stop];
  NSError *error = nil;
  if (![self.nativeAudioEngine startAndReturnError:&error]) {
    [self dispatchEvent:GSAudioStateEventName detail:@{ @"engine": @"AVAudioEngine", @"error": error.localizedDescription ?: @"El motor nativo no se recuperó." } inWebView:self.mainWebView];
    return;
  }
  if (karaokePlaying) [self.karaokeAudioDeck playAtPosition:karaokePosition error:nil];
  if (backgroundPlaying) [self.backgroundAudioDeck playAtPosition:backgroundPosition error:nil];
  [self emitNativeAudioState];
}

#pragma mark - Native CoreAudio output routing

- (NSString *)audioStringProperty:(AudioObjectID)objectID selector:(AudioObjectPropertySelector)selector {
  AudioObjectPropertyAddress address = { selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  CFStringRef value = NULL;
  UInt32 size = sizeof(value);
  if (AudioObjectGetPropertyData(objectID, &address, 0, NULL, &size, &value) != noErr || value == NULL) return @"";
  return CFBridgingRelease(value) ?: @"";
}

- (BOOL)audioDeviceHasOutput:(AudioDeviceID)deviceID {
  AudioObjectPropertyAddress address = { kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput, kAudioObjectPropertyElementMain };
  UInt32 size = 0;
  return AudioObjectGetPropertyDataSize(deviceID, &address, 0, NULL, &size) == noErr && size >= sizeof(AudioStreamID);
}

- (NSArray *)audioOutputDevices {
  AudioObjectPropertyAddress address = { kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size) != noErr || size == 0) return @[];
  NSUInteger count = size / sizeof(AudioDeviceID);
  AudioDeviceID *deviceIDs = calloc(count, sizeof(AudioDeviceID));
  if (deviceIDs == NULL) return @[];
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, deviceIDs) != noErr) { free(deviceIDs); return @[]; }
  AudioDeviceID defaultID = kAudioObjectUnknown;
  AudioObjectPropertyAddress defaultAddress = { kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  UInt32 defaultSize = sizeof(defaultID);
  AudioObjectGetPropertyData(kAudioObjectSystemObject, &defaultAddress, 0, NULL, &defaultSize, &defaultID);
  NSMutableArray *result = [NSMutableArray array];
  for (NSUInteger index = 0; index < count; index += 1) {
    AudioDeviceID deviceID = deviceIDs[index];
    if (![self audioDeviceHasOutput:deviceID]) continue;
    NSString *uid = [self audioStringProperty:deviceID selector:kAudioDevicePropertyDeviceUID];
    if (uid.length == 0) continue;
    NSString *name = [self audioStringProperty:deviceID selector:kAudioObjectPropertyName];
    [result addObject:@{ @"deviceId": uid, @"label": name.length ? name : @"Salida de audio", @"isDefault": @(deviceID == defaultID) }];
  }
  free(deviceIDs);
  return result;
}

- (void)emitAudioResult:(NSDictionary *)detail {
  [self dispatchEvent:GSAudioResultEventName detail:detail inWebView:self.mainWebView];
}

- (void)emitAudioDevicesWithRequestID:(NSString *)requestID {
  [self emitAudioResult:@{ @"requestId": requestID ?: @"", @"action": @"listAudioOutputs", @"ok": @YES, @"devices": [self audioOutputDevices] }];
}

- (AudioDeviceID)audioDeviceIDForUID:(NSString *)uid {
  if (uid.length == 0) return kAudioObjectUnknown;
  AudioDeviceID targetID = kAudioObjectUnknown;
  CFStringRef targetCFUID = (__bridge CFStringRef)uid;
  AudioValueTranslation translation = { &targetCFUID, sizeof(targetCFUID), &targetID, sizeof(targetID) };
  AudioObjectPropertyAddress translationAddress = { kAudioHardwarePropertyDeviceForUID, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  UInt32 translationSize = sizeof(translation);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &translationAddress, 0, NULL, &translationSize, &translation) != noErr) return kAudioObjectUnknown;
  return targetID;
}

- (BOOL)applyNativeAudioDevice:(AudioDeviceID)deviceID error:(NSError **)error {
  if (self.nativeAudioEngine == nil || deviceID == kAudioObjectUnknown) return YES;
  BOOL wasRunning = self.nativeAudioEngine.isRunning;
  if (wasRunning) [self.nativeAudioEngine stop];
  AudioUnit output = self.nativeAudioEngine.outputNode.audioUnit;
  OSStatus status = AudioUnitSetProperty(output, kAudioOutputUnitProperty_CurrentDevice,
                                         kAudioUnitScope_Global, 0, &deviceID, sizeof(deviceID));
  if (status != noErr) {
    if (error != NULL) *error = [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:@{ NSLocalizedDescriptionKey: [NSString stringWithFormat:@"AVAudioEngine no pudo seleccionar la salida (%d).", (int)status] }];
    return NO;
  }
  if (wasRunning && ![self.nativeAudioEngine startAndReturnError:error]) return NO;
  return YES;
}

- (void)setAudioOutputWithPayload:(NSDictionary *)payload {
  NSString *requestID = [payload[@"requestId"] isKindOfClass:NSString.class] ? payload[@"requestId"] : @"";
  NSString *uid = [payload[@"deviceId"] isKindOfClass:NSString.class] ? payload[@"deviceId"] : @"";
  NSArray *devices = [self audioOutputDevices];
  NSDictionary *match = nil;
  if (uid.length == 0) match = [devices filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *device, NSDictionary *bindings) { (void)bindings; return [device[@"isDefault"] boolValue]; }]].firstObject;
  else match = [devices filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *device, NSDictionary *bindings) { (void)bindings; return [device[@"deviceId"] isEqualToString:uid]; }]].firstObject;
  if (match == nil) {
    [self emitAudioResult:@{ @"requestId": requestID, @"action": @"setAudioOutput", @"ok": @NO, @"error": @"La salida de audio ya no está disponible." }];
    return;
  }
  NSString *targetUID = match[@"deviceId"];
  AudioDeviceID targetID = [self audioDeviceIDForUID:targetUID];
  if (targetID == kAudioObjectUnknown) {
    [self emitAudioResult:@{ @"requestId": requestID, @"action": @"setAudioOutput", @"ok": @NO, @"error": @"CoreAudio no pudo resolver la salida seleccionada." }];
    return;
  }
  NSError *engineError = nil;
  if (![self applyNativeAudioDevice:targetID error:&engineError]) {
    [self emitAudioResult:@{ @"requestId": requestID, @"action": @"setAudioOutput", @"ok": @NO, @"error": engineError.localizedDescription ?: @"AVAudioEngine rechazó el cambio de salida." }];
    return;
  }
  // Keep Guest Star's route private to its AVAudioEngine.  Changing this
  // control must never alter the system-wide macOS output for other apps.
  self.nativeAudioOutputID = uid;
  [self emitAudioResult:@{ @"requestId": requestID, @"action": @"setAudioOutput", @"ok": @YES, @"deviceId": targetUID, @"label": match[@"label"] ?: @"Salida de audio" }];
  [self emitNativeAudioState];
}

- (void)observeAudioDeviceChanges {
  AudioObjectPropertyAddress address = { kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  __weak typeof(self) weakSelf = self;
  AudioObjectAddPropertyListenerBlock(kAudioObjectSystemObject, &address, dispatch_get_main_queue(),
      ^(UInt32 numberAddresses, const AudioObjectPropertyAddress *addresses) {
        (void)numberAddresses; (void)addresses;
        GSAppDelegate *strongSelf = weakSelf;
        if (strongSelf == nil || !strongSelf.mainPageReady) return;
        [strongSelf dispatchEvent:GSAudioDevicesChangedEventName detail:@{} inWebView:strongSelf.mainWebView];
      });
}

#pragma mark - Display discovery and Star Screen

- (CGDirectDisplayID)directDisplayIDForScreen:(NSScreen *)screen {
  NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
  return (CGDirectDisplayID)number.unsignedIntValue;
}

- (NSString *)UUIDForDisplayID:(CGDirectDisplayID)displayID {
  CFUUIDRef displayUUID = CGDisplayCreateUUIDFromDisplayID(displayID);
  if (displayUUID == NULL) return @"";
  CFStringRef uuidString = CFUUIDCreateString(kCFAllocatorDefault, displayUUID);
  CFRelease(displayUUID);
  return CFBridgingRelease(uuidString) ?: @"";
}

- (NSString *)stableDisplayIDForScreen:(NSScreen *)screen {
  CGDirectDisplayID directID = [self directDisplayIDForScreen:screen];
  NSString *uuid = [self UUIDForDisplayID:directID];
  return uuid.length > 0 ? uuid : [NSString stringWithFormat:@"%u", directID];
}

- (NSDictionary *)dictionaryForScreen:(NSScreen *)screen {
  CGDirectDisplayID directID = [self directDisplayIDForScreen:screen];
  NSString *uuid = [self UUIDForDisplayID:directID];
  NSRect frame = screen.frame;
  return @{
    @"displayId": uuid.length > 0 ? uuid : [NSString stringWithFormat:@"%u", directID],
    @"cgDisplayId": @(directID),
    @"uuid": uuid,
    @"localizedName": screen.localizedName ?: @"Pantalla",
    @"frame": @{
      @"x": @(NSMinX(frame)),
      @"y": @(NSMinY(frame)),
      @"width": @(NSWidth(frame)),
      @"height": @(NSHeight(frame))
    },
    @"builtIn": @(CGDisplayIsBuiltin(directID)),
    @"primary": @(directID == CGMainDisplayID())
  };
}

- (NSArray<NSDictionary *> *)displayPayloads {
  NSMutableArray<NSDictionary *> *result = [NSMutableArray array];
  for (NSScreen *screen in NSScreen.screens) {
    [result addObject:[self dictionaryForScreen:screen]];
  }
  return result;
}

- (void)emitDisplays {
  [self dispatchEvent:GSDisplaysEventName
                detail:@{ @"displays": [self displayPayloads] }
             inWebView:self.mainWebView];
}

- (NSScreen *)primaryScreen {
  for (NSScreen *screen in NSScreen.screens) {
    if ([self directDisplayIDForScreen:screen] == CGMainDisplayID()) return screen;
  }
  return NSScreen.mainScreen ?: NSScreen.screens.firstObject;
}

- (NSScreen *)screenForDisplayID:(NSString *)displayID {
  if (displayID.length == 0) return nil;
  for (NSScreen *screen in NSScreen.screens) {
    CGDirectDisplayID directID = [self directDisplayIDForScreen:screen];
    if ([[self stableDisplayIDForScreen:screen] isEqualToString:displayID] ||
        [[NSString stringWithFormat:@"%u", directID] isEqualToString:displayID]) {
      return screen;
    }
  }
  return nil;
}

// Keep the guest presentation on an external output, including when it is
// the macOS primary display. Preview windows remain independently controllable.
- (BOOL)isBuiltInScreen:(NSScreen *)screen {
  return CGDisplayIsBuiltin([self directDisplayIDForScreen:screen]);
}

- (NSScreen *)starScreenForDisplayID:(NSString *)displayID preview:(BOOL)preview {
  NSScreen *requested = [self screenForDisplayID:displayID];
  if (preview) return requested ?: [self primaryScreen];
  if (requested && ![self isBuiltInScreen:requested]) return requested;
  for (NSScreen *screen in NSScreen.screens) {
    if (![self isBuiltInScreen:screen] && screen != self.mainWindow.screen) return screen;
  }
  for (NSScreen *screen in NSScreen.screens) {
    if (![self isBuiltInScreen:screen]) return screen;
  }
  return requested ?: [self primaryScreen];
}

- (void)restoreStarPresentation {
  if (!self.starPresentationActive) return;
  NSApp.presentationOptions = self.previousStarPresentationOptions;
  self.starPresentationActive = NO;
}

- (void)createStarWindowIfNeeded {
  if (self.starWindow != nil) return;
  self.starWindow = [[NSWindow alloc]
      initWithContentRect:NSMakeRect(0, 0, 1280, 720)
                styleMask:NSWindowStyleMaskBorderless
                  backing:NSBackingStoreBuffered
                    defer:NO];
  self.starWindow.title = @"Guest Star · Star Screen";
  self.starWindow.backgroundColor = NSColor.blackColor;
  self.starWindow.releasedWhenClosed = NO;
  self.starWindow.delegate = self;
  self.starWindow.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
      NSWindowCollectionBehaviorFullScreenAuxiliary;

  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.preferences.javaScriptCanOpenWindowsAutomatically = NO;
  self.starWebView = [[WKWebView alloc]
      initWithFrame:self.starWindow.contentView.bounds
      configuration:configuration];
  self.starWebView.navigationDelegate = self;
  if (@available(macOS 12.0, *)) {
    self.starWebView.underPageBackgroundColor = NSColor.blackColor;
  }
  [self.starWindow.contentView addSubview:self.starWebView];
}

- (void)layoutStarWebView {
  if (self.starWindow == nil || self.starWebView == nil) return;
  NSRect bounds = self.starWindow.contentView.bounds;
  if (self.starPreview) {
    self.starWebView.frame = bounds;
    return;
  }
  CGFloat width = NSWidth(bounds);
  CGFloat height = width * 9.0 / 16.0;
  if (height > NSHeight(bounds)) {
    height = NSHeight(bounds);
    width = height * 16.0 / 9.0;
  }
  self.starWebView.frame = NSMakeRect(
      floor((NSWidth(bounds) - width) / 2.0),
      floor((NSHeight(bounds) - height) / 2.0),
      floor(width),
      floor(height));
}

- (void)configureStarWindowForScreen:(NSScreen *)screen preview:(BOOL)preview {
  [self createStarWindowIfNeeded];
  self.starPreview = preview;
  // The built-in-only output stays controllable; an external output is
  // always a full-display presentation, including clamshell operation.
  BOOL floatingWindow = preview || (NSScreen.screens.count <= 1 &&
      [self isBuiltInScreen:screen]);
  if (floatingWindow) {
    [self restoreStarPresentation];
    self.starWindow.styleMask = NSWindowStyleMaskTitled |
        NSWindowStyleMaskClosable |
        NSWindowStyleMaskMiniaturizable |
        NSWindowStyleMaskResizable;
    self.starWindow.level = NSNormalWindowLevel;
    self.starWindow.collectionBehavior = NSWindowCollectionBehaviorDefault;
    self.starWindow.contentAspectRatio = NSMakeSize(16, 9);
    self.starWindow.minSize = NSMakeSize(800, 450);

    NSRect visible = screen.visibleFrame;
    CGFloat contentWidth = MIN(1280.0, NSWidth(visible) * 0.86);
    CGFloat contentHeight = contentWidth * 9.0 / 16.0;
    if (contentHeight > NSHeight(visible) * 0.86) {
      contentHeight = NSHeight(visible) * 0.86;
      contentWidth = contentHeight * 16.0 / 9.0;
    }
    NSRect content = NSMakeRect(0, 0, contentWidth, contentHeight);
    NSRect frame = [self.starWindow frameRectForContentRect:content];
    frame.origin.x = NSMidX(visible) - NSWidth(frame) / 2.0;
    frame.origin.y = NSMidY(visible) - NSHeight(frame) / 2.0;
    [self.starWindow setFrame:frame display:YES];
  } else {
    self.starWindow.styleMask = NSWindowStyleMaskBorderless;
    // Cover system chrome even when the pointer reaches the output edges.
    self.starWindow.level = NSScreenSaverWindowLevel;
    if (!self.starPresentationActive) {
      self.previousStarPresentationOptions = NSApp.presentationOptions;
      self.starPresentationActive = YES;
    }
    NSApp.presentationOptions = NSApplicationPresentationHideDock |
        NSApplicationPresentationHideMenuBar;
    self.starWindow.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
        NSWindowCollectionBehaviorFullScreenAuxiliary;
    self.starWindow.contentAspectRatio = NSZeroSize;
    [self.starWindow setFrame:screen.frame display:YES];
  }
  [self layoutStarWebView];
}

- (void)presentStarWindow {
  if (self.starWindow.miniaturized) [self.starWindow deminiaturize:nil];
  [self.starWindow makeKeyAndOrderFront:nil];
  [self.starWindow orderFrontRegardless];
  [NSApp activateIgnoringOtherApps:YES];
}

- (void)emitStarScreenResultWithOK:(BOOL)ok
                            reused:(BOOL)reused
                            screen:(NSScreen *)screen
                          fallback:(BOOL)fallback
                             error:(NSString *)error {
  NSMutableDictionary *detail = [@{
    @"ok": @(ok),
    @"reused": @(reused),
    @"fallback": @(fallback),
    @"preview": @(self.starPreview),
    @"url": self.starURLString ?: @""
  } mutableCopy];
  if (screen != nil) {
    detail[@"displayId"] = [self stableDisplayIDForScreen:screen];
    detail[@"cgDisplayId"] = @([self directDisplayIDForScreen:screen]);
  }
  if (self.requestedStarDisplayID.length > 0) {
    detail[@"requestedDisplayId"] = self.requestedStarDisplayID;
  }
  if (error.length > 0) detail[@"error"] = error;
  [self dispatchEvent:GSStarScreenResultEventName detail:detail inWebView:self.mainWebView];
}

- (void)openStarScreenWithPayload:(NSDictionary *)payload {
  NSURL *url = [self localURLFromValue:payload[@"url"]];
  if (url == nil) {
    [self emitStarScreenResultWithOK:NO
                              reused:(self.starWindow != nil)
                              screen:nil
                            fallback:NO
                               error:@"Star Screen solo puede cargar una URL local de Guest Star."];
    return;
  }

  id rawDisplayID = payload[@"displayId"];
  NSString *displayID = [rawDisplayID isKindOfClass:NSString.class]
      ? rawDisplayID
      : ([rawDisplayID respondsToSelector:@selector(stringValue)]
          ? [rawDisplayID stringValue]
          : @"");
  self.requestedStarDisplayID = displayID;
  BOOL preview = [payload[@"preview"] respondsToSelector:@selector(boolValue)]
      ? [payload[@"preview"] boolValue]
      : NO;
  NSScreen *requestedScreen = [self screenForDisplayID:displayID];
  BOOL fallback = displayID.length > 0 && requestedScreen == nil;
  NSScreen *screen = [self starScreenForDisplayID:displayID preview:preview];
  if (screen == nil) {
    [self emitStarScreenResultWithOK:NO
                              reused:(self.starWindow != nil)
                              screen:nil
                            fallback:YES
                               error:@"macOS no informó ninguna pantalla disponible."];
    return;
  }

  BOOL reused = self.starWindow != nil;
  [self configureStarWindowForScreen:screen preview:preview];
  self.starURLString = url.absoluteString;
  if (![self.starWebView.URL.absoluteString isEqualToString:url.absoluteString]) {
    [self.starWebView loadRequest:[NSURLRequest requestWithURL:url]];
  }
  [self presentStarWindow];
  [self emitStarScreenResultWithOK:YES
                            reused:reused
                            screen:screen
                          fallback:fallback
                             error:fallback
      ? @"La pantalla configurada ya no está disponible; se usó la principal."
      : nil];
}

- (void)updateStarScreenDisplayWithPayload:(NSDictionary *)payload {
  id rawDisplayID = payload[@"displayId"];
  NSString *displayID = [rawDisplayID isKindOfClass:NSString.class]
      ? rawDisplayID
      : ([rawDisplayID respondsToSelector:@selector(stringValue)]
          ? [rawDisplayID stringValue]
          : @"");
  self.requestedStarDisplayID = displayID;
  if (self.starWindow == nil || !self.starWindow.visible) return;
  NSScreen *requested = [self screenForDisplayID:displayID];
  BOOL fallback = displayID.length > 0 && requested == nil;
  NSScreen *screen = [self starScreenForDisplayID:displayID preview:self.starPreview];
  if (screen == nil) {
    [self emitStarScreenResultWithOK:NO
                              reused:YES
                              screen:nil
                            fallback:YES
                               error:@"macOS no informó ninguna pantalla disponible."];
    return;
  }
  [self configureStarWindowForScreen:screen preview:self.starPreview];
  [self presentStarWindow];
  [self emitStarScreenResultWithOK:YES
                            reused:YES
                            screen:screen
                          fallback:fallback
                             error:fallback
      ? @"La pantalla configurada ya no está disponible; se usó la principal."
      : nil];
}

- (void)screenParametersChanged:(NSNotification *)notification {
  (void)notification;
  [self emitDisplays];
  if (self.starWindow == nil || !self.starWindow.visible) return;
  NSScreen *requested = [self screenForDisplayID:self.requestedStarDisplayID];
  BOOL fallback = self.requestedStarDisplayID.length > 0 && requested == nil;
  NSScreen *screen = [self starScreenForDisplayID:self.requestedStarDisplayID preview:self.starPreview];
  if (screen == nil) return;
  [self configureStarWindowForScreen:screen preview:self.starPreview];
  [self.starWindow orderFrontRegardless];
  [self emitStarScreenResultWithOK:YES
                            reused:YES
                            screen:screen
                          fallback:fallback
                             error:fallback
      ? @"La pantalla configurada ya no está disponible; se usó la principal."
      : nil];
}

#pragma mark - Window and navigation delegates

- (BOOL)windowShouldClose:(NSWindow *)window {
  if (window == self.mainWindow) {
    [NSApp terminate:nil];
    return NO;
  }
  if (window == self.starWindow) {
    [self restoreStarPresentation];
    [window orderOut:nil];
    return NO;
  }
  return YES;
}

- (void)windowDidResize:(NSNotification *)notification {
  if (notification.object == self.starWindow) [self layoutStarWebView];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)navigation;
  if (webView != self.mainWebView || ![self isLocalURL:webView.URL]) return;
  self.mainPageReady = YES;
  [self emitDisplays];
  if (self.pendingPreferences) {
    self.pendingPreferences = NO;
    [self dispatchEvent:GSOpenPreferencesEventName detail:@{} inWebView:self.mainWebView];
  }
}

- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)navigation
                       withError:(NSError *)error {
  (void)navigation;
  [self handleNavigationFailureForWebView:webView error:error];
}

- (void)webView:(WKWebView *)webView
    didFailNavigation:(WKNavigation *)navigation
             withError:(NSError *)error {
  (void)navigation;
  [self handleNavigationFailureForWebView:webView error:error];
}

- (void)handleNavigationFailureForWebView:(WKWebView *)webView error:(NSError *)error {
  if (webView != self.mainWebView || error.code == NSURLErrorCancelled || self.terminating) return;
  [self showFatalError:[NSString stringWithFormat:
      @"La interfaz local de Guest Star no pudo cargarse: %@", error.localizedDescription]];
}

#pragma mark - Native alerts

- (void)showInstallRequiredAlert {
  NSAlert *alert = [[NSAlert alloc] init];
  alert.alertStyle = NSAlertStyleWarning;
  alert.messageText = @"Instala Guest Star";
  alert.informativeText =
      @"Mueve Guest Star a la carpeta Aplicaciones y ábrela desde allí.";
  [alert addButtonWithTitle:@"Abrir Aplicaciones"];
  [alert beginSheetModalForWindow:self.mainWindow
               completionHandler:^(NSModalResponse returnCode) {
                 (void)returnCode;
                 [[NSWorkspace sharedWorkspace]
                     openURL:[NSURL fileURLWithPath:@"/Applications"]];
                 [NSApp terminate:nil];
               }];
}

- (void)showFatalError:(NSString *)message {
  if (self.fatalErrorPresented || self.terminating) return;
  self.fatalErrorPresented = YES;
  [self.readinessTimer invalidate];
  self.readinessTimer = nil;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.alertStyle = NSAlertStyleCritical;
  alert.messageText = @"Guest Star no pudo iniciarse";
  alert.informativeText = message;
  [alert addButtonWithTitle:@"Salir"];
  [alert beginSheetModalForWindow:self.mainWindow
               completionHandler:^(NSModalResponse returnCode) {
                 (void)returnCode;
                 [NSApp terminate:nil];
               }];
}

@end

#ifndef GUEST_STAR_NATIVE_TEST
int main(int argc, const char *argv[]) {
  (void)argc;
  (void)argv;
  @autoreleasepool {
    NSApplication *application = NSApplication.sharedApplication;
    [application setActivationPolicy:NSApplicationActivationPolicyRegular];
    GSAppDelegate *delegate = [[GSAppDelegate alloc] init];
    application.delegate = delegate;
    [application run];
  }
  return 0;
}
#endif
