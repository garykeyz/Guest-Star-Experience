#define GUEST_STAR_NATIVE_TEST 1
#include "GuestStarNativeHost.m"
// Controlled native smoke: silent fixture, master muted; no app lifecycle or helper.
@interface GSGameSmoke : GSAppDelegate
@property(nonatomic,strong) NSDictionary *lastResult;
@end
@implementation GSGameSmoke
- (void)emitAudioResult:(NSDictionary *)result { self.lastResult=result; }
@end
static void Check(BOOL condition, NSString *message) { if(!condition){fprintf(stderr,"FAIL: %s\n",message.UTF8String);exit(1);} }
int main(int argc,const char **argv){@autoreleasepool{
 Check(argc==2,@"Expected isolated HTTP WAV URL");GSGameSmoke *host=[GSGameSmoke new];host.nativeMasterDb=-60;NSError *error=nil;Check([host ensureNativeAudioEngine:&error],error.localizedDescription ?: @"Native engine failed");
 Check([host isAllowedNativeAudioURL:@"http://127.0.0.1:8787/api/games/media/12345678-1234-1234-1234-123456789012"],@"Local game resource denied");Check(![host isAllowedNativeAudioURL:@"https://example.com/api/games/media/x"],@"Remote media accepted");
 host.gameAudioDeck=[[GSAudioDeck alloc]initWithName:@"game" engine:host.nativeAudioEngine destination:host.nativeOutputMix];__block BOOL done=NO,loaded=NO;
 [host.gameAudioDeck loadSources:@[@{@"slot":@"original",@"url":@(argv[1]),@"gain":@1}] position:.4 completion:^(BOOL ok,NSString *failure,NSTimeInterval duration){loaded=ok&&duration>=2;done=YES;if(!ok)fprintf(stderr,"%s\n",failure.UTF8String);}];
 NSDate *limit=[NSDate dateWithTimeIntervalSinceNow:10];while(!done&&limit.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.01]];Check(loaded,@"Silent fixture load failed");host.gameAudioDeck.duration=1.0;
 Check([host.gameAudioDeck playAtPosition:.4 error:&error],error.localizedDescription ?: @"Fragment play failed");NSDate *start=NSDate.date;NSTimeInterval last=.4;while(start.timeIntervalSinceNow>-2&&host.gameAudioDeck.playing){last=[host.gameAudioDeck currentPosition];[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.01]];}Check(!host.gameAudioDeck.playing&&last>=.99&&last<=1.001,@"Fragment did not stop at bounded render position");
 host.karaokeAudioDeck.playing=YES;[host playNativeAudioDeckWithPayload:@{@"deck":@"game",@"position":@.4,@"requestId":@"mutual-a"}];Check([host.lastResult[@"ok"] isEqual:@NO],@"Game interrupted karaoke");host.karaokeAudioDeck.playing=NO;
 host.gameAudioDeck.playing=YES;[host playNativeAudioDeckWithPayload:@{@"deck":@"karaoke",@"requestId":@"mutual-b"}];Check([host.lastResult[@"ok"] isEqual:@NO],@"Karaoke interrupted game");host.gameAudioDeck.playing=NO;host.gameAudioOwner=@"game-native-smoke";[host stopNativeAudioDeckWithPayload:@{@"deck":@"game",@"requestId":@"stop"}];Check(host.gameAudioOwner==nil,@"Game owner was not released");
 Check([host nativeAudioStatePayload][@"audioEngineCount"]!=nil,@"Missing native state");[host.nativeAudioEngine stop];printf("Native silent smoke passed: bounded render .4–1.0s, one AVAudioEngine, mutual playback exclusion, ownership release; no physical room or microphone certification.\n");return 0;
}}
