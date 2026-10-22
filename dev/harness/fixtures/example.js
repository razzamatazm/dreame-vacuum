// Example fixture: node dev/harness/shot.mjs home --fixture example
export function apply(hass) {
  const v = hass.states["vacuum.dreame_l10s"];
  v.state = "cleaning";
  v.attributes = { ...v.attributes, started: true, running: true, docked: false };
}
