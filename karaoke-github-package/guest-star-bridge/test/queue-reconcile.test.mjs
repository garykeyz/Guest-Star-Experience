import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileTrackedQueue,
  stabilizeVirtualDjEntries
} from "../src/queue-reconcile.mjs";

test("detecta qué solicitudes siguen realmente en la cola de VirtualDJ", () => {
  const tracked = [
    {
      id: "request-1",
      filePath: "/Music/Karaoke/Adele - Hello.mp4",
      singer: "Ana"
    },
    {
      id: "request-2",
      filePath: "/Music/Karaoke/Bruno Mars - Treasure.mp4",
      singer: "Carlos"
    }
  ];
  const actual = [
    {
      index: 0,
      filePath: "\\Music\\Karaoke\\Bruno Mars - Treasure.mp4",
      singer: "Carlos"
    }
  ];

  const result = reconcileTrackedQueue(tracked, actual);

  assert.deepEqual(result.missing, ["request-1"]);
  assert.equal(result.matched.get("request-2").index, 0);
});

test("asigna por separado dos entradas repetidas en la cola", () => {
  const tracked = [
    { id: "request-1", filePath: "/Music/song.mp4", singer: "Ana" },
    { id: "request-2", filePath: "/Music/song.mp4", singer: "Ana" }
  ];
  const actual = [
    { index: 3, filePath: "/Music/song.mp4", singer: "Ana" },
    { index: 4, filePath: "/Music/song.mp4", singer: "Ana" }
  ];

  const result = reconcileTrackedQueue(tracked, actual);

  assert.equal(result.matched.get("request-1").index, 3);
  assert.equal(result.matched.get("request-2").index, 4);
  assert.deepEqual(result.missing, []);
});

test("reconcilia por cantante y metadatos cuando VirtualDJ no entrega filepath", () => {
  const tracked = [
    {
      id: "request-1",
      filePath: "/Music/Adele - Hello.mp4",
      singer: "Ana",
      song: "Hello",
      artist: "Adele"
    }
  ];
  const actual = [
    {
      index: 0,
      filePath: "",
      singer: "Ana",
      song: "Hello",
      artist: "Adele"
    }
  ];

  const result = reconcileTrackedQueue(tracked, actual);

  assert.equal(result.matched.get("request-1").index, 0);
  assert.deepEqual(result.missing, []);
});

test("tolera un typo del artista si cantante y canción coinciden", () => {
  const tracked = [
    {
      id: "request-1",
      filePath: "/Music/Marc Anthony - Valio La Pena.mp4",
      singer: "Gary",
      song: "Valio La Pena",
      artist: "Marc Anthony"
    }
  ];
  const actual = [
    {
      index: 0,
      filePath: "",
      singer: "Gary",
      song: "Valio La Pena",
      artist: "Marc Antohny"
    }
  ];

  const result = reconcileTrackedQueue(tracked, actual);

  assert.equal(result.matched.get("request-1").index, 0);
  assert.deepEqual(result.missing, []);
});

test("preserva un vínculo manual aunque el título tenga baja coincidencia", () => {
  const result = reconcileTrackedQueue([{
    id: "request-gina",
    manualLink: true,
    filePath: "",
    singer: "Gina A",
    song: "Yo me llamo cumbia",
    artist: "La negra de Colombia",
    durationSeconds: 192
  }], [{
    index: 4,
    filePath: "",
    singer: "Gina A",
    song: "Leonor González Mina - Karaoke Oficial - Cumbia Colombiana",
    artist: "",
    durationSeconds: 192
  }]);

  assert.equal(result.matched.get("request-gina").index, 4);
  assert.ok(
    result.matchDetails.get("request-gina").fields.includes("uniqueSingerDuration")
  );
  assert.deepEqual(result.missing, []);
});

test("no usa solo cantante y duración cuando dos vínculos compiten", () => {
  const result = reconcileTrackedQueue([
    { id: "gina-1", manualLink: true, singer: "Gina A", song: "Uno", durationSeconds: 192 },
    { id: "gina-2", manualLink: true, singer: "Gina A", song: "Dos", durationSeconds: 192 }
  ], [{
    index: 0,
    singer: "Gina A",
    song: "Metadatos distintos",
    durationSeconds: 192
  }]);

  assert.equal(result.matched.size, 0);
  assert.deepEqual(result.missing, ["gina-1", "gina-2"]);
});

test("reconoce Mi Vida aunque VirtualDJ invierta título y artista", () => {
  const result = reconcileTrackedQueue([
    {
      id: "request-mi-vida",
      singer: "Laura",
      song: "Mi Vida",
      artist: "Divino",
      durationSeconds: 237
    }
  ], [
    {
      index: 0,
      singer: "Laura",
      song: "Divino",
      artist: "Mi vida",
      durationSeconds: 237
    }
  ]);

  assert.equal(result.matched.get("request-mi-vida").index, 0);
  assert.equal(
    result.matchDetails.get("request-mi-vida").fields.includes("metadataReversed"),
    true
  );
  assert.deepEqual(result.missing, []);
});

