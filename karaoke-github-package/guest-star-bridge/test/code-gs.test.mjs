import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../google-apps-script/Code.gs"),
  "utf8"
);
const context = vm.createContext({});
vm.runInContext(source, context);

function range(display, value) {
  return {
    getDisplayValue: () => display,
    getValue: () => value
  };
}

test("lee duraciones formateadas sin convertirlas en fechas de 1899", () => {
  assert.equal(context.readDurationSeconds_(range("0:08:30", new Date(0))), 510);
  assert.equal(context.readDurationSeconds_(range("2:05:30", new Date(0))), 7530);
});

test("descarta el contador corrupto en milisegundos", () => {
  assert.equal(
    context.readDurationSeconds_(range("-2209144290000", -2209144290000)),
    0
  );
});

test("acepta el valor numérico de Sheets cuando todavía no tiene formato", () => {
  assert.equal(context.readDurationSeconds_(range("", 0.5)), 43200);
});

test("lee 30 segundos sin sumar el desfase histórico de Santo Domingo", () => {
  const historicalDate = vm.runInContext(
    'new Date("1899-12-30T04:40:30.000Z")',
    context
  );
  assert.equal(
    context.durationCellSeconds_(historicalDate, "0:00:30"),
    30
  );
  assert.notEqual(
    context.durationCellSeconds_(historicalDate, "0:00:30"),
    4 * 3600 + 40 * 60 + 30
  );
});

test("solo el estado Saltado se resta del cálculo de la actividad", () => {
  assert.equal(context.skippedStatus_("Saltado"), true);
  assert.equal(context.skippedStatus_("Ya cantó"), false);
  assert.equal(context.skippedStatus_("Agregada a VirtualDJ"), false);
});

