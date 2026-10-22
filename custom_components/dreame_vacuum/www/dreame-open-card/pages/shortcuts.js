/*
 * Shortcuts (DVC guide: /guide/device-settings/shortcuts).
 *
 * Source: vacuum attribute `shortcuts` = {"<id>": {id, index, name, map_id,
 * running, tasks: [[ShortcutTask, ...], ...]}} (None fields dropped).
 * Services (entity services on the vacuum):
 *   vacuum_start_shortcut  {shortcut_id}
 *   vacuum_rename_shortcut {shortcut_id, shortcut_name}
 *   vacuum_delete_shortcut {shortcut_id}
 * Reload: button.reload_shortcuts, else vacuum_call_action {key: "reload_shortcuts"}.
 * Creating shortcuts / editing their tasks has no integration API (DVC is
 * view-only here too), so task details are read-only.
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import { levelLabel } from "./schedule.js";

const TASK_TYPES = { 0: "All", 1: "Rooms", 2: "Zone", 3: "Customized cleaning" };

class Shortcuts extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    _view: { state: true },
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
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sub {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      .running {
        color: var(--doc-accent);
      }
      .empty {
        padding: 24px 16px;
        text-align: center;
      }
      .group {
        margin: 0 16px 12px;
        border: 1px solid var(--doc-divider);
        border-radius: var(--doc-radius);
        overflow: hidden;
      }
      .group h4 {
        margin: 0;
        padding: 6px 12px;
        font-weight: 500;
        font-size: 0.9em;
        background: var(--doc-surface-2);
      }
      .task {
        padding: 8px 12px;
        border-top: 1px solid var(--doc-divider);
      }
      .task:first-of-type {
        border-top: none;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .chip {
        font-size: 0.8em;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--doc-surface-2);
      }
      .buttons {
        display: flex;
        gap: 8px;
        padding: 4px 16px 0;
      }
      .note {
        padding: 8px 16px 0;
        font-size: 0.85em;
      }
    `,
  ];

  get _list() {
    const s = this.ctx?.attrs.shortcuts || {};
    return Object.values(s)
      .filter(Boolean)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }

  _name(s) {
    return s.name || this.ctx.t("title", "shortcut_name_placeholder", "Shortcut %index%").replace("%index%", (s.index ?? 0) + 1);
  }

  /** Room name for a segment on the shortcut's map (falls back to the current map). */
  _room(segmentId, mapId) {
    const c = this.ctx;
    const a = c.attrs;
    const map = (a.maps || []).find((m) => String(m.id) === String(mapId));
    const list = map && a.rooms?.[map.name];
    const r = list?.find((x) => Number(x.id) === Number(segmentId));
    if (r) return r.name;
    const cur = c.rooms({ includeHidden: true }).find((x) => x.id === Number(segmentId));
    return cur ? c.roomName(cur) : `#${segmentId}`;
  }

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const list = this._list;
    return html`<doc-page .ctx=${c} heading=${c.t("title", "shortcut_list", "Shortcuts")}>
      <button slot="actions" class="icon reload" title=${c.t("action", "reload", "Reload")} @click=${() => this._reload()}>
        <ha-icon icon="mdi:refresh"></ha-icon>
      </button>
      ${list.length ? list.map((s) => this._item(s)) : html`<div class="empty muted">-</div>`}
      <div class="note muted">New shortcuts are created in the Dreame app; tasks are view-only.</div>
      ${this._sheet()}
    </doc-page>`;
  }

  _item(s) {
    const c = this.ctx;
    const groups = s.tasks || [];
    const rooms = new Set(groups.flat().filter((t) => t?.segment_id != null).map((t) => this._room(t.segment_id, s.map_id)));
    const sub = rooms.size ? [...rooms].join(", ") : `${groups.length} ${groups.length === 1 ? "task" : "tasks"}`;
    return html`<doc-list-item
      clickable
      .actions=${[
        { label: c.t("action", "rename", "Rename"), icon: "mdi:pencil", run: () => this._rename(s) },
        { label: c.t("action", "delete", "Delete"), icon: "mdi:delete", danger: true, run: () => this._delete(s) },
      ]}
      @item-click=${() => (this._view = s.id)}
    >
      <div class="item">
        <ha-icon icon=${s.running ? "mdi:play-circle" : "mdi:play-box-outline"} class=${s.running ? "running" : "muted"}></ha-icon>
        <div class="text">
          <div class="name">${this._name(s)}</div>
          <div class="sub">${sub}</div>
        </div>
        <span @pointerdown=${(e) => e.stopPropagation()}>
          <button class="icon run" title=${c.t("action", "start", "Start")} @click=${() => this._run(s)}>
            <ha-icon icon="mdi:play"></ha-icon>
          </button>
        </span>
      </div>
    </doc-list-item>`;
  }

  _taskChips(t) {
    const c = this.ctx;
    const chips = [];
    if (t.segment_id != null && t.task_type != null && TASK_TYPES[t.task_type]) chips.push(TASK_TYPES[t.task_type]);
    if (t.cleaning_mode != null) chips.push(levelLabel(c, "cleaning_mode", t.cleaning_mode));
    if (t.suction_level != null) chips.push(levelLabel(c, "suction_level", t.suction_level));
    if (t.water_volume != null) chips.push(levelLabel(c, "water_volume", t.water_volume));
    if (t.wetness_level != null) chips.push(`Wetness ${t.wetness_level}`);
    if (t.cleaning_route != null && t.cleaning_route > 0) chips.push(levelLabel(c, "cleaning_route", t.cleaning_route));
    if (t.cleaning_times != null) chips.push(`×${t.cleaning_times}`);
    return chips;
  }

  _sheet() {
    const c = this.ctx;
    const s = this._view != null && this._list.find((x) => x.id === this._view);
    if (!s) return nothing;
    const map = (c.attrs.maps || []).find((m) => String(m.id) === String(s.map_id));
    return html`<doc-sheet open heading=${this._name(s)} @closed=${() => (this._view = null)}>
      ${map && (c.attrs.maps || []).length > 1 ? html`<div class="note muted">${c.t("title", "map", "Map")}: ${map.custom_name || map.name}</div>` : nothing}
      <div style="height:8px"></div>
      ${(s.tasks || []).map(
        (group, gi) => html`<div class="group">
          <h4>${c.t("title", "task", "Task %index%").replace("%index%", gi + 1)}</h4>
          ${(group || []).map(
            (t) => html`<div class="task">
              <div>${t.segment_id != null ? this._room(t.segment_id, s.map_id) : t.coords ? TASK_TYPES[2] : TASK_TYPES[t.task_type] || "-"}</div>
              <div class="chips">${this._taskChips(t).map((x) => html`<span class="chip">${x}</span>`)}</div>
            </div>`
          )}
        </div>`
      )}
      <div class="buttons">
        <button @click=${() => this._rename(s)}><ha-icon icon="mdi:pencil"></ha-icon>${c.t("action", "rename", "Rename")}</button>
        <button class="danger" @click=${() => this._delete(s)}>${c.t("action", "delete", "Delete")}</button>
        <span class="spacer"></span>
        <button class="primary" @click=${() => this._run(s)}><ha-icon icon="mdi:play"></ha-icon>${c.t("action", "start", "Start")}</button>
      </div>
    </doc-sheet>`;
  }

  _run(s) {
    return this.ctx.vac("vacuum_start_shortcut", { shortcut_id: Number(s.id) });
  }

  async _rename(s) {
    const c = this.ctx;
    const name = await c.prompt({
      title: c.t("action", "rename", "Rename"),
      label: c.t("title", "shortcut", "Shortcut"),
      value: s.name || "",
      placeholder: this._name(s),
      maxlength: 40,
    });
    const v = name?.trim();
    if (!v || v === s.name) return;
    await c.vac("vacuum_rename_shortcut", { shortcut_id: Number(s.id), shortcut_name: v });
  }

  async _delete(s) {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("message", "delete_shortcut", "Delete Shortcut?"),
      text: c.t("message", "shortcut_will_deleted", "%name% will be deleted!").replace("%name%", this._name(s)),
      confirmText: c.t("action", "delete", "Delete"),
      destructive: true,
    });
    if (!ok) return;
    if (await c.vac("vacuum_delete_shortcut", { shortcut_id: Number(s.id) })) this._view = null;
  }

  _reload() {
    const c = this.ctx;
    return c.ent("button", "reload_shortcuts") ? c.press("reload_shortcuts") : c.action("reload_shortcuts");
  }
}

customElements.get("doc-shortcuts") || customElements.define("doc-shortcuts", Shortcuts);
