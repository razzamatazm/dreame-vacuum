/*
 * <doc-dock-actions .ctx> — Dock Actions panel content (the home screen opens it
 * in a <doc-sheet>). Not a routed page.
 *
 * Exports:
 *   dockAlertLevel(ctx) -> "error" | "warning" | null   (Dock button color)
 *   dockStatuses(ctx)   -> [{ key, id, level }] status sensors present on this model
 *   dockActions(ctx)    -> action descriptors shared with dock-settings.js
 *
 * Backing API (dreame/device.py public methods via vacuum_call_action, no value):
 *   start_washing / pause_washing, start_drying / stop_drying,
 *   start_dust_bag_drying / stop_dust_bag_drying; button.start_auto_empty;
 *   vacuum.return_to_base. Availability from vacuum attrs washing_available,
 *   washing, washing_paused, drying_available, drying, dust_bag_drying_available,
 *   dust_collection_available, draining; bag drying state from sensor.dust_bag_drying_status.
 */
import { LitElement, html, css, nothing, base } from "../core.js";

// Sensor states (translations/en.json) mapped to alert levels.
const LEVELS = {
  clean_water_tank_status: { not_installed: "error", low_water: "warning" },
  dirty_water_tank_status: { not_installed_or_full: "error" },
  dust_bag_status: { not_installed: "error", check: "warning" },
  detergent_status: { low_detergent: "warning" },
  low_water_warning: {
    no_water_left: "error",
    no_water_left_after_clean: "error",
    no_water_for_clean: "error",
    tank_not_installed: "error",
    low_water: "warning",
  },
  drainage_status: { draining_failed: "error" },
};
const STATUS_KEYS = [
  "clean_water_tank_status",
  "dirty_water_tank_status",
  "dust_bag_status",
  "detergent_status",
  "self_wash_base_status",
  "dust_bag_drying_status",
  "drainage_status",
  "station_drainage_status",
  "auto_empty_status",
  "low_water_warning",
];
const ICONS = {
  clean_water_tank_status: "mdi:water-check-outline",
  dirty_water_tank_status: "mdi:water-remove-outline",
  dust_bag_status: "mdi:delete-variant",
  detergent_status: "mdi:bottle-tonic-outline",
  self_wash_base_status: "mdi:dishwasher",
  dust_bag_drying_status: "mdi:tumble-dryer",
  drainage_status: "mdi:pump",
  station_drainage_status: "mdi:pump",
  auto_empty_status: "mdi:delete-restore",
  low_water_warning: "mdi:water-alert-outline",
};
// Titles the integration ships for the DVC dock panel.
const TITLES = {
  clean_water_tank_status: "clean_water_tank",
  dirty_water_tank_status: "used_water_tank",
  dust_bag_status: "dust_bag",
  detergent_status: "detergent",
};

const RANK = { error: 2, warning: 1 };

export function dockStatuses(ctx) {
  const out = [];
  for (const key of STATUS_KEYS) {
    const st = ctx.st("sensor", key);
    if (!st || st.state === "unavailable" || st.state === "unknown") continue;
    // Low-water warning only matters when it says something.
    if (key === "low_water_warning" && st.state === "no_warning") continue;
    out.push({ key, id: st.entity_id, st, level: LEVELS[key]?.[st.state] || null });
  }
  return out;
}

export function dockAlertLevel(ctx) {
  let level = null;
  for (const s of dockStatuses(ctx)) if (s.level && (RANK[s.level] || 0) > (RANK[level] || 0)) level = s.level;
  if (!level && ctx.attrs.low_water) level = "warning";
  return level;
}

/**
 * Dock actions available on this model. Each: { id, icon, label, active, disabled, run }.
 * run() asks for confirmation where DVC does (stopping a running dry/bag dry).
 */
