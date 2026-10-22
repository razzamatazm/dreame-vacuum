/*
 * <dreame-open-card> shell: config, hass wiring, page navigation and shared
 * dialogs. Pages live in ./pages and are loaded on first use.
 */

import { LitElement, html, css, nothing, base, Ctx, DOMAIN } from "./core.js";
import "./components.js";
import { PAGES } from "./pages.js";

export const CARD_VERSION = "2.0.0";

class DreameOpenCard extends LitElement {
  static properties = {
    _stack: { state: true },
    _ctx: { state: true },
    _loaded: { state: true },
    _dialog: { state: true },
  };

  static styles = [
    base,
    css`
      ha-card {
        overflow: hidden;
        position: relative;
      }
      .loading {
        padding: 32px;
        text-align: center;
        color: var(--doc-muted);
      }
      .dialog-body {
        padding: 0 16px;
        line-height: 1.4;
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px 16px 0;
      }
      .dialog-body input {
        width: 100%;
        box-sizing: border-box;
        margin-top: 8px;
      }
    `,
  ];

  static getConfigElement() {
    return document.createElement("dreame-open-card-editor");
  }

  static getStubConfig(hass) {
    const vac = Object.keys(hass.states).find((id) => id.startsWith("vacuum.") && hass.entities?.[id]?.platform === DOMAIN);
    return { entity: vac || "" };
  }

  constructor() {
    super();
    this._stack = [{ page: "home", params: {} }];
    this._loaded = new Set();
    this._dialog = null;
  }

  setConfig(config) {
    if (!config?.entity?.startsWith("vacuum.")) throw new Error("Set 'entity' to a dreame_vacuum vacuum entity");
    this._config = { show_settings: true, ...config };
    if (this._hass) this._ctx = new Ctx(this);
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) hass.loadBackendTranslation?.("entity_component", DOMAIN);
    if (!this._config) return;
    // Don't rebuild under someone typing.
    if (this._ctx && typingInside(this)) {
      this._pendingCtx = true;
      return;
    }
    this._ctx = new Ctx(this);
  }

  getCardSize() {
    return 10;
  }
  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  // ---- navigation -----------------------------------------------------
  navigate(page, params = {}) {
    if (!PAGES[page]) {
      this._ctx?.toast(`Unknown page: ${page}`);
      return;
    }
    this._stack = [...this._stack, { page, params }];
    this.scrollIntoView?.({ block: "nearest" });
  }
  back() {
    if (this._stack.length > 1) this._stack = this._stack.slice(0, -1);
  }

  async _ensure(page) {
    if (this._loaded.has(page)) return;
    try {
      await PAGES[page].load();
    } catch (err) {
      console.error(`dreame-open-card: failed to load page ${page}`, err);
      this._ctx?.toast(`Could not load ${page}: ${err.message}`);
      this.back();
      return;
    }
    this._loaded = new Set([...this._loaded, page]);
  }

  // ---- dialogs --------------------------------------------------------
  confirm({ title, text, confirmText, destructive } = {}) {
    return new Promise((resolve) => (this._dialog = { kind: "confirm", title, text, confirmText, destructive, resolve }));
  }
  prompt({ title, label, value = "", placeholder = "", maxlength = 40 } = {}) {
    return new Promise((resolve) => (this._dialog = { kind: "prompt", title, label, value, placeholder, maxlength, resolve }));
  }
  _closeDialog(result) {
    const d = this._dialog;
    this._dialog = null;
    if (this._pendingCtx) {
      this._pendingCtx = false;
      this._ctx = new Ctx(this);
    }
    d?.resolve(result);
  }

  // ---- render ---------------------------------------------------------
  render() {
    const ctx = this._ctx;
    if (!ctx) return nothing;
    if (!ctx.vacuum) return html`<ha-card><div class="loading">Entity not found: ${ctx.vacuumId}</div></ha-card>`;
    const { page, params } = this._stack[this._stack.length - 1];
    const def = PAGES[page];
    let body;
    if (!this._loaded.has(page)) {
      this._ensure(page);
      body = html`<div class="loading">Loading…</div>`;
    } else {
      body = this._pageEl(def.tag, ctx, params, this._stack.length);
    }
    return html`<ha-card>${body}${this._renderDialog()}</ha-card>`;
  }

  // Reuse the same element instance per stack depth so pages keep local state.
  _pageEl(tag, ctx, params, depth) {
    this._els ||= new Map();
    const key = `${depth}:${tag}`;
    let el = this._els.get(key);
    if (!el || el._params !== params) {
      el = document.createElement(tag);
      el._params = params;
      this._els.set(key, el);
      for (const k of [...this._els.keys()]) if (Number(k.split(":")[0]) > depth) this._els.delete(k);
    }
    el.ctx = ctx;
    el.params = params;
    return el;
  }

  _renderDialog() {
    const d = this._dialog;
    if (!d) return nothing;
    const ctx = this._ctx;
    const cancel = ctx.t("action", "cancel", "Cancel");
    if (d.kind === "confirm") {
      return html`<doc-sheet open heading=${d.title || ""} @closed=${() => this._closeDialog(false)}>
        <div class="dialog-body">${d.text}</div>
        <div class="dialog-actions">
          <button @click=${() => this._closeDialog(false)}>${cancel}</button>
          <button class=${d.destructive ? "danger" : "primary"} @click=${() => this._closeDialog(true)}>
            ${d.confirmText || ctx.t("action", "confirm", "Confirm")}
          </button>
        </div>
      </doc-sheet>`;
    }
    const submit = () => this._closeDialog(this.renderRoot.querySelector(".dialog-body input")?.value.trim() || null);
    return html`<doc-sheet open heading=${d.title || ""} @closed=${() => this._closeDialog(null)}>
      <div class="dialog-body">
        ${d.label ? html`<label>${d.label}</label>` : nothing}
        <input
          type="text"
          .value=${d.value}
          placeholder=${d.placeholder}
          maxlength=${d.maxlength}
          @keydown=${(e) => e.key === "Enter" && submit()}
        />
      </div>
      <div class="dialog-actions">
        <button @click=${() => this._closeDialog(null)}>${cancel}</button>
        <button class="primary" @click=${submit}>${ctx.t("action", "save", "Save")}</button>
      </div>
    </doc-sheet>`;
  }

  updated() {
    const input = this._dialog?.kind === "prompt" && this.renderRoot.querySelector(".dialog-body input");
    if (input && !this._focused) {
      this._focused = true;
      input.focus();
      input.select();
    }
    if (!this._dialog) this._focused = false;
  }
}

