// Customized cleaning off: per-room selects go unavailable (as select.py does), so
// room-cleaning edits through vacuum_set_custom_cleaning. Room 2 carries the optional
// attributes a newer model publishes (cleaning_mode, cleaning_route, mop_pressure).
export function apply(hass) {
  const sw = "switch.dreame_l10s_customized_cleaning";
  hass.states[sw] = { ...hass.states[sw], state: "off" };
  for (const [id, s] of Object.entries(hass.states)) {
    if (/_room_\d+_(suction_level|water_volume|cleaning_mode|cleaning_times|cleaning_route|mop_pad_humidity)$/.test(id))
      hass.states[id] = { ...s, state: "unavailable", attributes: { ...s.attributes, options: ["unavailable"] } };
  }
  const cam = hass.states["camera.dreame_l10s_map"];
  const rooms = { ...cam.attributes.rooms };
  rooms[2] = { ...rooms[2], cleaning_mode: 2, cleaning_route: 1, mop_pressure: "Normal" };
  cam.attributes = { ...cam.attributes, rooms };
}
