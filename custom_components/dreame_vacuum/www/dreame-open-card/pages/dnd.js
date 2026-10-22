/*
 * Do Not Disturb (DVC guide: /guide/device-settings/do-not-disturb-dnd).
 *
 * Multi-period models (capability "dnd_task"): vacuum attribute `dnd` is a
 * list of DNDTask dicts {id, enabled, start, end, repeats (bitmask), ss}.
 * Writes rewrite the whole list:
 *   dreame_vacuum.vacuum_set_property {key: "dnd_task", value: '[{"id":1,"en":1,"st":"22:00","et":"08:00","wk":127,"ss":0}]'}
 * (validated in DreameVacuumDevice.set_property_value: id >= 0, en in {0,1},
 *  st/et "HH:MM", wk int 1..127, ss >= -1). Deletes use
 *   dreame_vacuum.vacuum_call_action {key: "delete_dnd_task", value: "<id>"}.
 * `wk` bit i is WEEKDAYS[i] (bit 0 = Sunday), the card-wide convention; the
 * integration itself never interprets the bits. `ss` is opaque: preserved for
 * existing tasks, 0 for new ones (what set_dnd_tasks uses).
 *
 * Single-period models: switch.dnd + time.dnd_start / time.dnd_end rows.
 */
import { LitElement, html, css, nothing, base, WEEKDAYS } from "../core.js";
import { entityRows } from "../components.js";
import { weekdayNames } from "./schedule.js";

const EXTRA = ["switch.dnd_disable_resume_cleaning", "switch.dnd_disable_auto_empty", "switch.dnd_reduce_volume"];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

export const wkToDays = (wk) => WEEKDAYS.map((_, i) => !!(Number(wk) & (1 << i)));
export const daysToWk = (days) => days.reduce((m, d, i) => (d ? m | (1 << i) : m), 0);

/** Like dndToJson, but keeps any extra keys the device stores on each task. */
export function mergeDndRaw(raw, tasks) {
  let items = [];
  try {
    items = JSON.parse(raw);
  } catch {
    return dndToJson(tasks);
  }
  if (!Array.isArray(items)) return dndToJson(tasks);
  const ours = JSON.parse(dndToJson(tasks));
  const byId = new Map(items.map((it) => [String(it.id), it]));
  return JSON.stringify(ours.map((o) => ({ ...(byId.get(String(o.id)) || {}), ...o })));
}

/** DNDTask attribute dicts -> JSON accepted by set_property_value("dnd_task"). */
export function dndToJson(tasks) {
  return JSON.stringify(
    tasks.map((t) => ({
      id: Number(t.id),
      en: t.enabled ? 1 : 0,
      st: t.start,
      et: t.end,
      wk: Number(t.repeats ?? 127),
      ss: Number(t.ss ?? 0),
    }))
  );
}

function wkSummary(ctx, wk) {
  const days = wkToDays(wk);
  if (days.every(Boolean)) return "Every day";
  const names = weekdayNames(ctx);
  return MON_FIRST.filter((i) => days[i]).map((i) => names[i]).join(", ");
}

