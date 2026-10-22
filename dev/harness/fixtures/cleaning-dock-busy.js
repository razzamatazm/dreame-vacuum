// Dock problems and running dock jobs: low clean water (warning), dirty tank full (error),
// drying in progress, dust bag drying in progress, washing unavailable.
export function apply(hass) {
  const v = hass.states["vacuum.dreame_l10s"];
  v.attributes = { ...v.attributes, drying: true, drying_left: 95, washing_available: false, low_water: true };
  const set = (k, state) => (hass.states[`sensor.dreame_l10s_${k}`] = { ...hass.states[`sensor.dreame_l10s_${k}`], state });
  set("clean_water_tank_status", "low_water");
  set("dirty_water_tank_status", "not_installed_or_full");
  set("detergent_status", "low_detergent");
  const add = (k, state) => {
    const entity_id = `sensor.dreame_l10s_${k}`;
    hass.states[entity_id] = { entity_id, state, attributes: { friendly_name: `Dreame L10s ${k.replace(/_/g, " ")}` } };
    hass.entities[entity_id] = { entity_id, device_id: "dev-dreame-1", platform: "dreame_vacuum", translation_key: k };
  };
  add("dust_bag_drying_status", "drying");
}
