#import "Renderer.h"
static NSColor *Color(NSString *hex) {
  unsigned n=0xffffff; if([hex isKindOfClass:NSString.class] && hex.length==7) [[NSScanner scannerWithString:[hex substringFromIndex:1]] scanHexInt:&n];
  return [NSColor colorWithSRGBRed:((n>>16)&255)/255. green:((n>>8)&255)/255. blue:(n&255)/255. alpha:1];
}
static void Text(NSString *s, CGFloat x,CGFloat y,CGFloat w,CGFloat h,CGFloat size,NSColor *color,BOOL bold=NO) {
  if(![s isKindOfClass:NSString.class])return;
  NSMutableParagraphStyle *p=[NSMutableParagraphStyle new];p.lineBreakMode=NSLineBreakByTruncatingTail;
  [s drawInRect:NSMakeRect(x,y,w,h) withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:size weight:bold ? NSFontWeightSemibold : NSFontWeightRegular],NSForegroundColorAttributeName:color,NSParagraphStyleAttributeName:p}];
}
static void Card(NSRect r, NSColor *accent) {
  NSBezierPath *p=[NSBezierPath bezierPathWithRoundedRect:r xRadius:28 yRadius:28];
  [[NSColor colorWithSRGBRed:.10 green:.11 blue:.14 alpha:.94] setFill];[p fill];
  [[accent colorWithAlphaComponent:.35] setStroke];p.lineWidth=1.5;[p stroke];
}
static void Fit(NSImage *img,NSRect r) {
  if(!img || img.size.width<=0 || img.size.height<=0)return;
  CGFloat scale=MIN(r.size.width/img.size.width,r.size.height/img.size.height);
  NSRect dest=NSMakeRect(r.origin.x+(r.size.width-img.size.width*scale)/2,r.origin.y+(r.size.height-img.size.height*scale)/2,img.size.width*scale,img.size.height*scale);
  [img drawInRect:dest fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:@{NSImageHintInterpolation:@(NSImageInterpolationHigh)}];
}
NSDictionary *GSDefaultOptions() { return @{ @"qr":@YES,@"pin":@YES,@"logo":@YES,@"next":@YES,@"artist":@YES,@"message":@NO,@"extended":@NO,@"count":@3,@"mode":@1,@"qrMode":@2}; }
NSImage *GSQR(NSString *url) {
  if(!url.length)return nil;
  CIFilter *filter=[CIFilter filterWithName:@"CIQRCodeGenerator"];
  [filter setValue:[url dataUsingEncoding:NSUTF8StringEncoding] forKey:@"inputMessage"];
  [filter setValue:@"M" forKey:@"inputCorrectionLevel"];
  CIImage *ci=filter.outputImage; if(!ci)return nil;
  CIContext *ctx=[CIContext contextWithOptions:@{kCIContextUseSoftwareRenderer:@YES}];
  CGImageRef image=[ctx createCGImage:ci fromRect:ci.extent]; if(!image)return nil;
  // Add a four-module white quiet zone; scale by an integer without filtering.
  NSInteger modules=CGImageGetWidth(image), scale=MAX(1,420/(modules+8)), side=(modules+8)*scale;
  NSBitmapImageRep *rep=[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:side pixelsHigh:side bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:side*4 bitsPerPixel:32];
  CGContextRef cg=[NSGraphicsContext graphicsContextWithBitmapImageRep:rep].CGContext;
  CGContextSetRGBFillColor(cg,1,1,1,1);CGContextFillRect(cg,CGRectMake(0,0,side,side));
  CGContextSetInterpolationQuality(cg,kCGInterpolationNone);CGContextDrawImage(cg,CGRectMake(4*scale,4*scale,modules*scale,modules*scale),image);CGImageRelease(image);
  NSImage *result=[[NSImage alloc] initWithSize:NSMakeSize(side,side)];[result addRepresentation:rep];return result;
}
NSBitmapImageRep *GSRender(NSDictionary *s,NSDictionary *o,NSImage *logo,NSImage *teamLogo,NSImage *qr) {
  NSBitmapImageRep *rep=[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:1920 pixelsHigh:1080 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bitmapFormat:0 bytesPerRow:1920*4 bitsPerPixel:32];
  memset(rep.bitmapData,0,rep.bytesPerRow*rep.pixelsHigh);
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext *gc=[NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [NSGraphicsContext setCurrentContext:gc];
  CGContextTranslateCTM(gc.CGContext,0,1080);CGContextScaleCTM(gc.CGContext,1,-1);
  NSGraphicsContext *flipped=[NSGraphicsContext graphicsContextWithCGContext:gc.CGContext flipped:YES];[NSGraphicsContext setCurrentContext:flipped];
  NSColor *white=NSColor.whiteColor,*muted=[NSColor colorWithWhite:.75 alpha:1];
  NSColor *primary=Color(s[@"theme"][@"primary"]),*secondary=Color(s[@"theme"][@"secondary"]),*accent=Color(s[@"theme"][@"accent"]);
  NSString *state=s[@"state"] ?: @"NO ACTIVITY";
  BOOL compact=[state isEqual:@"NOW SINGING"] || [s[@"compact"] boolValue];
  if([s[@"offline"] boolValue]) {
    Card(NSMakeRect(64,46,610,78),accent);Text(@"GUEST STAR · esperando conexión local",90,65,570,45,25,muted);
  } else if (![s[@"enabled"] boolValue]) {
    // Player mode belongs to Star Screen. Do not cover VirtualDJ in that mode.
  } else if(compact) {
    NSDictionary *now=s[@"current"] ?: @{};
    Card(NSMakeRect(64,42,1180,84),accent);
    Text(@"NOW SINGING",90,58,220,30,20,accent,YES);
    Text(now[@"singerName"] ?: @"Karaoke",320,53,885,34,29,white,YES);
    NSString *song=now[@"displaySongTitle"] ?: @"";
    if([o[@"artist"] boolValue] && [now[@"displayArtist"] length])song=[song stringByAppendingFormat:@" · %@",now[@"displayArtist"]];
    Text(song,320,91,885,25,19,muted);
    if([o[@"qr"] boolValue] && [o[@"qrMode"] intValue]==0 && qr) {
      Card(NSMakeRect(1672,42,184,234),accent);Fit(qr,NSMakeRect(1690,58,148,148));
      if([o[@"pin"] boolValue])Text([@"PIN " stringByAppendingString:s[@"pin"] ?: @""],1690,219,158,30,20,white,YES);
    }
  } else {
    NSGradient *gradient=[[NSGradient alloc] initWithColorsAndLocations:[NSColor colorWithSRGBRed:.07 green:.08 blue:.10 alpha:1],0.,[[NSColor colorWithSRGBRed:.07 green:.08 blue:.10 alpha:1] blendedColorWithFraction:.12 ofColor:secondary],.55,[NSColor colorWithSRGBRed:.06 green:.10 blue:.12 alpha:1],1.,nil];
    [gradient drawInRect:NSMakeRect(0,0,1920,1080) angle:-25];
    [[primary colorWithAlphaComponent:.10] setFill];[[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(-240,620,1040,780)] fill];
    [[accent colorWithAlphaComponent:.07] setFill];[[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(1300,-350,1000,950)] fill];
    Card(NSMakeRect(72,72,670,936),primary);
    if([o[@"logo"] boolValue] && logo)Fit(logo,NSMakeRect(112,110,360,148));
    else Text(s[@"hotelName"] ?: @"Guest Star",112,121,580,76,38,white,YES);
    if([o[@"logo"] boolValue] && teamLogo)Fit(teamLogo,NSMakeRect(502,110,190,148));
    Text(@"GUEST STAR EXPERIENCE",112,284,570,38,23,accent,YES);
    Text(s[@"activityName"] ?: @"Karaoke",112,339,580,125,56,white,YES);
    BOOL end=[state isEqual:@"ACTIVITY FINISHED"] || [state isEqual:@"FINALIZING ACTIVITY"];
    if([o[@"qr"] boolValue] && [o[@"mode"] intValue]!=0 && qr && !end) {
      Fit(qr,NSMakeRect(160,495,390,390));
      Text(@"SCAN HERE TO SING",160,913,430,40,25,white,YES);
    }
    if([o[@"pin"] boolValue] && [s[@"pin"] length] && !end)Text([@"PIN  " stringByAppendingString:s[@"pin"]],112,952,575,38,28,accent,YES);
    Text([s[@"requestsOpen"] boolValue] ? @"REQUESTS OPEN" : @"REQUESTS CLOSED",804,90,1000,35,24,accent,YES);
    NSString *headline=end ? @"THANK YOU FOR SINGING" : [state isEqual:@"NO ACTIVITY"] ? @"Ready for your next experience" : @"NEXT SINGER";
    Text(headline,804,159,1030,120,52,white,YES);
    NSArray *next=s[@"next"] ?: @[];int counts[]={1,2,3,5};int count=counts[MIN(3,MAX(0,[o[@"countIndex"] intValue]))];
    if(o[@"count"]) count=[o[@"count"] intValue];
    count=MIN(5,MAX(1,count));
    if([o[@"next"] boolValue] && next.count && !end) {
      CGFloat height=count>3 ? 122 : 172;
      for(NSInteger i=0;i<MIN((NSInteger)next.count,count);i++) {
        CGFloat y=310+i*(height+18);NSDictionary *row=next[i];
        Card(NSMakeRect(804,y,1044,height),secondary);
        Text([NSString stringWithFormat:@"%02ld",(long)i+1],832,y+26,70,55,34,accent,YES);
        Text(row[@"singerName"],928,y+20,868,51,count>3 ? 30 : 37,white,YES);
        Text(row[@"displaySongTitle"],928,y+65,868,42,count>3 ? 24 : 28,muted);
        if([o[@"artist"] boolValue] && count<=3)Text(row[@"displayArtist"],928,y+114,860,30,23,muted);
        if([o[@"message"] boolValue] && [o[@"mode"] intValue]==2 && [row[@"publicMessage"] length] && count<=3)Text(row[@"publicMessage"],928,y+144,860,25,19,muted);
      }
    } else {
      Card(NSMakeRect(804,326,1044,380),primary);
      Text(end ? @"YOUR MOMENT. YOUR SONG. YOUR STAGE." : @"Your moment to shine",844,371,960,100,39,white,YES);
      Text(end ? (s[@"finalMessage"] ?: @"See you next time.") : @"Choose a song and join the experience.",844,491,950,130,29,muted);
    }
    if([o[@"extended"] boolValue] && [o[@"mode"] intValue]==2)Text([NSString stringWithFormat:@"%@ · %@",s[@"teamName"] ?: @"",state],804,966,1044,34,20,muted);
  }
  [NSGraphicsContext restoreGraphicsState];return rep;
}
