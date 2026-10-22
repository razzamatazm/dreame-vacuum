/*
 * Scheduled Cleanup (DVC guide: /guide/device-settings/scheduled-cleanup).
 *
 * Source: vacuum attribute `schedule`, a list of parsed ScheduledTask dicts
 * {id, enabled, invalid, time "HH:MM", repeats "xxxxxxx", once, map_id (str),
 *  suction_level (int), water_volume (int), options (list|null)}.
 *
 * Writes: dreame_vacuum.vacuum_set_property {key: "schedule", value: <raw>}
 * where raw is the device string parsed by DreameVacuumDevice._schedule_changed:
 *   "<id>-<status>-<HH:MM>-<repeats>-<once>-<map_id>-<suction>-<water>-<options>" joined by ";"
 * The whole list is rewritten on every edit (that is the only write path the
 * integration has). set_property_value only checks >= 9 fields, id != 0 and a
 * ":" in the time; it rejects an empty string, so deleting the last task must
 * go through the delete action, which we always use for deletes:
 *   dreame_vacuum.vacuum_call_action {key: "delete_scheduled_task", value: "<id>"}
 *
 * Serialization assumptions (not confirmable from the integration source,
 * which only parses):
 *  - status: parser maps "1"/"2" -> enabled, "3" -> invalid, anything else ->
 *    disabled. The attribute keeps only booleans, so "1" vs "2" is lost; we
 *    write "1" for enabled, "0" for disabled, "3" for invalid.
 *  - once: parser maps "0" -> once=true. For repeating tasks the original
 *    non-"0" value is lost; we write "1".
 *  - repeats: 7 chars after zfill(7). Which end is Sunday is not in the
 *    source. We treat char index i as WEEKDAYS[i] (Sunday leftmost), matching
 *    the card-wide "index 0 = Sunday" convention. Symmetric patterns
 *    (weekdays "0111110", weekend "1000001", daily) read the same either way.
 *    Flip REPEATS_SUNDAY_FIRST if a live device shows otherwise.
 *  - options: null -> "0", else the list joined with ",".
 *  - Fields past the 9th (if any firmware sends them) are dropped by the
 *    parser and therefore cannot be round-tripped.
 */
import { LitElement, html, css, nothing, base, WEEKDAYS } from "../core.js";

export const REPEATS_SUNDAY_FIRST = true;

const SUCTION = ["quiet", "standard", "strong", "turbo"];
const WATER = { 1: "low", 2: "medium", 3: "high" };

/** Localized label for an integer enum value using the matching select entity's translations. */
export function levelLabel(ctx, selectKey, value) {
  if (value == null) return "";
  const key =
    selectKey === "suction_level"
      ? SUCTION[value]
      : selectKey === "water_volume"
        ? WATER[value]
        : selectKey === "cleaning_mode"
          ? ["sweeping", "mopping", "sweeping_and_mopping", "mopping_after_sweeping"][value]
          : selectKey === "cleaning_route"
            ? [null, "standard", "intensive", "deep", "quick"][value]
            : undefined;
  if (!key) return String(value);
  return ctx.stateLabel(ctx.st("select", selectKey), key);
}

/** "0111110" -> [false,true,...] indexed like WEEKDAYS. */
export function repeatsToDays(repeats) {
  const s = String(repeats ?? "").padStart(7, "0").slice(-7);
  const chars = REPEATS_SUNDAY_FIRST ? s.split("") : s.split("").reverse();
  return chars.map((ch) => ch === "1");
}
export function daysToRepeats(days) {
  const chars = days.map((d) => (d ? "1" : "0"));
  return (REPEATS_SUNDAY_FIRST ? chars : chars.reverse()).join("");
}

/** One parsed ScheduledTask dict -> raw device token. */
export function taskToRaw(t) {
  const status = t.invalid ? "3" : t.enabled ? "1" : "0";
  const options = Array.isArray(t.options) && t.options.length ? t.options.join(",") : "0";
  const repeats = String(t.repeats ?? "0000000").padStart(7, "0");
  return [t.id, status, t.time, repeats, t.once ? "0" : "1", t.map_id ?? "0", t.suction_level ?? 1, t.water_volume ?? 2, options].join("-");
}
export const scheduleToRaw = (tasks) => tasks.map(taskToRaw).join(";");

