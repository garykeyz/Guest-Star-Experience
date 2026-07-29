import assert from "node:assert/strict";
import test from "node:test";
import { reconcileTrackedQueue } from "../src/queue-reconcile.mjs";

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
