/*
 * History fixture: realistic history attributes + canned history JSON.
 *   node dev/harness/shot.mjs cleaning-history --fixture history-sample
 *   node dev/harness/shot.mjs history-details --params '{"index":1}' --fixture history-sample
 *
 * - map.cleaning_history_picture / cruising_history_picture use the exact key format of
 *   camera.py get_key() and HISTORY_MAP_IMAGE_URL (index 1 = newest, v = unix timestamp).
 * - sensor.<dev>_cleaning_history attributes mirror device.py cleaning_history (keyed by date).
 * - hass.hassUrl maps history proxy URLs to SVG placeholders (no backend in the harness).
 * - hass.fetchWithAuth answers `&data=1` with objects shaped like DreameVacuumMapRenderer.get_data()
 *   (sorted keys, None fields omitted, enums as ints).
 */
const CAM = "camera.dreame_l10s_map";
const NOW = new Date(2026, 9, 21, 18, 0).getTime() / 1000;
const pad = (n) => String(n).padStart(2, "0");

// index 1 = newest
const TASKS = [
  { ago: 2.0, status: "Room Cleaning", second: true, completed: true, area: 9, time: 8, multi: "1761030000", startup: 1, cleanup: 2, dirty: true },
  { ago: 2.6, status: "Room Cleaning", completed: true, area: 38, time: 46, multi: "1761030000", startup: 1, cleanup: 2, blocked: { 3: [3] }, dirty: true },
  { ago: 26, status: "Cleaning", completed: false, area: 21, time: 25, startup: 2, cleanup: 0, interrupt: 11 },
  { ago: 50, status: "Cleaning", completed: true, area: 64, time: 71, startup: 2, cleanup: 0, ds: 1, wt: 4 },
  { ago: 74, status: "Zone Cleaning", completed: true, area: 6, time: 7, startup: 3, cleanup: 0 },
  { ago: 98, status: "Cleaning", completed: true, area: 62, time: 69, startup: 0, cleanup: 1, blocked: { 4: [5, 3500, 0] } },
  { ago: 24 * 400, status: "Cleaning", completed: true, area: 60, time: 66, startup: 2, cleanup: 0 },
];

const tsOf = (t) => Math.floor(NOW - t.ago * 3600);
function keyOf(i, t) {
  const d = new Date(tsOf(t) * 1000);
  const date =
    d.getFullYear() === new Date().getFullYear()
      ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      : `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${i}: ${date} - ${t.second ? "Second " : ""}${t.status} ${t.completed ? "(Completed)" : "(Interrupted)"}`;
}
const urlOf = (i, t, cruising) => `/api/camera_history_map_proxy/${CAM}?token=tok123&index=${i}&v=${tsOf(t)}${cruising ? "&cruising=1" : ""}`;

const CRUISES = [
  { ago: 5, status: "Cruising Point", completed: true, time: 4, startup: 1 },
  { ago: 30, status: "Cruising Path", completed: false, time: 9, startup: 2 },
];

