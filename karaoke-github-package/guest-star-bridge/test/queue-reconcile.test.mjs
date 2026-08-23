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

test("reconoce metadatos invertidos únicos aunque VirtualDJ haya cambiado el cantante", () => {
  const result = reconcileTrackedQueue([{
    id: "request-unique", singer: "Alex · G-19AF",
    song: "Valió la pena", artist: "Marc Anthony", durationSeconds: 274
  }], [{
    index: 0, singer: "Gary", song: "Marc Anthony",
    artist: "Valio la pena", durationSeconds: 274
  }]);

  assert.equal(result.matched.get("request-unique").index, 0);
  assert.equal(result.matchDetails.get("request-unique").fields.includes("metadataReversed"), true);
  assert.equal(result.matchDetails.get("request-unique").fields.includes("uniqueMetadata"), true);
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
