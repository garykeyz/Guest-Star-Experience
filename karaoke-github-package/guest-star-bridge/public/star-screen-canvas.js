export const STAR_SCREEN_CANVAS_WIDTH = 1920;
export const STAR_SCREEN_CANVAS_HEIGHT = 1080;

export function starScreenContainLayout(viewportWidth, viewportHeight) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const scale = Math.min(width / STAR_SCREEN_CANVAS_WIDTH, height / STAR_SCREEN_CANVAS_HEIGHT);
  return {
    scale,
    renderedWidth: STAR_SCREEN_CANVAS_WIDTH * scale,
    renderedHeight: STAR_SCREEN_CANVAS_HEIGHT * scale,
    letterboxX: Math.max(0, (width - STAR_SCREEN_CANVAS_WIDTH * scale) / 2),
    letterboxY: Math.max(0, (height - STAR_SCREEN_CANVAS_HEIGHT * scale) / 2)
  };
}

export function installStarScreenCanvas(canvas, targetWindow = window) {
  if (!canvas) return { update() {}, destroy() {} };
  const update = () => {
    const layout = starScreenContainLayout(targetWindow.innerWidth, targetWindow.innerHeight);
    canvas.style.setProperty('--star-screen-scale', String(layout.scale));
    canvas.dataset.renderedWidth = String(layout.renderedWidth);
    canvas.dataset.renderedHeight = String(layout.renderedHeight);
  };
  targetWindow.addEventListener('resize', update, { passive: true });
  update();
  return {
    update,
    destroy() { targetWindow.removeEventListener('resize', update); }
  };
}