function svg(label, tint) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#eef0f2"/>
  <rect x="100" y="200" width="400" height="400" fill="#7fb2ff" stroke="#555" stroke-width="3"/>
  <rect x="500" y="200" width="300" height="200" fill="#ffc36b" stroke="#555" stroke-width="3"/>
  <rect x="500" y="400" width="300" height="200" fill="#9be59b" stroke="#555" stroke-width="3"/>
  <rect x="800" y="200" width="150" height="400" fill="#f4a3c4" stroke="#555" stroke-width="3"/>
  <polyline points="150,250 450,250 450,300 150,300 150,350 450,350 450,400 650,400 650,300" fill="none" stroke="#fff" stroke-width="5"/>
  ${tint ? `<rect width="1000" height="800" fill="${tint}"/>` : ""}
  <text x="20" y="50" font-size="32" fill="#333">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(s)}`;
}

function json(i, t, cruising) {
  const out = {
    cleaning_time: t.time,
    completed: t.completed,
    docked: true,
    history_map: true,
    map_id: 1,
    map_index: 1,
    path: [[1, 150, 250, 450, 250]],
    saved_map: false,
    size: [-5000, -4000, -5000, -4000, 200, 160, 50, 0, [0, 0, 0, 0]],
    startup_method: t.startup,
    version: 1,
    wifi_map: false,
    segments: [
      [1, -2000, 0, 1, null, 0, 0],
      [2, 1500, 1000, 4, null, 1, 1],
      [3, 1500, -1000, 2, btoa("Master Bedroom"), 2, 2],
      [4, 3750, 0, 8, null, 3, 3],
    ],
  };
  if (!cruising) {
    Object.assign(out, {
      cleaned_area: t.area,
      cleaning_status: t.completed ? 1 : 0,
      cleanup_method: t.cleanup,
      cleaned_segments: [1, 2],
      remaining_battery: 64,
      task_end_type: t.completed ? 2 : 3,
      task_interrupt_reason: t.interrupt ?? 0,
      second_cleaning: t.second ? 1 : 0,
      cleaning_map: false,
      cleaning_map_data: { cleaning_map: true, history_map: true, map_id: 1, size: out.size },
      wifi_map_data: i % 2 ? { wifi_map: true, map_id: 1, size: out.size } : undefined,
    });
    if (t.ds != null) out.dust_collection_count = t.ds;
    if (t.wt != null) out.mop_wash_count = t.wt;
    if (t.blocked) out.blocked_segments = t.blocked;
    if (t.dirty) out.has_dirty_area = true;
    if (t.multi) out.multiple_cleaning_time = t.multi;
  }
  return JSON.parse(JSON.stringify(out));
}

const REASONS = { 3: "Blocked by door", 5: "Blocked by obstacle" };

export function apply(hass) {
  const cam = hass.states[CAM];
  const cleaning = {};
  const cruising = {};
  const sensor = {};
  TASKS.forEach((t, n) => {
    const i = n + 1;
    cleaning[keyOf(i, t)] = urlOf(i, t);
    const d = new Date(tsOf(t) * 1000);
    const a = { timestamp: tsOf(t), cleaning_time: `${t.time} min`, cleaned_area: `${t.area} m²`, status: t.status, completed: t.completed, cleanup_method: ["Default mode", "Customized cleaning", "Cleangenius"][t.cleanup] };
    if (t.blocked) a.blocked_rooms = Object.fromEntries(Object.entries(t.blocked).map(([k, v]) => [k, REASONS[v[0]]]));
    if (t.interrupt) a.interrupt_reason = "Robot lifted";
    if (t.multi) a.multiple_cleaning_time = t.multi;
    sensor[`${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`] = a;
  });
  CRUISES.forEach((t, n) => (cruising[keyOf(n + 1, t)] = urlOf(n + 1, t, true)));
  cam.attributes = { ...cam.attributes, cleaning_history_picture: cleaning, cruising_history_picture: cruising };

  const id = "sensor.dreame_l10s_cleaning_history";
  hass.states[id] = { entity_id: id, state: new Date(tsOf(TASKS[0]) * 1000).toISOString(), attributes: { friendly_name: "Dreame L10s Cleaning History", device_class: "timestamp", ...sensor } };
  hass.entities[id] = { entity_id: id, device_id: "dev-dreame-1", platform: "dreame_vacuum", translation_key: "cleaning_history" };

  const origUrl = hass.hassUrl;
  hass.hassUrl = (p) => {
    if (!String(p).startsWith("/api/camera_history_map_proxy/")) return origUrl(p);
    const q = new URL(p, "http://x").searchParams;
    const kind = q.get("wifi") ? "wifi map" : q.get("cleaning") ? "cleaning map" : q.get("cruising") ? "cruise" : "details";
    return svg(`#${q.get("index")} ${kind}`, q.get("wifi") ? "rgba(0,200,0,0.18)" : q.get("cleaning") ? "rgba(255,120,0,0.12)" : "");
  };
  const origFetch = hass.fetchWithAuth;
  hass.fetchWithAuth = async (url, init) => {
    if (!String(url).startsWith("/api/camera_history_map_proxy/")) return origFetch(url, init);
    const q = new URL(url, "http://x").searchParams;
    const isCruise = !!q.get("cruising");
    const i = Number(q.get("index"));
    const t = (isCruise ? CRUISES : TASKS)[i - 1];
    if (!t || q.get("data") !== "1") return new Response("", { status: 404 });
    console.info("fetchWithAuth", url);
    return new Response(JSON.stringify(json(i, t, isCruise)), { headers: { "content-type": "application/json" } });
  };
}
