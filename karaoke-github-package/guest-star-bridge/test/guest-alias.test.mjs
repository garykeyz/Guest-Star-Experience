import assert from "node:assert/strict";
import test from "node:test";
import {
  alphabeticalGuestAlias,
  assignGuestAliases
} from "../src/guest-alias.mjs";

test("asigna Alex A y Alex B por dispositivo y conserva la letra en otras canciones", () => {
  const result = assignGuestAliases([
    {
      id: "alex-a-song-1",
      timestamp: "2026-08-22T20:00:00.000Z",
      singer: "Alex",
      guestIdentity: "device-a"
    },
    {
      id: "alex-b-song-1",
      timestamp: "2026-08-22T20:01:00.000Z",
      singer: "Álex",
      guestIdentity: "device-b"
    },
    {
      id: "alex-a-song-2",
      timestamp: "2026-08-22T20:02:00.000Z",
      singer: "Alex",
      guestIdentity: "device-a"
    }
  ]);

  assert.deepEqual(
    result.map((item) => [item.guestAlias, item.guestTone]),
    [["A", 0], ["B", 1], ["A", 0]]
  );
});

test("la letra depende de la primera llegada y no de la posición actual", () => {
  const result = assignGuestAliases([
    {
      id: "later-device-first-in-queue",
      timestamp: "2026-08-22T20:05:00.000Z",
      singer: "Alex",
      guestIdentity: "device-b"
    },
    {
      id: "first-device-later-in-queue",
      timestamp: "2026-08-22T20:00:00.000Z",
      singer: "Alex",
      guestIdentity: "device-a"
    }
  ]);

  assert.deepEqual(result.map((item) => item.guestAlias), ["B", "A"]);
});

test("no añade una letra cuando no existe otro huésped con ese nombre", () => {
  const result = assignGuestAliases([
    {
      id: "only-gary",
      timestamp: "2026-08-22T20:00:00.000Z",
      singer: "Gary",
      guestIdentity: "device-gary"
    }
  ]);

  assert.equal(result[0].guestAlias, "");
});

test("continúa después de Z sin repetir identificadores", () => {
  assert.equal(alphabeticalGuestAlias(0), "A");
  assert.equal(alphabeticalGuestAlias(25), "Z");
  assert.equal(alphabeticalGuestAlias(26), "AA");
});
