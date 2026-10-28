#import "GuestStarOverlay.mm"
#import <Vision/Vision.h>
#include <cassert>
int main(){@autoreleasepool {
  assert(!ValidatedState((id)@[]));
  assert(!ValidatedState(@{@"schemaVersion":@1,@"state":@5,@"theme":@{}}));
  NSDictionary *raw=@{@"schemaVersion":@1,@"state":@"REQUESTS OPEN",@"enabled":@YES,@"connected":@YES,@"requestsOpen":@YES,@"theme":@{@"primary":@"#ff2d95",@"secondary":@"#8b3dff",@"accent":@"#00c8ff"},@"activityName":@"Karaoke QR acceptance",@"hotelName":@"Guest Star",@"next":@[@7,NSNull.null,@{@"singerName":@"Guest",@"displaySongTitle":@"Original test",@"email":@"PRIVATE_SENTINEL"}],@"current":NSNull.null,@"email":@"PRIVATE_SENTINEL"};
  NSDictionary *safe=ValidatedState(raw);assert(safe && !safe[@"email"] && [safe[@"next"] count]==1 && !safe[@"next"][0][@"email"] && !safe[@"current"]);
  assert(!BoundedLogo([@"invalid image" dataUsingEncoding:NSUTF8StringEncoding]));
  for(NSString *url in @[@"https://request.gstarxp.com/join/original-acceptance-one",@"https://request.gstarxp.com/join/original-acceptance-two"]){
    NSMutableDictionary *state=[safe mutableCopy];state[@"requestUrl"]=url;state[@"pin"]=@"123456";
    NSBitmapImageRep *rep=GSRender(state,GSDefaultOptions(),nil,nil,GSQR(url));
    VNDetectBarcodesRequest *request=[VNDetectBarcodesRequest new];request.symbologies=@[VNBarcodeSymbologyQR];
    VNImageRequestHandler *handler=[[VNImageRequestHandler alloc] initWithCGImage:rep.CGImage options:@{}];NSError *error=nil;
    assert([handler performRequests:@[request] error:&error]);
    BOOL found=NO;for(VNBarcodeObservation *barcode in request.results)found|=[barcode.payloadStringValue isEqual:url];assert(found);
  }
  puts("PASS: bounded public payload, malformed input rejection, invalid image rejection, both dynamic QR URLs decoded from full 1080p renderer with Apple Vision");
}}