// True when a text input inside this card has focus (walks nested shadow roots).
function typingInside(card) {
  let el = document.activeElement;
  let inside = false;
  while (el) {
    if (el === card) inside = true;
    if (!el.shadowRoot?.activeElement) break;
    el = el.shadowRoot.activeElement;
  }
  return inside && /^(INPUT|TEXTAREA)$/.test(el?.tagName || "") && !["range", "checkbox"].includes(el.type);
}

// ---------------------------------------------------------------------------

const MODE_OPTIONS = [
  { value: "rooms", label: "Rooms" },
  { value: "zone", label: "Zone" },
  { value: "spot", label: "Spot" },
  { value: "goto", label: "Go to" },
];

class DreameOpenCardEditor extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true } };
  setConfig(config) {
    this._config = config;
  }
  render() {
    if (!this.hass || !this._config) return nothing;
    const schema = [
      { name: "entity", label: "Vacuum", required: true, selector: { entity: { domain: "vacuum", integration: DOMAIN } } },
      { name: "map_entity", label: "Map camera (auto-detected if empty)", selector: { entity: { domain: "camera", integration: DOMAIN } } },
      { name: "title", label: "Title", selector: { text: {} } },
      { name: "task_types", label: "Task types", selector: { select: { multiple: true, options: MODE_OPTIONS } } },
      { name: "left_handed", label: "Left-handed mode", selector: { boolean: {} } },
      { name: "shortcut_scripts", label: "Extra shortcut scripts", selector: { entity: { domain: "script", multiple: true } } },
      {
        name: "hidden_card_objects",
        label: "Hidden card objects",
        selector: {
          select: {
            multiple: true,
            options: [
              "title",
              "status",
              "room_labels",
              "progress_bar",
              "controls",
              "menu",
              "shortcuts",
              "action_buttons",
              "fault_notification",
              "warning_notification",
              "low_water_notification",
              "information_notification",
              "map_change_confirmation",
            ].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
          },
        },
      },
    ];
    return html`<ha-form
      .hass=${this.hass}
      .data=${this._config}
      .schema=${schema}
      .computeLabel=${(s) => s.label}
      @value-changed=${(ev) => {
        this._config = { ...this._config, ...ev.detail.value };
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      }}
    ></ha-form>`;
  }
}

customElements.get("dreame-open-card") || customElements.define("dreame-open-card", DreameOpenCard);
customElements.get("dreame-open-card-editor") || customElements.define("dreame-open-card-editor", DreameOpenCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "dreame-open-card")) {
  window.customCards.push({
    type: "dreame-open-card",
    name: "Dreame Open Card",
    description: "Full-featured, license-free card for dreame_vacuum.",
    preview: false,
  });
}
console.info(`%c DREAME-OPEN-CARD %c ${CARD_VERSION} `, "background:#18bcf2;color:#fff", "");
