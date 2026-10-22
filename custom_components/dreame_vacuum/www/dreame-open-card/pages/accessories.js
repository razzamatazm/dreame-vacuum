/*
 * Accessory Usage (doc-accessories): the 17 consumables the integration exposes.
 *
 * Sensor keys are DreameVacuumProperty names lowercased (sensor.py): <sensor>_left (%)
 * and <sensor>_time_left (h or d). Reset uses button.reset_<consumable> when the
 * model has it (button.py, DreameVacuumAction.RESET_*), otherwise the
 * dreame_vacuum.vacuum_reset_consumable service {consumable} (vacuum.py
 * CONSUMABLE_RESET_ACTION). Tank filter has no reset button entity, only the service.
 * The DVC legend's "foller_mop_filter_dirty" is a typo; the real key is roller_mop_filter_dirty.
 *
 * Export: accessoryWarning(ctx) -> true if any consumable is below 30 %.
 */
import { LitElement, html, css, nothing, base } from "../core.js";

export const WARN_PCT = 30;

// [sensor prefix, consumable (service enum / button suffix), icon, English label]
export const CONSUMABLES = [
  ["filter", "filter", "mdi:air-filter", "Filter"],
  ["side_brush", "side_brush", "mdi:pinwheel-outline", "Side Brush"],
  ["main_brush", "main_brush", "mdi:car-turbocharger", "Main Brush"],
  ["tank_filter", "tank_filter", "mdi:air-filter", "Tank Filter"],
  ["sensor_dirty", "sensor", "mdi:radar", "Sensor Cleaning"],
  ["fluffing_roller_dirty", "fluffing_roller", "mdi:blinds-open", "Fluffing Roller Cleaning"],
  ["water_outlet_filter_dirty", "water_outlet_filter", "mdi:filter-settings", "Water Outlet Filter Cleaning"],
  ["dirty_water_channel_dirty", "dirty_water_channel", "mdi:water-sync", "Dirty Water Channel"],
  ["mop_pad", "mop_pad", "mdi:hydro-power", "Mop Pad"],
  ["detergent", "detergent", "mdi:water-opacity", "Detergent"],
  ["deodorizer", "deodorizer", "mdi:scent", "Deodorizer"],
  ["silver_ion", "silver_ion", "mdi:shimmer", "Silver Ion"],
  ["squeegee", "squeegee", "mdi:squeegee", "Squeegee"],
  ["onboard_dirty_water_tank", "onboard_dirty_water_tank", "mdi:train-car-tank", "Onboard Dirty Water Tank"],
  ["roller_mop_filter_dirty", "roller_mop_filter", "mdi:filter-settings", "Roller Mop Filter Cleaning"],
  ["scale_inhibitor", "scale_inhibitor", "mdi:pipe", "Scale Inhibitor"],
  ["wheel_dirty", "wheel", "mdi:tire", "Wheel Cleaning"],
];

const num = (st) => {
  const n = Number(st?.state);
  return st && st.state !== "unavailable" && st.state !== "unknown" && Number.isFinite(n) ? n : null;
};

/** Consumables present on this model with their current values. */
export function accessoryList(ctx) {
  return CONSUMABLES.map(([key, consumable, icon, label]) => {
    const left = ctx.st("sensor", `${key}_left`);
    const time = ctx.st("sensor", `${key}_time_left`);
    if (!left && !time) return null;
    return { key, consumable, icon, label, left, time, pct: num(left), timeLeft: num(time) };
  }).filter(Boolean);
}

export function accessoryWarning(ctx) {
  return accessoryList(ctx).some((a) => a.pct != null && a.pct < WARN_PCT);
}

class Accessories extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false } };
  static styles = [
    base,
    css`
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
      }
      .item > ha-icon {
        color: var(--state-icon-color, var(--doc-muted));
      }
      .text {
        flex: 1;
        min-width: 0;
      }
      .top {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .top .label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pct {
        font-weight: 500;
      }
      .bar {
        height: 6px;
        border-radius: 3px;
        background: var(--doc-surface-2);
        margin: 6px 0 4px;
        overflow: hidden;
      }
      .bar > div {
        height: 100%;
        background: var(--doc-accent);
        border-radius: 3px;
      }
      .low .bar > div {
        background: var(--doc-warn);
      }
      .low .pct,
      .low > ha-icon {
        color: var(--doc-warn);
      }
      .secondary {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
    `,
  ];

  _label(a) {
    // The reset button's translated name ("Reset Main Brush") is the only localized
    // name per consumable; fall back to the DVC legend's English label.
    return a.label;
  }

  _timeLeft(a) {
    if (a.timeLeft == null) return "";
    const unit = a.time.attributes.unit_of_measurement || "h";
    const n = Math.round(a.timeLeft).toLocaleString(this.ctx.hass.locale?.language);
    return this.ctx.t("title", "time_left", "%time% left").replace("%time%", `${n} ${unit}`);
  }

  async _reset(a) {
    const c = this.ctx;
    const label = this._label(a);
    const ok = await c.confirm({
      title: c.t("message", "reset_usage", "Reset Usage?"),
      text: c.t("message", "usage_will_reset", "Usage of %name% will be reset!").replace("%name%", label),
      confirmText: c.t("action", "reset", "Reset"),
      destructive: true,
    });
    if (!ok) return;
    if (c.ent("button", `reset_${a.consumable}`)) await c.press(`reset_${a.consumable}`);
    else await c.vac("vacuum_reset_consumable", { consumable: a.consumable });
  }

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const list = accessoryList(c);
    return html`<doc-page .ctx=${c} heading=${c.t("title", "accessory_usage", "Accessory Usage")}>
      ${list.length ? nothing : html`<p class="muted" style="padding:0 16px">-</p>`}
      ${list.map((a) => {
        const low = a.pct != null && a.pct < WARN_PCT;
        return html`<doc-list-item
          clickable
          .actions=${[{ label: c.t("action", "reset", "Reset"), icon: "mdi:restore", danger: true, run: () => this._reset(a) }]}
          @item-click=${(e) => (e.currentTarget._open = true)}
        >
          <div class="item ${low ? "low" : ""}">
            <ha-icon icon=${a.icon}></ha-icon>
            <div class="text">
              <div class="top">
                <span class="label">${this._label(a)}</span>
                <span class="pct">${a.pct != null ? `${Math.round(a.pct)}%` : "-"}</span>
              </div>
              <div class="bar"><div style="width:${Math.max(0, Math.min(100, a.pct ?? 0))}%"></div></div>
              <div class="secondary">${this._timeLeft(a)}</div>
            </div>
          </div>
        </doc-list-item>`;
      })}
    </doc-page>`;
  }
}

customElements.get("doc-accessories") || customElements.define("doc-accessories", Accessories);