export function dockActions(ctx) {
  const a = ctx.attrs;
  const t = (k, f) => ctx.t("action", k, f);
  const bagDrying = ctx.st("sensor", "dust_bag_drying_status")?.state === "drying";
  const out = [];

  if ("washing_available" in a) {
    const washing = !!a.washing;
    const paused = !!a.washing_paused;
    out.push({
      id: "wash",
      icon: washing ? "mdi:pause" : "mdi:dishwasher",
      label: t("wash", "Wash"),
      title: washing ? t("pause_washing", "Pause washing") : paused ? t("resume_washing", "Resume washing") : t("start_washing", "Start washing"),
      active: washing,
      disabled: !a.washing_available || !!a.draining,
      run: () => ctx.action(washing ? "pause_washing" : "start_washing"),
    });
  }
  if ("drying_available" in a) {
    const drying = !!a.drying;
    out.push({
      id: "dry",
      icon: drying ? "mdi:stop" : "mdi:weather-windy",
      label: t("dry", "Dry"),
      title: drying ? t("stop_drying", "Stop drying") : t("start_drying", "Start drying"),
      active: drying,
      disabled: !a.drying_available,
      run: async () => {
        if (drying) {
          const ok = await ctx.confirm({
            title: ctx.t("message", "stop_drying", "Stop Drying?"),
            text: ctx.t("message", "drying_will_stopped", "Mop pad drying will be stopped!"),
          });
          return ok && ctx.action("stop_drying");
        }
        if (bagDrying) {
          const ok = await ctx.confirm({
            title: t("start_drying", "Start drying"),
            text: ctx.t("message", "bag_drying_will_stopped", "Dust bag drying will be stopped!"),
          });
          if (!ok) return false;
        }
        return ctx.action("start_drying");
      },
    });
  }
  if ("dust_bag_drying_available" in a) {
    out.push({
      id: "dry_bag",
      icon: bagDrying ? "mdi:stop" : "mdi:tumble-dryer",
      label: t("dry_bag", "Dry Bag"),
      title: bagDrying ? t("stop_bag_drying", "Stop Bag Drying") : t("start_bag_drying", "Start Bag Drying"),
      active: bagDrying,
      disabled: !a.dust_bag_drying_available,
      run: async () => {
        if (bagDrying) {
          const ok = await ctx.confirm({
            title: ctx.t("message", "stop_bag_drying", "Stop Dust Bag Drying?"),
            text: ctx.t("message", "bag_drying_will_stopped", "Dust bag drying will be stopped!"),
          });
          return ok && ctx.action("stop_dust_bag_drying");
        }
        if (a.drying) {
          const ok = await ctx.confirm({
            title: t("start_bag_drying", "Start Bag Drying"),
            text: ctx.t("message", "drying_will_stopped", "Mop pad drying will be stopped!"),
          });
          if (!ok) return false;
        }
        return ctx.action("start_dust_bag_drying");
      },
    });
  }
  if (ctx.ent("button", "start_auto_empty")) {
    const emptying = ctx.st("sensor", "auto_empty_status")?.state === "active";
    out.push({
      id: "empty",
      icon: "mdi:delete-restore",
      label: t("empty", "Empty"),
      title: emptying ? t("auto_emptying", "Auto-Emptying") : t("start_auto_empty", "Start Auto-Empty"),
      active: emptying,
      disabled: emptying || ("dust_collection_available" in a && !a.dust_collection_available) || !ctx.available(ctx.ent("button", "start_auto_empty")),
      run: () => ctx.press("start_auto_empty"),
    });
  }
  return out;
}

class DockActions extends LitElement {
  static properties = { ctx: { attribute: false } };
  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .acts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
        gap: 8px;
        padding: 8px 16px 12px;
      }
      .acts button {
        flex-direction: column;
        border-radius: var(--doc-radius);
        padding: 10px 4px;
        min-height: 64px;
        gap: 4px;
        font-size: 0.9em;
      }
      .acts button ha-icon {
        --mdc-icon-size: 24px;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
      }
      .status .label {
        flex: 1;
      }
      .status .value {
        color: var(--doc-muted);
      }
      .status.warning .value,
      .status.warning ha-icon {
        color: var(--doc-warn);
      }
      .status.error .value,
      .status.error ha-icon {
        color: var(--doc-error);
      }
      .status ha-icon {
        color: var(--state-icon-color, var(--doc-muted));
      }
    `,
  ];

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const a = c.attrs;
    const acts = dockActions(c);
    return html`
      <div class="acts">
        ${acts.map(
          (x) => html`<button
            class=${x.active ? "active" : ""}
            title=${x.title}
            ?disabled=${x.disabled && !x.active}
            @click=${() => x.run()}
          >
            <ha-icon icon=${x.icon}></ha-icon>${x.label}
          </button>`
        )}
        <button
          title=${c.t("action", "dock", "Dock")}
          ?disabled=${!!a.docked || !!a.returning}
          @click=${() => c.vacuumCmd("return_to_base")}
        >
          <ha-icon icon="mdi:home-import-outline"></ha-icon>${c.t("action", "charge", "Return")}
        </button>
      </div>
      ${dockStatuses(c).map(
        (s) => html`<div class="status ${s.level || ""}">
          <ha-icon icon=${s.level ? (s.level === "error" ? "mdi:alert-circle" : "mdi:alert") : ICONS[s.key]}></ha-icon>
          <span class="label">${TITLES[s.key] ? c.t("title", TITLES[s.key]) : c.name(s.id)}</span>
          <span class="value">${c.stateLabel(s.st)}</span>
        </div>`
      )}
    `;
  }
}

customElements.get("doc-dock-actions") || customElements.define("doc-dock-actions", DockActions);
