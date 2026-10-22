/*
 * Mock Home Assistant for developing Dreame Open Card without a live instance.
 * Entity keys and attribute shapes mirror custom_components/dreame_vacuum;
 * select options and UI strings come from its translations/en.json.
 *
 * window.__calls records every callService for assertions.
 */

const DEV = "dreame_l10s";
const DEVICE_ID = "dev-dreame-1";
const TRANSLATIONS_URL = "/custom_components/dreame_vacuum/translations/en.json";

const SWITCHES = `ai_obstacle_detection ai_pet_detection ai_obstacle_picture auto_add_detergent auto_change_mop auto_drying auto_dust_collecting
auto_mount_mop carpet_avoidance carpet_boost carpet_recognition child_lock clean_carpets_first cleaning_sequence collision_avoidance
customized_cleaning dnd dnd_disable_auto_empty dnd_disable_resume_cleaning dnd_reduce_volume dust_bag_drying fill_light floor_direction_cleaning
gap_cleaning_extension hot_washing intelligent_recognition intensive_carpet_cleaning large_particles_boost map_saving
mopping_under_furnitures multi_floor_map obstacle_avoidance off_peak_charging pet_focused_cleaning resume_cleaning
self_clean silent_drying smart_mop_washing stain_avoidance streaming_voice_prompt tight_mopping uv_sterilization voice_assistant`.split(/\s+/);
const SELECTS = `auto_empty_frequency auto_empty_mode auto_recleaning auto_rewashing battery_charge_level carpet_cleaning carpet_sensitivity
cleangenius cleangenius_mode cleaning_mode cleaning_route drying_time map_rotation mop_clean_frequency mop_pad_humidity mop_pressure
mop_temperature mop_wash_level mopping_type selected_map self_clean_frequency suction_level voice_assistant_language washing_mode
water_temperature water_volume wider_corner_coverage`.split(/\s+/);
const NUMBERS = { volume: [0, 100, 1, 70, "%"], self_clean_area: [10, 35, 1, 20, "m²"], self_clean_time: [10, 50, 1, 25, "min"], camera_light_brightness: [40, 100, 1, 80, "%"] };
const TIMES = { dnd_start: "22:00:00", dnd_end: "08:00:00", off_peak_charging_start: "22:00:00", off_peak_charging_end: "08:00:00" };
const BUTTONS = `backup_saved_map base_station_cleaning base_station_self_repair clear_warning empty_water_tank manual_drying
reload_shortcuts reset_detergent reset_filter reset_main_brush reset_mop_pad reset_sensor reset_side_brush reset_silver_ion
self_clean start_auto_empty start_fast_mapping start_mapping start_recleaning water_tank_draining`.split(/\s+/);
const CONSUMABLES = { main_brush: [72, 216], side_brush: [18, 36], filter: [45, 67], sensor_dirty: [90, 27], mop_pad: [60, 48], silver_ion: [80, 292], detergent: [25, 4] };
const SENSORS = {
  state: "charging_completed", status: "sleeping", task_status: "completed", cleaned_area: 42, cleaning_time: 51, cleaning_progress: 100,
  battery_level: 96, charging_status: "charging_completed", error: "no_error", total_cleaned_area: 3421, total_cleaning_time: 9876, cleaning_count: 214,
  first_cleaning_date: "2024-03-01", clean_water_tank_status: "installed", dirty_water_tank_status: "installed", dust_bag_status: "installed",
  detergent_status: "installed", self_wash_base_status: "idle", auto_empty_status: "idle", drying_progress: 0, task_type: "standard",
  current_room: "Kitchen", firmware_version: "4.3.9_1279", water_tank: "installed", mop_pad: "installed", low_water_warning: "no_warning",
};
const UNITS = { cleaned_area: "m²", total_cleaned_area: "m²", cleaning_time: "min", total_cleaning_time: "min", battery_level: "%", cleaning_progress: "%", drying_progress: "%" };
const ROOM_SELECTS = ["suction_level", "water_volume", "cleaning_mode", "cleaning_times", "cleaning_route", "mop_pad_humidity", "order", "floor_material", "floor_material_direction", "visibility", "name", "mop_type"];

