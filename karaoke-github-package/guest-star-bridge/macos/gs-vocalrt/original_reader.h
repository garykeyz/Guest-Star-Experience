#import <AVFoundation/AVFoundation.h>
// Local decoder used only by the internal P0 candidate. Shares the existing
// reader interface without changing GSX or non-separation features.
@interface GSVOriginalReader : NSObject
@property(nonatomic,readonly) NSString *kind;
@property(nonatomic,readonly) AVAudioFormat *format;
@property(nonatomic,readonly) AVAudioFramePosition frameCount;
+ (void)prepareURL:(NSURL *)url completion:(void (^)(GSVOriginalReader *,NSError *))completion;
- (BOOL)scheduleFromPosition:(NSTimeInterval)position player:(AVAudioPlayerNode *)player error:(NSError **)error;
- (BOOL)isPreparedForPosition:(NSTimeInterval)position;
- (void)whenPreparedForPosition:(NSTimeInterval)position completion:(void (^)(BOOL, NSError *))completion;
- (void)invalidate;
- (void)close;
- (NSDictionary *)diagnostics;
@end
void GSVPrepareOriginalSource(NSURL *mediaURL,void (^completion)(NSDictionary *,NSError *));
