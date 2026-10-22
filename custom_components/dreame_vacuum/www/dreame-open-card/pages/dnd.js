/*
 * Do Not Disturb (DVC guide: /guide/device-settings/do-not-disturb-dnd).
 *
 * Multi-period models (capability "dnd_task"): vacuum attribute `dnd` is a
 * list of DNDTask dicts {id, enabled, start, end, repeats (bitmask), ss}.
 * Writes rewrite the whole list:
 *   dreame_vacuum.vacuum_set_property {key: "dnd_task", value: '[{"id":1,"en":true,"st":"22:00","et":"08:00","wk":127,"ss":0}]'}
 * (validated in DreameVacuumDevice.set_property_value: id >= 0, en in {0,1},
 *  st/et "HH:MM", wk int 1..127, ss >= -1). Deletes use
 *   dreame_vacuum.vacuum_call_action {key: "delete_dnd_task", value: "<id>"}.
 * The Dreame app only sets a time window and always writes wk 127 (every
 * day), so the card has no day picker: `wk` is preserved as stored and new
 * tasks get 127. `en` is a JSON boolean, as the app and the integration's own
 * set_dnd_tasks write it; this robot (2026-10 live test) silently ignores a
 * write with en 0/1. `ss` is opaque: preserved for existing tasks, 0 for new.
 *
 * Single-period models: switch.dnd + time.dnd_start / time.dnd_end rows.
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import { entityRows } from "../components.js";

const EXTRA = ["switch.dnd_disable_resume_cleaning", "switch.dnd_disable_auto_empty", "switch.dnd_reduce_volume"];

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
  // The attribute is sorted by start time; keep the device's own order and
  // append new tasks, so an untouched list round-trips in place.
  const rank = new Map(items.map((it, i) => [String(it.id), i]));
  const pos = (o) => rank.get(String(o.id)) ?? Infinity;
  ours.sort((a, b) => pos(a) - pos(b));
  return JSON.stringify(ours.map((o) => ({ ...(byId.get(String(o.id)) || {}), ...o })));
}

/** DNDTask attribute dicts -> JSON accepted by set_property_value("dnd_task"). */
export function dndToJson(tasks) {
  return JSON.stringify(
    tasks.map((t) => ({
      id: Number(t.id),
      en: !!t.enabled,
      st: t.start,
      et: t.end,
      wk: Number(t.repeats ?? 127),
      ss: Number(t.ss ?? 0),
    }))
  );
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
    this._edit = { isNew: false, task: { ...t } };
  }
  _new() {
    const id = Math.max(0, ...this._tasks.map((t) => Number(t.id) || 0)) + 1;
    const task = { id, enabled: true, start: "22:00", end: "08:00", repeats: 127, ss: 0 };
    this._edit = { isNew: true, task };
  }

  _sheet() {
    const e = this._edit;
    if (!e) return nothing;
    const c = this.ctx;
    const t = e.task;
    const set = (patch) => (this._edit = { ...e, task: { ...t, ...patch } });
    const error = t.start === t.end ? "Start and end must differ" : "";
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
    const { isNew, task } = this._edit;
    const next = { ...task, repeats: task.repeats ?? 127 };
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
