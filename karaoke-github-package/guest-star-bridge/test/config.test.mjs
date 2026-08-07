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

test("la configuración 7 recuerda sesión y selección sin guardar contraseñas", () => {
  const runtime = sanitizeConfig(
    {
      authToken: "session-token",
      deviceToken: "device-token",
      deviceId: "device-1",
      lastHotelId: "hotel-1",
      lastVenueId: "venue-1",
      lastActivityId: "activity-1",
      rememberLogin: true,
      rememberSelection: true
    },
    DEFAULT_CONFIG
  );
  const stored = configForStorage(runtime);

  assert.equal(runtime.configVersion, 7);
  assert.equal(stored.authToken, "session-token");
  assert.equal(stored.deviceToken, "device-token");
  assert.equal(stored.lastHotelId, "hotel-1");
  assert.equal(Object.hasOwn(stored, "password"), false);
});

test("permite no recordar tokens ni última actividad", () => {
  const runtime = sanitizeConfig(
    {
      authToken: "session-token",
      deviceToken: "device-token",
      deviceId: "device-1",
      lastHotelId: "hotel-1",
      lastVenueId: "venue-1",
      lastActivityId: "activity-1",
      rememberLogin: false,
      rememberSelection: false
    },
    DEFAULT_CONFIG
  );
  const stored = configForStorage(runtime);

  assert.equal(stored.authToken, "");
  assert.equal(stored.deviceToken, "");
  assert.equal(stored.lastHotelId, "");
  assert.equal(stored.lastVenueId, "");
  assert.equal(stored.lastActivityId, "");
});
