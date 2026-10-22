export function apply(hass) {
  const v = hass.states["vacuum.dreame_l10s"];
  v.attributes = { ...v.attributes, has_error: true, faults: { 1: "Drop" }, low_water: true, has_temporary_map: true };
  hass.states["sensor.dreame_l10s_error"].state = "drop";
  hass.states["sensor.dreame_l10s_filter_left"].state = "12";
}
