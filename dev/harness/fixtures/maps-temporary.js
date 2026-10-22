// Vacuum holding an unsaved temporary map with no free slot for a new one.
export function apply(hass) {
  const v = hass.states["vacuum.dreame_l10s"];
  v.attributes = { ...v.attributes, has_temporary_map: true, mapping_available: false };
}
