// Adds every Device Settings entity the base mock lacks, plus a richer schedule/shortcut set.
// node dev/harness/shot.mjs device-settings --fixture settings-full
import { SECTIONS, DND_KEYS } from "../../../custom_components/dreame_vacuum/www/dreame-open-card/pages/device-settings.js";

const pretty = (k) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const OPTIONS = {
  mop_pad_humidity: ["slightly_dry", "moist", "wet"],
  mop_pressure: ["light", "normal"],
  mop_temperature: ["normal", "mild", "warm", "hot"],
  water_temperature: ["normal", "mild", "warm", "hot"],
  custom_mopping_route: ["off", "standard", "intensive", "deep"],
  scraper_frequency: ["standard", "high"],
  mop_extend_frequency: ["standard", "intelligent", "high"],
  mop_pad_swing: ["off", "auto", "daily", "weekly"],
  low_lying_area_frequency: ["standard", "high"],
  auto_lds_coverage: ["off", "standard", "high"],
};

export function apply(hass) {
  const dev = Object.values(hass.entities).find((e) => e.entity_id === "vacuum.dreame_l10s").device_id;
  const add = (domain, key, state, attributes = {}) => {
    const entity_id = `${domain}.dreame_l10s_${key}`;
    if (hass.states[entity_id]) return;
    hass.states[entity_id] = { entity_id, state: String(state), attributes: { friendly_name: `Dreame L10s ${pretty(key)}`, ...attributes } };
    hass.entities[entity_id] = { entity_id, device_id: dev, platform: "dreame_vacuum", translation_key: key };
  };
  const keys = [...Object.values(SECTIONS).flatMap((s) => s.keys), ...DND_KEYS];
  for (const k of keys) {
    const [domain, key] = k.split(".");
    if (domain === "switch") add(domain, key, "off");
    else if (domain === "select") {
      const opts = OPTIONS[key] || ["option_1", "option_2"];
      add(domain, key, opts[0], { options: opts });
    } else if (domain === "number") add(domain, key, 10, { min: 0, max: 180, step: 1, unit_of_measurement: "min" });
    else if (domain === "time") add(domain, key, "22:00:00");
  }
  hass.devices[dev] = { ...hass.devices[dev], hw_version: "Linux", serial_number: "R2228-0042-XYZ" };
  const v = hass.states["vacuum.dreame_l10s"];
  v.attributes = {
    ...v.attributes,
    schedule: [
      ...v.attributes.schedule,
      { id: 3, enabled: true, invalid: false, time: "23:15", repeats: "0010100", once: false, map_id: "5", suction_level: 3, water_volume: 1, options: ["1", "2"] },
      { id: 4, enabled: false, invalid: true, time: "06:45", repeats: "0000000", once: true, map_id: "3", suction_level: 0, water_volume: 3, options: null },
    ],
    dnd: [...v.attributes.dnd, { id: 2, enabled: false, start: "12:30", end: "14:00", repeats: 65, ss: 0 }],
    shortcuts: {
      ...v.attributes.shortcuts,
      "34": {
        id: 34, index: 2, name: "Upstairs zones", map_id: 5, running: true,
        tasks: [[{ task_type: 2, coords: [0, 0, 1000, 1000], suction_level: 3, cleaning_times: 2 }], [{ segment_id: 1, suction_level: 0, cleaning_mode: 0, cleaning_route: 2 }, { segment_id: 4, water_volume: 3, cleaning_mode: 1 }]],
      },
    },
    rooms: { ...v.attributes.rooms, Upstairs: [{ id: 1, name: "Office" }, { id: 4, name: "Bath" }] },
  };
}