test("no vincula metadatos únicos si el cantante físico de VirtualDJ es otro", () => {
  const result = reconcileTrackedQueue([{
    id: "request-unique", singer: "Alex · G-19AF",
    song: "Valió la pena", artist: "Marc Anthony", durationSeconds: 274
  }], [{
    index: 0, singer: "Gary", song: "Marc Anthony",
    artist: "Valio la pena", durationSeconds: 274
  }]);

  assert.equal(result.matched.size, 0);
  assert.deepEqual(result.missing, ["request-unique"]);
  assert.deepEqual(result.unmatched.map((entry) => entry.index), [0]);
});

test("no vincula una pista propia por ruta, título o identificador si el cantante no coincide", () => {
  const actual = stabilizeVirtualDjEntries([{
    index: 0,
    filePath: "/Music/Oops I Did It Again.mp4",
    singer: "gary",
    song: "Oops!...I Did It Again",
    artist: "Britney Spears",
    durationSeconds: 239
  }]);
  const result = reconcileTrackedQueue([{
    id: "request-esteban",
    filePath: "/Music/Oops I Did It Again.mp4",
    singer: "gary",
    expectedSinger: "Esteban",
    song: "Oops!...I Did It Again",
    artist: "Britney Spears",
    durationSeconds: 239,
    virtualDJItemId: actual[0].virtualDJItemId,
    manualLink: false
  }], actual);

  assert.equal(result.matched.size, 0);
  assert.deepEqual(result.missing, ["request-esteban"]);
  assert.equal(result.unmatched[0].singer, "gary");
});

test("clasifica como propias las filas de la captura con cantantes distintos", () => {
  const tracked = [
    { id: "esteban", singer: "Esteban", song: "Oops!...I Did It Again", artist: "Britney Spears", durationSeconds: 239 },
    { id: "marcela", singer: "Marcela", song: "Gimme! Gimme! Gimme! (A Man After Midnight)", artist: "ABBA", durationSeconds: 300 },
    { id: "diana", singer: "Diana", song: "ROSÉ & Bruno Mars", artist: "APT.", durationSeconds: 191 },
    { id: "moises", singer: "moises", song: "Mr. Brightside", artist: "The Killers", durationSeconds: 235 }
  ];
  const actual = [
    { index: 0, singer: "gary", song: "Oops!...I Did It Again", artist: "Britney Spears", durationSeconds: 239 },
    { index: 1, singer: "jaf", song: "Gimme! Gimme! Gimme! (A Man After Midnight)", artist: "ABBA", durationSeconds: 300 },
    { index: 2, singer: "moises", song: "ROSÉ & Bruno Mars", artist: "APT.", durationSeconds: 191 },
    { index: 3, singer: "alfredo", song: "Mr. Brightside", artist: "The Killers", durationSeconds: 235 }
  ];
  const result = reconcileTrackedQueue(tracked, actual);

  assert.equal(result.matched.size, 0);
  assert.deepEqual(result.missing, ["esteban", "marcela", "diana", "moises"]);
  assert.deepEqual(result.unmatched.map((entry) => entry.singer), [
    "gary", "jaf", "moises", "alfredo"
  ]);
});

test("un vínculo manual estable sigue protegido aunque cambien cantante y metadatos", () => {
  const actual = stabilizeVirtualDjEntries([{
    index: 3,
    filePath: "/Music/Selected.mp4",
    singer: "VDJ edited singer",
    song: "VDJ edited title",
    artist: "",
    durationSeconds: 210
  }]);
  const result = reconcileTrackedQueue([{
    id: "manual-request",
    manualLink: true,
    expectedSinger: "Gina",
    singer: "Gina",
    song: "Requested title",
    artist: "Requested artist",
    durationSeconds: 192,
    virtualDJItemId: actual[0].virtualDJItemId
  }], actual);

  assert.equal(result.matched.get("manual-request").index, 3);
  assert.deepEqual(
    result.matchDetails.get("manual-request").fields,
    ["manualVirtualDJItemId"]
  );
});

test("una pista ya reconocida como propia de VirtualDJ no se adopta por coincidencia", () => {
  const actual = stabilizeVirtualDjEntries([{
    index: 0,
    filePath: "/Music/Native New Yorker.mp4",
    singer: "Gari Inirio",
    song: "Native New Yorker",
    artist: "Odyssey",
    durationSeconds: 239
  }]).map((entry) => ({ ...entry, knownExternal: true }));
  const result = reconcileTrackedQueue([{
    id: "same-looking-request",
    singer: "Gari Inirio",
    song: "Native New Yorker",
    artist: "Odyssey",
    durationSeconds: 239,
    filePath: "/Music/Native New Yorker.mp4",
    virtualDJItemId: actual[0].virtualDJItemId
  }], actual);

  assert.equal(result.matched.size, 0);
  assert.deepEqual(result.unmatched.map((entry) => entry.index), [0]);
});

