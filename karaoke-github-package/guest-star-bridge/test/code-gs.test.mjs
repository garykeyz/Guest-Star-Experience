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

test("solo el estado Saltado se resta del cálculo de la actividad", () => {
  assert.equal(context.skippedStatus_("Saltado"), true);
  assert.equal(context.skippedStatus_("Ya cantó"), false);
  assert.equal(context.skippedStatus_("Agregada a VirtualDJ"), false);
});

test("la cola del Bridge incluye el estado compartido", () => {
  assert.match(source, /state:\s*publicState_\(\),\s*requests:\s*bridgeQueue_\(\)/);
  assert.match(source, /const BRIDGE_API_VERSION = "3\.0\.0"/);
  assert.match(source, /body\.action === "bridgeControl"/);
  assert.match(source, /control:\s*control,\s*state:\s*publicState_\(\),\s*requests:\s*bridgeQueue_\(\)/);
  assert.match(source, /touchState_\("reset",\s*source,\s*true\)/);
  assert.match(source, /sourceUrl:\s*String\(row\[10\]/);
  assert.match(source, /fileName:\s*String\(row\[13\]/);
  assert.match(source, /durationSeconds:\s*durationCellSeconds_\(row\[6\]\)/);
  assert.match(source, /transitionSeconds:\s*durationCellSeconds_\(row\[7\]\)/);
  assert.match(source, /body\.action === "bridgeConfigUpdate"/);
  assert.match(source, /activityStartedAt:\s*cfg\.activityStartedAt/);
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
  assert.match(source, /language:\s*String\(row\[5\]/);
  assert.match(
    source,
    /findKaraokeCandidates_\(body\.song,\s*body\.artist,\s*body\.language\)/
  );
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

  const options = context.findKaraokeCandidates_("Hello", "Adele");
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

  const options = context.findKaraokeCandidates_("Dancing Queen", "ABBA");
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
