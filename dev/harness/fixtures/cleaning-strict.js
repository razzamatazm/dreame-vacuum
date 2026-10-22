// Strict (cleaning_sequence_v2) model: switch.cleaning_sequence does not exist.
export function apply(hass) {
  for (const id of ["switch.dreame_l10s_cleaning_sequence"]) {
    delete hass.states[id];
    delete hass.entities[id];
  }
}
