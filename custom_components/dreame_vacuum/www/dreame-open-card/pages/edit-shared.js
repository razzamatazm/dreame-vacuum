/*
 * Helpers shared by the saved-map editor and the object editor.
 *
 * All geometry is in integer vacuum coordinates (mm) unless a name says
 * otherwise. Camera attribute shapes come from dreame/types.py
 * (Line.as_dict, Area.as_dict, Furniture.as_dict, Segment.as_dict).
 */

import { css, svg, nothing } from "../core.js";
import { unsafeSVG } from "../vendor/lit.js";
import { areaCorners, polyPoints } from "../map-view.js";

// Minimum size (mm) for a drawn rect or line; smaller gestures count as taps.
export const MIN_SHAPE_MM = 150;
// After a save, keep showing the local draft this long while the map catches up.
export const SAVE_SETTLE_MS = 20000;

const r = Math.round;

/** Line.as_dict -> [x0, y0, x1, y1] */
export const parseLine = (w) => [w.x0, w.y0, w.x1, w.y1].map(r);

/** Area.as_dict (4 corners + angle) -> [minX, minY, maxX, maxY, angle] */
export const parseArea = (a) =>
  [Math.min(a.x0, a.x2), Math.min(a.y0, a.y2), Math.max(a.x0, a.x2), Math.max(a.y0, a.y2), a.angle || 0].map(r);

/** Camera attributes -> restricted-zone draft (ported from the single-file card). */
export function restrictionsFromAttributes(attrs = {}) {
  return {
    wall: (attrs.virtual_walls || []).map(parseLine),
    nogo: (attrs.no_go_areas || []).map(parseArea),
    nomop: (attrs.no_mopping_areas || []).map(parseArea),
  };
}

/**
 * A rect list for a service whose schema is vol.Any(list of 4-tuples, list of
 * 5-tuples): every element must have the same length, so send angles only when
 * at least one rect has one.
 */
export const uniformAreas = (list) =>
  list.some((a) => a[4]) ? list.map((a) => [...a.slice(0, 4), a[4] || 0]) : list.map((a) => a.slice(0, 4));

/** Draft -> vacuum_set_restricted_zone data. The service replaces all three lists at once. */
export function restrictionsPayload(draft) {
  return { walls: draft.wall.map((w) => w.slice(0, 4)), zones: uniformAreas(draft.nogo), no_mops: uniformAreas(draft.nomop) };
}

/** Rect [x0,y0,x1,y1] centered on c with size [w,h] mm. */
export const rectAt = ([cx, cy], w, h = w) => [r(cx - w / 2), r(cy - h / 2), r(cx + w / 2), r(cy + h / 2), 0];
/** Horizontal line centered on c. */
export const lineAt = ([cx, cy], len) => [r(cx - len / 2), r(cy), r(cx + len / 2), r(cy)];

export const tooSmallRect = (g) => Math.abs(g[2] - g[0]) < MIN_SHAPE_MM || Math.abs(g[3] - g[1]) < MIN_SHAPE_MM;
export const tooShortLine = (g) => Math.hypot(g[2] - g[0], g[3] - g[1]) < MIN_SHAPE_MM;

/** Room bounding box [x0,y0,x1,y1] from Segment.as_dict, or null. */
export function roomBox(room) {
  if (room?.x0 == null || room?.x1 == null) return null;
  return [Math.min(room.x0, room.x1), Math.min(room.y0, room.y1), Math.max(room.x0, room.x1), Math.max(room.y0, room.y1)];
}
const inBox = (b, x, y, pad = 0) => b && x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;

