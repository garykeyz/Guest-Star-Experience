import assert from "node:assert/strict";
import test from "node:test";
import {
  configForStorage,
  DEFAULT_CONFIG,
  sanitizeConfig
} from "../src/config.mjs";

test("recuerda carpeta y PIN por defecto", () => {
  const clean = sanitizeConfig(
    {
      libraryFolders: ["/Users/Yefry/Music/Karaoke"],
      hostPin: "123456"
    },
    DEFAULT_CONFIG
  );
  const stored = configForStorage(clean);

  assert.deepEqual(stored.libraryFolders, ["/Users/Yefry/Music/Karaoke"]);
  assert.equal(stored.hostPin, "123456");
  assert.equal(stored.rememberLibraryFolders, true);
  assert.equal(stored.rememberHostPin, true);
  assert.equal(stored.requestIntervalSeconds, 2);
});

test("permite sincronizar Google Sheets cada dos segundos", () => {
  const clean = sanitizeConfig(
    { requestIntervalSeconds: 1 },
    DEFAULT_CONFIG
  );

  assert.equal(clean.requestIntervalSeconds, 2);
});

test("permite olvidar carpeta y PIN por separado al cerrar", () => {
  const runtime = sanitizeConfig(
    {
      libraryFolders: ["/Users/Yefry/Music/Karaoke"],
      rememberLibraryFolders: false,
      hostPin: "123456",
      rememberHostPin: false
    },
    DEFAULT_CONFIG
  );
  const stored = configForStorage(runtime);

  assert.deepEqual(runtime.libraryFolders, ["/Users/Yefry/Music/Karaoke"]);
  assert.equal(runtime.hostPin, "123456");
  assert.deepEqual(stored.libraryFolders, []);
  assert.equal(stored.hostPin, "");
});
