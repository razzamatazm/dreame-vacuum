/*
 * Device Settings (DVC guide: /guide/device-settings).
 *
 * Index of sections; sections without any backing entity/attribute on this
 * model are hidden. `params.section` renders one entity-driven section in
 * place. Scheduled Cleanup, Shortcuts and DnD are their own pages.
 *
 * Every settings-type entity key from switch.py / select.py / number.py /
 * time.py is assigned below. Keys owned by other pages (Cleaning Settings,
 * Dock Settings, Maps, Cleaning Sequence, per-room selects) are listed in
 * NOT_HERE so the assignment can be audited.
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import { entityRows, hasAny } from "../components.js";

export const SECTIONS = {
  audio: {
    title: ["title", "audio_settings", "Audio Settings"],
    icon: "mdi:volume-high",
    keys: ["number.volume", "switch.voice_assistant", "select.voice_assistant_language", "switch.streaming_voice_prompt"],
  },
  carpet: {
    title: ["title", "global_carpet_settings", "Global Carpet Settings"],
    menuTitle: ["title", "carpet_settings", "Carpet Settings"],
    icon: "mdi:rug",
    keys: [
      "switch.carpet_recognition",
      "switch.carpet_boost",
      "select.carpet_sensitivity",
      "select.carpet_cleaning",
      "switch.carpet_avoidance",
      "switch.intensive_carpet_cleaning",
      "switch.clean_carpets_first",
      "switch.side_brush_carpet_rotate",
      "switch.lift_chassis_on_carpet",
      "switch.close_roller_cover_on_carpet",
    ],
  },
  mopping: {
    title: ["title", "mopping_settings", "Mopping Settings"],
    icon: "mdi:water",
    groups: [
      [
        null,
        [
          "select.mopping_type",
          "select.mop_pad_humidity",
          "select.mop_pressure",
          "select.mop_temperature",
          "select.water_temperature",
          "select.custom_mopping_route",
          "switch.tight_mopping",
          "switch.gap_cleaning_extension",
          "switch.mopping_under_furnitures",
          "select.wider_corner_coverage",
          "switch.mop_extend",
          "select.mop_extend_frequency",
          "select.mop_pad_swing",
          "switch.side_reach",
          "switch.pressurized_cleaning",
        ],
      ],
      [
        "Mop pads",
        [
          "switch.auto_change_mop",
          "switch.auto_mount_mop",
          "select.mop_clean_frequency",
          "number.mop_cleaning_remainder",
          "select.scraper_frequency",
        ],
      ],
    ],
  },
  obstacle: {
    title: ["title", "obstacle_settings", "Camera and Obstacle Settings"],
    icon: "mdi:camera",
    groups: [
      [
        "Obstacles",
        [
          "switch.obstacle_avoidance",
          "switch.ai_obstacle_detection",
          "switch.ai_obstacle_image_upload",
          "switch.ai_obstacle_picture",
          "switch.fuzzy_obstacle_detection",
          "switch.ai_human_detection",
          "switch.ai_furniture_detection",
          "switch.ai_fluid_detection",
          "switch.stain_avoidance",
          "switch.collision_avoidance",
          "switch.intelligent_recognition",
          "switch.large_particles_boost",
          "switch.dynamic_obstacle_cleaning",
          "switch.obstacle_crossing",
          "switch.active_suspension_crossing",
          "select.low_lying_area_frequency",
          "switch.lds_state",
          "select.auto_lds_coverage",
        ],
      ],
      [
        "Pets",
        [
          "switch.ai_pet_detection",
          "switch.ai_pet_avoidance",
          "switch.pet_picture",
          "switch.pet_focused_detection",
          "switch.pet_focused_cleaning",
        ],
      ],
      [
        "Camera",
        [
          "switch.fill_light",
          "switch.camera_light_brightness_auto",
          "number.camera_light_brightness",
          "switch.ring_light_always_on",
          "switch.human_follow",
        ],
      ],
    ],
  },
  battery: {
    title: ["title", "battery_management", "Battery Management"],
    icon: "mdi:battery-charging",
    keys: [
      "switch.off_peak_charging",
      "time.off_peak_charging_start",
      "time.off_peak_charging_end",
      "select.battery_charge_level",
      "switch.auto_charging",
    ],
  },
  // Settings the DVC guide has no dedicated page for; kept here so nothing is orphaned.
  general: {
    title: ["title", "more_functions", "More Functions"],
    icon: "mdi:tune-variant",
    keys: [
      "switch.resume_cleaning",
      "switch.child_lock",
      "switch.floor_direction_cleaning",
      "switch.max_suction_power",
      "switch.hair_compression",
    ],
  },
};

for (const def of Object.values(SECTIONS)) {
  if (!def.groups) def.groups = [[null, def.keys]];
  def.keys = def.groups.flatMap(([, keys]) => keys);
}

export const DND_KEYS = [
  "switch.dnd",
  "time.dnd_start",
  "time.dnd_end",
  "switch.dnd_disable_resume_cleaning",
  "switch.dnd_disable_auto_empty",
  "switch.dnd_reduce_volume",
];

// Deliberately not shown on Device Settings (owned by other pages).
export const NOT_HERE = {
  "cleaning-settings": [
    "select.suction_level", "select.water_volume", "select.cleaning_mode", "select.cleaning_route", "select.cleangenius",
    "select.cleangenius_mode", "switch.customized_cleaning", "select.cleaning_times",
  ],
  "dock-settings": [
    "select.mop_wash_level", "select.washing_mode", "switch.self_clean", "switch.self_clean_by_zone", "select.self_clean_frequency",
    "number.self_clean_area", "number.self_clean_time", "select.drying_time", "number.drying_time", "switch.silent_drying",
    "switch.auto_drying", "switch.smart_drying", "switch.hot_washing", "select.auto_rewashing", "select.auto_recleaning",
    "select.auto_empty_frequency", "select.auto_empty_mode", "number.auto_empty_area", "switch.auto_dust_collecting",
    "switch.auto_add_detergent", "switch.mopping_with_detergent", "switch.mop_washing_with_detergent", "switch.dust_bag_drying",
    "switch.uv_sterilization", "switch.water_electrolysis", "switch.auto_water_refilling", "switch.smart_mop_washing",
    "switch.ultra_clean_mode",
  ],
  maps: ["switch.multi_floor_map", "switch.map_saving", "select.selected_map", "select.map_rotation"],
  "cleaning-sequence": ["switch.cleaning_sequence"],
};

const INDEX = [
  { id: "schedule", page: "schedule", title: ["title", "schedule_list", "Scheduled Cleanup"], icon: "mdi:calendar-clock" },
  { id: "shortcuts", page: "shortcuts", title: ["title", "shortcut_list", "Shortcuts"], icon: "mdi:play-box-multiple-outline" },
  { id: "audio" },
  { id: "carpet" },
  { id: "mopping" },
  { id: "obstacle" },
  { id: "dnd", page: "dnd", title: ["title", "dnd", "Do not Disturb"], icon: "mdi:minus-circle-outline" },
  { id: "battery" },
  { id: "general" },
  { id: "info", title: ["title", "device_information", "Device Information"], icon: "mdi:information-outline" },
];

class DeviceSettings extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false } };
  static styles = [
    base,
    css`
      .tile {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
      }
      .tile .text {
        flex: 1;
        min-width: 0;
      }
      .tile ha-icon.lead {
        color: var(--doc-accent);
      }
      .sub {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      .kv {
        display: flex;
        gap: 12px;
        padding: 8px 16px;
        align-items: baseline;
      }
      .kv .k {
        flex: 1;
        color: var(--doc-muted);
      }
      .kv .v {
        text-align: right;
        word-break: break-all;
        font-variant-numeric: tabular-nums;
      }
      .empty {
        padding: 16px;
      }
    `,
  ];

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const section = this.params?.section;
    if (section === "info") return this._info();
    if (section && SECTIONS[section]) return this._section(section);
    return html`<doc-page .ctx=${c} heading=${c.t("title", "device_settings", "Device Settings")}>
      ${INDEX.filter((e) => this._available(e.id)).map((e) => {
        const def = SECTIONS[e.id];
        const title = e.title || def.menuTitle || def.title;
        return html`<doc-list-item clickable @item-click=${() => (e.page ? c.navigate(e.page) : c.navigate("device-settings", { section: e.id }))}>
          <div class="tile">
            <ha-icon class="lead" icon=${e.icon || def.icon}></ha-icon>
            <div class="text">
              <div>${c.t(...title)}</div>
              ${this._summary(e.id)}
            </div>
            <ha-icon icon="mdi:chevron-right" class="muted"></ha-icon>
          </div>
        </doc-list-item>`;
      })}
    </doc-page>`;
  }

  _available(id) {
    const c = this.ctx;
    const a = c.attrs;
    switch (id) {
      case "schedule":
        return Array.isArray(a.schedule);
      case "shortcuts":
        return a.shortcuts != null || c.can("shortcuts");
      case "dnd":
        return c.can("dnd_task") || Array.isArray(a.dnd) || hasAny(c, DND_KEYS);
      case "info":
        return true;
      default:
        return hasAny(c, SECTIONS[id].keys);
    }
  }

  _summary(id) {
    const c = this.ctx;
    const a = c.attrs;
    let text = "";
    if (id === "schedule") {
      const on = a.schedule.filter((s) => s.enabled).length;
      text = `${on} / ${a.schedule.length}`;
    } else if (id === "shortcuts") {
      text = String(Object.keys(a.shortcuts || {}).length);
    } else if (id === "dnd") {
      if (Array.isArray(a.dnd)) text = a.dnd.map((d) => `${d.start}-${d.end}`).join(", ");
      else {
        const s = c.st("time", "dnd_start");
        const e = c.st("time", "dnd_end");
        if (s && e) text = `${s.state.slice(0, 5)}-${e.state.slice(0, 5)}`;
      }
    } else if (id === "battery") {
      const st = c.st("select", "battery_charge_level");
      if (st) text = c.stateLabel(st);
    } else if (id === "info") {
      text = a.firmware_version || "";
    }
    return text ? html`<div class="sub">${text}</div>` : nothing;
  }

  _section(id) {
    const c = this.ctx;
    const def = SECTIONS[id];
    return html`<doc-page .ctx=${c} heading=${c.t(...def.title)}>
      ${def.groups.map(([heading, keys]) =>
        hasAny(c, keys) ? html`<doc-section heading=${heading || ""}>${entityRows(c, keys)}</doc-section>` : nothing
      )}
      ${hasAny(c, def.keys) ? nothing : html`<div class="empty muted">${c.t("message", "not_supported", "Not supported")}</div>`}
    </doc-page>`;
  }

  _info() {
    const c = this.ctx;
    const a = c.attrs;
    const dev = c.hass.devices?.[c.deviceId] || {};
    const ap = a.ap || {};
    const mac = (dev.connections || []).find(([k]) => k === "mac")?.[1];
    const rssi = ap.rssi != null && ap.rssi !== "" ? `${ap.rssi} dBm` : null;
    const groups = [
      [
        "Hardware",
        [
          ["Name", dev.name_by_user || dev.name],
          ["Manufacturer", dev.manufacturer],
          ["Model", dev.model],
          ["Hardware version", dev.hw_version],
          ["Serial number", dev.serial_number],
        ],
      ],
      [
        "Network",
        [
          ["SSID", ap.ssid],
          ["BSSID", ap.bssid],
          ["RSSI", rssi],
          ["IP", ap.ip],
          ["MAC", mac],
        ],
      ],
      [
        "System",
        [
          ["Firmware", a.firmware_version || dev.sw_version],
          // The integration reports the HA host's offset to the cloud; the HA zone is the closest public value.
          ["Time zone", c.hass.config?.time_zone],
        ],
      ],
    ];
    return html`<doc-page .ctx=${c} heading=${c.t("title", "device_information", "Device Information")}>
      ${groups.map(([title, items]) => {
        const shown = items.filter(([, v]) => v != null && v !== "");
        return shown.length
          ? html`<doc-section heading=${title}>
              ${shown.map(([k, v]) => html`<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`)}
            </doc-section>`
          : nothing;
      })}
    </doc-page>`;
  }
}

customElements.get("doc-device-settings") || customElements.define("doc-device-settings", DeviceSettings);
