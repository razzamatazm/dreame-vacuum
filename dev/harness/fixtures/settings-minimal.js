// Basic model: no shortcuts, no schedule attribute, no audio/carpet/mopping/camera/battery entities.
export function apply(hass) {
  const v = hass.states["vacuum.dreame_l10s"];
  const { shortcuts, schedule, ...rest } = v.attributes;
  v.attributes = { ...rest, capabilities: rest.capabilities.filter((c) => c !== "shortcuts") };
  const drop = /_(volume|voice_assistant\w*|streaming_voice_prompt|carpet\w*|clean_carpets_first|mop\w*|tight_mopping|gap_cleaning_extension|water_temperature|auto_change_mop|auto_mount_mop|ai_\w+|obstacle_avoidance|collision_avoidance|stain_avoidance|fill_light|camera_light_brightness|pet_\w+|intelligent_recognition|large_particles_boost|off_peak_charging\w*|battery_charge_level|wider_corner_coverage|mopping_\w+)$/;
  for (const id of Object.keys(hass.states)) {
    if (id.startsWith("vacuum.") || id.startsWith("sensor.") || id.includes("_room_")) continue;
    if (drop.test(id)) {
      delete hass.states[id];
      delete hass.entities[id];
    }
  }
}
