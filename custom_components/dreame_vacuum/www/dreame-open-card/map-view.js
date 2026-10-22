/*
 * <doc-map> — map image with an SVG overlay in image pixel space.
 *
 * Properties
 *   .ctx          Ctx
 *   .src          image URL (defaults to the live map camera picture)
 *   .calibration  calibration_points (defaults to the live map's)
 *   .overlay      (tf, u, [w, h]) => svg`...`   tf = transform, u = image px per CSS px
 *   .dim          dim the image (editors)
 *
 * Events (bubbling): "map-down", "map-move", "map-up"
 *   detail: { x, y } vacuum coords, { mx, my } image coords, data (dataset of the
 *   closest overlay element carrying data-* attributes), event (PointerEvent)
 *   Call `this.capture(ev)` from a map-down handler to keep receiving moves.
 */

import { LitElement, html, svg, css, nothing } from "./core.js";

// Affine transform between vacuum coordinates and map image pixels, solved
// from the three calibration points the camera publishes.
export function buildTransform(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const [p0, p1, p2] = points;
  const v1 = [p1.vacuum.x - p0.vacuum.x, p1.vacuum.y - p0.vacuum.y];
  const v2 = [p2.vacuum.x - p0.vacuum.x, p2.vacuum.y - p0.vacuum.y];
  const m1 = [p1.map.x - p0.map.x, p1.map.y - p0.map.y];
  const m2 = [p2.map.x - p0.map.x, p2.map.y - p0.map.y];
  const det = v1[0] * v2[1] - v2[0] * v1[1];
  if (!det) return null;
  const iv = [v2[1] / det, -v2[0] / det, -v1[1] / det, v1[0] / det];
  const a = m1[0] * iv[0] + m2[0] * iv[2];
  const b = m1[0] * iv[1] + m2[0] * iv[3];
  const c = m1[1] * iv[0] + m2[1] * iv[2];
  const d = m1[1] * iv[1] + m2[1] * iv[3];
  const tx = p0.map.x - (a * p0.vacuum.x + b * p0.vacuum.y);
  const ty = p0.map.y - (c * p0.vacuum.x + d * p0.vacuum.y);
  const adet = a * d - b * c;
  if (!adet) return null;
  return {
    toMap: (x, y) => [a * x + b * y + tx, c * x + d * y + ty],
    toVacuum: (mx, my) => {
      const px = mx - tx;
      const py = my - ty;
      return [Math.round((d * px - b * py) / adet), Math.round((-c * px + a * py) / adet)];
    },
    /** vacuum mm -> image px scale factor (for sizes such as a 1.5 m spot square) */
    scale: Math.sqrt(Math.abs(adet)),
  };
}

/** Normalize a rectangle to [minX, minY, maxX, maxY, ...rest]. */
export function normRect([x0, y0, x1, y1, ...rest]) {
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), ...rest];
}

/** Corners of [x0, y0, x1, y1, angle] in vacuum coords, rotated like the integration's Area.to_img. */
export function areaCorners([x0, y0, x1, y1, angle]) {
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  if (!angle) return pts;
  const t = (-angle * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [dx * c + dy * s + cx, -dx * s + dy * c + cy];
  });
}

/** svg points attribute for a list of vacuum-coordinate points. */
export const polyPoints = (tf, pts) => pts.map(([x, y]) => tf.toMap(x, y).map((n) => n.toFixed(1)).join(",")).join(" ");

class DocMap extends LitElement {
  static properties = {
    ctx: { attribute: false },
    src: {},
    calibration: { attribute: false },
    overlay: { attribute: false },
    dim: { type: Boolean },
    _size: { state: true },
    _cssWidth: { state: true },
  };

  static styles = css`
    :host {
      display: block;
      position: relative;
      line-height: 0;
      background: var(--secondary-background-color);
      overflow: hidden;
    }
    img {
      width: 100%;
      height: auto;
      display: block;
      user-select: none;
      -webkit-user-drag: none;
      transition: opacity 0.2s;
    }
    :host([dim]) img {
      opacity: 0.55;
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      touch-action: none;
    }
    .empty {
      line-height: 1.4;
      padding: 32px 16px;
      text-align: center;
      color: var(--secondary-text-color);
    }
  `;

  constructor() {
    super();
    this._size = null;
    this._cssWidth = 0;
    this._ro = new ResizeObserver(([entry]) => (this._cssWidth = entry.contentRect.width));
  }
  connectedCallback() {
    super.connectedCallback();
    this._ro.observe(this);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._ro.disconnect();
  }

  get transform() {
    const pts = this.calibration ?? this.ctx?.mapAttrs.calibration_points;
    const sig = JSON.stringify(pts);
    if (sig !== this._calSig) {
      this._calSig = sig;
      this._tf = buildTransform(pts);
    }
    return this._tf;
  }

  render() {
    const src = this.src ?? this.ctx?.url(this.ctx?.mapAttrs.entity_picture);
    if (!src) return html`<div class="empty">No map available</div>`;
    const [w, h] = this._size || [1000, 1000];
    const tf = this.transform;
    // image px per CSS px, so overlay handles stay finger sized at any width
    const u = w / (this._cssWidth || 400);
    return html`
      <img src=${src} alt="" draggable="false" @load=${this._loaded} />
      <svg
        viewBox="0 0 ${w} ${h}"
        preserveAspectRatio="none"
        @pointerdown=${(e) => this._emit("map-down", e)}
        @pointermove=${(e) => this._emit("map-move", e)}
        @pointerup=${(e) => this._emit("map-up", e)}
        @pointercancel=${(e) => this._emit("map-up", e)}
      >
        ${tf && this._size && this.overlay ? this.overlay(tf, u, [w, h]) : nothing}
      </svg>
    `;
  }

  _loaded(e) {
    const img = e.target;
    const size = [img.naturalWidth, img.naturalHeight];
    if (!this._size || size[0] !== this._size[0] || size[1] !== this._size[1]) this._size = size;
  }

  /** Keep receiving pointer moves for this pointer (call from map-down). */
  capture(ev) {
    this.renderRoot.querySelector("svg")?.setPointerCapture(ev.pointerId);
  }

  _emit(type, ev) {
    const tf = this.transform;
    if (!tf || !this._size) return;
    if (type === "map-down" && ev.button > 0) return;
    const svgEl = this.renderRoot.querySelector("svg");
    const pt = svgEl.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    const [x, y] = tf.toVacuum(p.x, p.y);
    const el = ev.target.closest?.("[data-kind]");
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { x, y, mx: p.x, my: p.y, data: el ? { ...el.dataset } : null, event: ev, map: this },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.get("doc-map") || customElements.define("doc-map", DocMap);
export { svg };
