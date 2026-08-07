import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

test("el Bridge genera el QR localmente y no intenta mostrar un archivo de Drive", async () => {
  const [html, app, qrUi, vendor] = await Promise.all([
    readFile(new URL("public/index.html", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
    readFile(new URL("public/qr-ui.js", root), "utf8"),
    readFile(new URL("public/vendor/qrcode.js", root), "utf8")
  ]);

  assert.match(html, /vendor\/qrcode\.js/);
  assert.match(app, /setLocalQrImage\(\$\("#shareQr"\), publicUrl\)/);
  assert.match(app, /downloadLocalQr\(url, "Guest-Star-QR\.png"\)/);
  assert.doesNotMatch(app, /share\.qrViewUrl/);
  assert.match(qrUi, /quietModules = 4/);
  assert.match(qrUi, /toDataURL\("image\/png"\)/);
  assert.match(vendor, /QR Code Generator for JavaScript/);
});

test("el generador incluido codifica el enlace público sin conexión externa", async () => {
  const source = await readFile(new URL("public/vendor/qrcode.js", root), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const code = context.qrcode(0, "H");
  code.addData("https://request.gstarxp.com/h/moon-palace-demo", "Byte");
  code.make();
  const modules = code.getModuleCount();
  let dark = 0;
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (code.isDark(row, column)) dark += 1;
    }
  }
  assert.ok(modules >= 21);
  assert.ok(dark > modules * modules * 0.2);
  assert.ok(dark < modules * modules * 0.8);
});