test("la cola del Bridge incluye el estado compartido", () => {
  assert.match(source, /state:\s*publicState_\(\),\s*requests:\s*bridgeQueue_\(\)/);
  assert.match(source, /const BRIDGE_API_VERSION = "4\.0\.1"/);
  assert.match(source, /body\.action === "bridgeControl"/);
  assert.match(source, /control:\s*control,\s*state:\s*publicState_\(\),\s*requests:\s*bridgeQueue_\(\)/);
  assert.match(source, /touchState_\("reset",\s*source,\s*true\)/);
  assert.match(source, /touchState_\("start",\s*source,\s*false\)/);
  assert.match(source, /cfg\.getRange\("B7"\)\.clearContent\(\)/);
  assert.match(source, /\["start", "open", "close", "reset"\]/);
  assert.match(source, /sourceUrl:\s*String\(row\[10\]/);
  assert.match(source, /fileName:\s*String\(row\[13\]/);
  assert.match(source, /durationSeconds:\s*durationCellSeconds_\(row\[6\],\s*displayRow\[6\]\)/);
  assert.match(source, /transitionSeconds:\s*durationCellSeconds_\(row\[7\],\s*displayRow\[7\]\)/);
  assert.match(source, /const displayRows = range\.getDisplayValues\(\)/);
  assert.match(source, /body\.action === "bridgeConfigUpdate"/);
  assert.match(source, /activityStartedAt:\s*cfg\.activityStartedAt/);
  assert.match(source, /sheetRow:\s*index \+ 2/);
});

test("cuenta personas activas una sola vez y excluye quienes finalizaron", () => {
  const originalSpreadsheet = context.spreadsheet_;
  context.spreadsheet_ = () => ({
    getSheetByName: () => ({
      getLastRow: () => 6,
      getRange: () => ({
        getDisplayValues: () => [
          ["Ana", "", "", "", "", "", "", "", "", "", "Pendiente"],
          ["Ana", "", "", "", "", "", "", "", "", "", "Agregada a VirtualDJ"],
          ["Luis", "", "", "", "", "", "", "", "", "", "Ya cantó"],
          ["Marta", "", "", "", "", "", "", "", "", "", "Saltado"],
          ["Carlos", "", "", "", "", "", "", "", "", "", "Fuera de VirtualDJ"]
        ]
      })
    })
  });
  assert.equal(context.activeQueuePeopleCount_(), 2);
  context.spreadsheet_ = originalSpreadsheet;
});

test("el HOST controla si los huéspedes ven el estado de la actividad", () => {
  assert.match(source, /body\.action === "publicStatusVisibility"/);
  assert.match(source, /setPublicStatusVisibility_\(body\.show === true, source\)/);
  assert.match(source, /showPublicStatus:\s*cfg\.showPublicStatus/);
  assert.match(source, /queuePeopleCount:\s*activeQueuePeopleCount_\(\)/);
  assert.match(source, /\["Mostrar estado público"\]/);
  assert.match(source, /getRange\("A8:A13"\)/);
  assert.match(source, /getRange\("B13"\)\.setValue\(false\)/);
});

test("advierte repeticiones antes de crear una fila y permite confirmarlas", () => {
  const originalSpreadsheet = context.spreadsheet_;
  context.spreadsheet_ = () => ({
    getSheetByName: () => ({
      getLastRow: () => 3,
      getRange: () => ({
        getDisplayValues: () => [
          ["Ana", "Dancing Queen", "ABBA", "", "English", "", "", "", "", "", "Agregada a VirtualDJ"],
          ["Luis", "Vivir Mi Vida", "Marc Anthony", "", "Español", "", "", "", "", "", "Ya cantó"]
        ]
      })
    })
  });

  const active = context.requestDuplicateWarning_({
    name: "Ana",
    song: "Dancing Queen",
    artist: "ABBA"
  });
  const completed = context.requestDuplicateWarning_({
    name: "Otro",
    song: "Vivir Mi Vida",
    artist: "Marc Anthony"
  });
  context.spreadsheet_ = originalSpreadsheet;

  assert.equal(active.repeatedSinger, true);
  assert.equal(active.duplicateSong, true);
  assert.equal(active.duplicateSongState, "active");
  assert.equal(completed.duplicateSongState, "completed");
  assert.match(source, /DUPLICATE_CONFIRMATION_REQUIRED/);
  assert.match(source, /!body\.confirmDuplicate/);
});

test("setup y el recálculo funcionan sin una interfaz de Google Sheets", () => {
  const setupBody = source.slice(
    source.indexOf("function setup()"),
    source.indexOf("function ensureBaseConfig_")
  );
  const recalculateBody = source.slice(
    source.indexOf("function recalcularTiempos()"),
    source.indexOf("function onOpen()")
  );
  assert.doesNotMatch(setupBody, /SpreadsheetApp\.getUi/);
  assert.doesNotMatch(recalculateBody, /SpreadsheetApp\.getUi/);
  assert.match(setupBody, /return state;/);
  assert.match(source, /ensureBaseConfig_\(sheet\);/);
  assert.match(source, /\["Inicio de la actividad", ""\]/);
  assert.match(source, /const legacyStartLabel = String\(values\[6\]\[0\]/);
  assert.match(source, /legacyStartLabel !== defaults\[6\]\[0\]/);
  assert.match(source, /values\[6\]\[1\] = ""/);
  assert.match(source, /activityRunning:\s*cfg\.activityRunning/);
});

test("YouTube devuelve hasta seis opciones confiables y exige letras visibles", () => {
  assert.match(source, /\.slice\(0,\s*6\)/);
  assert.match(source, /if \(candidates\.length < 6\)/);
  assert.match(source, /maxResults=25/);
  assert.match(source, /const confirmedKaraoke =/);
  assert.match(source, /lyricsVisible:\s*true/);
  assert.match(
    source,
    /No encontramos una versión 100% karaoke; se eligió una versión con voces y letra en pantalla\./
  );
});

test("la hoja entrega el idioma al Bridge y a la búsqueda de YouTube", () => {
  assert.match(
    source,
    /!body\.name \|\| !body\.song \|\| !body\.artist \|\| !body\.language/
  );
  assert.match(source, /language:\s*String\(row\[5\]/);
  assert.match(
    source,
    /const requestedLanguage = body\.languageCode \|\| body\.language;/
  );
  assert.match(
    source,
    /findSong_\(body\.song,\s*body\.artist,\s*requestedLanguage\)/
  );
  assert.match(
    source,
    /findKaraokeCandidates_\(body\.song,\s*body\.artist,\s*requestedLanguage\)/
  );
});

test("el formulario guarda un solo enlace karaoke usando la misma prioridad del Bridge", () => {
  const originalCandidates = context.findKaraokeCandidates_;
  context.findKaraokeCandidates_ = () => [
    {
      id: "sing-king",
      url: "https://www.youtube.com/watch?v=singking123",
      durationSeconds: 243,
      resultType: "karaoke",
      channel: "Sing King"
    },
    {
      id: "karafun",
      url: "https://www.youtube.com/watch?v=karafun456",
      durationSeconds: 250,
      resultType: "karaoke",
      channel: "KaraFun Karaoke"
    }
  ];

  const selected = context.findSong_("Hello", "Adele", "English");
  context.findKaraokeCandidates_ = originalCandidates;

  assert.equal(selected.url, "https://www.youtube.com/watch?v=singking123");
  assert.equal(selected.seconds, 243);
  assert.equal(selected.resultType, "karaoke");
  assert.doesNotMatch(source, /official audio/);
  assert.match(source, /remainingSeconds \/ 86400, song\.url, "Pendiente"/);
});

test("el enlace elegido en el Bridge reemplaza la única fuente de la fila", () => {
  assert.match(source, /const sourceUrl = clean_\(body\.sourceUrl\)/);
  assert.match(source, /sheet\.getRange\(row, 11\)\.setValue\(sourceUrl\)/);
});

test("Español usa la lista ampliada de Latinoamérica sin crear otro idioma", () => {
  assert.equal(context.youtubeLanguageKey_("Español"), "spanish");
  assert.equal(context.youtubeLanguageKey_("Latinoamérica"), "spanish");
  assert.equal(context.youtubeChannelPriority_("Sing King", "spanish").rank, 1);
  assert.equal(context.youtubeChannelPriority_("KaraokeMedia", "spanish").rank, 2);
  assert.equal(
    context.youtubeChannelPriority_("Puro Mariachi Karaoke", "spanish").rank,
    5
  );
  assert.equal(context.youtubeChannelPriority_("CantaOkey", "spanish").rank, 8);
  assert.equal(
    context.youtubeChannelPriority_("Sunfly Karaoke", "spanish").rank,
    20
  );
});

test("inglés prioriza Stingray antes de KaraFun e incluye los canales agregados", () => {
  assert.equal(
    context.youtubeChannelPriority_("Stingray Karaoke", "english").rank,
    2
  );
  assert.equal(
    context.youtubeChannelPriority_("KaraFun Karaoke", "english").rank,
    3
  );
  assert.equal(
    context.youtubeChannelPriority_("Zoom Karaoke Official", "english").rank,
    11
  );
  assert.equal(
    context.youtubeChannelPriority_("Atomic Karaoke", "english").rank,
    12
  );
  assert.equal(
    context.youtubeChannelPriority_("Karaoke Sesh", "english").rank,
    13
  );
  assert.equal(
    context.youtubeChannelPriority_("Leo Ponce", "english").rank,
    14
  );
  assert.equal(
    context.youtubeChannelPriority_("Musisi Karaoke", "english").rank,
    15
  );
});

test("respeta las prioridades indicadas para cada idioma", () => {
  const checks = [
    ["english", "KaraFun Karaoke", 3],
    ["french", "KaraStar Karaoke", 3],
    ["portuguese", "Muramatsu Karaoke", 2],
    ["german", "KaraFun Deutschland", 2],
    ["italian", "JAM Karaoke Italia", 6],
    ["russian", "KaraRuTV", 4]
  ];
  checks.forEach(function(check) {
    assert.equal(
      context.youtubeChannelPriority_(check[1], check[0]).rank,
      check[2]
    );
  });
});

test("reconoce variantes con espacios, orden invertido y nombres bilingües", () => {
  assert.equal(
    context.youtubeChannelPriority_("Easy Karaoke Official", "english").rank,
    7
  );
  assert.equal(
    context.youtubeChannelPriority_("Ameritz Karaoke", "spanish").rank,
    10
  );
  assert.equal(
    context.youtubeChannelPriority_("Kalinka Karaoke", "russian").rank,
    2
  );
});

test("ordena primero por canal prioritario y luego por calidad", () => {
  const candidates = [
    {
      id: "karaoke-media",
      channelPriority: 2,
      qualityScore: 80,
      resultType: "karaoke"
    },
    {
      id: "unknown",
      channelPriority: 120,
      qualityScore: 999,
      resultType: "karaoke"
    },
    {
      id: "sing-king",
      channelPriority: 1,
      qualityScore: 70,
      resultType: "karaoke"
    }
  ];
  candidates.sort(context.compareKaraokeCandidates_);
  assert.deepEqual(
    Array.from(candidates, (item) => item.id),
    ["sing-king", "karaoke-media", "unknown"]
  );
});

test("conserva varias opciones para que el host elija", () => {
  const originalKey = context.youtubeKey_;
  const originalCandidates = context.youtubeCandidates_;
  context.youtubeKey_ = () => "key";
  context.youtubeCandidates_ = () => [
    { id: "karaoke1", qualityScore: 120, resultType: "karaoke" },
    { id: "karaoke2", qualityScore: 110, resultType: "karaoke" },
    { id: "lyrics1", qualityScore: 70, resultType: "lyrics-vocals" }
  ];

  const options = context.findKaraokeCandidates_("Hello", "Adele", "English");
  context.youtubeKey_ = originalKey;
  context.youtubeCandidates_ = originalCandidates;

  assert.deepEqual(
    Array.from(options, (item) => item.id),
    ["karaoke1", "karaoke2", "lyrics1"]
  );
});

test("conserva las seis mejores opciones y descarta la séptima", () => {
  const originalKey = context.youtubeKey_;
  const originalCandidates = context.youtubeCandidates_;
  context.youtubeKey_ = () => "key";
  context.youtubeCandidates_ = () =>
    Array.from({ length: 7 }, (_value, index) => ({
      id: `option${index + 1}`,
      qualityScore: 100 - index,
      resultType: "karaoke"
    }));

  const options = context.findKaraokeCandidates_("Dancing Queen", "ABBA", "English");
  context.youtubeKey_ = originalKey;
  context.youtubeCandidates_ = originalCandidates;

  assert.deepEqual(
    Array.from(options, (item) => item.id),
    ["option1", "option2", "option3", "option4", "option5", "option6"]
  );
});

test("rechaza una pista karaoke sin señal de letras", () => {
  const originalFetch = context.fetchJson_;
  context.fetchJson_ = (url) => {
    if (url.includes("/search?")) {
      return {
        items: [
          { id: { videoId: "empty" }, snippet: {} },
          { id: { videoId: "lyrics" }, snippet: {} },
          { id: { videoId: "karaokeLyrics" }, snippet: {} }
        ]
      };
    }
    return {
      items: [
        {
          id: "empty",
          contentDetails: { duration: "PT4M" },
          snippet: {
            title: "Hello Karaoke Instrumental",
            channelTitle: "Canal desconocido"
          }
        },
        {
          id: "lyrics",
          contentDetails: { duration: "PT4M" },
          snippet: {
            title: "Hello Official Lyrics",
            channelTitle: "Adele"
          }
        },
        {
          id: "karaokeLyrics",
          contentDetails: { duration: "PT4M" },
          snippet: {
            title: "Hello Karaoke Lyrics",
            channelTitle: "Karaoke Channel"
          }
        }
      ]
    };
  };

  const items = context.youtubeCandidates_("Adele Hello", "key");
  context.fetchJson_ = originalFetch;

  assert.deepEqual(
    Array.from(items, (item) => item.id),
    ["karaokeLyrics", "lyrics"]
  );
  assert.equal(items[0].resultType, "karaoke");
  assert.equal(items[1].resultType, "lyrics-vocals");
});

test("normaliza los siete idiomas y nunca cae silenciosamente a inglés", () => {
  const languages = [
    ["English", "english"],
    ["Español", "spanish"],
    ["Français", "french"],
    ["Português", "portuguese"],
    ["Deutsch", "german"],
    ["Italiano", "italian"],
    ["Русский", "russian"]
  ];
  languages.forEach(function(pair) {
    assert.equal(context.youtubeLanguageKey_(pair[0]), pair[1]);
  });
  assert.equal(context.youtubeLanguageKey_("idioma desconocido"), "");
  assert.deepEqual(
    Array.from(context.findKaraokeCandidates_("Hello", "Adele", "idioma desconocido")),
    []
  );
});

test("cada idioma construye su búsqueda regional y sus términos propios", () => {
  const captured = [];
  const originalFetch = context.fetchJson_;
  context.fetchJson_ = function(url) {
    captured.push(String(url));
    return { items: [] };
  };

  context.youtubeCandidates_(
    "Celine Dion Pour que tu m'aimes encore " + context.youtubeSearchTerms_("french", false),
    "key",
    "french"
  );
  context.youtubeCandidates_(
    "Roberto Carlos Detalhes " + context.youtubeSearchTerms_("portuguese", false),
    "key",
    "portuguese"
  );
  context.fetchJson_ = originalFetch;

  assert.match(captured[0], /relevanceLanguage=fr/);
  assert.match(captured[0], /regionCode=FR/);
  assert.match(decodeURIComponent(captured[0]), /paroles a l ecran/);
  assert.match(captured[1], /relevanceLanguage=pt/);
  assert.match(captured[1], /regionCode=BR/);
  assert.match(decodeURIComponent(captured[1]), /letra na tela/);
  assert.notEqual(captured[0], captured[1]);
});

test("descarta evidencia explícita de otro idioma", () => {
  const french = context.youtubeLanguageEvidence_(
    "Hello karaoke English lyrics",
    "Canal desconocido",
    "french"
  );
  const english = context.youtubeLanguageEvidence_(
    "Hello karaoke English lyrics",
    "Canal desconocido",
    "english"
  );
  assert.equal(french.conflict, true);
  assert.equal(english.match, true);
  assert.equal(english.conflict, false);
});

test("la migración 4.0 crea registro central, respaldo y un Sheet independiente por hotel", () => {
  assert.match(source, /function setupMultiUserV4\(\)/);
  assert.match(source, /backupLegacySpreadsheetV4_\(master\)/);
  assert.match(source, /file\.makeCopy\(/);
  assert.match(source, /function createHotelSpreadsheetV4_\(hotel, legacySource, destinationFolder\)/);
  assert.match(source, /SpreadsheetApp\.create\("Guest Star - " \+ hotel\.name\)/);
  assert.match(source, /hotel\.dataSheetId = createHotelSpreadsheetV4_\(hotel, null, destinationFolder\)/);
  assert.match(source, /DriveApp\.getFileById\(spreadsheet\.getId\(\)\)\.setTrashed\(true\)/);
  assert.match(source, /"MASTER_SHEET_ID"/);
  assert.match(source, /"HOTEL_DATA_FOLDER_ID"/);
  assert.match(source, /"DEFAULT_PUBLIC_HOTEL_ID"/);
  assert.match(source, /dataSheetId/);
  assert.doesNotMatch(
    source.slice(source.indexOf("function setupMultiUserV4")),
    /deleteSheet\(.*Solicitudes|deleteSheet\(.*Historial/
  );
});

test("la instalación muestra la clave temporal y permite recuperarla de forma segura", () => {
  assert.match(source, /function revealTemporaryPasswordV4_/);
  assert.match(source, /showModalDialog\(html, title\)/);
  assert.match(source, /I copied both values/);
  assert.match(source, /Guest Star 4\.0 — Setup Complete/);
  assert.match(source, /function resetSuperhostPasswordV4/);
  assert.match(source, /function setupOrRecoverSuperhostV4/);
  assert.match(source, /Set Up or Recover Superhost Access/);
  assert.match(source, /Reset Superhost Temporary Password/);
  assert.match(source, /revokeUserAccessV4_\(master, user\.userId\)/);
  assert.match(source, /mustChangePassword: true/);
});

test("la ventana de credenciales permite copiar valores escapados sin guardarlos en la hoja", () => {
  const originalSpreadsheetApp = context.SpreadsheetApp;
  const originalHtmlService = context.HtmlService;
  let dialog = null;
  context.SpreadsheetApp = {
    getUi: () => ({
      showModalDialog: (html, title) => {
        dialog = { html, title };
      }
    })
  };
  context.HtmlService = {
    createHtmlOutput: (htmlSource) => ({
      htmlSource,
      width: 0,
      height: 0,
      setWidth(width) { this.width = width; return this; },
      setHeight(height) { this.height = height; return this; }
    })
  };

  try {
    assert.equal(
      context.revealTemporaryPasswordV4_("Setup", 'owner<admin>', 'p&ss"word'),
      true
    );
    assert.equal(dialog.title, "Setup");
    assert.match(dialog.html.htmlSource, /owner&lt;admin&gt;/);
    assert.match(dialog.html.htmlSource, /p&amp;ss&quot;word/);
    assert.match(dialog.html.htmlSource, /copyField/);
    assert.equal(dialog.html.width, 520);
    assert.equal(dialog.html.height, 455);
  } finally {
    context.SpreadsheetApp = originalSpreadsheetApp;
    context.HtmlService = originalHtmlService;
  }
});

test("la acción inicial crea la cuenta o recupera una existente sin dejar al Superhost bloqueado", () => {
  const originalSetup = context.setupMultiUserV4;
  const originalReset = context.resetSuperhostPasswordV4;
  let resets = 0;

  try {
    context.setupMultiUserV4 = () => ({
      ok: true,
      superhost: { created: true, temporaryPassword: "created-once" }
    });
    context.resetSuperhostPasswordV4 = () => {
      resets += 1;
      return { ok: true, temporaryPassword: "recovered" };
    };
    assert.equal(context.setupOrRecoverSuperhostV4().superhost.temporaryPassword, "created-once");
    assert.equal(resets, 0);

    context.setupMultiUserV4 = () => ({
      ok: true,
      superhost: { created: false }
    });
    assert.equal(
      context.setupOrRecoverSuperhostV4().recovery.temporaryPassword,
      "recovered"
    );
    assert.equal(resets, 1);
  } finally {
    context.setupMultiUserV4 = originalSetup;
    context.resetSuperhostPasswordV4 = originalReset;
  }
});

test("la instalación exige todos los permisos de Google y ofrece una autorización explícita", () => {
  assert.match(source, /const V4_REQUIRED_OAUTH_SCOPES = \[/);
  assert.match(source, /"https:\/\/www\.googleapis\.com\/auth\/spreadsheets"/);
  assert.match(source, /"https:\/\/www\.googleapis\.com\/auth\/drive"/);
  assert.match(source, /function authorizeGuestStarV4\(\)/);
  assert.match(
    source,
    /ScriptApp\.requireScopes\(ScriptApp\.AuthMode\.FULL, V4_REQUIRED_OAUTH_SCOPES\)/
  );
  const setupBody = source.slice(
    source.indexOf("function setupMultiUserV4()"),
    source.indexOf("function auditV4_")
  );
  assert.match(setupBody, /requireGuestStarScopesV4_\(\)/);
});

test("la autorización termina sin esperar una ventana bloqueante", () => {
  const body = source.slice(
    source.indexOf("function authorizeGuestStarV4()"),
    source.indexOf("function setupMultiUserV4()")
  );
  assert.match(body, /master\.toast\(/);
  assert.doesNotMatch(body, /getUi\(\)\.alert\(/);
});

test("el web app comprueba el archivo y la carpeta reales de Drive", () => {
  const body = source.slice(
    source.indexOf("function guestStarDriveReadinessV4_"),
    source.indexOf("function authorizeGuestStarV4()")
  );
  assert.match(body, /DriveApp\.getFileById\(spreadsheet\.getId\(\)\)\.getName\(\)/);
  assert.match(body, /hotelDataFolderV4_\(\)/);
  assert.match(body, /hotel\.drive\.readiness\.failed/);
  assert.doesNotMatch(body, /getAuthorizationInfo/);
});

test("la hoja válida sobrevive si Google niega moverla a la carpeta de Drive", () => {
  const originalSpreadsheetApp = context.SpreadsheetApp;
  const originalDriveApp = context.DriveApp;
  const originalInitialize = context.initializeHotelDataV4_;
  const originalConsole = context.console;
  const firstSheet = {
    getLastRow: () => 1,
    getName: () => "Sheet1"
  };
  const spreadsheet = {
    getId: () => "hotel-sheet-1",
    getSheets: () => [firstSheet],
    getSheetByName: () => ({
      getRange: () => ({ setValue: () => undefined })
    }),
    deleteSheet: () => undefined
  };
  try {
    context.SpreadsheetApp = { create: () => spreadsheet };
    context.DriveApp = {
      getFileById: () => { throw new Error("Drive scope unavailable"); }
    };
    context.initializeHotelDataV4_ = () => undefined;
    context.console = { error: () => undefined };
    assert.equal(
      context.createHotelSpreadsheetV4_(
        { name: "Moon Palace" },
        null,
        { getId: () => "folder-1" }
      ),
      "hotel-sheet-1"
    );
  } finally {
    context.SpreadsheetApp = originalSpreadsheetApp;
    context.DriveApp = originalDriveApp;
    context.initializeHotelDataV4_ = originalInitialize;
    context.console = originalConsole;
  }
});

test("crear Moon Palace funciona con Sheets aunque DriveApp no esté disponible", () => {
  const originals = {
    Utilities: context.Utilities,
    tableRowsV4_: context.tableRowsV4_,
    validTimezoneV4_: context.validTimezoneV4_,
    uniqueSlugV4_: context.uniqueSlugV4_,
    randomTokenV4_: context.randomTokenV4_,
    publicBaseUrlV4_: context.publicBaseUrlV4_,
    guestStarDriveReadinessV4_: context.guestStarDriveReadinessV4_,
    createHotelSpreadsheetV4_: context.createHotelSpreadsheetV4_,
    createHotelQrV4_: context.createHotelQrV4_,
    appendRecordV4_: context.appendRecordV4_,
    updateRecordV4_: context.updateRecordV4_,
    auditV4_: context.auditV4_
  };
  const appended = [];
  let uuid = 0;
  let qrCalls = 0;
  try {
    context.Utilities = { getUuid: () => `id-${++uuid}` };
    context.tableRowsV4_ = () => [];
    context.validTimezoneV4_ = () => true;
    context.uniqueSlugV4_ = () => "moon-palace";
    context.randomTokenV4_ = () => "public-token";
    context.publicBaseUrlV4_ = () => "https://request.gstarxp.com";
    context.guestStarDriveReadinessV4_ = () => ({
      ok: false,
      detail: "Drive scope unavailable"
    });
    context.createHotelSpreadsheetV4_ = (_hotel, _legacy, destinationFolder) => {
      assert.equal(destinationFolder, null);
      return "hotel-sheet-1";
    };
    context.createHotelQrV4_ = () => {
      qrCalls += 1;
      return "unexpected-qr";
    };
    context.appendRecordV4_ = (_master, table, _headers, record) => {
      appended.push(table);
      return { ...record, _row: appended.length + 1 };
    };
    context.updateRecordV4_ = () => undefined;
    context.auditV4_ = () => undefined;

    const result = context.createHotelForSuperhostUnlockedV4_(
      { master: {}, user: { userId: "superhost-1", role: "superhost" } },
      { name: "Moon Palace", timezone: "America/Santo_Domingo" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.hotel.dataSheetId, "hotel-sheet-1");
    assert.equal(result.hotel.qrFileId, "");
    assert.equal(qrCalls, 0);
    assert.match(result.warning, /created in My Drive/);
    assert.deepEqual(
      appended,
      ["Hotels", "Venues", "Activities", "UserAssignments", "HotelBranding"]
    );
    assert.match(
      context.shareInfoV4_(result.hotel).qrDownloadUrl,
      /^https:\/\/quickchart\.io\/qr\?/
    );
  } finally {
    Object.assign(context, originals);
  }
});

test("crear un hotel no queda bloqueado por la organización opcional de Drive", () => {
  const body = source.slice(
    source.indexOf("function createHotelForSuperhostV4_"),
    source.indexOf("function updateHotelForSuperhostV4_")
  );
  assert.match(body, /LockService\.getScriptLock\(\)/);
  assert.match(body, /lock\.tryLock\(5000\)/);
  assert.match(body, /code: "HOTEL_CREATION_IN_PROGRESS"/);
  assert.match(body, /code: "HOTEL_ALREADY_EXISTS"/);
  assert.ok(
    body.indexOf("HOTEL_ALREADY_EXISTS") < body.indexOf("createHotelSpreadsheetV4_(hotel, null, destinationFolder)"),
    "an existing hotel must be detected before creating another spreadsheet"
  );
  assert.match(body, /guestStarDriveReadinessV4_\(auth\.master\)/);
  assert.match(body, /const destinationFolder = driveReadiness\.ok \? driveReadiness\.folder : null/);
  assert.doesNotMatch(body, /code: "GOOGLE_DRIVE_UNAVAILABLE"/);
  assert.match(body, /code: "HOTEL_SHEET_PROVISIONING_FAILED"/);
  assert.match(body, /The hotel Sheet was created in My Drive/);
  assert.ok(
    body.indexOf("guestStarDriveReadinessV4_(auth.master)") < body.indexOf("createHotelSpreadsheetV4_(hotel, null, destinationFolder)"),
    "Drive readiness must only select optional folder organization before Sheets provisioning"
  );
});

test("crear un hotel serializa la provisión y nunca duplica un nombre existente", () => {
  const originalLockService = context.LockService;
  const originalUnlocked = context.createHotelForSuperhostUnlockedV4_;
  const originalRows = context.tableRowsV4_;
  const originalReadiness = context.guestStarDriveReadinessV4_;
  const originalTimezone = context.validTimezoneV4_;
  let released = 0;
  let provisioned = 0;
  try {
    context.LockService = {
      getScriptLock: () => ({
        tryLock: () => false,
        releaseLock: () => { released += 1; }
      })
    };
    const busy = context.createHotelForSuperhostV4_(
      { user: { role: "superhost" } },
      { name: "Moon Palace" }
    );
    assert.equal(busy.code, "HOTEL_CREATION_IN_PROGRESS");
    assert.equal(released, 0);

    context.LockService = {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => { released += 1; }
      })
    };
    context.createHotelForSuperhostUnlockedV4_ = () => {
      provisioned += 1;
      return { ok: true };
    };
    assert.equal(
      context.createHotelForSuperhostV4_({ user: { role: "superhost" } }, {}).ok,
      true
    );
    assert.equal(provisioned, 1);
    assert.equal(released, 1);

    let driveChecks = 0;
    context.createHotelForSuperhostUnlockedV4_ = originalUnlocked;
    context.validTimezoneV4_ = () => true;
    context.tableRowsV4_ = () => [{
      hotelId: "hotel-1",
      name: "Moon Palace",
      slug: "moon-palace"
    }];
    context.guestStarDriveReadinessV4_ = () => {
      driveChecks += 1;
      return { ok: true };
    };
    const duplicate = context.createHotelForSuperhostUnlockedV4_(
      { master: {}, user: { role: "superhost" } },
      { name: "Moon Palace", timezone: "America/Santo_Domingo" }
    );
    assert.equal(duplicate.code, "HOTEL_ALREADY_EXISTS");
    assert.equal(driveChecks, 0);
  } finally {
    context.LockService = originalLockService;
    context.createHotelForSuperhostUnlockedV4_ = originalUnlocked;
    context.tableRowsV4_ = originalRows;
    context.guestStarDriveReadinessV4_ = originalReadiness;
    context.validTimezoneV4_ = originalTimezone;
  }
});

test("crear un usuario solo registra permisos y nunca crea otro spreadsheet", () => {
  const body = source.slice(
    source.indexOf("function createHostUserV4_"),
    source.indexOf("function createHotelForSuperhostV4_")
  );
  assert.match(body, /appendRecordV4_\(auth\.master, "Users"/);
  assert.doesNotMatch(body, /SpreadsheetApp\.create/);
  assert.doesNotMatch(body, /DriveApp\.create/);
});

test("crear un hotel automatiza su hoja, sede, actividad, asignación, identidad, enlace y QR", () => {
  const body = source.slice(
    source.indexOf("function createHotelForSuperhostV4_"),
    source.indexOf("function updateHotelForSuperhostV4_")
  );
  assert.match(body, /hotel\.dataSheetId = createHotelSpreadsheetV4_\(hotel, null, destinationFolder\)/);
  assert.match(body, /hotel\.qrFileId = destinationFolder/);
  assert.match(body, /appendRecordV4_\(auth\.master, "Hotels"/);
  assert.match(body, /appendRecordV4_\(auth\.master, "Venues"/);
  assert.match(body, /appendRecordV4_\(auth\.master, "Activities"/);
  assert.match(body, /appendRecordV4_\(auth\.master, "UserAssignments"/);
  assert.match(body, /appendRecordV4_\(auth\.master, "HotelBranding"/);
  assert.match(body, /activePublicActivityId:\s*activity\.activityId/);
  assert.match(body, /publicBaseUrlV4_\(\) \+ "\/h\/"/);
  assert.match(body, /warning: driveReadiness\.ok/);
});

test("el registro maestro vive en la cuenta Superhost y enruta cada solicitud a la hoja del hotel", () => {
  assert.match(source, /getProperty\("MASTER_SHEET_ID"\)/);
  assert.match(source, /properties\.setProperty\("MASTER_SHEET_ID", master\.getId\(\)\)/);
  assert.match(source, /REQUEST_DATA_SHEET_ID_ = hotel\.dataSheetId/);
  assert.match(source, /SpreadsheetApp\.openById\(dataSheetId\)/);
  assert.match(source, /function accessibleSelectionV4_\(user\)/);
  assert.match(source, /activity\.hotelId === hotelId/);
});

test("las sesiones web informan la versión exacta de Code.gs", () => {
  assert.match(source, /const BRIDGE_API_VERSION = "4\.0\.1"/);
  assert.match(source, /const GUEST_STAR_CODE_BUILD = "4\.0\.1-drive-fallback-1"/);
  const dispatchBody = source.slice(
    source.indexOf("function dispatchV4Action_"),
    source.indexOf("function publicHotelIdentifierV4_")
  );
  assert.match(dispatchBody, /codeVersion: BRIDGE_API_VERSION/);
});

test("la sincronización multi-hotel no queda serializada por el lock legado", () => {
  const body = source.slice(source.indexOf("function doPost(e)"), source.indexOf("function hostAction_"));
  assert.match(body, /const v4Response = dispatchV4Action_\(body\);/);
  assert.match(body, /if \(v4Response !== null\) return json_\(v4Response\);/);
  assert.ok(body.indexOf("dispatchV4Action_(body)") < body.indexOf("LockService.getScriptLock()"));
  assert.match(body, /legacy\/public submission path atomic/);
});

test("las respuestas de usuario nunca exponen hashes ni salts", () => {
  const body = source.slice(
    source.indexOf("function publicUserV4_"),
    source.indexOf("function loginRateLimitV4_")
  );
  assert.doesNotMatch(body, /passwordHash:/);
  assert.doesNotMatch(body, /passwordSalt:/);
  assert.match(source, /computeHmacSha256Signature/);
  assert.match(source, /sessionTokenHash:\s*tokenHashV4_\(token\)/);
  assert.match(source, /deviceTokenHash:\s*tokenHashV4_\(rawToken\)/);
});

test("el permiso más específico puede restringir el permiso heredado del hotel", () => {
  const originalMaster = context.masterSpreadsheetV4_;
  const originalRows = context.tableRowsV4_;
  context.masterSpreadsheetV4_ = () => ({});
  context.tableRowsV4_ = (_master, table) => table === "UserAssignments" ? [
    {
      userId: "host-1",
      hotelId: "hotel-1",
      venueId: "",
      activityId: "",
      status: "active",
      permissionsJson: JSON.stringify({ canStartActivity: true, canViewReviews: true })
    },
    {
      userId: "host-1",
      hotelId: "hotel-1",
      venueId: "venue-1",
      activityId: "activity-1",
      status: "active",
      permissionsJson: JSON.stringify({ canStartActivity: false })
    }
  ] : [];

  const permissions = context.effectivePermissionsV4_(
    { userId: "host-1", role: "host" },
    { hotelId: "hotel-1", venueId: "venue-1", activityId: "activity-1" }
  );
  context.masterSpreadsheetV4_ = originalMaster;
  context.tableRowsV4_ = originalRows;

  assert.equal(permissions.canStartActivity, false);
  assert.equal(permissions.canViewReviews, true);
  assert.equal(permissions.canManageHosts, false);
});

test("una asignación de actividad no expone otras actividades del mismo hotel", () => {
  const originalMaster = context.masterSpreadsheetV4_;
  const originalRows = context.tableRowsV4_;
  context.masterSpreadsheetV4_ = () => ({});
  context.tableRowsV4_ = (_master, table) => ({
    Hotels: [
      { hotelId: "hotel-1", status: "active" },
      { hotelId: "hotel-2", status: "active" }
    ],
    Venues: [
      { venueId: "venue-1", hotelId: "hotel-1", status: "active" },
      { venueId: "venue-2", hotelId: "hotel-1", status: "active" },
      { venueId: "venue-3", hotelId: "hotel-2", status: "active" }
    ],
    Activities: [
      { activityId: "activity-1", hotelId: "hotel-1", venueId: "venue-1", status: "ready" },
      { activityId: "activity-2", hotelId: "hotel-1", venueId: "venue-2", status: "ready" },
      { activityId: "activity-3", hotelId: "hotel-2", venueId: "venue-3", status: "ready" }
    ],
    UserAssignments: [
      {
        userId: "host-1", hotelId: "hotel-1", venueId: "venue-1",
        activityId: "activity-1", status: "active"
      }
    ]
  }[table] || []);

  const selection = context.accessibleSelectionV4_({ userId: "host-1", role: "host" });
  context.masterSpreadsheetV4_ = originalMaster;
  context.tableRowsV4_ = originalRows;

  assert.deepEqual(Array.from(selection.hotels, item => item.hotelId), ["hotel-1"]);
  assert.deepEqual(Array.from(selection.venues, item => item.venueId), ["venue-1"]);
  assert.deepEqual(Array.from(selection.activities, item => item.activityId), ["activity-1"]);
});

test("el login temporal vence y solo puede consumirse una vez", () => {
  assert.match(source, /now\.getTime\(\) \+ 90 \* 1000/);
  assert.match(source, /if \(!record \|\| record\.usedAt \|\| new Date\(record\.expiresAt\)/);
  assert.match(source, /usedAt:\s*isoNowV4_\(\)/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("function createOneTimeLoginCodeV4_"),
      source.indexOf("function consumeOneTimeLoginCodeV4_")
    ),
    /authToken|password|deviceToken=/
  );
});

test("la recurrencia semanal respeta el intervalo después del último día del ciclo", () => {
  const originalUtilities = context.Utilities;
  const originalSession = context.Session;
  context.Utilities = {
    formatDate: date => new Date(date).toISOString().slice(0, 19),
    parseDate: text => new Date(`${text}Z`)
  };
  context.Session = { getScriptTimeZone: () => "UTC" };
  const schedule = {
    scheduledStartAt: "2026-08-05T20:00:00.000Z",
    recurrenceType: "weekly",
    recurrenceInterval: 2,
    recurrenceDaysJson: "[1,3]",
    recurrenceEndAt: ""
  };
  const next = context.nextOccurrenceV4_(schedule, "UTC");
  context.Utilities = originalUtilities;
  context.Session = originalSession;
  assert.equal(next, "2026-08-17T20:00:00.000Z");
});
