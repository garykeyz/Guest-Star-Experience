#!/usr/bin/osascript -l JavaScript

ObjC.import("Cocoa");
ObjC.import("WebKit");

const PANEL_URL = "http://127.0.0.1:8787";

function createDelegate() {
  if (!$.GuestStarWindowDelegate) {
    ObjC.registerSubclass({
      name: "GuestStarWindowDelegate",
      superclass: "NSObject",
      protocols: ["NSWindowDelegate"],
      methods: {
        "windowWillClose:": {
          types: ["void", ["id"]],
          implementation: function () {
            $.NSApplication.sharedApplication.terminate(null);
          },
        },
      },
    });
  }
  return $.GuestStarWindowDelegate.alloc.init;
}

function createMenu(app) {
  const menuBar = $.NSMenu.alloc.init;
  const appMenuItem = $.NSMenuItem.alloc.init;
  const appMenu = $.NSMenu.alloc.initWithTitle("Guest Star Bridge");
  const quitItem =
    $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(
      "Salir de Guest Star Bridge",
      "terminate:",
      "q"
    );

  appMenu.addItem(quitItem);
  appMenuItem.submenu = appMenu;
  menuBar.addItem(appMenuItem);
  app.mainMenu = menuBar;
}

const app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
createMenu(app);

const styleMask =
  $.NSWindowStyleMaskTitled |
  $.NSWindowStyleMaskClosable |
  $.NSWindowStyleMaskMiniaturizable |
  $.NSWindowStyleMaskResizable;
const windowFrame = $.NSMakeRect(0, 0, 1440, 900);
const window =
  $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    windowFrame,
    styleMask,
    $.NSBackingStoreBuffered,
    false
  );
window.title = "Guest Star Bridge";
window.releasedWhenClosed = false;
window.minSize = $.NSMakeSize(900, 620);
window.center;

const configuration = $.WKWebViewConfiguration.alloc.init;
configuration.preferences.javaScriptCanOpenWindowsAutomatically = false;

const webView =
  $.WKWebView.alloc.initWithFrameConfiguration(
    window.contentView.bounds,
    configuration
  );
webView.autoresizingMask = $.NSViewWidthSizable | $.NSViewHeightSizable;

const delegate = createDelegate();
window.delegate = delegate;
window.contentView.addSubview(webView);

const panelURL = $.NSURL.URLWithString(PANEL_URL);
const request = $.NSURLRequest.requestWithURL(panelURL);
webView.loadRequest(request);

window.makeKeyAndOrderFront(null);
app.activateIgnoringOtherApps(true);
app.run;
