// A scheduled task is running: cleaning settings are locked, sequence save disabled.
export function apply(hass) {
  const v = hass.states["vacuum.dreame_l10s"];
  v.state = "cleaning";
  v.attributes = { ...v.attributes, started: true, running: true, docked: false, startup_method: "Scheduled Activation" };
}
