import assert from "node:assert/strict";
import test from "node:test";
import {
  drawInfiniteRotation,
  normalizeFavoriteSongs,
  rotationSongKey
} from "../src/random-rotation.mjs";

const catalog = [
  { song: "Uno", artist: "A", language: "Español" },
  { song: "Dos", artist: "B", language: "Español" },
  { song: "Tres", artist: "C", language: "Español" }
];

test("la rotación infinita no repite antes de completar una vuelta", () => {
  const first = drawInfiniteRotation(catalog, {}, 2, () => 0);
  const second = drawInfiniteRotation(catalog, first.state, 1, () => 0);
  const keys = [...first.items, ...second.items].map(rotationSongKey);

  assert.equal(new Set(keys).size, 3);
  assert.equal(second.state.round, 1);
});

test("una vuelta nueva evita repetir inmediatamente el último tema", () => {
  const first = drawInfiniteRotation(catalog, {}, 3, () => 0);
  const second = drawInfiniteRotation(catalog, first.state, 1, () => 0);

  assert.notEqual(
    rotationSongKey(first.items.at(-1)),
    rotationSongKey(second.items[0])
  );
  assert.equal(second.state.round, 2);
});

test("los favoritos se limpian, deduplican y conservan por canción y artista", () => {
  const favorites = normalizeFavoriteSongs([
    { song: " Mi Vida ", artist: " Divino ", language: "Español" },
    { song: "mi vida", artist: "divino", language: "Spanish" },
    { song: "Dancing Queen", artist: "ABBA", language: "English" },
    { song: "", artist: "Sin tema" }
  ]);

  assert.equal(favorites.length, 2);
  assert.equal(favorites[0].song, "Mi Vida");
  assert.equal(favorites[1].language, "English");
});
