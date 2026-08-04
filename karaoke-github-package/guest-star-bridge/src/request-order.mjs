function arrivalTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function orderRequestViews(items = []) {
  return items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => {
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
