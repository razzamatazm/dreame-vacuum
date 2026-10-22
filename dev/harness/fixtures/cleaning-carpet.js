// Manual carpet with v3 preferences bitmask (clean first + boost) and a detected carpet.
export function apply(hass) {
  recognitionOn(hass);
  const cam = hass.states["camera.dreame_l10s_map"];
  const [c1] = cam.attributes.carpets;
  cam.attributes = {
    ...cam.attributes,
    carpets: [{ ...c1, carpet_preferences: 3, ellipse: false }],
    detected_carpets: [{ x0: 1000, y0: -1500, x1: 2000, y1: -1500, x2: 2000, y2: -500, x3: 1000, y3: -500, angle: null, id: 4, type: 7, carpet_cleaning: -1 }],
  };
}
export function recognitionOn(hass) {
  const sw = "switch.dreame_l10s_carpet_recognition";
  hass.states[sw] = { ...hass.states[sw], state: "on" };
}
