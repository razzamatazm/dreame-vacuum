/*
 * Shared UI building blocks. All are plain Lit elements prefixed `doc-`.
 *
 *   <doc-page .ctx title="..">           page frame with back button; slot="actions" for header icons
 *   <doc-section title="..">             titled group with optional footnote (slot="note")
 *   <doc-entity-row .ctx entity=".." [label=".."]>   generic control for switch/select/number/time/button/sensor
 *   entityRows(ctx, ["switch.carpet_boost", ...])    rows for keys the model has (skips missing)
 *   <doc-list-item [clickable] .actions=[{label,icon,danger,run}]>   swipe left / long press / right click reveals actions
 *   <doc-toggle .checked @change>         switch
 *   <doc-tabs .tabs=[{id,label,icon}] .selected @select>
 *   <doc-sheet open heading=".." @closed> modal bottom sheet (dialog on desktop)
 */

import { LitElement, html, css, nothing, base } from "./core.js";

const fire = (el, type, detail) =>
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

// ---------------------------------------------------------------------------

class DocPage extends LitElement {
  static properties = { ctx: { attribute: false }, heading: {}, noBack: { type: Boolean, attribute: "no-back" } };
  static styles = [
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      header {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 8px 8px 4px;
        border-bottom: 1px solid var(--doc-divider);
        position: sticky;
        top: 0;
        background: var(--doc-surface);
        z-index: 2;
      }
      h2 {
        flex: 1;
        margin: 0 4px;
        font-size: 1.1em;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .body {
        padding: 8px 0 12px;
      }
    `,
  ];
  render() {
    return html`
      <header>
        ${this.noBack
          ? nothing
          : html`<button class="icon" title="Back" @click=${() => this.ctx.back()}>
              <ha-icon icon="mdi:arrow-left"></ha-icon>
            </button>`}
        <h2>${this.heading}</h2>
        <slot name="actions"></slot>
      </header>
      <div class="body"><slot></slot></div>
    `;
  }
}

// ---------------------------------------------------------------------------

class DocSection extends LitElement {
  static properties = { heading: {} };
  static styles = [
    base,
    css`
      :host {
        display: block;
        margin: 4px 0 12px;
      }
      h3 {
        margin: 8px 16px 4px;
        font-size: 0.85em;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--doc-muted);
      }
      ::slotted([slot="note"]) {
        display: block;
        margin: 4px 16px 0;
        font-size: 0.85em;
        color: var(--doc-muted);
      }
    `,
  ];
  render() {
    return html`${this.heading ? html`<h3>${this.heading}</h3>` : nothing}<slot></slot><slot name="note"></slot>`;
  }
}

// ---------------------------------------------------------------------------

class DocToggle extends LitElement {
  static properties = { checked: { type: Boolean }, disabled: { type: Boolean } };
  static styles = css`
    :host {
      display: inline-block;
    }
    button {
      all: unset;
      cursor: pointer;
      width: 40px;
      height: 22px;
      border-radius: 11px;
      background: var(--disabled-text-color, #bbb);
      position: relative;
      transition: background 0.15s;
    }
    button[aria-checked="true"] {
      background: var(--primary-color, #03a9f4);
    }
    button::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      transition: left 0.15s;
    }
    button[aria-checked="true"]::after {
      left: 21px;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;
  render() {
    return html`<button
      role="switch"
      aria-checked=${this.checked ? "true" : "false"}
      ?disabled=${this.disabled}
      @click=${(e) => {
        e.stopPropagation();
        this.checked = !this.checked;
        this.dispatchEvent(new CustomEvent("change", { detail: { checked: this.checked } }));
      }}
    ></button>`;
  }
}

// ---------------------------------------------------------------------------

const rowStyles = css`
  :host {
    display: block;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    min-height: 32px;
  }
  .icon {
    color: var(--state-icon-color, var(--doc-muted));
    flex: none;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .secondary {
    font-size: 0.85em;
    color: var(--doc-muted);
  }
  .end {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input[type="range"] {
    width: 120px;
  }
`;

class DocEntityRow extends LitElement {
  static properties = {
    ctx: { attribute: false },
    entity: {},
    label: {},
    secondary: {},
  };
  static styles = [base, rowStyles];

  render() {
    const ctx = this.ctx;
    const st = ctx?.hass.states[this.entity];
    if (!st) return nothing;
    const domain = this.entity.split(".")[0];
    const disabled = st.state === "unavailable";
    const label = this.label || ctx.name(this.entity);
    return html`<div class="item">
      <ha-state-icon class="icon" .hass=${ctx.hass} .stateObj=${st}></ha-state-icon>
      <div class="text">
        <div class="label">${label}</div>
        ${this.secondary ? html`<div class="secondary">${this.secondary}</div>` : nothing}
      </div>
      <div class="end">${this._control(domain, st, disabled)}</div>
    </div>`;
  }

  _control(domain, st, disabled) {
    const ctx = this.ctx;
    const target = { entity_id: this.entity };
    switch (domain) {
      case "switch":
      case "input_boolean":
        return html`<doc-toggle
          .checked=${st.state === "on"}
          ?disabled=${disabled}
          @change=${(e) => ctx.call(domain, e.detail.checked ? "turn_on" : "turn_off", {}, target)}
        ></doc-toggle>`;
      case "select":
        return html`<select
          ?disabled=${disabled}
          @change=${(e) => ctx.call("select", "select_option", { option: e.target.value }, target)}
        >
          ${(st.attributes.options || []).map(
            (o) => html`<option value=${o} ?selected=${o === st.state}>${ctx.stateLabel(st, o)}</option>`
          )}
        </select>`;
      case "number": {
        const { min = 0, max = 100, step = 1, unit_of_measurement: unit = "" } = st.attributes;
        const set = (v) => ctx.call("number", "set_value", { value: Number(v) }, target);
        return html`<input
            type="range"
            min=${min}
            max=${max}
            step=${step}
            .value=${st.state}
            ?disabled=${disabled}
            @change=${(e) => set(e.target.value)}
          /><span class="secondary">${st.state}${unit ? ` ${unit}` : ""}</span>`;
      }
      case "time":
        return html`<input
          type="time"
          .value=${(st.state || "").slice(0, 5)}
          ?disabled=${disabled}
          @change=${(e) => ctx.call("time", "set_value", { time: `${e.target.value}:00` }, target)}
        />`;
      case "button":
        return html`<button ?disabled=${disabled} @click=${() => ctx.call("button", "press", {}, target)}>
          ${ctx.t("action", "start", "Run")}
        </button>`;
      default:
        return html`<span class="secondary">${ctx.stateLabel(st)}</span>`;
    }
  }
}

/**
 * Rows for every "domain.key" the model has, in order. Missing entities are
 * skipped, which is how per-model feature gating works throughout the card.
 * Items may also be { key: "switch.x", label, secondary }.
 */
export function entityRows(ctx, items) {
  return items.map((item) => {
    const { key, label, secondary } = typeof item === "string" ? { key: item } : item;
    const [domain, k] = key.split(".");
    const id = ctx.ent(domain, k);
    return id
      ? html`<doc-entity-row .ctx=${ctx} entity=${id} label=${label || ""} secondary=${secondary || ""}></doc-entity-row>`
      : nothing;
  });
}
/** True if at least one of the keys exists on this model. */
export const hasAny = (ctx, keys) => keys.some((key) => ctx.ent(...(typeof key === "string" ? key : key.key).split(".")));

// ---------------------------------------------------------------------------

/**
 * List item with optional hidden actions revealed by swipe left (touch),
 * long press (touch) or right click (mouse), matching the DVC behavior.
 * Fires "item-click" when tapped (if clickable and actions are not open).
 */
class DocListItem extends LitElement {
  static properties = {
    actions: { attribute: false },
    clickable: { type: Boolean },
    _open: { state: true },
    _dx: { state: true },
  };
  static styles = [
    base,
    rowStyles,
    css`
      .wrap {
        position: relative;
        overflow: hidden;
      }
      .content {
        position: relative;
        background: var(--doc-surface);
        transition: transform 0.18s;
        touch-action: pan-y;
        user-select: none;
      }
      .content.clickable {
        cursor: pointer;
      }
      .acts {
        position: absolute;
        inset: 0 0 0 auto;
        display: flex;
      }
      .acts button {
        border-radius: 0;
        border: none;
        min-width: 80px;
        color: #fff;
        background: var(--doc-muted);
      }
      .acts button.danger {
        background: var(--doc-error);
      }
    `,
  ];

  constructor() {
    super();
    this._open = false;
    this._dx = 0;
  }

  get _actWidth() {
    return (this.actions?.length || 0) * 80;
  }

  render() {
    const has = this.actions?.length;
    const x = this._open ? -this._actWidth : this._dx;
    return html`<div class="wrap">
      ${has
        ? html`<div class="acts">
            ${this.actions.map(
              (a) => html`<button
                class=${a.danger ? "danger" : ""}
                @click=${async () => {
                  this._open = false;
                  await a.run();
                }}
              >
                ${a.icon ? html`<ha-icon icon=${a.icon}></ha-icon>` : nothing}${a.label}
              </button>`
            )}
          </div>`
        : nothing}
      <div
        class="content ${this.clickable ? "clickable" : ""}"
        style="transform: translateX(${x}px)"
        @pointerdown=${this._down}
        @pointermove=${this._move}
        @pointerup=${this._up}
        @pointercancel=${this._cancel}
        @contextmenu=${this._context}
      >
        <slot></slot>
      </div>
    </div>`;
  }

  _down(e) {
    this._start = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId, moved: false };
    clearTimeout(this._lp);
    if (this.actions?.length && e.pointerType !== "mouse") {
      this._lp = setTimeout(() => {
        this._open = true;
        this._start = null;
        navigator.vibrate?.(15);
      }, 550);
    }
  }
  _move(e) {
    const s = this._start;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      s.moved = true;
      clearTimeout(this._lp);
    }
    if (this.actions?.length && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      this._dx = Math.max(-this._actWidth, Math.min(0, dx + (this._open ? -this._actWidth : 0)));
    }
  }
  _up() {
    clearTimeout(this._lp);
    const s = this._start;
    this._start = null;
    if (!s) return;
    if (this._dx) {
      this._open = this._dx < -this._actWidth / 2;
      this._dx = 0;
      return;
    }
    if (!s.moved) {
      if (this._open) this._open = false;
      else if (this.clickable) fire(this, "item-click");
    }
  }
  _cancel() {
    clearTimeout(this._lp);
    this._start = null;
    this._dx = 0;
  }
  _context(e) {
    if (!this.actions?.length) return;
    e.preventDefault();
    this._open = !this._open;
  }
}

// ---------------------------------------------------------------------------

class DocTabs extends LitElement {
  static properties = { tabs: { attribute: false }, selected: {} };
  static styles = [
    base,
    css`
      :host {
        display: flex;
        gap: 4px;
        padding: 8px 16px;
        flex-wrap: wrap;
      }
      button {
        flex: 1;
      }
    `,
  ];
  render() {
    return (this.tabs || []).map(
      (t) => html`<button
        class=${t.id === this.selected ? "active" : ""}
        @click=${() => this.dispatchEvent(new CustomEvent("select", { detail: { id: t.id } }))}
      >
        ${t.icon ? html`<ha-icon icon=${t.icon}></ha-icon>` : nothing}${t.label}
      </button>`
    );
  }
}

// ---------------------------------------------------------------------------

/** Modal sheet. Docks to the bottom on narrow screens, centered dialog on wide ones. */
class DocSheet extends LitElement {
  static properties = { open: { type: Boolean, reflect: true }, heading: {} };
  static styles = [
    base,
    css`
      :host {
        display: none;
      }
      :host([open]) {
        display: block;
      }
      .scrim {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 1000;
        display: flex;
        align-items: flex-end;
        justify-content: center;
      }
      .panel {
        background: var(--doc-surface);
        width: 100%;
        max-width: 560px;
        max-height: 85vh;
        overflow: auto;
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
      }
      @media (min-width: 700px) {
        .scrim {
          align-items: center;
        }
        .panel {
          border-radius: 16px;
        }
      }
      header {
        display: flex;
        align-items: center;
        padding: 12px 8px 4px 16px;
      }
      h2 {
        flex: 1;
        margin: 0;
        font-size: 1.1em;
        font-weight: 500;
      }
      .body {
        padding: 0 0 16px;
      }
    `,
  ];
  render() {
    if (!this.open) return nothing;
    return html`<div class="scrim" @click=${(e) => e.target === e.currentTarget && this.close()}>
      <div class="panel" role="dialog" aria-label=${this.heading || ""}>
        <header>
          <h2>${this.heading}</h2>
          <slot name="actions"></slot>
          <button class="icon" title="Close" @click=${() => this.close()}><ha-icon icon="mdi:close"></ha-icon></button>
        </header>
        <div class="body"><slot></slot></div>
      </div>
    </div>`;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new CustomEvent("closed"));
  }
}

const define = (tag, cls) => customElements.get(tag) || customElements.define(tag, cls);
define("doc-page", DocPage);
define("doc-section", DocSection);
define("doc-toggle", DocToggle);
define("doc-entity-row", DocEntityRow);
define("doc-list-item", DocListItem);
define("doc-tabs", DocTabs);
define("doc-sheet", DocSheet);
