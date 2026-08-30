import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIDGE_PROXY_URL,
  configForStorage,
  DEFAULT_CONFIG,
  LEGACY_DIRECT_APPS_SCRIPT_URL,
  mergeLoadedSecrets,
  migrateAppsScriptUrl,
  publicConfig,
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

test("la configuración 12 recuerda sesión, selección e idioma sin guardar contraseñas de usuario", () => {
  const runtime = sanitizeConfig(
    {
      authToken: "session-token",
      deviceToken: "device-token",
      deviceId: "device-1",
      lastHotelId: "hotel-1",
      lastVenueId: "venue-1",
      lastActivityId: "activity-1",
      rememberLogin: true,
      rememberSelection: true,
      uiLanguage: "en"
    },
    DEFAULT_CONFIG
  );
  const stored = configForStorage(runtime);

  assert.equal(runtime.configVersion, 12);
  assert.equal(runtime.uiLanguage, "en");
  assert.equal(stored.authToken, "session-token");
  assert.equal(stored.deviceToken, "device-token");
  assert.equal(stored.lastHotelId, "hotel-1");
  assert.equal(Object.hasOwn(stored, "password"), false);
});

test("conserva las carpetas y archivos elegidos para música ambiental", () => {
  const runtime = sanitizeConfig({
    backgroundMusicSources: [
      "/Users/Yefry/Music/Ambiente",
      "/Users/Yefry/Music/intro.mp3",
      "/Users/Yefry/Music/Ambiente"
    ],
    backgroundMusicVolume: 0.42
  }, DEFAULT_CONFIG);

  assert.deepEqual(runtime.backgroundMusicSources, [
    "/Users/Yefry/Music/Ambiente",
    "/Users/Yefry/Music/intro.mp3"
  ]);
  assert.deepEqual(configForStorage(runtime).backgroundMusicSources, runtime.backgroundMusicSources);
  assert.equal(runtime.backgroundMusicVolume, 0.42);
});

test("guarda favoritos independientes por hotel y elimina duplicados", () => {
  const runtime = sanitizeConfig({
    favoriteSongsByHotel: {
      "hotel-1": [
        { song: "Mi Vida", artist: "Divino", language: "Español" },
        { song: "mi vida", artist: "divino", language: "Español" }
      ],
      "hotel-2": [
        { song: "Dancing Queen", artist: "ABBA", language: "English" }
      ]
    },
    superhostLanguage: "en"
  }, DEFAULT_CONFIG);

  assert.equal(runtime.favoriteSongsByHotel["hotel-1"].length, 1);
  assert.equal(runtime.favoriteSongsByHotel["hotel-2"].length, 1);
  assert.equal(runtime.superhostLanguage, "en");
  assert.deepEqual(publicConfig(runtime).favoriteSongsByHotel, {});
});

test("la actualización migra cualquier endpoint directo de Apps Script al proxy estable", () => {
  assert.equal(
    migrateAppsScriptUrl(LEGACY_DIRECT_APPS_SCRIPT_URL, 7),
    BRIDGE_PROXY_URL
  );
  assert.equal(
    migrateAppsScriptUrl(
      "https://script.google.com/macros/s/AKfycb-a-different-deployment/exec",
      8
    ),
    BRIDGE_PROXY_URL
  );
  assert.equal(migrateAppsScriptUrl("https://example.com/custom", 7), "https://example.com/custom");
  assert.equal(DEFAULT_CONFIG.appsScriptUrl, BRIDGE_PROXY_URL);
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

test("conserva la sesión guardada si Keychain no devuelve los tokens", () => {
  const stored = sanitizeConfig({
    authToken: "session-from-file",
    deviceToken: "device-from-file",
    deviceId: "device-1",
    rememberLogin: true,
    secretsInKeychain: true
  }, DEFAULT_CONFIG);

  const loaded = mergeLoadedSecrets(stored, { authToken: "", deviceToken: "" });

  assert.equal(loaded.authToken, "session-from-file");
  assert.equal(loaded.deviceToken, "device-from-file");
});