/**
 * Like scheduleToRaw, but starts from the device's raw string so fields the
 * parsed attribute loses survive: the exact status digit (1 vs 2), the real
 * `once` value, any fields after the 9th, and task order. Only fields whose
 * meaning changed are rewritten.
 */
export function mergeScheduleRaw(raw, tasks) {
  const tokens = new Map();
  const order = [];
  for (const tok of String(raw || "").split(";")) {
    if (!tok.includes("-")) continue;
    const p = tok.split("-");
    const id = String(Number(p[0]));
    tokens.set(id, p);
    order.push(id);
  }
  const byId = new Map(tasks.map((t) => [String(t.id), t]));
  const ids = [...order.filter((id) => byId.has(id)), ...tasks.map((t) => String(t.id)).filter((id) => !tokens.has(id))];
  return ids
    .map((id) => {
      const t = byId.get(id);
      const fresh = taskToRaw(t).split("-");
      const p = tokens.get(id);
      if (!p || p.length < 9) return fresh.join("-");
      const q = [...p];
      const rawEnabled = p[1] === "1" || p[1] === "2";
      if (rawEnabled !== !!t.enabled || (p[1] === "3") !== !!t.invalid) q[1] = fresh[1];
      q[2] = fresh[2];
      if (p[3].padStart(7, "0") !== fresh[3]) q[3] = fresh[3];
      if ((p[4] === "0") !== !!t.once) q[4] = fresh[4];
      return q.join("-");
    })
    .join(";");
}

/** Weekday names in the user's language, indexed like WEEKDAYS. */
export function weekdayNames(ctx, style = "short") {
  const fmt = new Intl.DateTimeFormat(ctx.hass.locale?.language || "en", { weekday: style });
  return WEEKDAYS.map((_, i) => fmt.format(new Date(2024, 0, 7 + i))); // 2024-01-07 is a Sunday
}

export function daysSummary(ctx, days) {
  const names = weekdayNames(ctx);
  if (days.every(Boolean)) return "Every day";
  if (!days.some(Boolean)) return "Once";
  if (days.join() === [false, true, true, true, true, true, false].join()) return "Weekdays";
  if (days.join() === [true, false, false, false, false, false, true].join()) return "Weekends";
  // Show Monday-first, as most locales do.
  return [1, 2, 3, 4, 5, 6, 0].filter((i) => days[i]).map((i) => names[i]).join(", ");
}

const mins = (hhmm) => {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return h * 60 + m;
};

/** True if `time` on one of `days` falls inside an enabled DnD period. */
export function inDnd(ctx, time, days) {
  const a = ctx.attrs;
  let periods = [];
  if (Array.isArray(a.dnd)) periods = a.dnd.filter((d) => d.enabled).map((d) => ({ start: d.start, end: d.end, wk: d.repeats ?? 127 }));
  else if (a.dnd === true || ctx.st("switch", "dnd")?.state === "on") {
    const s = ctx.st("time", "dnd_start")?.state;
    const e = ctx.st("time", "dnd_end")?.state;
    if (s && e) periods = [{ start: s.slice(0, 5), end: e.slice(0, 5), wk: 127 }];
  }
  const t = mins(time);
  return periods.some((p) => {
    const s = mins(p.start);
    const e = mins(p.end);
    const inside = s <= e ? t >= s && t < e : t >= s || t < e;
    if (!inside) return false;
    // Day overlap; once-tasks (no days) are treated as overlapping.
    return !days.some(Boolean) || days.some((d, i) => d && p.wk & (1 << i));
  });
}

