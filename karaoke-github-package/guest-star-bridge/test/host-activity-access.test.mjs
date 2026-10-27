import assert from "node:assert/strict";
import test from "node:test";
import { currentHostActivityAccess } from "../public/host-activity-access.js";

function hostState() {
  return {
    account: {
      authenticated: true,
      user: { role: "host" },
      current: { hotelId: "hotel-1", activityId: "activity-1", venueId: "venue-1" }
    },
    tenant: {
      hotel: { hotelId: "hotel-1" },
      activity: { activityId: "activity-1", status: "finished" },
      venue: { venueId: "venue-1" },
      kioskAccess: {
        hotelId: "hotel-1", activityId: "activity-1", venueId: "venue-1",
        pin: "760391", joinUrl: "https://request.gstarxp.com/join/persistent-token"
      }
    }
  };
}

test("Host conserva el acceso de la actividad persistente después de finalizar la ocurrencia", () => {
  const state = hostState();
  assert.equal(currentHostActivityAccess(state), state.tenant.kioskAccess);
  delete state.tenant.activity.status;
  assert.equal(currentHostActivityAccess(state), state.tenant.kioskAccess);
});

test("no muestra el PIN de otra actividad o sala mientras llega el nuevo estado", () => {
  const state = hostState();
  state.account.current.activityId = "activity-2";
  assert.equal(currentHostActivityAccess(state), null);
  state.account.current.activityId = "activity-1";
  state.tenant.venue.venueId = "venue-2";
  assert.equal(currentHostActivityAccess(state), null);
  state.tenant.venue.venueId = "venue-1";
  state.tenant.kioskAccess = { ...state.tenant.kioskAccess, pin: "123456", joinUrl: "https://request.gstarxp.com/join/new-token" };
  assert.equal(currentHostActivityAccess(state), state.tenant.kioskAccess);
});

test("Superhost solo obtiene acceso en Modo Host con la actividad correcta", () => {
  const state = hostState();
  state.account.user.role = "superhost";
  assert.equal(currentHostActivityAccess(state), null);
  assert.equal(currentHostActivityAccess(state, { superhostInHostView: true }), state.tenant.kioskAccess);
  state.account.current.activityId = "activity-2";
  assert.equal(currentHostActivityAccess(state, { superhostInHostView: true }), null);
});

test("PIN inválido y enlace ajeno no obtienen acceso operativo", () => {
  const state = hostState();
  state.account.user.role = "host";
  state.tenant.kioskAccess.pin = "123";
  assert.equal(currentHostActivityAccess(state), null);
  state.tenant.kioskAccess.pin = "760391";
  state.tenant.kioskAccess.joinUrl = "https://example.com/join/persistent-token";
  assert.equal(currentHostActivityAccess(state), null);
});
