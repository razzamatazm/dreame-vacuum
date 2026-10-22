// Single-period DnD model: no "dnd_task" capability, `dnd` attribute is a bool.
export function apply(hass) {
  const v = hass.states["vacuum.dreame_l10s"];
  v.attributes = { ...v.attributes, dnd: true, capabilities: v.attributes.capabilities.filter((c) => c !== "dnd_task") };
}
