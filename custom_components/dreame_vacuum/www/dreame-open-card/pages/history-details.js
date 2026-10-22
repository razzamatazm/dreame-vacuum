/*
 * <doc-history-details> Cleaning / Cruising details for one history entry.
 * params: { index, cruising? }   (index 1 = newest, as in the camera attribute)
 *
 * Image: the entry URL from map.<cleaning|cruising>_history_picture
 *   (/api/camera_history_map_proxy/<cam>?token=..&index=N&v=ts[&cruising=1]) plus
 *   &info=0 (no text baked into the PNG), &cleaning=1 (cleaning map) or &wifi=1 (Wi-Fi map).
 * Data: same URL + &data=1 -> DreameVacuumMapRenderer.get_data() JSON (dreame/map.py ~8198),
 *   None fields dropped, enums as ints. Fields used here:
 *   cleaned_area, cleaning_time, completed, cleaning_status, startup_method, cleanup_method,
 *   second_cleaning, dust_collection_count, mop_wash_count, task_interrupt_reason, task_end_type,
 *   remaining_battery, blocked_segments {id: [reason, x?, y?]}, has_dirty_area, cleaned_segments,
 *   multiple_cleaning_time, map_id, map_index, segments [[id, x, y, type, b64name, ...]],
 *   cleaning_map_data {...} (cleaning map available), wifi_map_data {...} (Wi-Fi map available).
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import "../components.js";
import "../map-view.js";
import { historyEntries, entryDate, entLabel, statusText } from "./history.js";

// Enum ints (dreame/types.py) -> translation state keys (translations/en.json entity.sensor.*)
const STARTUP = { 0: "button", 1: "app", 2: "scheduled", 3: "voice" };
const STARTUP_ICON = { button: "mdi:button-pointer", app: "mdi:cellphone-play", scheduled: "mdi:calendar-start", voice: "mdi:account-voice", second_cleaning: "mdi:repeat" };
const CLEANUP = { "-1": "other", 0: "default", 1: "customized", 2: "cleangenius", 3: "water_stain" };
const END_TYPE = { 0: "other", 1: "manual_docking", 2: "docking", 3: "failed_docking", 4: "stop" };
const CLEANING_STATUS = { 0: "interrupted", 1: "completed", 2: "manually_ended", 3: "failed" };
const INTERRUPT = {
  0: "task_completed", 11: "robot_lifted", 12: "robot_fallen", 13: "cliff_sensor_error", 14: "mop_pad_removed",
  15: "mop_pad_fallen_off", 16: "mop_pad_stuck", 17: "mop_pad_fallen_off_by_table", 18: "mop_pad_fallen_off_by_obstacle",
  19: "mop_pad_abnormally_removed", 20: "mop_pad_fallen_off_crossing_obstacle", 21: "brush_entangled_by_obstacle",
  22: "brush_entangled_by_carpet", 23: "brush_entangled_by_object", 24: "laser_distance_sensor_error",
  25: "robot_is_stuck_on_step", 26: "robot_is_stuck_on_obstacle", 27: "base_station_powered_off",
  101: "abnormal_docking", 102: "cannot_find_base_station",
};
const OBSTACLE_REASON = {
  2: "blocked_by_virtual_wall", 3: "blocked_by_door", 4: "blocked_by_threshold", 5: "blocked_by_obstacle",
  6: "blocked_by_carpet", 7: "blocked_by_detected_carpet", 8: "blocked_by_hidden_obstacle",
  9: "blocked_by_dynamic_obstacle", 10: "passage_too_low", 27: "step_too_low", 33: "failed_to_cross_threshold",
};

const TYPE_KEY = "dreame-open-card.history-map-type";
const dataCache = new Map(); // url -> Promise<object|null>

const b64 = (s) => {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
};

class DocHistoryDetails extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    _index: { state: true },
    _data: { state: true },
    _loading: { state: true },
    _type: { state: true },
    _info: { state: true },
  };

  static styles = [
    base,
    css`
      .mapwrap {
        position: relative;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap: 8px;
        padding: 12px 16px 4px;
        text-align: center;
      }
      .stat ha-icon {
        color: var(--doc-muted);
      }
      .stat .v {
        font-size: 1.15em;
        font-weight: 500;
      }
      .stat .l {
        font-size: 0.78em;
        color: var(--doc-muted);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 16px;
        justify-content: center;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 14px;
        background: var(--doc-surface-2);
        font-size: 0.9em;
      }
      .chip.ok {
        color: var(--success-color, #2e7d32);
      }
      .chip.bad {
        color: var(--doc-error);
      }
      .date {
        text-align: center;
        color: var(--doc-muted);
        font-size: 0.9em;
        padding: 8px 16px 0;
      }
      .nav {
        display: flex;
        gap: 8px;
        padding: 8px 16px;
      }
      .nav button {
        flex: 1;
      }
      button.icon.alert {
        color: var(--doc-error);
      }
      .rows {
        padding: 0 16px;
      }
      .r {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--doc-divider);
      }
      .r:last-child {
        border-bottom: none;
      }
      .r .k {
        flex: 1;
        color: var(--doc-muted);
      }
      .r .k ha-icon {
        margin-right: 8px;
      }
      .r.alert .v {
        color: var(--doc-error);
      }
      .blocked {
        padding: 0 16px;
      }
      .blocked .r .v {
        color: var(--doc-warn);
      }
      .loading {
        padding: 8px 16px;
        color: var(--doc-muted);
        font-size: 0.85em;
        text-align: center;
      }
      .again {
        padding: 4px 16px 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
    `,
  ];

  willUpdate(changed) {
    if (changed.has("params") && this.params) {
      this._index = Number(this.params.index) || 1;
      this._info = false;
    }
    if (this._type === undefined) {
      this._type = localStorage.getItem(TYPE_KEY) || "history";
    }
  }

  get _cruising() {
    return !!this.params?.cruising;
  }
  get _entries() {
    return historyEntries(this.ctx, this._cruising);
  }
  get _entry() {
    return this._entries.find((e) => e.index === this._index);
  }

  updated() {
    const e = this._entry;
    if (e && this._loadedUrl !== e.url) {
      this._loadedUrl = e.url;
      this._load(e.url);
    }
  }

  async _load(url) {
    this._data = null;
    this._loading = true;
    if (!dataCache.has(url)) dataCache.set(url, this._fetch(url));
    const data = await dataCache.get(url);
    if (this._loadedUrl !== url) return;
    if (!data) dataCache.delete(url); // retry next time
    this._data = data;
    this._loading = false;
  }

  async _fetch(url) {
    if (/^(data|blob):/.test(url)) return null;
    const path = `${url}&data=1`;
    try {
      const hass = this.ctx.hass;
      const res = hass.fetchWithAuth ? await hass.fetchWithAuth(path) : await fetch(this.ctx.url(path));
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn("dreame-open-card: history data", err);
      return null;
    }
  }

  // ---- derived ----------------------------------------------------------
  _types(d) {
    const c = this.ctx;
    const types = [{ id: "history", label: entLabel(c, "select.map_type", "history", "Cleaning details"), icon: "mdi:floor-plan" }];
    if (this._cruising) return types;
    if (d?.cleaning_map_data) types.push({ id: "cleaning", label: entLabel(c, "select.map_type", "cleaning", "Cleaning map"), icon: "mdi:broom" });
    if (d?.wifi_map_data) types.push({ id: "wifi", label: entLabel(c, "select.map_type", "wifi", "Wi-Fi map"), icon: "mdi:wifi-marker" });
    return types;
  }

  _imageUrl(e, type) {
    if (/^(data|blob):/.test(e.url)) return e.url; // not a proxy URL (e.g. base harness mock)
    let u = `${e.url}&info=0`;
    if (type === "cleaning") u += "&cleaning=1";
    else if (type === "wifi") u += "&wifi=1";
    return u;
  }

  _roomName(id, d) {
    const seg = (d?.segments || []).find((s) => Number(s[0]) === Number(id));
    const custom = seg?.[4] ? b64(seg[4]) : null;
    if (custom) return custom;
    const live = this.ctx.rooms({ includeHidden: true }).find((r) => r.id === Number(id));
    return live ? this.ctx.roomName(live) : `Room ${id}`;
  }

  _interrupt(d, e) {
    const v = d?.task_interrupt_reason;
    if (v != null && Number(v) !== 0) return entLabel(this.ctx, "sensor.task_interrupt_reason", INTERRUPT[v] || "unknown");
    const s = e?.info?.interrupt_reason;
    if (s && !/task completed/i.test(s)) return s;
    return null;
  }

  // ---- render -------------------------------------------------------------
  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const cruising = this._cruising;
    const heading = cruising ? c.t("title", "cruising_details", "Cruising Details") : c.t("title", "cleaning_details", "Cleaning Details");
    const entries = this._entries;
    const e = this._entry;
    if (!e) {
      return html`<doc-page .ctx=${c} heading=${heading}><div class="loading">Entry not found</div></doc-page>`;
    }
    const d = this._data;
    const types = this._types(d);
    // Wi-Fi is transient; other choices are remembered. Fall back when this entry lacks the type.
    const type = types.some((t) => t.id === this._type) ? this._type : "history";
    const src = c.url(this._imageUrl(e, type));
    const interrupt = this._interrupt(d, e);
    const older = entries.find((x) => x.index === e.index + 1);
    const newer = entries.find((x) => x.index === e.index - 1);

    return html`<doc-page .ctx=${c} heading=${heading}>
      <button
        slot="actions"
        class="icon ${interrupt ? "alert" : ""}"
        title="Information"
        @click=${() => (this._info = true)}
      >
        <ha-icon icon=${interrupt ? "mdi:message-alert" : "mdi:information-outline"}></ha-icon>
      </button>
      <button slot="actions" class="icon" title=${c.t("action", "download", "Download")} @click=${() => this._download(src, e)}>
        <ha-icon icon="mdi:download"></ha-icon>
      </button>

      <div class="date">${entryDate(c, e, { weekday: true })} · ${statusText(c, e)}</div>
      ${types.length > 1
        ? html`<doc-tabs
            .tabs=${types}
            .selected=${type}
            @select=${(ev) => {
              this._type = ev.detail.id;
              if (ev.detail.id !== "wifi") localStorage.setItem(TYPE_KEY, ev.detail.id);
            }}
          ></doc-tabs>`
        : nothing}
      <div class="mapwrap"><doc-map .ctx=${c} .src=${src} .calibration=${[]}></doc-map></div>

      ${this._stats(d, e)} ${this._meta(d, e)}
      ${this._loading ? html`<div class="loading">Loading details…</div>` : nothing}
      ${this._blocked(d)} ${this._cleanAgain(d, e)}

      <div class="nav">
        <button ?disabled=${!older} @click=${() => (this._index = older.index)}>
          <ha-icon icon="mdi:chevron-left"></ha-icon>${c.t("action", "previous_job", "Previous job")}
        </button>
        <button ?disabled=${!newer} @click=${() => (this._index = newer.index)}>
          ${c.t("action", "next_job", "Next job")}<ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>

      <doc-sheet .open=${!!this._info} heading="Information" @closed=${() => (this._info = false)}>
        ${this._infoRows(d, e, interrupt)}
      </doc-sheet>
    </doc-page>`;
  }

  _stats(d, e) {
    const c = this.ctx;
    const i = e.info || {};
    const area = d?.cleaned_area ?? (i.cleaned_area != null ? parseFloat(i.cleaned_area) : null);
    const iTime = i.cleaning_time ?? i.cruising_time;
    const time = d?.cleaning_time ?? (iTime != null ? parseFloat(iTime) : null);
    const stat = (icon, v, l) => html`<div class="stat">
      <ha-icon icon=${icon}></ha-icon>
      <div class="v">${v}</div>
      <div class="l">${l}</div>
    </div>`;
    const name = (key, fb) => (c.ent("sensor", key) ? c.name(c.ent("sensor", key)) : fb);
    return html`<div class="stats">
      ${this._cruising ? nothing : stat("mdi:texture-box", c.area(area), name("cleaned_area", "Cleaned area"))}
      ${stat("mdi:timer-outline", c.duration(time), name("cleaning_time", "Cleaning time"))}
      ${d?.dust_collection_count != null ? stat("mdi:delete-restore", d.dust_collection_count, "Auto-empty") : nothing}
      ${d?.mop_wash_count != null ? stat("mdi:water-sync", d.mop_wash_count, "Self-wash") : nothing}
    </div>`;
  }

  _meta(d, e) {
    const c = this.ctx;
    const completed = d?.completed ?? e.completed;
    const startup = this._startupKey(d, e);
    return html`<div class="meta">
      <span class="chip ${completed ? "ok" : "bad"}">
        <ha-icon icon=${completed ? "mdi:check-circle" : "mdi:close-circle"}></ha-icon>
        ${entLabel(c, "sensor.cleaning_status", completed ? "completed" : "interrupted")}
      </span>
      ${startup
        ? html`<span class="chip"
            ><ha-icon icon=${STARTUP_ICON[startup] || "mdi:play"}></ha-icon>${entLabel(c, "sensor.startup_method", startup)}</span
          >`
        : nothing}
      ${Number(d?.cleanup_method) === 2 || /cleangenius/i.test(e.info?.cleanup_method || "")
        ? html`<span class="chip"><ha-icon icon="mdi:atom"></ha-icon>CleanGenius</span>`
        : nothing}
    </div>`;
  }

  _startupKey(d, e) {
    if (d?.second_cleaning || e.second) return "second_cleaning";
    if (d?.startup_method == null) return null;
    return STARTUP[d.startup_method] || "unknown";
  }

  _blockedList(d, e) {
    const out = [];
    const src = d?.blocked_segments || null;
    if (src) {
      for (const [id, v] of Object.entries(src)) {
        const reason = Array.isArray(v) ? v[0] : v;
        out.push({ id, name: this._roomName(id, d), reason: entLabel(this.ctx, "sensor.obstacle_reason", OBSTACLE_REASON[reason] || "unknown") });
      }
    } else if (e?.info?.blocked_rooms) {
      for (const [id, reason] of Object.entries(e.info.blocked_rooms)) out.push({ id, name: this._roomName(id, d), reason });
    }
    return out;
  }

  _blocked(d) {
    const list = this._blockedList(d, this._entry);
    if (!list.length && !d?.has_dirty_area) return nothing;
    const heading = list.length ? this.ctx.t("config", "map_object_blocked_segments", "Blocked rooms") : "Dirty area";
    return html`<doc-section heading=${heading}>
      <div class="blocked">
        ${list.map(
          (b) => html`<div class="r">
            <span class="k"><ha-icon icon="mdi:door-closed-cancel"></ha-icon>${b.name}</span><span class="v">${b.reason}</span>
          </div>`
        )}
        ${d?.has_dirty_area
          ? html`<div class="r"><span class="k"><ha-icon icon="mdi:liquid-spot"></ha-icon>Dirty area detected</span></div>`
          : nothing}
      </div>
    </doc-section>`;
  }

  _cleanAgain(d, e) {
    const c = this.ctx;
    // device.start_recleaning(): newest history item only, map must be the current map,
    // targets all blocked rooms (or cleaned/blocked areas via MopAgain for CleanGenius). No per-room choice.
    if (this._cruising || e.index !== 1 || !c.ent("button", "start_recleaning") || !d) return nothing;
    const blocked = d.blocked_segments && Object.keys(d.blocked_segments).length;
    if (!blocked && !d.has_dirty_area) return nothing;
    const sameMap = d.map_id == null || c.mapAttrs.map_id == null || Number(d.map_id) === Number(c.mapAttrs.map_id);
    return html`<div class="again">
      <button class="primary" ?disabled=${!sameMap} @click=${() => this._recleanConfirm()}>
        <ha-icon icon="mdi:refresh-circle"></ha-icon>${c.t("action", "clean_again", "Clean Again")}
      </button>
      ${sameMap ? nothing : html`<span class="muted">Only available while this task's map is selected.</span>`}
    </div>`;
  }

  async _recleanConfirm() {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("action", "clean_again", "Clean Again"),
      text: "Re-clean the blocked rooms and dirty areas of this task?",
      confirmText: c.t("action", "start", "Start"),
    });
    if (ok) c.press("start_recleaning");
  }

  _infoRows(d, e, interrupt) {
    const c = this.ctx;
    const row = (icon, k, v, alert = false) =>
      v == null || v === "" ? nothing : html`<div class="r ${alert ? "alert" : ""}"><span class="k"><ha-icon icon=${icon}></ha-icon>${k}</span><span class="v">${v}</span></div>`;
    const i = e.info || {};
    const label = (path, fb) => c.hass.localize?.(`component.dreame_vacuum.entity.${path}.name`) || fb;
    const cleaned = (d?.cleaned_segments || []).map((id) => this._roomName(id, d)).join(", ");
    const startup = this._startupKey(d, e);
    return html`<div class="rows">
      ${row("mdi:calendar", "Date", entryDate(c, e, { weekday: true }))}
      ${row("mdi:circle-medium", label("sensor.status", "Task"), statusText(c, e))}
      ${row(
        "mdi:check-circle",
        label("sensor.cleaning_status", "Status"),
        d?.cleaning_status != null ? entLabel(c, "sensor.cleaning_status", CLEANING_STATUS[d.cleaning_status] || "unknown") : entLabel(c, "sensor.cleaning_status", e.completed ? "completed" : "interrupted")
      )}
      ${row("mdi:message-alert", label("sensor.task_interrupt_reason", "Interrupt reason"), interrupt, true)}
      ${row("mdi:file-tree", label("sensor.cleanup_method", "Cleanup method"), d?.cleanup_method != null ? entLabel(c, "sensor.cleanup_method", CLEANUP[d.cleanup_method] || "unknown") : i.cleanup_method)}
      ${row(STARTUP_ICON[startup] || "mdi:play", label("sensor.startup_method", "Started by"), startup ? entLabel(c, "sensor.startup_method", startup) : null)}
      ${row("mdi:playlist-check", label("sensor.task_end_type", "Completed by"), d?.task_end_type != null ? entLabel(c, "sensor.task_end_type", END_TYPE[d.task_end_type] || "unknown") : null)}
      ${row("mdi:battery-check", "Remaining battery", d?.remaining_battery != null ? `${d.remaining_battery} %` : null)}
      ${row("mdi:floor-plan", "Cleaned rooms", cleaned)}
      ${row("mdi:map", "Map", d?.map_index != null ? `#${d.map_index}${d.map_id != null ? ` (id ${d.map_id})` : ""}` : i.map_name ?? null)}
      ${row("mdi:water", i.mop_pad != null ? "Mop pad" : "Water tank", i.mop_pad ?? i.water_tank)}
      ${row("mdi:fan", "Suction level", i.suction_level)}
      ${row("mdi:map-marker-path", "Cruising type", i.cruising_type)}
      ${!d && !this._loading ? html`<div class="r"><span class="k muted">Map data unavailable</span></div>` : nothing}
    </div>`;
  }

  async _download(src, e) {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const stamp = e.ts ? new Date(e.ts * 1000).toISOString().slice(0, 16).replace(/[:T]/g, "-") : e.index;
      const ext = (blob.type.split("/")[1] || "png").replace("svg+xml", "svg");
      a.download = `${this._cruising ? "cruising" : "cleaning"}-${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) {
      this.ctx.toast(`Download failed: ${err.message}`);
    }
  }
}

customElements.get("doc-history-details") || customElements.define("doc-history-details", DocHistoryDetails);
