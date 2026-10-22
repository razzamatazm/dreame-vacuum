// Realistic obstacle photo URLs (camera.py OBSTACLE_IMAGE_URL carries index=<obstacle key>).
export function apply(hass) {
  const cam = hass.states["camera.dreame_l10s_map"];
  cam.attributes.obstacle_picture = {
    "2: Sock %87 (Living Room)": "/dev/harness/fixtures/obstacle.svg?token=t&index=1&v=1",
    "1: Pet waste %92 (Kitchen)": "/dev/harness/fixtures/obstacle.svg?token=t&index=2&v=2",
  };
  cam.attributes.obstacles["1"].ignore_status = "Not Ignored";
  cam.attributes.obstacles["2"].ignore_status = "Manually Ignored";
}