/** Smallest room whose bounding box contains the point (rooms overlap at L shapes). */
export function roomAt(rooms, x, y) {
  let best = null;
  let bestArea = Infinity;
  for (const room of rooms) {
    const b = roomBox(room);
    if (!inBox(b, x, y)) continue;
    const area = (b[2] - b[0]) * (b[3] - b[1]);
    if (area < bestArea) {
      best = room;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Neighbor test from bounding boxes. Rooms that share a border always have
 * touching boxes, so this never excludes a true neighbor; the robot rejects
 * the rare false positive. Segment.neighbors is not exposed in attributes.
 */
export function maybeNeighbors(a, b, tol = 250) {
  const p = roomBox(a);
  const q = roomBox(b);
  if (!p || !q) return true;
  return p[0] <= q[2] + tol && q[0] <= p[2] + tol && p[1] <= q[3] + tol && q[1] <= p[3] + tol;
}

/** True if the segment [x0,y0,x1,y1] crosses the box with both ends outside it. */
export function lineCrossesBox(line, box) {
  if (!box) return false;
  const [x0, y0, x1, y1] = line;
  if (inBox(box, x0, y0) || inBox(box, x1, y1)) return false;
  // Liang-Barsky clip
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const edges = [
    [-dx, x0 - box[0]],
    [dx, box[2] - x0],
    [-dy, y0 - box[1]],
    [dy, box[3] - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Handle at image point (mx, my): a small visible dot over a finger-sized hit area. */
export const handleAt = (u, mx, my, h, extra = "") =>
  svg`<g data-kind="handle" data-h=${h}>
    <circle class="handle-hit" cx=${mx} cy=${my} r=${13 * u}></circle>
    <circle class="handle ${extra}" cx=${mx} cy=${my} r=${5 * u}></circle>
  </g>`;

/** Handle at vacuum point (x, y). */
export const handle = (tf, u, x, y, h, extra = "") => handleAt(u, ...tf.toMap(x, y), h, extra);

/** Rect polygon (rotated like Area.to_img). */
export const rectShape = (tf, g, cls, data = {}) =>
  svg`<polygon class=${cls} data-kind=${data.kind || nothing} data-layer=${data.layer ?? nothing} data-index=${data.index ?? nothing}
    points=${polyPoints(tf, areaCorners(g))}></polygon>`;

/** Ellipse inscribed in an axis-aligned rect. */
export const ellipseShape = (tf, g, cls, data = {}) => {
  const [ax, ay] = tf.toMap(g[0], g[1]);
  const [bx, by] = tf.toMap(g[2], g[3]);
  return svg`<ellipse class=${cls} data-kind=${data.kind || nothing} data-layer=${data.layer ?? nothing} data-index=${data.index ?? nothing}
    cx=${(ax + bx) / 2} cy=${(ay + by) / 2} rx=${Math.abs(bx - ax) / 2} ry=${Math.abs(by - ay) / 2}></ellipse>`;
};

/** Line with a fat transparent hit area. */
export const lineShape = (tf, u, g, cls, data = {}) => {
  const [a, b] = [tf.toMap(g[0], g[1]), tf.toMap(g[2], g[3])];
  return svg`<g class=${cls} data-kind=${data.kind || nothing} data-layer=${data.layer ?? nothing} data-index=${data.index ?? nothing}>
    <line class="hit" x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]} stroke-width=${18 * u}></line>
    <line class="shape" x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]}></line></g>`;
};

/** Overlay styles shared by both editors (put inside the page's static styles). */
export const editStyles = css`
  doc-map {
    cursor: crosshair;
  }
  .hint {
    padding: 6px 16px 0;
    color: var(--doc-muted);
    font-size: 0.85em;
    line-height: 1.3;
    min-height: 1.3em;
  }
  .note {
    margin: 8px 16px;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--doc-surface-2);
    font-size: 0.85em;
    line-height: 1.35;
  }
  .note.warn {
    color: var(--doc-warn);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 16px;
    align-items: center;
  }
  .bar .dirty {
    font-size: 0.85em;
    color: var(--doc-muted);
  }
  .count {
    opacity: 0.7;
    font-size: 0.85em;
  }
  .options {
    display: flex;
    flex-direction: column;
  }
  .options button {
    border: none;
    border-radius: 0;
    justify-content: flex-start;
    padding: 10px 16px;
    text-align: left;
  }
  .options button.active {
    color: var(--text-primary-color, #fff);
  }
  .sheet-row {
    display: flex;
    gap: 8px;
    padding: 8px 16px;
    flex-wrap: wrap;
  }
`;

// Overlay styles. The overlay renders inside <doc-map>'s shadow root, so page
// styles cannot reach it; every overlay emits this <style> element itself.
const OVERLAY_CSS = `
  svg * {
    vector-effect: non-scaling-stroke;
  }
  .hit {
    stroke: transparent;
  }
  .item {
    cursor: move;
  }
  .item .shape,
  line.shape {
    stroke-width: 4;
    stroke-linecap: round;
  }
  .wall .shape {
    stroke: #e53935;
  }
  .curtain .shape {
    stroke: #8e24aa;
    stroke-dasharray: 10 5;
  }
  .passable .shape,
  .vthreshold .shape {
    stroke: #43a047;
  }
  .impassable .shape {
    stroke: #f4511e;
  }
  polygon.nogo {
    fill: rgba(229, 57, 53, 0.3);
    stroke: #e53935;
    stroke-width: 2;
  }
  polygon.nomop {
    fill: rgba(126, 87, 194, 0.3);
    stroke: #7e57c2;
    stroke-width: 2;
  }
  .carpet {
    fill: rgba(121, 85, 72, 0.35);
    stroke: #6d4c41;
    stroke-width: 2;
  }
  .detected {
    fill: rgba(121, 85, 72, 0.18);
    stroke: #8d6e63;
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
    cursor: pointer;
  }
  .deleted {
    fill: rgba(229, 57, 53, 0.35);
    stroke: #e53935;
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }
  .ramp {
    fill: rgba(0, 137, 123, 0.3);
    stroke: #00897b;
    stroke-width: 2;
  }
  .lowlying {
    fill: rgba(255, 179, 0, 0.3);
    stroke: #ffb300;
    stroke-width: 2;
  }
  .furn rect {
    fill: rgba(96, 125, 139, 0.35);
    stroke: #455a64;
    stroke-width: 2;
  }
  .furn text,
  .room text {
    fill: #fff;
    text-anchor: middle;
    pointer-events: none;
    paint-order: stroke;
    stroke: rgba(0, 0, 0, 0.6);
    stroke-width: 3px;
    vector-effect: none;
  }
  .point circle {
    fill: var(--doc-accent);
    stroke: #fff;
    stroke-width: 2;
  }
  .point text {
    fill: #fff;
    text-anchor: middle;
    pointer-events: none;
  }
  .sel polygon,
  polygon.sel,
  ellipse.sel,
  .sel rect,
  .sel circle {
    stroke: var(--doc-accent);
    stroke-width: 3;
  }
  .sel .shape {
    stroke: var(--doc-accent);
  }
  .handle {
    fill: #fff;
    stroke: var(--doc-accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .handle-hit {
    fill: transparent;
    cursor: grab;
  }
  .handle.rot {
    fill: var(--doc-accent);
  }
  .room {
    cursor: pointer;
  }
  .room circle {
    fill: rgba(0, 0, 0, 0.45);
    stroke: #fff;
    stroke-width: 2;
  }
  .room.sel circle {
    fill: var(--doc-accent);
  }
  .room.off {
    opacity: 0.45;
  }
  .room.disabled {
    cursor: not-allowed;
  }
  .room-box {
    fill: none;
    stroke: none;
  }
  .room-box.sel {
    fill: rgba(3, 169, 244, 0.18);
    stroke: var(--doc-accent);
    stroke-width: 2;
  }
  .room-box.off {
    fill: rgba(60, 60, 60, 0.45);
  }
  .room-box.blocked {
    fill: rgba(255, 255, 255, 0.55);
  }
  line.split {
    stroke: var(--doc-accent);
    stroke-width: 4;
    stroke-dasharray: 8 6;
  }
  line.split.ok {
    stroke-dasharray: none;
  }
  .mwall .shape {
    stroke: #37474f;
    stroke-width: 5;
  }
  .door .shape {
    stroke: #ff9800;
    stroke-width: 6;
  }
  .mwall.passive,
  .door.passive {
    opacity: 0.45;
    pointer-events: none;
  }
`;
export const overlayStyle = unsafeSVG(`<style>${OVERLAY_CSS}</style>`);

/**
 * Camera attributes overlaid with the richer ctx.mapData() payload (map.py get_data
 * ~8600-8860), converted to the attribute dict shapes. In mapData a null list
 * means "not supported on this map" (the device raises NotSupported for it),
 * which has() checks rely on. Adds __md: true and furniture_version.
 */
export function mergeMapData(attrs, md) {
  if (!md) return attrs;
  const line = (l) => ({ x0: l[0], y0: l[1], x1: l[2], y1: l[3] });
  const area = (a, angle = true) => ({ x0: a[0], y0: a[1], x1: a[2], y1: a[3], x2: a[4], y2: a[5], x3: a[6], y3: a[7], angle: angle ? a[8] ?? null : null });
  const list = (k, fn) => (md[k] == null ? null : md[k].map(fn));
  // [x0..y3, id, ellipse, carpet_cleaning, carpet_preferences, carpet_type, hidden, tassel]
  const carpet = (a) => ({ ...area(a, false), id: a[8] ?? null, ellipse: !!a[9], carpet_type: a[12] ?? null });
  return {
    ...attrs,
    __md: true,
    virtual_walls: (md.virtual_walls || []).map(line),
    no_go_areas: (md.no_go || []).map((a) => area(a)),
    no_mopping_areas: (md.no_mop || []).map((a) => area(a)),
    passable_thresholds: list("passable_thresholds", line),
    impassable_thresholds: list("impassable_thresholds", line),
    virtual_thresholds: list("virtual_thresholds", line),
    ramps: list("ramps", (a) => area(a)),
    curtains: list("curtains", line),
    low_lying_areas: list("low_lying_areas", (a) => area(a, false)),
    predefined_points: list("predefined_points", ([x, y]) => ({ x, y })),
    carpets: list("carpets", carpet),
    deleted_carpets: list("deleted_carpets", carpet),
    detected_carpets: list("detected_carpets", carpet),
    // [x, y, width, height, type, edit_type, angle, scale, segment_id, furniture_id]
    furnitures: list("furnitures", (f) => ({
      x: f[0], y: f[1], width: f[2], height: f[3], type: f[4], edit_type: f[5], angle: f[6], scale: f[7], room_id: f[8], furniture_id: f[9],
    })),
    furniture_version: md.furniture_version,
  };
}
