// Extra consumables: tank filter (no reset button entity, service path) and wheel cleaning at 12 %.
export function apply(hass) {
  const add = (k, state, unit) => {
    const entity_id = `sensor.dreame_l10s_${k}`;
    hass.states[entity_id] = { entity_id, state: String(state), attributes: { friendly_name: `Dreame L10s ${k}`, unit_of_measurement: unit } };
    hass.entities[entity_id] = { entity_id, device_id: "dev-dreame-1", platform: "dreame_vacuum", translation_key: k };
  };
  add("tank_filter_left", 64, "%");
  add("tank_filter_time_left", 19, "h");
  add("wheel_dirty_left", 12, "%");
  add("wheel_dirty_time_left", 1, "d");
}