test("solo el vínculo manual exacto puede reclamar una pista externa conocida", () => {
  const actual = stabilizeVirtualDjEntries([{
    index: 2,
    filePath: "/Music/Selected.mp4",
    singer: "Gina",
    song: "Selected song",
    artist: "Selected artist",
    durationSeconds: 210
  }]).map((entry) => ({ ...entry, knownExternal: true }));
  const result = reconcileTrackedQueue([{
    id: "manual-request",
    manualLink: true,
    singer: "Gina",
    song: "Requested song",
    artist: "Requested artist",
    durationSeconds: 192,
    virtualDJItemId: actual[0].virtualDJItemId
  }], actual);

  assert.equal(result.matched.get("manual-request").index, 2);
  assert.deepEqual(
    result.matchDetails.get("manual-request").fields,
    ["manualVirtualDJItemId"]
  );
});

test("no adivina por metadatos cuando dos solicitudes compiten por la misma canción", () => {
  const result = reconcileTrackedQueue([
    { id: "alex-a", singer: "Alex A", song: "Mi Vida", artist: "Divino", durationSeconds: 237 },
    { id: "alex-b", singer: "Alex B", song: "Mi Vida", artist: "Divino", durationSeconds: 237 }
  ], [{
    index: 0, singer: "Sin identificar", song: "Divino", artist: "Mi Vida", durationSeconds: 237
  }]);

  assert.equal(result.matched.size, 0);
  assert.deepEqual(result.missing, ["alex-a", "alex-b"]);
});

test("mantiene el identificador estable cuando VirtualDJ reordena la cola", () => {
  const first = stabilizeVirtualDjEntries([
    { index: 0, filePath: "/Music/First.mp4", singer: "Ana" },
    { index: 1, filePath: "/Music/Second.mp4", singer: "Luis" }
  ]);
  const reordered = stabilizeVirtualDjEntries([
    { index: 0, filePath: "/Music/Second.mp4", singer: "Luis" },
    { index: 1, filePath: "/Music/First.mp4", singer: "Ana" }
  ], first);

  assert.equal(reordered[0].virtualDJItemId, first[1].virtualDJItemId);
  assert.equal(reordered[1].virtualDJItemId, first[0].virtualDJItemId);
});

test("prefiere el vínculo estable y expone pistas externas sin perder duplicados", () => {
  const actual = stabilizeVirtualDjEntries([
    { index: 0, filePath: "/Music/Same.mp4", singer: "Ana" },
    { index: 1, filePath: "/Music/Same.mp4", singer: "Ana" },
    { index: 2, filePath: "/Music/External.mp4", singer: "Invitado" }
  ]);
  const tracked = [
    {
      id: "request-2",
      filePath: "/Music/Same.mp4",
      singer: "Ana",
      virtualDJItemId: actual[1].virtualDJItemId
    },
    {
      id: "request-1",
      filePath: "/Music/Same.mp4",
      singer: "Ana",
      virtualDJItemId: actual[0].virtualDJItemId
    }
  ];

  const result = reconcileTrackedQueue(tracked, actual);
  assert.equal(result.matched.get("request-2").virtualDJItemId, actual[1].virtualDJItemId);
  assert.equal(result.matched.get("request-1").virtualDJItemId, actual[0].virtualDJItemId);
  assert.equal(result.unmatched.length, 1);
  assert.match(result.unmatched[0].filePath, /External/);
});

test("la cola de cuatro filas conserva tres pistas propias y vincula una sola solicitud", () => {
  const actual = stabilizeVirtualDjEntries([
    { index: 0, filePath: "/Music/Que Dios Decida.mp4", singer: "", song: "Que Dios Decida", artist: "El Gary", durationSeconds: 252 },
    { index: 1, filePath: "/Music/Todo Contigo.mp4", singer: "", song: "Todo Contigo", artist: "El Gary", durationSeconds: 280 },
    { index: 2, filePath: "/Music/Midnight Sun.mp4", singer: "Summer Collis", song: "Midnight Sun", artist: "Zara Larsson", durationSeconds: 190 },
    { index: 3, filePath: "/Music/External.mp4", singer: "Guest", song: "External", artist: "Artist", durationSeconds: 210 }
  ]);
  const result = reconcileTrackedQueue([{
    id: "summer-request",
    filePath: "/Music/Midnight Sun.mp4",
    singer: "Summer Collis",
    song: "Midnight Sun",
    artist: "Zara Larsson",
    durationSeconds: 190
  }], actual);

  assert.equal(actual.length, 4);
  assert.equal(result.matched.get("summer-request").index, 2);
  assert.deepEqual(result.unmatched.map((entry) => entry.index), [0, 1, 3]);
});
