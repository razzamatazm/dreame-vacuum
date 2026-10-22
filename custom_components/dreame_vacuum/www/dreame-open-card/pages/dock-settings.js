/*
 * Dock Settings (doc-dock-settings): Wash / Dry / Empty tabs, only those the
 * model supports, last tab remembered in localStorage.
 *
 * Every dock entity key from switch.py / select.py / number.py / button.py is
 * placed below; entityRows() skips the ones a model lacks. Manual actions reuse
 * dockActions() from dock-actions.js (vacuum_call_action start_washing /
 * pause_washing / start_drying / stop_drying / start_dust_bag_drying /
 * stop_dust_bag_drying, button.start_auto_empty).
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import { entityRows, hasAny } from "../components.js";
import { dockActions } from "./dock-actions.js";
import { cleanGeniusOn, navRowStyles } from "./cleaning-settings.js";

const STORE = "dreame-open-card:dock-tab";

const WASH = [
  "select.mop_wash_level",
  "select.washing_mode",
  "select.water_temperature",
  "switch.hot_washing",
  "select.auto_rewashing",
  "switch.smart_mop_washing",
  "switch.ultra_clean_mode",
  "switch.pressurized_cleaning",
  "switch.mop_washing_with_detergent",
  "switch.mopping_with_detergent",
  "switch.auto_add_detergent",
  "switch.water_electrolysis",
  "switch.auto_water_refilling",
];
// Hidden when CleanGenius is on (the robot decides washing frequency).
const SELF_CLEAN = [
  "switch.self_clean",
  "select.self_clean_frequency",
  "switch.self_clean_by_zone",
  "number.self_clean_area",
  "number.self_clean_time",
  "select.mop_clean_frequency",
];
const WASH_MAINT = [
  "button.self_clean",
  "button.base_station_cleaning",
  "button.base_station_self_repair",
  "button.water_tank_draining",
  "button.empty_water_tank",
];
const DRY = [
  "select.drying_time",
  "number.drying_time",
  "switch.auto_drying",
  "switch.silent_drying",
  "switch.smart_drying",
  "switch.uv_sterilization",
];
const BAG = ["switch.dust_bag_drying"];
const EMPTY = ["switch.auto_dust_collecting", "select.auto_empty_frequency", "select.auto_empty_mode", "number.auto_empty_area"];
const EMPTY_STATUS = ["sensor.auto_empty_status", "sensor.dust_collection", "sensor.dust_bag_status"];

class DockSettings extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false }, _tab: { state: true } };
  static styles = [
    base,
    navRowStyles,
    css`
      .manual {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
      }
      .manual .text {
        flex: 1;
      }
      .manual .secondary {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      .manual ha-icon {
        color: var(--state-icon-color, var(--doc-muted));
      }
    `,
  ];

  constructor() {
    super();
    try {
      this._tab = localStorage.getItem(STORE) || "wash";
    } catch {
      this._tab = "wash";
    }
  }

  _tabs(c) {
    const a = c.attrs;
    const tabs = [];
    if ("washing_available" in a || hasAny(c, [...WASH, ...SELF_CLEAN]))
      tabs.push({ id: "wash", label: c.t("action", "wash", "Wash"), icon: "mdi:dishwasher" });
    if ("drying_available" in a || "dust_bag_drying_available" in a || hasAny(c, [...DRY, ...BAG, "button.manual_drying", "button.manual_dust_bag_drying"]))
      tabs.push({ id: "dry", label: c.t("action", "dry", "Dry"), icon: "mdi:weather-windy" });
    if ("dust_collection_available" in a || hasAny(c, [...EMPTY, "button.start_auto_empty"]))
      tabs.push({ id: "empty", label: c.t("action", "empty", "Empty"), icon: "mdi:delete-restore" });
    return tabs;
  }

  _select(id) {
    this._tab = id;
    try {
      localStorage.setItem(STORE, id);
    } catch {
      /* private mode */
    }
  }

  _manual(act, secondary) {
    if (!act) return nothing;
    return html`<div class="manual">
      <ha-icon icon=${act.icon}></ha-icon>
      <div class="text">
        <div>${act.label}</div>
        ${secondary ? html`<div class="secondary">${secondary}</div>` : nothing}
      </div>
      <button class=${act.active ? "active" : "primary"} ?disabled=${act.disabled && !act.active} @click=${() => act.run()}>
        ${act.title}
      </button>
    </div>`;
  }

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const tabs = this._tabs(c);
    const tab = tabs.find((t) => t.id === this._tab)?.id || tabs[0]?.id;
    const acts = Object.fromEntries(dockActions(c).map((x) => [x.id, x]));
    return html`<doc-page .ctx=${c} heading=${c.t("action", "dock_settings", "Dock settings")}>
      ${tabs.length > 1 ? html`<doc-tabs .tabs=${tabs} .selected=${tab} @select=${(e) => this._select(e.detail.id)}></doc-tabs>` : nothing}
      ${tab === "wash" ? this._wash(c, acts) : tab === "dry" ? this._dry(c, acts) : tab === "empty" ? this._empty(c, acts) : nothing}
    </doc-page>`;
  }

  _wash(c, acts) {
    const cg = cleanGeniusOn(c);
    // Only the threshold that matches the self-clean frequency mode applies.
    const freq = c.st("select", "self_clean_frequency")?.state;
    const selfClean = SELF_CLEAN.filter(
      (k) => !(freq === "by_area" && k === "number.self_clean_time") && !(freq === "by_time" && k === "number.self_clean_area")
    );
    const wash = acts.wash && { ...acts.wash, icon: "mdi:dishwasher" };
    return html`
      <doc-section>${this._manual(wash)}${entityRows(c, WASH)}</doc-section>
      ${!cg && hasAny(c, SELF_CLEAN) ? html`<doc-section heading=${c.name(c.ent("switch", "self_clean") || c.ent("select", "self_clean_frequency") || "") || "Self-Clean"}>${entityRows(c, selfClean)}</doc-section>` : nothing}
      ${hasAny(c, WASH_MAINT) ? html`<doc-section heading=${c.t("title", "more_functions", "More Functions")}>${entityRows(c, WASH_MAINT)}</doc-section>` : nothing}
    `;
  }

  _dry(c, acts) {
    const a = c.attrs;
    const left = a.drying && a.drying_left ? c.t("title", "time_left", "%time% left").replace("%time%", c.duration(a.drying_left)) : "";
    const bagStatus = c.st("sensor", "dust_bag_drying_status");
    return html`
      <doc-section>
        ${acts.dry ? this._manual(acts.dry, left) : entityRows(c, ["button.manual_drying"])}
        ${entityRows(c, [...DRY, "sensor.drying_progress"])}
      </doc-section>
      ${acts.dry_bag || hasAny(c, [...BAG, "button.manual_dust_bag_drying"])
        ? html`<doc-section heading=${c.t("action", "dry_bag", "Dry Bag")}>
            ${acts.dry_bag ? this._manual(acts.dry_bag, bagStatus ? c.stateLabel(bagStatus) : "") : entityRows(c, ["button.manual_dust_bag_drying"])}
            ${entityRows(c, [...BAG, "sensor.dust_bag_drying_left"])}
          </doc-section>`
        : nothing}
    `;
  }

  _empty(c, acts) {
    return html`<doc-section>
      ${this._manual(acts.empty)}
      ${entityRows(c, [...EMPTY, ...EMPTY_STATUS])}
    </doc-section>`;
  }
}

customElements.get("doc-dock-settings") || customElements.define("doc-dock-settings", DockSettings);
