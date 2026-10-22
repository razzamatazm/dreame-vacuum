// Non-strict sequence with Hall unassigned (order 0) and per-room mop types.
export function apply(hass) {
  const cam = hass.states["camera.dreame_l10s_map"];
  const rooms = { ...cam.attributes.rooms };
  rooms[1] = { ...rooms[1], order: 2 };
  rooms[2] = { ...rooms[2], order: 1 };
  rooms[3] = { ...rooms[3], order: 3 };
  rooms[4] = { ...rooms[4], order: 0 };
  cam.attributes = { ...cam.attributes, rooms };
  const sw = "switch.dreame_l10s_auto_change_mop";
  hass.states[sw] = { ...hass.states[sw], state: "on" };
}
