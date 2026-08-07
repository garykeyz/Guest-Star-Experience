function createMatrix(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("The public link is not available.");
  if (typeof globalThis.qrcode !== "function") {
    throw new Error("The local QR generator did not load.");
  }
  const code = globalThis.qrcode(0, "H");
  code.addData(value, "Byte");
  code.make();
  return code;
}

export function qrPngDataUrl(text, preferredSize = 900) {
  const code = createMatrix(text);
  const modules = code.getModuleCount();
  const quietModules = 4;
  const target = Math.max(240, Math.min(1600, Number(preferredSize) || 900));
  const cell = Math.max(2, Math.floor(target / (modules + quietModules * 2)));
  const size = (modules + quietModules * 2) * cell;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This computer could not draw the QR code.");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#000000";
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (!code.isDark(row, column)) continue;
      context.fillRect(
        (column + quietModules) * cell,
        (row + quietModules) * cell,
        cell,
        cell
      );
    }
  }
  return canvas.toDataURL("image/png");
}

export function setLocalQrImage(image, text, preferredSize = 900) {
  const dataUrl = qrPngDataUrl(text, preferredSize);
  image.src = dataUrl;
  image.dataset.qrText = String(text || "");
  image.dataset.qrDataUrl = dataUrl;
  return dataUrl;
}

export function downloadLocalQr(text, filename = "Guest-Star-QR.png") {
  const link = document.createElement("a");
  link.href = qrPngDataUrl(text, 1200);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}
