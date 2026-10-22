// Serves a canned ctx.mapData() payload shaped like dreame/map.py
// DreameVacuumMapRenderer.get_data for every camera_map_data_proxy URL.
// The camera entity_picture gets a token (ctx.mapData needs one) and hassUrl
// maps that fake path back to the original image.
// node dev/harness/shot.mjs saved-map-edit --fixture edit-mapdata,edit-helpers --params '{"mapIndex":1}'
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const area = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
const ROOMS = {
  // id: [x0, y0, x1, y1, type, index, custom, neighbors, floor_material, direction, visibility]
  1: [-4000, -2000, 0, 2000, 1, 0, null, [2, 3], 1, 90, 1],
  2: [0, 0, 3000, 2000, 4, 0, null, [1, 3, 4], 2, null, 1],
  3: [0, -2000, 3000, 0, 2, 0, "Guest", [1, 2, 4], 1, 0, 1],
  4: [3000, -2000, 4500, 2000, 8, 0, null, [2, 3], 0, null, 1],
};
export function mapData() {
  const segments = Object.entries(ROOMS).map(([id, r]) => {
    const row = new Array(26).fill(null);
    Object.assign(row, {
      0: Number(id), 1: (r[0] + r[2]) / 2, 2: (r[1] + r[3]) / 2, 3: r[4], 4: r[6] ? b64(r[6]) : null, 5: r[5], 6: Number(id) - 1,
      7: r[7], 8: r[8], 9: r[9], 10: r[10], 11: false, 20: r.slice(0, 4),
    });
    return row;
  });
  const walls = {};
  for (const [id, [x0, y0, x1, y1]] of Object.entries(ROOMS)) {
    walls[id] = [
      [x0, y1, x1, y1], [x1, y0, x1, y1], [x0, y0, x1, y0], [x0, y0, x0, y1],
    ].map((l, i) => [...l, ...l, i % 2 ? 2 : 1, (l[0] + l[2]) / 2, (l[1] + l[3]) / 2]);
  }
  return {
    version: 2, saved_map: true, map_index: 1, size: [0, 0, 0, 0, 200, 160, 50, 0, [0, 0, 0, 0]],
    segments, walls,
    doors: [[0, 800, 0, 1600, 0, 800, 0, 1600, 1, 7, 1], [1200, 0, 2000, 0, 1200, 0, 2000, 0, 1, 8, 1]],
    virtual_walls: [[-3800, 1500, -2500, 1500]],
    no_go: [[...area(500, 500, 1500, 1500), null]],
    no_mop: [[...area(-3500, -500, -2000, 500), 0, 0]],
    carpets: [[...area(-3000, 600, -1500, 1600), 3, 1, 1, null, 5, 0, null], [...area(-1200, -1500, -300, -700), 4, 0, 2, null, 6, 0, null]],
    deleted_carpets: [[...area(2400, -1800, 2900, -1200), 9]],
    detected_carpets: [[...area(500, -1700, 2200, -600), 1, 0, 1, null, 7, 0, null, [], [3], null]],
    passable_thresholds: [[0, 300, 0, 1100]], impassable_thresholds: [[3000, -1500, 3000, -700]],
    ramps: [[...area(3200, 200, 4200, 800), 0]], virtual_thresholds: null,
    curtains: [[3100, 1900, 4400, 1900]],
    low_lying_areas: [[...area(-3800, -1800, -2600, -1000), 1, null, 0, 0, null, 96]],
    predefined_points: [[2000, 1000], [-2000, -1000]],
    furnitures: [[1500, -1000, 1600, 2000, 2, 1, 0, 1.0, 3, 1], [-2000, 1200, 2000, 900, 5, 0, 30, 1.0, 1, 2]],
    furniture_version: 2,
    charger_position: [1500, 800, 90],
  };
}
export function apply(hass) {
  const pics = {};
  for (const s of Object.values(hass.states)) {
    if (!s.entity_id.startsWith("camera.") || !s.attributes.entity_picture?.startsWith("data:")) continue;
    const fake = `/api/camera_proxy/${s.entity_id}?token=tok123`;
    pics[fake] = s.attributes.entity_picture;
    s.attributes.entity_picture = fake;
  }
  const hassUrl = hass.hassUrl;
  hass.hassUrl = (p) => pics[p] || hassUrl(p);
  const fetchWithAuth = hass.fetchWithAuth;
  hass.fetchWithAuth = async (url, init) => {
    if (String(url).includes("camera_map_data_proxy")) return new Response(JSON.stringify(mapData()), { status: 200 });
    return fetchWithAuth(url, init);
  };
}