class Dnd extends LitElement {
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
      }
      .time {
        font-size: 1.3em;
        font-variant-numeric: tabular-nums;
      }
      .item.off .time {
        color: var(--doc-muted);
      }
      .sub {
        font-size: 0.85em;
        color: var(--doc-muted);
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
      .times {
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: center;
      }
      .times input {
        font-size: 1.3em;
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
      .buttons {
        display: flex;
        gap: 8px;
      }
      .err {
        color: var(--doc-error);
        font-size: 0.85em;
      }
      .empty {
        padding: 24px 16px;
        text-align: center;
      }
    `,
  ];

  get _multi() {
    const c = this.ctx;
    return c.can("dnd_task") || Array.isArray(c.attrs.dnd);
  }
  get _tasks() {
    const d = this.ctx.attrs.dnd;
    return Array.isArray(d) ? d : [];
  }

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const multi = this._multi;
    return html`<doc-page .ctx=${c} heading=${c.t("title", "dnd", "Do not Disturb")}>
      ${multi
        ? html`<doc-section>
            ${this._tasks.length ? this._tasks.map((t) => this._item(t)) : html`<div class="empty muted">-</div>`}
            <button class="primary add" @click=${() => this._new()}>
              <ha-icon icon="mdi:plus"></ha-icon>${c.t("action", "new_dnd", "New Dnd task")}
            </button>
          </doc-section>`
        : html`<doc-section>${entityRows(c, ["switch.dnd", "time.dnd_start", "time.dnd_end"])}</doc-section>`}
      <doc-section>${entityRows(c, EXTRA)}</doc-section>
      ${this._sheet()}
    </doc-page>`;
  }

  _item(t) {
    const c = this.ctx;
    return html`<doc-list-item
      clickable
      .actions=${[{ label: c.t("action", "delete", "Delete"), icon: "mdi:delete", danger: true, run: () => this._delete(t) }]}
      @item-click=${() => this._open(t)}
    >
      <div class="item ${t.enabled ? "" : "off"}">
        <div class="text">
          <div class="time">${t.start} - ${t.end}</div>
          <div class="sub">${wkSummary(c, t.repeats ?? 127)}</div>
        </div>
        <span @pointerdown=${(e) => e.stopPropagation()}>
          <doc-toggle
            .checked=${!!t.enabled}
            ?disabled=${this._busy}
            @change=${(e) => this._write(this._tasks.map((x) => (x.id === t.id ? { ...x, enabled: e.detail.checked } : x)))}
          ></doc-toggle>
        </span>
      </div>
    </doc-list-item>`;
  }

  _open(t) {
    this._edit = { isNew: false, task: { ...t }, days: wkToDays(t.repeats ?? 127) };
  }
  _new() {
    const id = Math.max(0, ...this._tasks.map((t) => Number(t.id) || 0)) + 1;
    const task = { id, enabled: true, start: "22:00", end: "08:00", repeats: 127, ss: 0 };
    this._edit = { isNew: true, task, days: wkToDays(127) };
  }

  _sheet() {
    const e = this._edit;
    if (!e) return nothing;
    const c = this.ctx;
    const t = e.task;
    const names = weekdayNames(c, "short");
    const set = (patch) => (this._edit = { ...e, task: { ...t, ...patch } });
    const error = t.start === t.end ? "Start and end must differ" : !e.days.some(Boolean) ? "Select at least one day" : "";
    return html`<doc-sheet
      open
      heading=${e.isNew ? c.t("action", "new_dnd", "New Dnd task") : c.t("title", "dnd_task", "DnD Task")}
      @closed=${() => (this._edit = null)}
    >
      <div class="form">
        <div class="row">
          <span class="spacer">${c.t("action", "enable", "Enable")}</span>
          <doc-toggle .checked=${!!t.enabled} @change=${(ev) => set({ enabled: ev.detail.checked })}></doc-toggle>
        </div>
        <div class="times">
          <input type="time" class="start" .value=${t.start} @change=${(ev) => ev.target.value && set({ start: ev.target.value.slice(0, 5) })} />
          <span>-</span>
          <input type="time" class="end" .value=${t.end} @change=${(ev) => ev.target.value && set({ end: ev.target.value.slice(0, 5) })} />
        </div>
        <div>
          <div class="sub">${c.t("action", "repeats", "Repeats")}</div>
          <div class="days">
            ${MON_FIRST.map(
              (i) => html`<button
                class=${e.days[i] ? "active" : ""}
                data-day=${WEEKDAYS[i]}
                @click=${() => (this._edit = { ...e, days: e.days.map((d, j) => (j === i ? !d : d)) })}
              >
                ${names[i]}
              </button>`
            )}
          </div>
        </div>
        ${error ? html`<div class="err">${error}</div>` : nothing}
        <div class="buttons">
          ${e.isNew ? nothing : html`<button class="danger" @click=${() => this._delete(t)}>${c.t("action", "delete", "Delete")}</button>`}
          <span class="spacer"></span>
          <button @click=${() => (this._edit = null)}>${c.t("action", "cancel", "Cancel")}</button>
          <button class="primary" ?disabled=${!!error || this._busy} @click=${() => this._save()}>${c.t("action", "save", "Save")}</button>
        </div>
      </div>
    </doc-sheet>`;
  }

  async _save() {
    const { isNew, task, days } = this._edit;
    const next = { ...task, repeats: daysToWk(days) };
    const tasks = isNew ? [...this._tasks, next] : this._tasks.map((x) => (x.id === task.id ? next : x));
    if (await this._write(tasks)) this._edit = null;
  }

  async _write(tasks) {
    this._busy = true;
    try {
      const raw = await this.ctx.rawProperty("dnd_task");
      return await this.ctx.setProp("dnd_task", raw ? mergeDndRaw(raw, tasks) : dndToJson(tasks));
    } finally {
      this._busy = false;
    }
  }

  async _delete(t) {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("message", "delete_dnd", "Delete DnD Task?"),
      text: c
        .t("message", "dnd_will_deleted", "DnD task at %start% to %end% will be deleted!")
        .replace("%start%", t.start)
        .replace("%end%", t.end),
      confirmText: c.t("action", "delete", "Delete"),
      destructive: true,
    });
    if (!ok) return;
    if (await c.action("delete_dnd_task", t.id)) this._edit = null;
  }
}

customElements.get("doc-dnd") || customElements.define("doc-dnd", Dnd);
