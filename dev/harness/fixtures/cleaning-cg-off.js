// CleanGenius off: global suction/water/mode/route rows and the self-clean section show.
export function apply(hass) {
  const id = "select.dreame_l10s_cleangenius";
  hass.states[id] = { ...hass.states[id], state: "off" };
}
