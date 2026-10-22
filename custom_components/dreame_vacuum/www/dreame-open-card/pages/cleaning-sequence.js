/*
 * Cleaning Sequence (doc-cleaning-sequence): reorder rooms, save with
 * dreame_vacuum.vacuum_set_cleaning_sequence { cleaning_sequence: [segment ids] }.
 *
 * Current order: camera `rooms[*].order` (Segment.as_dict; 0/absent = unassigned),
 * falling back to the vacuum `cleaning_sequence` attribute (device.segment_order).
 *
 * Strict vs non-strict: device.set_cleaning_sequence on "cleaning_sequence_v2" maps
 * writes `cleanareaorder` with every room numbered and rejects an empty sequence;
 * v1 maps write `cleanOrder` where rooms left out get order 0 (unassigned) and an empty
 * list turns the custom order off. switch.cleaning_sequence exists only when
 * `not device.status.cleaning_sequence_v2` (switch.py), so: switch present = non-strict,
 * switch absent = strict.
 *
 * Mop type per room (auto mop change models): select.<dev>_room_<id>_mop_type and
 * switch.auto_change_mop.
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import { entityRows } from "../components.js";
import { navRowStyles } from "./cleaning-settings.js";

class CleaningSequence extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    _order: { state: true },
    _dirty: { state: true },
    _drag: { state: true },
  };
  static styles = [
    base,
    navRowStyles,
    css`
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px 6px 12px;
        background: var(--doc-surface);
        border-bottom: 1px solid var(--doc-divider);
      }
      .row.dragging {
        position: relative;
        z-index: 3;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        border-radius: 8px;
      }
      .handle {
        cursor: grab;
        touch-action: none;
        color: var(--doc-muted);
        padding: 8px 4px;
        display: inline-flex;
      }
      .dragging .handle {
        cursor: grabbing;
      }
      .badge {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--doc-accent);
        color: var(--text-primary-color, #fff);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85em;
        font-weight: 600;
        flex: none;
      }
      .badge.none {
        background: var(--doc-surface-2);
        color: var(--doc-muted);
      }
      .text {
        flex: 1;
        min-width: 0;
      }
      .secondary {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      .actions {
        display: flex;
        gap: 4px;
        margin: 12px 16px;
        justify-content: flex-end;
      }
    `,
  ];

  // ---- data -------------------------------------------------------------
  _strict() {
    return !this.ctx.ent("switch", "cleaning_sequence");
  }

  _source() {
    const c = this.ctx;
    const rooms = c.rooms();
    const ids = new Set(rooms.map((r) => r.id));
    let ordered = rooms.filter((r) => Number(r.order) > 0).sort((a, b) => a.order - b.order).map((r) => r.id);
    if (!ordered.length && Array.isArray(c.attrs.cleaning_sequence)) ordered = c.attrs.cleaning_sequence.map(Number).filter((id) => ids.has(id));
    if (this._strict()) ordered = [...ordered, ...rooms.map((r) => r.id).filter((id) => !ordered.includes(id))];
    return ordered;
  }

  willUpdate(changed) {
    if (changed.has("ctx") && this.ctx && !this._dirty && !this._drag) this._order = this._source();
  }

  _set(order) {
    this._order = order;
    this._dirty = true;
  }
  _move(id, delta) {
    const o = [...this._order];
    const i = o.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    this._set(o);
  }

  async _save() {
    const c = this.ctx;
    let ok;
    if (!this._order.length && !this._strict()) {
      ok = await c.call("switch", "turn_off", {}, { entity_id: c.ent("switch", "cleaning_sequence") });
    } else {
      ok = await c.vac("vacuum_set_cleaning_sequence", { cleaning_sequence: [...this._order] });
    }
    if (ok) {
      this._dirty = false;
      c.toast(c.t("message", "saved", "Successfully saved"));
    }
  }
  _discard() {
    this._dirty = false;
    this._order = this._source();
  }

  // ---- drag (pointer events: mouse, touch, pen) -------------------------
  _down(e, id) {
    if (e.button > 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    this._drag = { id, y0: e.clientY, dy: 0 };
  }
  _dragMove(e) {
    const d = this._drag;
    if (!d) return;
    const rows = [...this.renderRoot.querySelectorAll(".row[data-id]")];
    const me = rows.find((r) => Number(r.dataset.id) === d.id);
    if (!me) return;
    // Swap with a neighbour once the pointer passes its midpoint.
    const idx = this._order.indexOf(d.id);
    const prev = rows[idx - 1];
    const next = rows[idx + 1];
    let moved = 0;
    if (next) {
      const r = next.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) moved = 1;
    }
    if (!moved && prev) {
      const r = prev.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) moved = -1;
    }
    if (moved) {
      const h = (moved > 0 ? next : prev).getBoundingClientRect().height;
      this._move(d.id, moved);
      d.y0 += moved * h;
    }
    this._drag = { ...d, dy: e.clientY - d.y0 };
  }
  _dragEnd() {
    this._drag = null;
  }

  // ---- render -----------------------------------------------------------
  _mopType(id) {
    const c = this.ctx;
    if (!c.ent("switch", "auto_change_mop")) return "";
    const e = c.roomEnt("select", "mop_type", id);
    const st = e && c.hass.states[e];
    if (st && st.state !== "unavailable" && st.state !== "unknown")
      return `${c.t("title", "mop_type", "Mop Type")}: ${c.stateLabel(st)}`;
    const r = c.rooms().find((x) => x.id === id);
    return r?.mop_type != null ? `${c.t("title", "mop_type", "Mop Type")}: ${r.mop_type}` : "";
  }

  _row(r, i, strict, disabled) {
    const c = this.ctx;
    const n = this._order.length;
    const dragging = this._drag?.id === r.id;
    return html`<div
      class="row ${dragging ? "dragging" : ""}"
      data-id=${r.id}
      style=${dragging ? `transform: translateY(${this._drag.dy}px)` : ""}
    >
      <span
        class="handle"
        title="Drag"
        @pointerdown=${(e) => !disabled && this._down(e, r.id)}
        @pointermove=${this._dragMove}
        @pointerup=${this._dragEnd}
        @pointercancel=${this._dragEnd}
        ><ha-icon icon="mdi:drag"></ha-icon
      ></span>
      <span class="badge">${i + 1}</span>
      <div class="text">
        <div>${c.roomName(r)}</div>
        ${this._mopType(r.id) ? html`<div class="secondary">${this._mopType(r.id)}</div>` : nothing}
      </div>
      <button class="icon" title="Up" aria-label="Move up" ?disabled=${disabled || i === 0} @click=${() => this._move(r.id, -1)}>
        <ha-icon icon="mdi:chevron-up"></ha-icon>
      </button>
      <button class="icon" title="Down" aria-label="Move down" ?disabled=${disabled || i === n - 1} @click=${() => this._move(r.id, 1)}>
        <ha-icon icon="mdi:chevron-down"></ha-icon>
      </button>
      ${strict
        ? nothing
        : html`<button class="icon" title="Remove" aria-label="Remove from sequence" ?disabled=${disabled}
            @click=${() => this._set(this._order.filter((x) => x !== r.id))}>
            <ha-icon icon="mdi:minus-circle-outline"></ha-icon>
          </button>`}
    </div>`;
  }

  render() {
    const c = this.ctx;
    if (!c || !this._order) return nothing;
    const strict = this._strict();
    const started = !!c.attrs.started;
    const temp = !!c.attrs.has_temporary_map;
    const disabled = started || temp;
    const byId = new Map(c.rooms().map((r) => [r.id, r]));
    const ordered = this._order.map((id) => byId.get(id)).filter(Boolean);
    const unassigned = strict ? [] : c.rooms().filter((r) => !this._order.includes(r.id));

    return html`<doc-page .ctx=${c} heading=${c.t("title", "cleaning_sequence", "Cleaning Sequence")}>
      ${disabled
        ? html`<div class="banner"><ha-icon icon="mdi:lock-outline"></ha-icon>${c.t("message", "active_task", "Vacuum has active task!")}
            ${c.t("message", "not_available", "Not available right now...")}</div>`
        : nothing}
      ${entityRows(c, ["switch.cleaning_sequence", "switch.auto_change_mop"])}
      <div class="note">
        ${strict
          ? "Every room has a position in the sequence."
          : "Unassigned rooms are cleaned last, nearest room first."}
      </div>
      <doc-section heading=${c.t("title", "cleaning_sequence", "Cleaning Sequence")}>
        ${ordered.length
          ? ordered.map((r, i) => this._row(r, i, strict, disabled))
          : html`<div class="note">${c.t("message", "select_room", "Select a room to set the cleaning sequence")}</div>`}
      </doc-section>
      ${unassigned.length
        ? html`<doc-section heading="Unassigned">
            ${unassigned.map(
              (r) => html`<div class="row">
                <span class="badge none">-</span>
                <div class="text">
                  <div>${c.roomName(r)}</div>
                  ${this._mopType(r.id) ? html`<div class="secondary">${this._mopType(r.id)}</div>` : nothing}
                </div>
                <button class="icon" title="Add" aria-label="Add to sequence" ?disabled=${disabled} @click=${() => this._set([...this._order, r.id])}>
                  <ha-icon icon="mdi:plus-circle-outline"></ha-icon>
                </button>
              </div>`
            )}
          </doc-section>`
        : nothing}
      <div class="actions">
        <button ?disabled=${!this._dirty} @click=${this._discard}>${c.t("action", "discard", "Discard")}</button>
        <button class="primary" ?disabled=${!this._dirty || disabled} @click=${this._save}>${c.t("action", "save", "Save")}</button>
      </div>
    </doc-page>`;
  }
}

customElements.get("doc-cleaning-sequence") || customElements.define("doc-cleaning-sequence", CleaningSequence);
