#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#import <WebKit/WebKit.h>

#include <signal.h>
#include <unistd.h>

static NSString *const GSPanelURLString = @"http://127.0.0.1:8787";
static NSString *const GSNativeHandlerName = @"guestStarNative";
static NSString *const GSDisplaysEventName = @"gueststar:native-displays";
static NSString *const GSStarScreenResultEventName = @"gueststar:native-star-screen-result";
static NSString *const GSOpenPreferencesEventName = @"gueststar:open-preferences";
static NSString *const GSReportProblemEventName = @"gueststar:report-problem";
static NSString *const GSMarkDiagnosticEventName = @"gueststar:mark-diagnostic";

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
@property(nonatomic) BOOL pollInFlight;
@property(nonatomic) BOOL backendReady;
@property(nonatomic) BOOL mainPageReady;
@property(nonatomic) BOOL pendingPreferences;
@property(nonatomic) BOOL fatalErrorPresented;
@property(nonatomic) BOOL terminating;
@property(nonatomic) BOOL terminationReplyPending;
- (void)updateStarScreenDisplayWithPayload:(NSDictionary *)payload;
@end

@implementation GSAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  [self buildMainMenu];
  [self buildMainWindow];

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
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [self.readinessTimer invalidate];
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
  self.mainWindow.minSize = NSMakeSize(900, 620);
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
                     [self menuItemWithTitle:@"Bridge (VirtualDJ)"
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
  [self runMainJavaScript:@"document.querySelector('#liveEventButton')?.click()"];
}

- (void)switchActivity:(id)sender {
  (void)sender;
  [self runMainJavaScript:@"document.querySelector('#switchActivity')?.click()"];
}

- (void)openAdministration:(id)sender {
  (void)sender;
  [self runMainJavaScript:@"document.querySelector('#openHostPanel')?.click()"];
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
  if (preview) {
    self.starWindow.styleMask = NSWindowStyleMaskTitled |
        NSWindowStyleMaskClosable |
        NSWindowStyleMaskMiniaturizable |
        NSWindowStyleMaskResizable;
    self.starWindow.level = NSNormalWindowLevel;
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
    self.starWindow.level = NSMainMenuWindowLevel - 1;
    self.starWindow.contentAspectRatio = NSZeroSize;
    [self.starWindow setFrame:screen.frame display:YES];
  }
  [self layoutStarWebView];
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
  NSScreen *screen = requestedScreen ?: [self primaryScreen];
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
  [self.starWindow makeKeyAndOrderFront:nil];
  [self.starWindow orderFrontRegardless];
  [NSApp activateIgnoringOtherApps:YES];
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
  NSScreen *screen = requested ?: [self primaryScreen];
  if (screen == nil) {
    [self emitStarScreenResultWithOK:NO
                              reused:YES
                              screen:nil
                            fallback:YES
                               error:@"macOS no informó ninguna pantalla disponible."];
    return;
  }
  [self configureStarWindowForScreen:screen preview:self.starPreview];
  [self.starWindow makeKeyAndOrderFront:nil];
  [self.starWindow orderFrontRegardless];
  [NSApp activateIgnoringOtherApps:YES];
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
  NSScreen *screen = requested ?: [self primaryScreen];
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
