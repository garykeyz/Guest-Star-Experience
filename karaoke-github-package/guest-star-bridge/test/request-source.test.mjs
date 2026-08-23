import assert from "node:assert/strict";
import test from "node:test";
import {
  isOnlineGuestRequest,
  isTechnicalVirtualDjValue
} from "../src/request-source.mjs";

test("mantiene solicitudes online separadas de las pistas propias de VirtualDJ", () => {
  const rows = [
    { id: "request-1", sourceType: "guest_request", singer: "Moises", song: "La vida es un carnaval" },
    { id: "vdj-1", sourceType: "virtualdj_external", singer: "VirtualDJ", song: "Que Dios Decida" },
    { id: "vdj-2", sourceType: "VirtualDJ External", singer: "VirtualDJ", song: "Todo Contigo" }
  ];

  assert.deepEqual(rows.filter(isOnlineGuestRequest).map((item) => item.id), ["request-1"]);
});

test("oculta filas técnicas antiguas aunque hayan perdido su tipo de origen", () => {
  assert.equal(isTechnicalVirtualDjValue("error:-2147467259"), true);
  assert.equal(isOnlineGuestRequest({ singer: "ERROR:-2147467259", song: "error:-2147467259" }), false);
});
