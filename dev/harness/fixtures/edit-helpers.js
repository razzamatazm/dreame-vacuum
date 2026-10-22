// Pointer helpers for editor screenshots (no state changes).
//   window.__docMap()                 -> the visible <doc-map>
//   window.__drag([[x,y], ...])       -> pointerdown/move/up through vacuum coords (mm)
//   window.__tap(x, y)
function deep(root, sel) {
  const hit = root.querySelector(sel);
  if (hit) return hit;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const r = deep(el.shadowRoot, sel);
      if (r) return r;
    }
  }
  return null;
}
export function apply() {
  window.__deep = (sel) => deep(document, sel);
  window.__docMap = () => deep(document, "doc-map");
  const client = (map, x, y) => {
    const svg = map.shadowRoot.querySelector("svg");
    const tf = map.transform;
    const [mx, my] = tf.toMap(x, y);
    const pt = svg.createSVGPoint();
    pt.x = mx;
    pt.y = my;
    const p = pt.matrixTransform(svg.getScreenCTM());
    return [p.x, p.y];
  };
  window.__drag = (pts) => {
    const map = window.__docMap();
    const svg = map.shadowRoot.querySelector("svg");
    const fire = (type, [x, y]) => {
      const [cx, cy] = client(map, x, y);
      const target = map.shadowRoot.elementFromPoint(cx, cy) || svg;
      (type === "pointerdown" ? target : svg).dispatchEvent(
        new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, composed: true, pointerId: 1, button: 0, isPrimary: true })
      );
    };
    fire("pointerdown", pts[0]);
    for (const p of pts.slice(1)) fire("pointermove", p);
    fire("pointerup", pts[pts.length - 1]);
  };
  window.__tap = (x, y) => window.__drag([[x, y]]);
}
