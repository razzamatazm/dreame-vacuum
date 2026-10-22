// Saved-map and wifi-map cameras as camera.py creates them (unique_id <mac>_map_<index>, <mac>_wifi_map_<index>).
// node dev/harness/shot.mjs maps --fixture maps-cameras
export function apply(hass) {
  const live = hass.states["camera.dreame_l10s_map"].attributes;
  const dev = "dev-dreame-1";
  const add = (id, tk, attributes) => {
    hass.states[id] = { entity_id: id, state: "idle", attributes, last_updated: new Date().toISOString() };
    hass.entities[id] = { entity_id: id, device_id: dev, platform: "dreame_vacuum", translation_key: tk, entity_category: "config" };
  };
  const tint = (label, color) =>
    `data:image/svg+xml;base64,${btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="${color}"/><text x="40" y="420" font-size="120" fill="#333">${label}</text></svg>`
    )}`;
  add("camera.dreame_l10s_map_1", "saved_map", {
    ...live, entity_picture: live.entity_picture, map_index: 1, selected: true, friendly_name: "Dreame L10s Saved Map Ground Floor",
    cleaning_history_picture: undefined, cruising_history_picture: undefined, obstacle_picture: undefined,
  });
  add("camera.dreame_l10s_map_2", "saved_map", {
    entity_picture: tint("Upstairs", "#e7f0ff"), calibration_points: live.calibration_points, map_index: 2, selected: false,
    friendly_name: "Dreame L10s Saved Map Upstairs",
    recovery_map_picture: { "09/02/26 11:10:00: Map1 (Original)": tint("orig", "#fff3e0") },
    recovery_map_file: { "09/02/26 11:10:00: Map1 (Original)": "#upfile1" },
  });
  // Wifi camera: its own (half resolution) image + calibration, as the low_resolution renderer would produce.
  const wifiSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400"><rect width="500" height="400" fill="#eef0f2"/>
    <rect x="50" y="100" width="200" height="200" fill="#9be59b"/><rect x="250" y="100" width="150" height="100" fill="#f7e27a"/>
    <rect x="250" y="200" width="150" height="100" fill="#f4a3c4"/><rect x="400" y="100" width="75" height="200" fill="#f49a9a"/>
    <text x="10" y="30" font-size="20">wifi camera</text></svg>`;
  add("camera.dreame_l10s_wifi_map_1", "wifi_map", {
    entity_picture: `data:image/svg+xml;base64,${btoa(wifiSvg)}`, map_index: 1, selected: true,
    calibration_points: [
      { vacuum: { x: 0, y: 0 }, map: { x: 250, y: 200 } },
      { vacuum: { x: 1000, y: 0 }, map: { x: 300, y: 200 } },
      { vacuum: { x: 0, y: 1000 }, map: { x: 250, y: 150 } },
    ],
    rooms: live.rooms, router_position: { x: 4000, y: 1500 }, friendly_name: "Dreame L10s Saved Wifi Map Ground Floor",
  });
}
