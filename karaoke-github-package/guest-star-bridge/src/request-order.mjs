function arrivalTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function orderRequestViews(items = []) {
  return items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => {
      const leftTerminal = Boolean(left.item.outcome);
      const rightTerminal = Boolean(right.item.outcome);
      if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;

      const leftQueued = left.item.queued === true;
      const rightQueued = right.item.queued === true;
      if (leftQueued !== rightQueued) return leftQueued ? -1 : 1;

      if (leftQueued && rightQueued) {
        const leftPosition = Number(left.item.queuePosition);
        const rightPosition = Number(right.item.queuePosition);
        const leftHasPosition = Number.isFinite(leftPosition) && leftPosition > 0;
        const rightHasPosition = Number.isFinite(rightPosition) && rightPosition > 0;
        if (leftHasPosition && rightHasPosition && leftPosition !== rightPosition) {
          return leftPosition - rightPosition;
        }
        if (leftHasPosition !== rightHasPosition) return leftHasPosition ? -1 : 1;
      }

      const leftArrival = arrivalTime(left.item.timestamp);
      const rightArrival = arrivalTime(right.item.timestamp);
      if (
        leftArrival !== null &&
        rightArrival !== null &&
        leftArrival !== rightArrival
      ) {
        return leftArrival - rightArrival;
      }
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ item }) => item);
}
