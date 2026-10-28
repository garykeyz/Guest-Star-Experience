#import "Renderer.h"
int main(int argc,char **argv){@autoreleasepool {
 if(argc!=3)return 2;
 NSData *data=[NSData dataWithContentsOfFile:@(argv[1])];NSDictionary *s=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];if(!s)return 3;
 NSImage *qr=GSQR(s[@"requestUrl"]);
 NSBitmapImageRep *rep=GSRender(s,GSDefaultOptions(),nil,nil,qr);
 return [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:@(argv[2]) atomically:YES] ? 0 : 4;
}}
