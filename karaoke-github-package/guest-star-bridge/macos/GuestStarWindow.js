#!/usr/bin/osascript -l JavaScript

ObjC.import("Cocoa");
ObjC.import("WebKit");

const PANEL_URL = "http://127.0.0.1:8787";
let windowRef = null;
let webView = null;

function runBridgeCommand(script) {
  if (webView) webView.evaluateJavaScriptCompletionHandler(script, null);
}

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
        "reloadPage:": {
          types: ["void", ["id"]],
          implementation: function () { if (webView) webView.reload; },
        },
        "openLiveEvent:": {
          types: ["void", ["id"]],
          implementation: function () { runBridgeCommand("document.querySelector('#liveEventButton')?.click()"); },
        },
        "switchActivity:": {
          types: ["void", ["id"]],
          implementation: function () { runBridgeCommand("document.querySelector('#switchActivity')?.click()"); },
        },
        "openAdministration:": {
          types: ["void", ["id"]],
          implementation: function () { runBridgeCommand("document.querySelector('#openHostPanel')?.click()"); },
        },
        "openSettings:": {
          types: ["void", ["id"]],
          implementation: function () { runBridgeCommand("document.querySelector('#settingsButton')?.click()"); },
        },
        "toggleFullScreen:": {
          types: ["void", ["id"]],
          implementation: function () { if (windowRef) windowRef.toggleFullScreen(null); },
        },
        "showAbout:": {
          types: ["void", ["id"]],
          implementation: function () { $.NSApplication.sharedApplication.orderFrontStandardAboutPanel(null); },
        },
        "openLog:": {
          types: ["void", ["id"]],
          implementation: function () {
            const path = $.NSHomeDirectory.stringByAppendingPathComponent("Library/Logs/Guest Star Bridge.log");
            $.NSWorkspace.sharedWorkspace.openURL($.NSURL.fileURLWithPath(path));
          },
        },
      },
    });
  }
  return $.GuestStarWindowDelegate.alloc.init;
}

function menuItem(title, action, key, target) {
  const item = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(title, action, key || "");
  if (target) item.target = target;
  return item;
}

function addMenu(menuBar, title, items) {
  const root = $.NSMenuItem.alloc.init;
  root.title = title;
  const menu = $.NSMenu.alloc.initWithTitle(title);
  items.forEach((item) => item === null ? menu.addItem($.NSMenuItem.separatorItem) : menu.addItem(item));
  root.submenu = menu;
  menuBar.addItem(root);
}

function createMenu(app, delegate) {
  const menuBar = $.NSMenu.alloc.init;
  addMenu(menuBar, "Guest Star Bridge", [
    menuItem("Acerca de Guest Star Bridge", "showAbout:", "", delegate),
    menuItem("Configuración…", "openSettings:", ",", delegate),
    null,
    menuItem("Salir de Guest Star Bridge", "terminate:", "q", app)
  ]);
  addMenu(menuBar, "Actividad", [
    menuItem("Evento en vivo", "openLiveEvent:", "l", delegate),
    menuItem("Cambiar actividad…", "switchActivity:", "k", delegate),
    menuItem("Administración Superhost", "openAdministration:", "h", delegate)
  ]);
  addMenu(menuBar, "Edición", [
    menuItem("Cortar", "cut:", "x", null),
    menuItem("Copiar", "copy:", "c", null),
    menuItem("Pegar", "paste:", "v", null),
    menuItem("Seleccionar todo", "selectAll:", "a", null)
  ]);
  addMenu(menuBar, "Visualización", [
    menuItem("Recargar", "reloadPage:", "r", delegate),
    menuItem("Pantalla completa", "toggleFullScreen:", "f", delegate)
  ]);
  addMenu(menuBar, "Ventana", [
    menuItem("Minimizar", "performMiniaturize:", "m", null),
    menuItem("Zoom", "performZoom:", "", null),
    menuItem("Traer todo al frente", "arrangeInFront:", "", app)
  ]);
  addMenu(menuBar, "Ayuda", [menuItem("Abrir registro de diagnóstico", "openLog:", "", delegate)]);
  app.mainMenu = menuBar;
}

const app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
try { $.NSProcessInfo.processInfo.processName = "Guest Star Bridge"; } catch (_) { /* menu title still owns the visible name */ }
const delegate = createDelegate();
createMenu(app, delegate);

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
windowRef = window;
window.releasedWhenClosed = false;
window.minSize = $.NSMakeSize(900, 620);
window.center;

const configuration = $.WKWebViewConfiguration.alloc.init;
configuration.preferences.javaScriptCanOpenWindowsAutomatically = false;

webView =
  $.WKWebView.alloc.initWithFrameConfiguration(
    window.contentView.bounds,
    configuration
  );
webView.autoresizingMask = $.NSViewWidthSizable | $.NSViewHeightSizable;

window.delegate = delegate;
window.contentView.addSubview(webView);

const panelURL = $.NSURL.URLWithString(PANEL_URL);
const request = $.NSURLRequest.requestWithURL(panelURL);
webView.loadRequest(request);

window.makeKeyAndOrderFront(null);
app.activateIgnoringOtherApps(true);
app.run;
