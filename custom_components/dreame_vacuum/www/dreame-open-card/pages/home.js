/*
 * Home screen: live map, task types, action buttons, controls, notifications,
 * object bubbles and the main menu. Mirrors https://dvc.tasshack.com/guide/home-screen
 */

import { LitElement, html, svg, css, nothing, base, carpetsFromMapData, prettify, dedupeName } from "../core.js";
import { normRect, areaCorners, polyPoints } from "../map-view.js";
import "../map-view.js";

const TASK_TYPES = [
  { id: "global", icon: "mdi:home", key: "global_cleaning", label: "Global" },
  { id: "rooms", icon: "mdi:floor-plan", key: "room_cleaning", label: "Rooms" },
  { id: "zone", icon: "mdi:select-drag", key: "zone_cleaning", label: "Zone" },
  { id: "spot", icon: "mdi:target", key: "spot_cleaning", label: "Spot" },
  { id: "goto", icon: "mdi:map-marker-radius", key: "go_to_point", label: "Go to" },
];
const SPOT_HALF_MM = 750; // spot cleaning covers 1.5 m x 1.5 m around each point
const DEFAULT_ZONE_MM = 2000;
const MAX_ZONES = 5;
const MAX_SPOTS = 5;
const MIN_ZONE_MM = 300;
const LOW_ACCESSORY_PCT = 30;
const CONSUMABLE_PREFIXES = [
  "main_brush", "side_brush", "filter", "tank_filter", "sensor_dirty", "fluffing_roller_dirty", "water_outlet_filter_dirty",
  "dirty_water_channel_dirty", "mop_pad", "detergent", "deodorizer", "silver_ion", "squeegee", "onboard_dirty_water_tank",
  "roller_mop_filter_dirty", "scale_inhibitor", "wheel_dirty",
];

const storage = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

// Bounding rectangle [x0,y0,x1,y1] in vacuum coords for an area-like object.
function areaBounds(a) {
  const corners = a.x2 != null ? [[a.x0, a.y0], [a.x1, a.y1], [a.x2, a.y2], [a.x3, a.y3]] : areaCorners([a.x0, a.y0, a.x1, a.y1, a.angle]);
  return cornersBounds(corners);
}
function furnitureCorners(f) {
  const w = (f.width || 0) * (f.scale || 1);
  const h = (f.height || 0) * (f.scale || 1);
  return areaCorners([f.x - w / 2, f.y - h / 2, f.x + w / 2, f.y + h / 2, f.angle || 0]);
}
function cornersBounds(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round);
}
const areaPoints = (a) => (a.x2 != null ? [[a.x0, a.y0], [a.x1, a.y1], [a.x2, a.y2], [a.x3, a.y3]] : areaCorners([a.x0, a.y0, a.x1, a.y1, a.angle]));

