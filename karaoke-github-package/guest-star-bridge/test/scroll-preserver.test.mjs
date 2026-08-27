import assert from "node:assert/strict";
import test from "node:test";
import {
  captureBridgeScrollState,
  restoreBridgeScrollState
} from "../public/scroll-preserver.js";

function anchor(attribute, key, offsetTop, offsetHeight = 48) {
  return {
    offsetTop,
    offsetHeight,
    getAttribute(name) {
      return name === attribute ? key : null;
    }
  };
}

function container(anchors, scrollTop = 0, scrollLeft = 0) {
  return {
    anchors,
    scrollTop,
    scrollLeft,
    querySelectorAll() {
      return this.anchors;
    }
  };
}

function rootWith(values) {
  return {
    values,
    querySelector(selector) {
      return this.values[selector] || null;
    }
  };
}

test("conserva la misma solicitud visible cuando una actualización reconstruye la lista", () => {
  const requestList = container([
    anchor("data-request-id", "request-1", 180),
    anchor("data-request-id", "request-2", 260),
    anchor("data-request-id", "request-3", 340)
  ], 240);
  const root = rootWith({ "#requests .request-list": requestList });
  const view = {
    scrollX: 12,
    scrollY: 620,
    scrollTo(x, y) {
      this.restored = [x, y];
    }
  };
  const snapshot = captureBridgeScrollState(root, view);

  root.values["#requests .request-list"] = container([
    anchor("data-request-id", "request-2", 500),
    anchor("data-request-id", "request-3", 580)
  ]);
  restoreBridgeScrollState(snapshot, root, view);

  assert.equal(root.values["#requests .request-list"].scrollTop, 480);
  assert.deepEqual(view.restored, [12, 620]);
});

test("conserva el desplazamiento numérico de la cola VDJ si el ancla desaparece", () => {
  const vdjList = container([
    anchor("data-vdj-id", "vdj-1", 0),
    anchor("data-vdj-id", "vdj-2", 80)
  ], 95, 7);
  const root = rootWith({ "#vdjQueueList": vdjList });
  const snapshot = captureBridgeScrollState(root, { scrollX: 0, scrollY: 0 });
  root.values["#vdjQueueList"] = container([
    anchor("data-vdj-id", "vdj-3", 0)
  ]);

  restoreBridgeScrollState(snapshot, root, {});
  assert.equal(root.values["#vdjQueueList"].scrollTop, 95);
  assert.equal(root.values["#vdjQueueList"].scrollLeft, 7);
});
