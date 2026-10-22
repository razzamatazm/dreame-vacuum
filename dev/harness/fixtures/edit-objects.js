// Object editor fixture: realistic camera attribute shapes (types.py as_dict),
// i.e. carpets without id/ellipse, plus thresholds, ramps, detected carpets,
// deleted carpets and low-lying areas.
// node dev/harness/shot.mjs object-edit --fixture edit-objects --params '{"mode":"carpets"}'
const area = (x0, y0, x1, y1, angle = null) => ({ x0, y0, x1: x1, y1: y0, x2: x1, y2: y1, x3: x0, y3: y1, angle });
export function apply(hass) {
  const cam = Object.values(hass.states).find((s) => s.entity_id.startsWith("camera."));
  Object.assign(cam.attributes, {
    carpets: [area(-3000, 600, -1500, 1600)],
    detected_carpets: [area(500, -1700, 2200, -600)],
    deleted_carpets: [area(2400, -1800, 2900, -1200)],
    passable_thresholds: [{ x0: 0, y0: 300, x1: 0, y1: 1100 }],
    impassable_thresholds: [{ x0: 3000, y0: -1500, x1: 3000, y1: -700 }],
    ramps: [area(3200, 200, 4200, 800, 0)],
    low_lying_areas: [area(-3800, -1800, -2600, -1000)],
    furnitures: [
      { x: 1500, y: -1000, x0: 700, y0: -2000, width: 1600, height: 2000, type: "Double bed", room_id: 3, furniture_id: 1, angle: 0, scale: 1.0 },
      { x: -2000, y: 1200, x0: -3000, y0: 800, width: 2000, height: 900, type: "Three-Seat Sofa", room_id: 1, furniture_id: 2, angle: 30, scale: 1.0 },
    ],
    predefined_points: [{ x: 2000, y: 1000, type: 1, completed: false }, { x: -2000, y: -1000, type: 1, completed: false }],
  });
}
