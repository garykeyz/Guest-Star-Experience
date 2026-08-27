const SCROLL_TARGETS = [
  {
    selector: "#requests .request-list",
    anchorSelector: "[data-request-id]",
    anchorAttribute: "data-request-id"
  },
  {
    selector: "#finishedRequests .request-list",
    anchorSelector: "[data-request-id]",
    anchorAttribute: "data-request-id"
  },
  {
    selector: "#vdjQueueList",
    anchorSelector: "[data-vdj-id]",
    anchorAttribute: "data-vdj-id"
  }
];

function firstVisibleAnchor(container, target) {
  const anchors = [...container.querySelectorAll(target.anchorSelector)];
  const scrollTop = Number(container.scrollTop) || 0;
  return anchors.find((anchor) => {
    const top = Number(anchor.offsetTop) || 0;
    const height = Math.max(1, Number(anchor.offsetHeight) || 1);
    return top + height > scrollTop;
  }) || null;
}

export function captureBridgeScrollState(root = document, view = window) {
  const containers = SCROLL_TARGETS.map((target) => {
    const container = root.querySelector(target.selector);
    if (!container) return { ...target, present: false };
    const anchor = firstVisibleAnchor(container, target);
    return {
      ...target,
      present: true,
      scrollTop: Number(container.scrollTop) || 0,
      scrollLeft: Number(container.scrollLeft) || 0,
      anchorKey: anchor?.getAttribute(target.anchorAttribute) || "",
      anchorOffset: anchor
        ? (Number(anchor.offsetTop) || 0) - (Number(container.scrollTop) || 0)
        : 0
    };
  });
  return {
    containers,
    windowX: Number(view?.scrollX ?? view?.pageXOffset) || 0,
    windowY: Number(view?.scrollY ?? view?.pageYOffset) || 0
  };
}

export function restoreBridgeScrollState(snapshot, root = document, view = window) {
  if (!snapshot) return;
  for (const saved of snapshot.containers || []) {
    if (!saved.present) continue;
    const container = root.querySelector(saved.selector);
    if (!container) continue;
    let nextTop = saved.scrollTop;
    if (saved.anchorKey) {
      const anchor = [...container.querySelectorAll(saved.anchorSelector)]
        .find((candidate) =>
          candidate.getAttribute(saved.anchorAttribute) === saved.anchorKey
        );
      if (anchor) {
        nextTop = (Number(anchor.offsetTop) || 0) - saved.anchorOffset;
      }
    }
    container.scrollTop = Math.max(0, nextTop);
    container.scrollLeft = Math.max(0, saved.scrollLeft);
  }
  if (typeof view?.scrollTo === "function") {
    view.scrollTo(snapshot.windowX || 0, snapshot.windowY || 0);
  }
}

export function preserveBridgeScroll(render, root = document, view = window) {
  const snapshot = captureBridgeScrollState(root, view);
  try {
    return render();
  } finally {
    restoreBridgeScrollState(snapshot, root, view);
  }
}
