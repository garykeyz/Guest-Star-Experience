#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
NSDictionary *GSDefaultOptions();
NSBitmapImageRep *GSRender(NSDictionary *state, NSDictionary *options, NSImage *logo, NSImage *teamLogo, NSImage *qr);
NSImage *GSQR(NSString *url);