class Schedule extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    _edit: { state: true },
    _busy: { state: true },
  };
  static styles = [
    base,
    css`
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
      }
      .item .text {
        flex: 1;
        min-width: 0;
      }
      .time {
        font-size: 1.5em;
        font-variant-numeric: tabular-nums;
      }
      .item.off .time {
        color: var(--doc-muted);
      }
      .sub {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      .warn {
        color: var(--doc-warn);
        font-size: 0.85em;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .tag {
        font-size: 0.75em;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--doc-error);
        color: #fff;
        margin-left: 6px;
        vertical-align: middle;
      }
      .add {
        margin: 12px 16px;
        width: calc(100% - 32px);
      }
      .form {
        padding: 0 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .form input[type="time"] {
        font-size: 1.6em;
        align-self: center;
      }
      .days {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .days button {
        flex: 1;
        min-width: 44px;
        padding: 6px 0;
      }
      .ro {
        display: flex;
        justify-content: space-between;
        font-size: 0.9em;
      }
      .ro .k {
        color: var(--doc-muted);
      }
      .buttons {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        padding-top: 4px;
      }
      .empty {
        padding: 24px 16px;
        text-align: center;
      }
      .note {
        padding: 0 16px;
        font-size: 0.85em;
      }
    `,
  ];

  get _tasks() {
    const s = this.ctx?.attrs.schedule;
    return Array.isArray(s) ? s : [];
  }

  _mapName(mapId) {
    const m = (this.ctx.attrs.maps || []).find((x) => String(x.id) === String(mapId));
    return m ? m.custom_name || m.name : null;
  }

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const tasks = this._tasks;
    return html`<doc-page .ctx=${c} heading=${c.t("title", "schedule_list", "Scheduled Cleanup")}>
      ${tasks.length ? tasks.map((t) => this._item(t)) : html`<div class="empty muted">-</div>`}
      <button class="primary add" @click=${() => this._new()}>
        <ha-icon icon="mdi:plus"></ha-icon>${c.t("action", "new_schedule", "New scheduled task")}
      </button>
      <div class="note muted">${c.t("message", "not_fully_supported", "Not fully supported yet!")}
        Room, zone and per-task cleaning options are kept as-is and shown read-only.</div>
      ${this._sheet()}
    </doc-page>`;
  }

  _item(t) {
    const c = this.ctx;
    const days = repeatsToDays(t.repeats);
    const map = this._mapName(t.map_id);
    const parts = [t.once ? "Once" : daysSummary(c, days)];
    if (map && (c.attrs.maps || []).length > 1) parts.push(map);
    const conflict = t.enabled && inDnd(c, t.time, t.once ? [] : days);
    return html`<doc-list-item
      clickable
      .actions=${[{ label: c.t("action", "delete", "Delete"), icon: "mdi:delete", danger: true, run: () => this._delete(t) }]}
      @item-click=${() => this._open(t)}
    >
      <div class="item ${t.enabled ? "" : "off"}">
        <div class="text">
          <div class="time">${t.time}${t.invalid ? html`<span class="tag">${c.t("title", "invalid", "invalid")}</span>` : nothing}</div>
          <div class="sub">${parts.join(" · ")}</div>
          ${conflict
            ? html`<div class="warn"><ha-icon icon="mdi:alert"></ha-icon>${c.t("message", "dnd_confliction_detail", "Scheduled task is set up during the Do Not Disturb period.")}</div>`
            : nothing}
        </div>
        <span @pointerdown=${(e) => e.stopPropagation()}>
          <doc-toggle
            .checked=${!!t.enabled}
            ?disabled=${this._busy || t.invalid}
            @change=${(e) => this._write(this._tasks.map((x) => (x.id === t.id ? { ...x, enabled: e.detail.checked } : x)))}
          ></doc-toggle>
        </span>
      </div>
    </doc-list-item>`;
  }

  _open(t) {
    this._edit = { isNew: false, task: { ...t }, days: repeatsToDays(t.repeats) };
  }

  _new() {
    const c = this.ctx;
    const tasks = this._tasks;
    const id = Math.max(0, ...tasks.map((t) => Number(t.id) || 0)) + 1;
    const suction = SUCTION.indexOf(c.st("select", "suction_level")?.state);
    const waterKey = c.st("select", "water_volume")?.state;
    const water = Number(Object.keys(WATER).find((k) => WATER[k] === waterKey));
    const task = {
      id,
      enabled: true,
      invalid: false,
      time: "09:00",
      repeats: "1111111",
      once: false,
      map_id: String(c.attrs.selected_map_id ?? tasks[0]?.map_id ?? "0"),
      suction_level: suction >= 0 ? suction : 1,
      water_volume: water || 2,
      options: null,
    };
    this._edit = { isNew: true, task, days: repeatsToDays(task.repeats) };
  }

  _sheet() {
    const e = this._edit;
    if (!e) return nothing;
    const c = this.ctx;
    const t = e.task;
    const names = weekdayNames(c, "short");
    const order = [1, 2, 3, 4, 5, 6, 0];
    const map = this._mapName(t.map_id);
    const set = (patch) => (this._edit = { ...e, task: { ...t, ...patch } });
    const ro = [
      map ? [c.t("title", "map", "Map"), map] : null,
      t.suction_level != null ? [c.name(c.ent("select", "suction_level") || "") || "Suction", levelLabel(c, "suction_level", t.suction_level)] : null,
      t.water_volume != null && c.ent("select", "water_volume") ? [c.name(c.ent("select", "water_volume")), levelLabel(c, "water_volume", t.water_volume)] : null,
      t.options ? ["Options", t.options.join(", ")] : null,
    ].filter(Boolean);
    return html`<doc-sheet
      open
      heading=${e.isNew ? c.t("action", "new_schedule", "New scheduled task") : c.t("title", "scheduled_task", "Scheduled Task")}
      @closed=${() => (this._edit = null)}
    >
      <div class="form">
        <div class="row">
          <span class="spacer">${c.t("action", "enable", "Enable")}</span>
          <doc-toggle .checked=${!!t.enabled} ?disabled=${t.invalid} @change=${(ev) => set({ enabled: ev.detail.checked })}></doc-toggle>
        </div>
        <input type="time" .value=${t.time} @change=${(ev) => ev.target.value && set({ time: ev.target.value.slice(0, 5) })} />
        <div>
          <div class="sub">${c.t("action", "repeats", "Repeats")}</div>
          <div class="days">
            ${order.map(
              (i) => html`<button
                class=${e.days[i] ? "active" : ""}
                aria-pressed=${e.days[i] ? "true" : "false"}
                data-day=${WEEKDAYS[i]}
                @click=${() => {
                  const days = e.days.map((d, j) => (j === i ? !d : d));
                  this._edit = { ...e, days };
                }}
              >
                ${names[i]}
              </button>`
            )}
          </div>
          <div class="sub">${e.days.some(Boolean) ? daysSummary(c, e.days) : "Once"}</div>
        </div>
        ${ro.map(([k, v]) => html`<div class="ro"><span class="k">${k}</span><span>${v}</span></div>`)}
        <div class="buttons">
          ${e.isNew
            ? nothing
            : html`<button class="danger" @click=${() => this._delete(t)}>${c.t("action", "delete", "Delete")}</button>`}
          <span class="spacer"></span>
          <button @click=${() => (this._edit = null)}>${c.t("action", "cancel", "Cancel")}</button>
          <button class="primary" ?disabled=${this._busy} @click=${() => this._save()}>${c.t("action", "save", "Save")}</button>
        </div>
      </div>
    </doc-sheet>`;
  }

  async _save() {
    const { isNew, task, days } = this._edit;
    const once = !days.some(Boolean);
    const next = { ...task, repeats: daysToRepeats(days), once };
    const tasks = isNew ? [...this._tasks, next] : this._tasks.map((x) => (x.id === task.id ? next : x));
    if (await this._write(tasks)) this._edit = null;
  }

  async _write(tasks) {
    this._busy = true;
    try {
      const raw = await this.ctx.rawProperty("schedule");
      return await this.ctx.setProp("schedule", raw ? mergeScheduleRaw(raw, tasks) : scheduleToRaw(tasks));
    } finally {
      this._busy = false;
    }
  }

  async _delete(t) {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("message", "delete_schedule", "Delete Scheduled Task?"),
      text: c.t("message", "schedule_will_deleted", "Scheduled task at %time% will be deleted!").replace("%time%", t.time),
      confirmText: c.t("action", "delete", "Delete"),
      destructive: true,
    });
    if (!ok) return;
    if (await c.action("delete_scheduled_task", t.id)) this._edit = null;
  }
}

customElements.get("doc-schedule") || customElements.define("doc-schedule", Schedule);
