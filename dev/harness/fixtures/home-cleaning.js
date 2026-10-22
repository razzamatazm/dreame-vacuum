export function apply(hass) {
  const v = hass.states["vacuum.dreame_l10s"];
  v.state = "cleaning";
  v.attributes = { ...v.attributes, started: true, running: true, docked: false, segment_cleaning: true, active_segments: [2], status: "Room cleaning", charging: false, battery: 64 };
  hass.states["sensor.dreame_l10s_cleaning_progress"].state = "45";
  hass.states["sensor.dreame_l10s_cleaned_area"].state = "18";
  hass.states["sensor.dreame_l10s_cleaning_time"].state = "23";
}
