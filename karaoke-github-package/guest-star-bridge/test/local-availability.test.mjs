import assert from "node:assert/strict";
import test from "node:test";
import { reconcileLocalAvailability } from "../src/local-availability.mjs";

test("detecta cuando una canción que estaba local deja de estar disponible", () => {
  const previous = new Map([
    ["request-1", true],
    ["request-2", false]
  ]);
  const result = reconcileLocalAvailability(previous, [
    { id: "request-1", available: false },
    { id: "request-2", available: false }
  ]);

  assert.deepEqual(result.becameMissing, ["request-1"]);
  assert.equal(result.next.get("request-1"), false);
});

test("no considera desaparición una solicitud nueva y limpia las solicitudes eliminadas", () => {
  const previous = new Map([
    ["old-request", true],
    ["request-1", false]
  ]);
  const result = reconcileLocalAvailability(previous, [
    { id: "request-1", available: true },
    { id: "request-2", available: false }
  ]);

  assert.deepEqual(result.becameMissing, []);
  assert.equal(result.next.get("request-1"), true);
  assert.equal(result.next.get("request-2"), false);
  assert.equal(result.next.has("old-request"), false);
});