class DocHome extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    _mode: { state: true },
    _rooms: { state: true },
    _zones: { state: true },
    _spots: { state: true },
    _goto: { state: true },
    _repeats: { state: true },
    _bubble: { state: true },
    _sheet: { state: true },
    _busy: { state: true },
    _dismissed: { state: true },
    _dockLoaded: { state: true },
    _tick: { state: true },
  };

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 8px 6px 16px;
      }
      .title {
        font-size: 1.15em;
        font-weight: 500;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .title .state {
        margin-left: 8px;
        font-size: 0.8em;
        font-weight: 400;
        color: var(--doc-muted);
      }
      .status {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 0 16px 8px;
        color: var(--doc-muted);
        font-size: 0.9em;
        flex-wrap: wrap;
      }
      .status span {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .status ha-icon {
        --mdc-icon-size: 18px;
      }
      .battery.low {
        color: var(--doc-error);
      }
      .battery.charging {
        color: var(--success-color, #43a047);
      }
      .progress {
        height: 3px;
        background: var(--doc-divider);
      }
      .progress div {
        height: 100%;
        background: var(--doc-accent);
        transition: width 0.5s;
      }
      .banner {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 12px 8px;
        padding: 8px 8px 8px 12px;
        border-radius: 10px;
        color: #fff;
        font-size: 0.92em;
        touch-action: pan-y;
      }
      .banner.error {
        background: var(--doc-error);
      }
      .banner.warning,
      .banner.low_water {
        background: var(--doc-warn);
      }
      .banner.info {
        background: var(--doc-accent);
      }
      .banner .text {
        flex: 1;
      }
      .banner button {
        color: inherit;
        border-color: rgba(255, 255, 255, 0.6);
        min-height: 30px;
      }
      .banner button.icon {
        border: none;
      }
      .mapwrap {
        position: relative;
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px 0 4px;
        min-height: 40px;
      }
      .toolbar.left {
        flex-direction: row-reverse;
        padding: 6px 4px 0 12px;
      }
      .toolbar .hint {
        flex: 1;
        padding: 0 0 0 12px;
      }
      .fabs {
        display: flex;
        gap: 6px;
      }
      .fab {
        width: 38px;
        height: 38px;
        min-height: 38px;
        padding: 0;
        border-radius: 50%;
        background: var(--doc-surface-2);
        border: none;
        font-weight: 500;
      }
      .fab.on {
        background: var(--doc-accent);
        color: var(--text-primary-color, #fff);
      }
      .hint {
        padding: 6px 16px 0;
        color: var(--doc-muted);
        font-size: 0.85em;
      }
      .types {
        display: flex;
        gap: 4px;
        padding: 8px 12px 0;
        flex-wrap: wrap;
      }
      .types button {
        flex: 1;
        padding: 6px 4px;
        font-size: 0.9em;
      }
      .controls {
        display: flex;
        gap: 6px;
        padding: 10px 12px 12px;
        align-items: center;
        flex-wrap: wrap;
      }
      .controls.left {
        flex-direction: row-reverse;
      }
      .controls .main {
        flex: 1;
        min-width: 120px;
      }
      .dock.warning {
        color: var(--doc-warn);
        border-color: var(--doc-warn);
      }
      .dock.error {
        color: var(--doc-error);
        border-color: var(--doc-error);
      }
      .menu-item,
      .sc-item {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 20px;
        cursor: pointer;
      }
      .menu-item:hover,
      .sc-item:hover {
        background: var(--doc-surface-2);
      }
      .menu-item .badge {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--doc-warn);
      }
      .sc-item .name {
        flex: 1;
      }
      .photo {
        width: 100%;
        display: block;
        cursor: zoom-in;
        background: var(--doc-surface-2);
        min-height: 120px;
      }
      .ob-meta {
        padding: 10px 16px;
        display: grid;
        gap: 4px;
      }
      .sheet-actions {
        display: flex;
        gap: 8px;
        padding: 8px 16px 0;
        flex-wrap: wrap;
      }
    `,
  ];

  constructor() {
    super();
    this._mode = "global";
    this._rooms = [];
    this._zones = [];
    this._spots = [];
    this._goto = null;
    this._repeats = 1;
    this._bubble = null;
    this._sheet = null;
    this._busy = false;
    this._drag = null;
    this._dockLoaded = false;
    this._tick = 0;
  }

  get _hidden() {
    return new Set(this.ctx?.config.hidden_card_objects || []);
  }
  get _vac() {
    return this.ctx.attrs;
  }
  get _started() {
    return !!this._vac.started;
  }

  willUpdate(changed) {
    if (!changed.has("ctx") || !this.ctx) return;
    if (this._dismissed === undefined) this._dismissed = storage.get(this._dismissKey, {});
    // Return to Global once a task finishes on its own; a manual Stop keeps the mode.
    const started = this._started;
    if (this._wasStarted && !started) {
      if (!this._manualStop) this._resetSelection("global");
      this._manualStop = false;
    }
    this._wasStarted = started;
  }

  get _dismissKey() {
    return `doc-dismissed:${this.ctx.vacuumId}`;
  }

  _resetSelection(mode = this._mode) {
    this._mode = mode;
    this._rooms = [];
    this._zones = [];
    this._spots = [];
    this._goto = null;
    this._bubble = null;
  }

  _taskTypes() {
    const allowed = this.ctx.config.task_types;
    const can = (id) => id !== "rooms" || this.ctx.rooms().length > 0;
    return TASK_TYPES.filter((t) => (!allowed?.length || t.id === "global" || allowed.includes(t.id)) && can(t.id));
  }

  // The task type that is actually running, for the selector icon.
  _activeType() {
    const v = this._vac;
    if (!this._started) return null;
    if (v.segment_cleaning) return "rooms";
    if (v.zone_cleaning) return "zone";
    if (v.spot_cleaning) return "spot";
    if (v.cruising) return "goto";
    return "global";
  }

  // ---- render -----------------------------------------------------------

  render() {
    const ctx = this.ctx;
    if (!ctx) return nothing;
    const hidden = this._hidden;
    const left = !!ctx.config.left_handed;
    return html`
      ${hidden.has("title") && hidden.has("menu") && hidden.has("status") ? nothing : this._renderHeader()}
      ${hidden.has("status") ? nothing : this._renderStatus()}
      ${this._renderProgress()} ${this._renderBanners()}
      <div class="mapwrap">
        <doc-map
          .ctx=${ctx}
          .overlay=${(tf, u, size) => this._overlay(tf, u, size)}
          @map-down=${this._down}
          @map-move=${this._move}
          @map-up=${this._up}
        ></doc-map>
      </div>
      <div class="toolbar ${left ? "left" : ""}">
        <div class="hint">${this._hint()}</div>
        ${hidden.has("action_buttons") ? nothing : html`<div class="fabs">${this._renderFabs()}</div>`}
      </div>
      ${this._renderTypes()} ${hidden.has("controls") ? nothing : this._renderControls(left)} ${this._renderSheet()}
    `;
  }

  _renderHeader() {
    const ctx = this.ctx;
    const hidden = this._hidden;
    const title = ctx.config.title ?? dedupeName(ctx.vacuum.attributes.friendly_name ?? "");
    return html`<div class="header">
      <div class="title">
        ${hidden.has("title") ? "" : title}
        ${hidden.has("status") ? nothing : html`<span class="state">${this._statusText()}</span>`}
      </div>
      ${hidden.has("menu")
        ? nothing
        : html`<button class="icon" title=${ctx.t("title", "menu", "Menu")} @click=${() => (this._sheet = "menu")}>
            <ha-icon icon="mdi:dots-vertical"></ha-icon>
          </button>`}
    </div>`;
  }

  // Localized robot status; while the base is washing or drying the mop that
  // is what the robot is actually doing, so show the base's status instead.
  _statusText() {
    const ctx = this.ctx;
    const v = this._vac;
    const base = (v.washing || v.drying || v.returning_to_wash) && ctx.st("sensor", "self_wash_base_status");
    const st = base || ctx.st("sensor", "status");
    return st ? ctx.stateLabel(st) : prettify(v.status ?? ctx.vacuum.state);
  }

  _renderStatus() {
    const ctx = this.ctx;
    const v = this._vac;
    const battery = v.battery ?? ctx.vacuum.attributes.battery_level;
    const charging = !!v.charging;
    const low = battery != null && battery <= 20 && !charging;
    const icon = ctx.vacuum.attributes.battery_icon || (low ? "mdi:battery-alert" : "mdi:battery");
    const area = ctx.st("sensor", "cleaned_area");
    const time = ctx.st("sensor", "cleaning_time");
    return html`<div class="status">
      ${this._started && area ? html`<span><ha-icon icon="mdi:texture-box"></ha-icon>${ctx.area(area.state)}</span>` : nothing}
      ${this._started && time ? html`<span><ha-icon icon="mdi:timer-outline"></ha-icon>${ctx.duration(time.state)}</span>` : nothing}
      ${battery != null
        ? html`<span class="battery ${low ? "low" : ""} ${charging ? "charging" : ""}"><ha-icon icon=${icon}></ha-icon>${battery}%</span>`
        : nothing}
    </div>`;
  }

  _renderProgress() {
    if (this._hidden.has("progress_bar") || !this._started) return nothing;
    const p = Number(this.ctx.st("sensor", "cleaning_progress")?.state);
    if (!Number.isFinite(p)) return nothing;
    return html`<div class="progress"><div style="width:${Math.max(0, Math.min(100, p))}%"></div></div>`;
  }

  // ---- notifications ------------------------------------------------------

  _notifications() {
    const ctx = this.ctx;
    const v = this._vac;
    const hidden = this._hidden;
    const out = [];
    const faults = v.faults && typeof v.faults === "object" ? v.faults : {};
    const codes = Object.keys(faults).sort();
    if (codes.length) {
      const level = v.has_error ? "error" : "warning";
      if (!hidden.has(`${level === "error" ? "fault" : "warning"}_notification`)) {
        const err = ctx.st("sensor", "error");
        const text = err && err.state !== "no_error" ? ctx.stateLabel(err) : Object.values(faults).join(", ");
        out.push({ id: `${level}:${codes.join(",")}`, level, text, clearable: level === "warning" });
      }
    }
    if (v.low_water && !hidden.has("low_water_notification")) {
      out.push({ id: "low_water", level: "low_water", text: ctx.t("message", "low_water", "Clean water tank is low"), clearable: true });
    }
    if (v.has_temporary_map && !hidden.has("information_notification")) {
      out.push({
        id: "temp_map",
        level: "info",
        text: ctx.t("title", "temporary_map", "Temporary map"),
        action: { label: ctx.t("action", "map_management", "Maps"), run: () => ctx.navigate("maps") },
      });
    }
    return out.filter((n) => !this._dismissed?.[n.id]);
  }

  _renderBanners() {
    return this._notifications().map(
      (n) => html`<div
        class="banner ${n.level}"
        @pointerdown=${(e) => (this._swipe = { x: e.clientX, id: n.id })}
        @pointerup=${(e) => {
          if (this._swipe?.id === n.id && Math.abs(e.clientX - this._swipe.x) > 60) this._dismiss(n);
          this._swipe = null;
        }}
      >
        <ha-icon icon=${n.level === "error" ? "mdi:alert-circle" : n.level === "info" ? "mdi:information" : n.level === "low_water" ? "mdi:water-alert" : "mdi:alert"}></ha-icon>
        <div class="text">${n.text}</div>
        ${n.action ? html`<button @click=${n.action.run}>${n.action.label}</button>` : nothing}
        <button class="icon" title="Dismiss" @click=${() => this._dismiss(n)}><ha-icon icon="mdi:close"></ha-icon></button>
      </div>`
    );
  }

  async _dismiss(n) {
    // Remember until a new or different fault appears (ids encode the fault codes).
    this._dismissed = { ...Object.fromEntries(Object.entries(this._dismissed || {}).filter(([k]) => this._notifications().some((x) => x.id === k))), [n.id]: true };
    storage.set(this._dismissKey, this._dismissed);
    if (!n.clearable) return;
    if (n.level === "low_water") await this.ctx.action("clear_low_water_warning");
    else if (this.ctx.ent("button", "clear_warning")) await this.ctx.press("clear_warning");
    else await this.ctx.action("clear_warning");
  }

  // ---- map overlay --------------------------------------------------------

  _overlay(tf, u, [w, h]) {
    const ctx = this.ctx;
    const m = ctx.mapAttrs;
    // While a task runs, show that task's context (e.g. the rooms being cleaned).
    const mode = (this._started && this._activeType()) || this._mode;
    const parts = [];
    const pt = (x, y) => tf.toMap(x, y);

    // Carpets and furniture are tappable in Global and Zone modes.
    if (mode === "global" || mode === "zone") {
      [...(m.carpets || []), ...(m.detected_carpets || [])].forEach((c, i) => {
        const sel = this._bubble?.kind === "carpet" && this._bubble.index === i;
        parts.push(svg`<polygon data-kind="carpet" data-index=${i} points=${polyPoints(tf, areaPoints(c))}
          fill=${sel ? "rgba(3,169,244,.25)" : "transparent"} stroke=${sel ? "var(--doc-accent)" : "none"} stroke-width="2" vector-effect="non-scaling-stroke"></polygon>`);
      });
      (m.furnitures || []).forEach((f, i) => {
        const sel = this._bubble?.kind === "furniture" && this._bubble.index === i;
        parts.push(svg`<polygon data-kind="furniture" data-index=${i} points=${polyPoints(tf, furnitureCorners(f))}
          fill=${sel ? "rgba(3,169,244,.25)" : "transparent"} stroke=${sel ? "var(--doc-accent)" : "none"} stroke-width="2" vector-effect="non-scaling-stroke"></polygon>`);
      });
    }

    // Obstacles on the live map.
    if (mode !== "rooms") {
      for (const [key, o] of Object.entries(m.obstacles || {})) {
        const [x, y] = pt(o.x, o.y);
        const ignored = /ignored/i.test(String(o.ignore_status || "")) && !/not/i.test(String(o.ignore_status));
        parts.push(svg`<circle data-kind="obstacle" data-key=${key} cx=${x} cy=${y} r=${9 * u}
          fill=${ignored ? "#9e9e9e" : "#ff7043"} stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"></circle>`);
      }
    }

    if (mode === "rooms") {
      const active = new Set(this._vac.active_segments || []);
      for (const r of ctx.rooms()) {
        if (r.x == null) continue;
        const [x, y] = pt(r.x, r.y);
        const order = this._rooms.indexOf(r.id);
        const sel = order >= 0;
        const fs = 13 * u;
        parts.push(svg`<g data-kind="room" data-room=${r.id} transform="translate(${x} ${y})" style="cursor:pointer">
          <circle r=${fs * 1.15} fill=${sel ? "var(--doc-accent)" : active.has(r.id) ? "rgba(3,169,244,.6)" : "rgba(0,0,0,.45)"}
            stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"></circle>
          <text dy="0.35em" font-size=${fs} fill="#fff" text-anchor="middle" style="pointer-events:none">${sel ? order + 1 : "+"}</text>
          <text dy=${fs * 2.5} font-size=${fs * 0.85} fill="#fff" text-anchor="middle" paint-order="stroke" stroke="rgba(0,0,0,.6)" stroke-width="3"
            style="pointer-events:none">${ctx.roomName(r)}</text>
        </g>`);
      }
    }

    if (mode === "zone") {
      this._zones.forEach((z, i) => {
        const r = normRect(z);
        const [hx, hy] = pt(r[2], r[1]);
        const [dx, dy] = pt(r[0], r[3]);
        parts.push(svg`<polygon data-kind="zone" data-index=${i} points=${polyPoints(tf, areaCorners(r))}
            fill="rgba(3,169,244,.2)" stroke="var(--doc-accent)" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" style="cursor:move"></polygon>
          <circle data-kind="zone-handle" data-index=${i} cx=${hx} cy=${hy} r=${9 * u} fill="#fff" stroke="var(--doc-accent)" stroke-width="3" vector-effect="non-scaling-stroke"></circle>
          <g data-kind="zone-del" data-index=${i} transform="translate(${dx} ${dy})" style="cursor:pointer">
            <circle r=${10 * u} fill="var(--doc-error)"></circle>
            <text dy="0.35em" font-size=${14 * u} fill="#fff" text-anchor="middle" style="pointer-events:none">×</text>
          </g>`);
      });
    }

    if (mode === "spot") {
      this._spots.forEach(([x, y], i) => {
        const sq = areaCorners([x - SPOT_HALF_MM, y - SPOT_HALF_MM, x + SPOT_HALF_MM, y + SPOT_HALF_MM]);
        const [cx, cy] = pt(x, y);
        parts.push(svg`<polygon points=${polyPoints(tf, sq)} fill="rgba(3,169,244,.18)" stroke="var(--doc-accent)" stroke-width="2" vector-effect="non-scaling-stroke"></polygon>
          <circle data-kind="spot" data-index=${i} cx=${cx} cy=${cy} r=${10 * u} fill="var(--doc-accent)" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke" style="cursor:pointer"></circle>`);
      });
    }

    if (mode === "goto") {
      for (const [i, p] of (m.predefined_points || []).entries()) {
        const [x, y] = pt(p.x, p.y);
        parts.push(svg`<circle data-kind="ppoint" data-index=${i} cx=${x} cy=${y} r=${8 * u} fill="#fff" stroke="var(--doc-accent)" stroke-width="3" vector-effect="non-scaling-stroke" style="cursor:pointer"></circle>`);
      }
      if (this._goto) {
        const [x, y] = pt(...this._goto);
        const s = 22 * u;
        parts.push(svg`<path transform="translate(${x} ${y})" fill="var(--doc-accent)" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"
          d="M0 0 C ${-s * 0.6} ${-s * 0.8} ${-s * 0.6} ${-s * 1.6} 0 ${-s * 1.6} C ${s * 0.6} ${-s * 1.6} ${s * 0.6} ${-s * 0.8} 0 0 Z"></path>`);
      }
    }

    if (this._bubble) parts.push(this._bubbleSvg(tf, u, w));
    return parts;
  }

  _bubbleSvg(tf, u, w) {
    const b = this._bubble;
    const [x, y] = tf.toMap(b.x, b.y);
    const fs = 12 * u;
    const label = b.label;
    const width = Math.min(w * 0.9, (label.length * 0.58 + 3.2) * fs + (b.spot ? 2.2 * fs : 0));
    const hgt = fs * 2.2;
    // Keep the bubble on-canvas.
    const bx = Math.max(4 * u, Math.min(w - width - 4 * u, x - width / 2));
    const by = y - hgt - 14 * u < 0 ? y + 14 * u : y - hgt - 14 * u;
    const icon = b.kind === "obstacle" ? "›" : "⚙";
    return svg`<g data-kind="bubble" style="cursor:pointer">
      <rect x=${bx} y=${by} width=${width} height=${hgt} rx=${hgt / 2} fill="rgba(33,33,33,.88)"></rect>
      <text x=${bx + fs} y=${by + hgt / 2} dy="0.35em" font-size=${fs} fill="#fff" style="pointer-events:none">${label} ${icon}</text>
      ${b.spot
        ? svg`<g data-kind="bubble-spot" transform="translate(${bx + width - fs * 1.3} ${by + hgt / 2})">
            <circle r=${fs * 0.85} fill="var(--doc-accent)"></circle>
            <text dy="0.35em" font-size=${fs} fill="#fff" text-anchor="middle" style="pointer-events:none">◎</text></g>`
        : nothing}
    </g>`;
  }

  // ---- pointer ------------------------------------------------------------

  _down(e) {
    const { x, y, data, map, event } = e.detail;
    const kind = data?.kind;
    const ctx = this.ctx;
    const m = ctx.mapAttrs;
    const locked = this._started && this._mode !== "global";

    if (kind === "bubble-spot") {
      const b = this._bubble;
      this._bubble = null;
      if (!this._started) {
        this._mode = "spot";
        this._spots = [...this._spots, [Math.round(b.x), Math.round(b.y)]].slice(-MAX_SPOTS);
      }
      return;
    }
    if (kind === "bubble") return this._openBubble();

    if (kind === "obstacle") {
      const o = m.obstacles?.[data.key];
      if (!o) return;
      const label = `${o.type}${o.possibility ? ` ${o.possibility}%` : ""}`;
      this._bubble = { kind: "obstacle", key: data.key, x: o.x, y: o.y, label, spot: !this._started };
      return;
    }

    if (kind === "carpet" || kind === "furniture") {
      const i = Number(data.index);
      const list = kind === "carpet" ? [...(m.carpets || []), ...(m.detected_carpets || [])] : m.furnitures || [];
      const obj = list[i];
      if (!obj) return;
      const bounds = kind === "carpet" ? areaBounds(obj) : cornersBounds(furnitureCorners(obj));
      const again = this._bubble?.kind === kind && this._bubble.index === i;
      // Zone mode, or a second tap in Global: clean exactly this object.
      if (!this._started && (this._mode === "zone" || again)) {
        this._mode = "zone";
        this._zones = [...this._zones, bounds].slice(-MAX_ZONES);
        this._bubble = null;
        return;
      }
      const cx = (bounds[0] + bounds[2]) / 2;
      const cy = Math.max(bounds[1], bounds[3]);
      const label = kind === "carpet" ? ctx.t("action", "carpet", "Carpet") : String(obj.type || ctx.t("title", "furniture", "Furniture"));
      this._bubble = { kind, index: i, x: cx, y: cy, label, obj };
      return;
    }

    this._bubble = null;
    if (locked) return;

    switch (this._mode) {
      case "rooms":
        if (kind === "room") {
          const id = Number(data.room);
          const i = this._rooms.indexOf(id);
          this._rooms = i >= 0 ? this._rooms.filter((r) => r !== id) : [...this._rooms, id];
        }
        return;
      case "zone": {
        const i = Number(data?.index);
        if (kind === "zone-del") {
          this._zones = this._zones.filter((_, j) => j !== i);
          return;
        }
        if (kind === "zone-handle") {
          const r = normRect(this._zones[i]);
          this._drag = { kind: "resize", index: i, fixed: [r[0], r[3]] };
        } else if (kind === "zone") {
          this._drag = { kind: "move", index: i, start: [x, y], orig: [...this._zones[i]] };
        } else {
          if (this._zones.length >= MAX_ZONES) return ctx.toast(ctx.t("message", "max_zones", `Up to ${MAX_ZONES} zones`));
          this._zones = [...this._zones, [x, y, x, y]];
          this._drag = { kind: "resize", index: this._zones.length - 1, fixed: [x, y], isNew: true };
        }
        map.capture(event);
        return;
      }
      case "spot":
        if (kind === "spot") {
          const i = Number(data.index);
          this._spots = this._spots.filter((_, j) => j !== i);
        } else if (this._spots.length < MAX_SPOTS) {
          this._spots = [...this._spots, [x, y]];
        } else ctx.toast(`Up to ${MAX_SPOTS} points`);
        return;
      case "goto":
        if (kind === "ppoint") {
          const p = m.predefined_points[Number(data.index)];
          this._goto = [Math.round(p.x), Math.round(p.y)];
        } else this._goto = [x, y];
        return;
    }
  }

  _move(e) {
    const d = this._drag;
    if (!d) return;
    const { x, y } = e.detail;
    const zones = [...this._zones];
    if (d.kind === "resize") zones[d.index] = normRect([d.fixed[0], d.fixed[1], x, y]);
    else {
      const dx = x - d.start[0];
      const dy = y - d.start[1];
      zones[d.index] = [d.orig[0] + dx, d.orig[1] + dy, d.orig[2] + dx, d.orig[3] + dy];
    }
    this._zones = zones;
  }

  _up() {
    const d = this._drag;
    this._drag = null;
    if (!d || d.kind !== "resize") return;
    const z = this._zones[d.index];
    if (!z) return;
    if (Math.abs(z[2] - z[0]) < MIN_ZONE_MM || Math.abs(z[3] - z[1]) < MIN_ZONE_MM) {
      if (d.isNew) {
        // A tap: drop a default-sized zone centred there instead.
        const [cx, cy] = [d.fixed[0], d.fixed[1]];
        const half = DEFAULT_ZONE_MM / 2;
        this._zones = this._zones.map((r, i) => (i === d.index ? [cx - half, cy - half, cx + half, cy + half] : r));
      }
    }
  }

  async _openBubble() {
    const b = this._bubble;
    if (!b) return;
    if (b.kind === "obstacle") this._sheet = { kind: "obstacle", key: b.key };
    else if (b.kind === "carpet") {
      // Attribute carpets lack ids; resolve the same carpet from the full map JSON.
      const manual = (this.ctx.mapAttrs.carpets || []).length;
      const object_type = b.index < manual ? 1 : 0;
      const lists = carpetsFromMapData(await this.ctx.mapData());
      const full = lists && (object_type ? lists.carpets[b.index] : lists.detected_carpets[b.index - manual]);
      this.ctx.navigate("carpet-settings", { carpet: { ...b.obj, ...(full || {}), object_type } });
    }
    else if (b.kind === "furniture") this.ctx.navigate("object-edit", { mode: "furniture" });
    this._bubble = null;
  }

  // ---- action buttons ----------------------------------------------------------

  _hasDock() {
    const v = this._vac;
    return this.ctx.can("self_wash_base") || this.ctx.can("auto_empty_base") || v.washing_available !== undefined || v.dust_collection_available !== undefined;
  }

  _shortcuts() {
    const sc = this._vac.shortcuts;
    return sc && typeof sc === "object" ? Object.values(sc).filter(Boolean) : [];
  }

  _renderFabs() {
    const ctx = this.ctx;
    const mode = this._mode;
    if (mode === "goto") return nothing;
    const fabs = [];
    const fab = (icon, title, run, extra = "") =>
      fabs.push(html`<button class="fab ${extra}" title=${title} @click=${run}><ha-icon icon=${icon}></ha-icon></button>`);

    if (mode === "zone" || mode === "spot") {
      fab("mdi:plus", ctx.t("action", "add_cleaning_area", "Add cleaning area"), () => this._addArea());
    }
    const customized = ctx.st("switch", "customized_cleaning")?.state === "on";
    if (mode === "zone" || mode === "spot" || (mode === "rooms" && !customized)) {
      fabs.push(html`<button class="fab" title=${ctx.t("action", "repeats", "Repeats")} @click=${() => (this._repeats = (this._repeats % 3) + 1)}>
        ×${this._repeats}
      </button>`);
    }
    if (ctx.config.shortcut_scripts?.length || this._shortcuts().length) {
      if (!this._hidden.has("shortcuts")) fab("mdi:play-box-multiple-outline", ctx.t("action", "shortcuts", "Shortcuts"), () => (this._sheet = "shortcuts"));
    }
    if (ctx.can("multi_floor_map") || (this._vac.maps || []).length > 1) {
      fab("mdi:layers-outline", ctx.t("action", "map_management", "Map management"), () => ctx.navigate("maps"));
    }
    if (this._hasDock()) fab("mdi:home-floor-g", ctx.t("action", "dock_settings", "Dock settings"), () => ctx.navigate("dock-settings"));
    fab("mdi:tune-variant", ctx.t("action", "cleaning_settings", "Cleaning settings"), () => ctx.navigate("cleaning-settings"));
    return fabs;
  }

  _addArea() {
    // Add at the map centre (vacuum coords of the image centre).
    const map = this.renderRoot.querySelector("doc-map");
    const tf = map?.transform;
    const size = map?._size;
    if (!tf || !size) return;
    const [cx, cy] = tf.toVacuum(size[0] / 2, size[1] / 2);
    if (this._mode === "zone") {
      if (this._zones.length >= MAX_ZONES) return this.ctx.toast(`Up to ${MAX_ZONES} zones`);
      const half = DEFAULT_ZONE_MM / 2;
      this._zones = [...this._zones, [cx - half, cy - half, cx + half, cy + half]];
    } else if (this._spots.length < MAX_SPOTS) this._spots = [...this._spots, [cx, cy]];
  }

  // ---- task types & controls ----------------------------------------------

  _renderTypes() {
    const types = this._taskTypes();
    if (types.length < 2) return nothing;
    const active = this._activeType();
    const ctx = this.ctx;
    const v = this._vac;
    const scheduled = /sched/i.test(String(v.startup_method || ""));
    return html`<div class="types">
      ${types.map((t) => {
        const isActive = active === t.id;
        let icon = t.icon;
        if (isActive && v.shortcut_task) icon = "mdi:play-box-multiple";
        else if (isActive && scheduled) icon = t.id === "global" ? "mdi:home-clock" : "mdi:calendar-clock";
        return html`<button
          class=${(active ? isActive : this._mode === t.id) ? "active" : ""}
          ?disabled=${this._started}
          @click=${() => {
            this._mode = t.id;
            this._bubble = null;
          }}
        >
          <ha-icon icon=${icon}></ha-icon>${ctx.t("title", t.key, t.label)}
        </button>`;
      })}
    </div>`;
  }

  _selectionCount() {
    return { global: 1, rooms: this._rooms.length, zone: this._zones.length, spot: this._spots.length, goto: this._goto ? 1 : 0 }[this._mode];
  }

  _renderControls(left) {
    const ctx = this.ctx;
    const v = this._vac;
    const state = ctx.vacuum.state;
    const started = this._started;
    const paused = !!v.paused || state === "paused";
    const docked = !!v.docked || state === "docked";
    const n = this._selectionCount();
    const t = (k, f) => ctx.t("action", k, f);
    const buttons = [];

    if (!started) {
      const label = this._mode === "goto" ? t("go_to", "Go") : t("clean", "Clean");
      buttons.push(html`<button class="primary main" ?disabled=${this._busy || !n} @click=${() => this._start()}>
        <ha-icon icon="mdi:play"></ha-icon>${label}${this._mode !== "global" && this._mode !== "goto" && n ? ` (${n})` : ""}
      </button>`);
    } else if (paused) {
      buttons.push(html`<button class="primary main" @click=${() => ctx.vacuumCmd("start")}><ha-icon icon="mdi:play"></ha-icon>${t("resume", "Resume")}</button>`);
    } else {
      buttons.push(html`<button class="main" @click=${() => ctx.vacuumCmd("pause")}><ha-icon icon="mdi:pause"></ha-icon>${t("pause", "Pause")}</button>`);
    }
    if (started || v.washing || v.drying) {
      buttons.push(html`<button title=${t("stop", "Stop")} @click=${() => this._stop()}><ha-icon icon="mdi:stop"></ha-icon></button>`);
    }
    if (!docked || v.returning) {
      buttons.push(html`<button title=${t("charge", "Return")} @click=${() => ctx.vacuumCmd("return_to_base")}>
        <ha-icon icon="mdi:home-import-outline"></ha-icon>
      </button>`);
    }
    if (this._hasDock() && (docked || started)) {
      const level = this._dockLevel();
      buttons.push(html`<button class="dock ${level || ""}" title=${ctx.t("action", "dock", "Dock")} @click=${() => this._openDock()}>
        <ha-icon icon="mdi:home-floor-g"></ha-icon>
      </button>`);
    }
    return html`<div class="controls ${left ? "left" : ""}">${buttons}</div>`;
  }

  async _start() {
    const ctx = this.ctx;
    const repeats = this._repeats;
    // With customized cleaning on, empty lists make device.clean_segment fall
    // back to each room's own settings; a scalar would override every room.
    const perRoom = ctx.st("switch", "customized_cleaning")?.state === "on"
      ? { repeats: [], suction_level: [], water_volume: [] }
      : { repeats };
    const calls = {
      global: () => ctx.vacuumCmd("start"),
      rooms: () => ctx.vac("vacuum_clean_segment", { segments: [...this._rooms], ...perRoom }),
      zone: () => ctx.vac("vacuum_clean_zone", { zone: this._zones.map((z) => normRect(z).slice(0, 4).map(Math.round)), repeats }),
      spot: () => ctx.vac("vacuum_clean_spot", { points: this._spots.map((p) => p.map(Math.round)), repeats }),
      goto: () => ctx.vac("vacuum_goto", { x: this._goto[0], y: this._goto[1] }),
    };
    this._busy = true;
    try {
      await calls[this._mode]();
    } finally {
      this._busy = false;
    }
  }

  async _stop() {
    this._manualStop = true;
    const v = this._vac;
    if (!this._started && v.washing) return this.ctx.action("toggle_washing");
    if (!this._started && v.drying) return this.ctx.action("toggle_drying");
    return this.ctx.vacuumCmd("stop");
  }

  // Dock alert colour; dock-actions.js owns the real logic once loaded.
  _dockLevel() {
    if (this._dockModule?.dockAlertLevel) return this._dockModule.dockAlertLevel(this.ctx);
    if (!this._dockImport) {
      this._dockImport = import("./dock-actions.js")
        .then((mod) => {
          this._dockModule = mod;
          this._dockLoaded = true;
        })
        .catch(() => {});
    }
    return null;
  }

  async _openDock() {
    await this._dockImport;
    this._sheet = "dock";
  }

  _hint() {
    const ctx = this.ctx;
    if (this._started) return "";
    return {
      global: "",
      rooms: "Tap rooms in cleaning order",
      zone: "Drag on the map to draw a zone",
      spot: "Tap the floor to add spot points (1.5 m each)",
      goto: "Tap where the robot should go",
    }[this._mode];
  }

  // ---- sheets ---------------------------------------------------------------

  _renderSheet() {
    const s = this._sheet;
    if (!s) return nothing;
    const close = () => (this._sheet = null);
    const ctx = this.ctx;
    if (s === "menu") return html`<doc-sheet open heading=${ctx.t("title", "menu", "Menu")} @closed=${close}>${this._menuItems()}</doc-sheet>`;
    if (s === "shortcuts") return html`<doc-sheet open heading=${ctx.t("action", "shortcuts", "Shortcuts")} @closed=${close}>${this._shortcutItems()}</doc-sheet>`;
    if (s === "dock")
      return html`<doc-sheet open heading=${ctx.t("action", "dock", "Dock")} @closed=${close}>
        ${this._dockLoaded ? html`<doc-dock-actions .ctx=${ctx}></doc-dock-actions>` : html`<div class="hint">Dock controls unavailable</div>`}
      </doc-sheet>`;
    if (s.kind === "obstacle") return this._obstacleSheet(s.key, close);
    return nothing;
  }

  _menuItems() {
    const ctx = this.ctx;
    const v = this._vac;
    const m = ctx.mapAttrs;
    const go = (page, params) => () => {
      this._sheet = null;
      ctx.navigate(page, params);
    };
    const lowAccessory = CONSUMABLE_PREFIXES.some((p) => {
      const s = ctx.st("sensor", `${p}_left`);
      return s && Number(s.state) < LOW_ACCESSORY_PCT;
    });
    const items = [
      { icon: "mdi:map-marker-radius", key: "locate", label: "Locate", run: () => ctx.vacuumCmd("locate") },
      Object.keys(m.cleaning_history_picture || {}).length && { icon: "mdi:history", key: "cleaning_history", label: "Cleaning history", run: go("cleaning-history", { cruising: false }) },
      Object.keys(m.cruising_history_picture || {}).length && { icon: "mdi:map-marker-path", key: "cruising_history", label: "Cruising history", run: go("cleaning-history", { cruising: true }) },
      { icon: "mdi:wrench-clock", key: "accessory_usage", label: "Accessory usage", run: go("accessories"), badge: lowAccessory },
      ctx.can("cleangenius") && { icon: "mdi:sort-numeric-ascending", key: "cleaning_sequence", label: "Cleaning sequence", run: go("cleaning-sequence") },
      { icon: "mdi:gamepad-round-outline", key: "remote_control", label: "Remote control", run: go("remote") },
      (ctx.can("multi_floor_map") || (v.maps || []).length) && { icon: "mdi:layers-outline", key: "map_management", label: "Map management", run: go("maps") },
      { icon: "mdi:cog-outline", key: "device_settings", label: "Device settings", run: go("device-settings") },
    ].filter(Boolean);
    return items.map(
      (i) => html`<div class="menu-item" role="button" @click=${async () => {
          await i.run();
          if (i.key === "locate") this._sheet = null;
        }}>
        <ha-icon icon=${i.icon}></ha-icon><span class="spacer">${ctx.t("title", i.key, i.label)}</span>${i.badge ? html`<span class="badge"></span>` : nothing}
      </div>`
    );
  }

  _shortcutItems() {
    const ctx = this.ctx;
    const running = this._shortcuts().find((s) => s.running);
    const items = this._shortcuts().map(
      (s) => html`<div class="sc-item">
        <ha-icon icon=${s.running ? "mdi:play-circle" : "mdi:play-box-multiple-outline"}></ha-icon>
        <span class="name">${s.name}</span>
        ${s.running
          ? html`<button @click=${() => (this._started && !this._vac.paused ? ctx.vacuumCmd("pause") : ctx.vacuumCmd("start"))}>
              ${this._vac.paused ? ctx.t("action", "resume", "Resume") : ctx.t("action", "pause", "Pause")}
            </button>`
          : html`<button class="primary" @click=${() => ctx.vac("vacuum_start_shortcut", { shortcut_id: Number(s.id) })}>
              ${ctx.t("action", "start", "Start")}
            </button>`}
      </div>`
    );
    const scripts = (ctx.config.shortcut_scripts || []).map((id) => {
      const st = ctx.hass.states[id];
      return html`<div class="sc-item">
        <ha-icon icon=${st?.attributes.icon || "mdi:script-text-outline"}></ha-icon>
        <span class="name">${st?.attributes.friendly_name || id}</span>
        <button class="primary" @click=${() => ctx.call("script", "turn_on", {}, { entity_id: id })}>${ctx.t("action", "start", "Start")}</button>
      </div>`;
    });
    return html`${items}${scripts}${running ? nothing : nothing}`;
  }

  _obstaclePhoto(key) {
    const pics = this.ctx.mapAttrs.obstacle_picture || {};
    // Photo URLs carry index=<obstacle key> (camera.py OBSTACLE_IMAGE_URL).
    return Object.values(pics).find((url) => new URLSearchParams(String(url).split("?")[1] || "").get("index") === String(key));
  }

  _obstacleSheet(key, close) {
    const ctx = this.ctx;
    const o = ctx.mapAttrs.obstacles?.[key];
    if (!o) return nothing;
    const photo = this._obstaclePhoto(key);
    const src = photo ? ctx.url(photo) : "";
    const status = String(o.ignore_status ?? "");
    const ignored = /ignored/i.test(status) && !/not/i.test(status);
    const canIgnore = o.ignore_status !== undefined && o.ignore_status !== null;
    return html`<doc-sheet open heading=${o.type} @closed=${close}>
      ${src ? html`<img class="photo" src=${src} alt=${o.type} @click=${() => window.open(src, "_blank")} />` : nothing}
      <div class="ob-meta">
        ${o.possibility ? html`<div>Confidence: ${o.possibility}%</div>` : nothing}
        ${o.room || o.segment ? html`<div class="muted">${o.room || o.segment}</div>` : nothing}
        ${canIgnore ? html`<div class="muted">${status}</div>` : nothing}
      </div>
      <div class="sheet-actions">
        ${src ? html`<a href=${`${src}${src.includes("?") ? "&" : "?"}file=1`} download><button><ha-icon icon="mdi:download"></ha-icon>${ctx.t("action", "download", "Download")}</button></a>` : nothing}
        ${canIgnore
          ? html`<button
              @click=${async () => {
                if (await ctx.vac("vacuum_set_obstacle_ignore", { x: o.x, y: o.y, obstacle_ignored: !ignored })) close();
              }}
            >
              <ha-icon icon=${ignored ? "mdi:eye" : "mdi:eye-off"}></ha-icon>${ignored ? ctx.t("action", "cancel_ignore", "Don't ignore") : ctx.t("action", "ignore_obstacle", "Ignore")}
            </button>`
          : nothing}
        ${!this._started
          ? html`<button
              @click=${() => {
                this._mode = "spot";
                this._spots = [...this._spots, [Math.round(o.x), Math.round(o.y)]].slice(-MAX_SPOTS);
                close();
              }}
            >
              <ha-icon icon="mdi:target"></ha-icon>${"Spot clean here"}
            </button>`
          : nothing}
      </div>
    </doc-sheet>`;
  }
}

customElements.get("doc-home") || customElements.define("doc-home", DocHome);