// Rooms in vacuum mm; image is 1000x800, 0.1 px/mm, origin at (500,400), y up.
const ROOMS = {
  1: { name: "Living Room", type: 1, x0: -4000, y0: -2000, x1: 0, y1: 2000, floor_material: "Wood", icon: "mdi:sofa" },
  2: { name: "Kitchen", type: 4, x0: 0, y0: 0, x1: 3000, y1: 2000, floor_material: "Tile", icon: "mdi:silverware-fork-knife" },
  3: { name: "Bedroom", type: 2, x0: 0, y0: -2000, x1: 3000, y1: 0, floor_material: "Wood", icon: "mdi:bed" },
  4: { name: "Hall", type: 8, x0: 3000, y0: -2000, x1: 4500, y1: 2000, floor_material: "None", icon: "mdi:door" },
};
const COLORS = ["#7fb2ff", "#ffc36b", "#9be59b", "#f4a3c4"];
const toImg = (x, y) => [500 + x * 0.1, 400 - y * 0.1];

function mapSvg(variant = "") {
  const rects = Object.entries(ROOMS)
    .map(([id, r], i) => {
      const [ax, ay] = toImg(r.x0, r.y1);
      const [bx, by] = toImg(r.x1, r.y0);
      return `<rect x="${ax}" y="${ay}" width="${bx - ax}" height="${by - ay}" fill="${COLORS[i]}" stroke="#555" stroke-width="3"/>`;
    })
    .join("");
  const [cx, cy] = toImg(-3500, -1600);
  const [rx, ry] = toImg(1500, 800);
  const tint = variant === "wifi" ? `<rect width="1000" height="800" fill="rgba(0,200,0,0.15)"/>` : "";
  const label = variant ? `<text x="20" y="40" font-size="28" fill="#333">${variant}</text>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#eef0f2"/>${rects}${tint}
    <circle cx="${cx}" cy="${cy}" r="14" fill="#333"/><circle cx="${rx}" cy="${ry}" r="12" fill="#fff" stroke="#03a9f4" stroke-width="5"/>${label}</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function cameraAttrs() {
  const rooms = {};
  for (const [id, r] of Object.entries(ROOMS)) {
    rooms[id] = {
      x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, room_id: Number(id), name: r.name, order: Number(id), cleaning_times: 1,
      suction_level: 1, water_volume: 2, type: r.type, index: Number(id) - 1, icon: r.icon, color_index: Number(id) - 1,
      floor_material: r.floor_material, visibility: "Visible", x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2,
    };
  }
  const history = {};
  const cruising = {};
  for (let i = 1; i <= 6; i++) {
    history[`${i}: 10/${20 - i} 09:${10 + i} - ${i % 3 ? "Room cleaning" : "Cleaning"} ${i === 2 ? "(Interrupted)" : "(Completed)"}`] = mapSvg(`history ${i}`);
  }
  cruising["1: 10/18 14:02 - Cruising (Completed)"] = mapSvg("cruise 1");
  return {
    entity_picture: mapSvg(),
    calibration_points: [
      { vacuum: { x: 0, y: 0 }, map: { x: 500, y: 400 } },
      { vacuum: { x: 1000, y: 0 }, map: { x: 600, y: 400 } },
      { vacuum: { x: 0, y: 1000 }, map: { x: 500, y: 300 } },
    ],
    rooms,
    charger_position: { x: 1500, y: 800, a: 90 },
    vacuum_position: { x: -3500, y: -1600, a: 0 },
    map_id: 1, saved_map_id: 3, map_name: "Ground Floor", rotation: 0, map_index: 1,
    virtual_walls: [{ x0: -3800, y0: 1500, x1: -2500, y1: 1500 }],
    no_go_areas: [{ x0: 500, y0: 500, x1: 1500, y1: 500, x2: 1500, y2: 1500, x3: 500, y3: 1500, angle: null }],
    no_mopping_areas: [{ x0: -3500, y0: -500, x1: -2000, y1: -500, x2: -2000, y2: 500, x3: -3500, y3: 500, angle: 0 }],
    carpets: [{ x0: -3000, y0: 600, x1: -1500, y1: 600, x2: -1500, y2: 1600, x3: -3000, y3: 1600, angle: null, id: 1, type: 5, carpet_cleaning: 1 }],
    detected_carpets: [],
    deleted_carpets: [],
    passable_thresholds: [], impassable_thresholds: [], ramps: [], virtual_thresholds: [],
    curtains: [{ x0: 3100, y0: 1900, x1: 4400, y1: 1900 }],
    low_lying_areas: [],
    predefined_points: [{ x: 2000, y: 1000 }, { x: -2000, y: -1000 }],
    furnitures: [{ x: 1500, y: -1000, width: 1600, height: 2000, angle: 0, type: "Bed", furniture_id: 1, size_type: 1 }],
    obstacles: {
      1: { x: -1000, y: 300, type: "Sock", possibility: 87, ignore_status: 0, picture_status: 2, segment: "Living Room", segment_id: 1 },
      2: { x: 2200, y: 1500, type: "Pet waste", possibility: 92, ignore_status: 0, picture_status: 2, segment: "Kitchen", segment_id: 2 },
    },
    obstacle_picture: { "2: Sock %87 (Living Room)": mapSvg("sock"), "1: Pet waste %92 (Kitchen)": mapSvg("pet waste") },
    cleaning_history_picture: history,
    cruising_history_picture: cruising,
    recovery_map_picture: { "10/01/26 09:00:00: Map1 (Original)": mapSvg("original"), "10/15/26 18:22:00: Map2 (Backup)": mapSvg("backup"), "10/20/26 07:45:00: Map3 (Edited)": mapSvg("edited") },
    recovery_map_file: { "10/01/26 09:00:00: Map1 (Original)": "#file1", "10/15/26 18:22:00: Map2 (Backup)": "#file2", "10/20/26 07:45:00: Map3 (Edited)": "#file3" },
    wifi_map_picture: mapSvg("wifi"),
    router_position: { x: 4000, y: 1500 },
    active_segments: null, color_scheme: "Dreame Light", friendly_name: "Dreame L10s Map",
  };
}

function vacuumAttrs() {
  return {
    friendly_name: "Dreame L10s", battery_level: 96, battery_icon: "mdi:battery-charging-100", fan_speed: "Standard",
    fan_speed_list: ["Quiet", "Standard", "Strong", "Turbo"], status: "Charging completed", supported_features: 16383,
    battery: 96, charging: false, docked: true, located: true, started: false, paused: false, running: false, returning: false,
    segment_cleaning: false, zone_cleaning: false, spot_cleaning: false, cruising: false, vacuum_state: "charging_completed",
    has_saved_map: true, has_temporary_map: false, has_error: false, faults: {},
    cleaning_sequence: [1, 2, 3, 4], cleangenius_cleaning: false, current_segment: 0,
    selected_map: "Ground Floor", selected_map_id: 3, selected_map_index: 1, map_count: 2,
    maps: [
      { id: 3, date: "2026-10-20T07:45:00", index: 1, name: "Ground Floor", custom_name: "Ground Floor", recovery_map: ["10/01/26 09:00:00: Map1 (Original)", "10/15/26 18:22:00: Map2 (Backup)", "10/20/26 07:45:00: Map3 (Edited)"] },
      { id: 5, date: "2026-09-02T11:10:00", index: 2, name: "Upstairs", custom_name: "Upstairs", recovery_map: ["09/02/26 11:10:00: Map1 (Original)"] },
    ],
    rooms: { "Ground Floor": Object.entries(ROOMS).map(([id, r]) => ({ id: Number(id), name: r.name, icon: r.icon, type: r.type, index: Number(id) - 1 })) },
    schedule: [
      { id: 1, enabled: true, invalid: false, time: "09:30", repeats: "0111110", once: false, map_id: "3", suction_level: 1, water_volume: 2, options: null },
      { id: 2, enabled: false, invalid: false, time: "14:00", repeats: "1000001", once: false, map_id: "3", suction_level: 2, water_volume: 2, options: null },
    ],
    dnd: [{ id: 1, enabled: true, start: "22:00", end: "08:00", repeats: 127, ss: 0 }],
    shortcuts: {
      "32": { id: 32, index: 0, name: "After dinner", map_id: 3, running: false, tasks: [[{ segment_id: 2, suction_level: 2, water_volume: 2, cleaning_times: 1, cleaning_mode: 2 }]] },
      "33": { id: 33, index: 1, name: "Bedroom quick", map_id: 3, running: false, tasks: [[{ segment_id: 3, suction_level: 1, cleaning_times: 1 }]] },
    },
    shortcut_task: false, washing: false, washing_paused: false, drying: false, washing_available: true, drying_available: true,
    draining_available: false, drying_left: 0, dust_collection_available: true, dust_bag_drying_available: true, low_water: false,
    mapping: false, mapping_available: true, startup_method: "App", off_peak_charging: false,
    off_peak_charging_start: "22:00", off_peak_charging_end: "08:00", firmware_version: "4.3.9_1279",
    ap: { ssid: "HomeNet", bssid: "a4:2b:b0:11:22:33", rssi: -52, ip: "192.168.1.84" },
    capabilities: ["lidar_navigation", "multi_floor_map", "ai_detection", "self_wash_base", "auto_empty_base", "customized_cleaning",
      "wifi_map", "backup_map", "dnd_task", "shortcuts", "carpet_recognition", "hot_washing", "off_peak_charging", "floor_material",
      "floor_direction_cleaning", "segment_visibility", "cleaning_route", "auto_change_mop", "camera_streaming", "dust_bag_drying",
      "silent_drying", "carpet_type", "carpet_shape", "curtains", "low_lying_areas", "ramps", "walls", "pet_furniture", "obstacles", "detergent"],
  };
}

export async function createMockHass() {
  const tr = await (await fetch(TRANSLATIONS_URL)).json();
  const states = {};
  const entities = {};
  const add = (domain, key, state, attributes = {}, extra = {}) => {
    const entity_id = `${domain}.${DEV}_${key}`;
    const name = tr.entity?.[domain]?.[extra.translation_key ?? key]?.name || key.replace(/_/g, " ");
    states[entity_id] = {
      entity_id, state: String(state), last_updated: new Date().toISOString(), last_changed: new Date().toISOString(),
      attributes: { friendly_name: `Dreame L10s ${name}`, ...attributes },
    };
    entities[entity_id] = { entity_id, device_id: DEVICE_ID, platform: "dreame_vacuum", translation_key: key, ...extra };
    return entity_id;
  };

  states["vacuum.dreame_l10s"] = { entity_id: "vacuum.dreame_l10s", state: "docked", attributes: vacuumAttrs(), last_updated: new Date().toISOString() };
  entities["vacuum.dreame_l10s"] = { entity_id: "vacuum.dreame_l10s", device_id: DEVICE_ID, platform: "dreame_vacuum", translation_key: null };
  add("camera", "map", "idle", cameraAttrs());

  const options = (domain, key) => Object.keys(tr.entity?.[domain]?.[key]?.state || {});
  for (const k of SWITCHES) add("switch", k, ["dnd", "customized_cleaning", "carpet_boost", "self_clean", "auto_dust_collecting", "obstacle_avoidance", "ai_obstacle_detection", "voice_assistant"].includes(k) ? "on" : "off");
  for (const k of SELECTS) {
    let opts = options("select", k);
    if (k === "selected_map") opts = ["Ground Floor", "Upstairs"];
    if (!opts.length) opts = ["option_1", "option_2"];
    add("select", k, opts[Math.min(1, opts.length - 1)], { options: opts });
  }
  for (const [k, [min, max, step, val, unit]] of Object.entries(NUMBERS)) add("number", k, val, { min, max, step, unit_of_measurement: unit, mode: "slider" });
  for (const [k, v] of Object.entries(TIMES)) add("time", k, v);
  for (const k of BUTTONS) add("button", k, "unknown");
  for (const [k, v] of Object.entries(SENSORS)) add("sensor", k, v, UNITS[k] ? { unit_of_measurement: UNITS[k] } : {});
  for (const [k, [pct, hours]] of Object.entries(CONSUMABLES)) {
    add("sensor", `${k}_left`, pct, { unit_of_measurement: "%" });
    add("sensor", `${k}_time_left`, hours, { unit_of_measurement: k === "silver_ion" || k === "detergent" ? "d" : "h" });
  }
  for (const id of Object.keys(ROOMS)) {
    for (const k of ROOM_SELECTS) {
      const opts = k === "name" ? Object.values(tr.entity?.select?.name?.state || { room: "Room" }) : options("select", k).length ? options("select", k) : ["1", "2", "3"];
      add("select", `room_${id}_${k}`, opts[0], { options: opts }, { translation_key: k });
    }
  }

  const calls = (window.__calls = []);
  const lookup = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), tr);

  const hass = {
    states, entities,
    devices: { [DEVICE_ID]: { id: DEVICE_ID, name: "Dreame L10s", model: "dreame.vacuum.r2228o", manufacturer: "Dreametech™", sw_version: "4.3.9_1279", connections: [["mac", "a4:2b:b0:aa:bb:cc"]] } },
    config: { unit_system: { length: "km" }, time_zone: "America/Chicago", version: "2026.10.0" },
    locale: { language: "en", time_format: "24" },
    language: "en",
    themes: { darkMode: false },
    user: { is_admin: true },
    localize(key, ..._args) {
      if (key.startsWith("component.dreame_vacuum.")) return lookup(key.slice("component.dreame_vacuum.".length)) || "";
      return "";
    },
    formatEntityState(stateObj, value = stateObj.state) {
      const domain = stateObj.entity_id.split(".")[0];
      const tk = entities[stateObj.entity_id]?.translation_key;
      const t = tk && tr.entity?.[domain]?.[tk]?.state?.[value];
      if (t) return t;
      const unit = stateObj.attributes.unit_of_measurement;
      return `${String(value).replace(/_/g, " ")}${unit && value === stateObj.state ? ` ${unit}` : ""}`;
    },
    formatEntityAttributeValue: (s, a) => String(s.attributes[a] ?? ""),
    hassUrl: (p) => p,
    loadBackendTranslation: async () => {},
    callService(domain, service, data, target) {
      calls.push({ domain, service, data, target });
      console.info("callService", domain, service, JSON.stringify(data), JSON.stringify(target));
      if (window.__failNextCall) {
        window.__failNextCall = false;
        return Promise.reject(new Error("Mock failure"));
      }
      return Promise.resolve();
    },
    callWS: async (msg) => (console.info("callWS", JSON.stringify(msg)), {}),
    // Serves camera_map_data_proxy JSON shaped like dreame/map.py get_data.
    fetchWithAuth: (url, init) => {
      if (String(url).includes("camera_map_data_proxy")) {
        const a = states["camera.dreame_l10s_map"].attributes;
        const tuple = (c, id, extra = []) => [c.x0, c.y0, c.x1, c.y1, c.x2, c.y2, c.x3, c.y3, id, ...extra];
        const body = {
          map_id: a.map_id, saved_map_id: a.saved_map_id, map_index: a.map_index,
          carpets: (a.carpets || []).map((c, i) => tuple(c, c.id ?? i + 1, [0, c.carpet_cleaning ?? 0, null, c.type ?? 5, 0, null])),
          detected_carpets: (a.detected_carpets || []).map((c, i) => tuple(c, 100 + i, [0, 0, null, 6, 0, null, null, null, null])),
          deleted_carpets: (a.deleted_carpets || []).map((c, i) => tuple(c, 200 + i)),
          furnitures: a.furnitures || [], walls: [], doors: [],
          segments: Object.fromEntries(Object.keys(a.rooms || {}).map((id) => [id, { id: Number(id), neighbors: [] }])),
        };
        return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
      }
      return fetch(url, init);
    },
  };
  return hass;
}

// Minimal stand-ins for HA frontend elements used by the card.
const stub = (tag, render) => {
  if (customElements.get(tag)) return;
  customElements.define(
    tag,
    class extends HTMLElement {
      static observedAttributes = ["icon"];
      attributeChangedCallback() {
        render(this);
      }
      connectedCallback() {
        render(this);
      }
      set icon(v) {
        this.setAttribute("icon", v);
        render(this);
      }
      set stateObj(v) {
        this._s = v;
        render(this);
      }
    }
  );
};
stub("ha-card", (el) => {
  el.style.cssText = "display:block;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.2);overflow:hidden";
});
const glyph = (el, name) => {
  el.style.cssText = "display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;font:10px/1 monospace;color:#666;border:1px dashed #bbb;border-radius:4px;overflow:hidden;flex:none";
  el.title = name || "";
  el.textContent = (name || "?").replace("mdi:", "").slice(0, 3);
};
stub("ha-icon", (el) => glyph(el, el.getAttribute("icon")));
stub("ha-state-icon", (el) => glyph(el, el._s?.attributes?.icon || el._s?.entity_id?.split(".")[0]));
stub("ha-form", (el) => {
  el.textContent = "[ha-form]";
});
