/**
 * Shared plumbing for the two draggable 2D panels.
 *
 * Both the hand rectangle and the wrist chart are the same kind of thing: a
 * linear map from some 2D model space to canvas pixels, plus pointer capture and
 * a drag. Only what they draw and what the axes MEAN differ, so everything else
 * lives here.
 *
 * Two details are load-bearing rather than incidental:
 *
 *   - The canvas is measured by its OWN box, never its parent's. Flex decides the
 *     height, and if the CSS size and the backing store disagree then pointer
 *     coordinates and drawn coordinates drift apart -- a drag that lands
 *     visibly off the cursor.
 *   - `flip` mirrors the horizontal axis with handedness, so both panels are
 *     drawn from the golfer's own point of view rather than face-on to them.
 */

const MARGIN = 38;

export class Canvas2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hover = null;
    this.viewport = { scale: 1, ox: 0, oy: 0, flip: 1 };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  /**
   * Fit a model-space box to the canvas, anchored on the box's centre so the
   * handedness flip is exact for any bounds, with screen y inverted so the
   * vertical model axis points up.
   */
  fitBox({ xMin, xMax, yMin, yMax }, flip, margin = MARGIN) {
    const scale = Math.min(
      (this.w - 2 * margin) / (xMax - xMin),
      (this.h - 2 * margin) / (yMax - yMin),
    );
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;
    this.viewport = {
      scale,
      flip,
      ox: this.w / 2 - flip * cx * scale,
      oy: this.h / 2 + cy * scale,
    };
  }

  toPx(x, y) {
    const { scale, ox, oy, flip } = this.viewport;
    return { x: ox + flip * x * scale, y: oy - y * scale };
  }

  fromPx(px, py) {
    const { scale, ox, oy, flip } = this.viewport;
    return { x: (flip * (px - ox)) / scale, y: (oy - py) / scale };
  }

  pointerToCanvas(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * @param handlers.onDown  (x, y, event) -> truthy to begin a drag
   * @param handlers.onDrag  (x, y) while dragging
   * @param handlers.onUp    called once when the drag ends
   * @param handlers.onHover (x, y) when not dragging
   */
  bindPointer({ onDown, onDrag, onUp, onHover }) {
    let dragging = false;

    this.canvas.addEventListener('pointerdown', (event) => {
      const { x, y } = this.pointerToCanvas(event);
      if (onDown(x, y, event) === false) return;
      dragging = true;
      this.canvas.setPointerCapture(event.pointerId);
      onDrag(x, y);
    });

    this.canvas.addEventListener('pointermove', (event) => {
      const { x, y } = this.pointerToCanvas(event);
      if (dragging) onDrag(x, y);
      else onHover?.(x, y);
    });

    const end = (event) => {
      if (dragging) {
        dragging = false;
        onUp?.();
      }
      if (this.canvas.hasPointerCapture?.(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
    });
  }

  /** Set the cursor without touching the DOM on every mouse move. */
  setCursor(cursor) {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  label(text, x, y, { align = 'center', color = 'rgba(255,255,255,0.45)', font = '11px ui-monospace, monospace' } = {}) {
    const ctx = this.ctx;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }
}
