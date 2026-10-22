/*
 * <doc-remote> Remote control: two independent analog sliders.
 *   left  (vertical)   -> velocity  -600..600  (forward / backward)
 *   right (horizontal) -> rotation  -360..360  (rotate in place)
 * Keyboard after focusing the control: W/S or Up/Down, A/D or Left/Right,
 * Shift = fine forward/back, Ctrl = fine rotation.
 *
 * Service: dreame_vacuum.vacuum_remote_control_move_step {velocity, rotation}
 * (vacuum.py schema clamps velocity to ±600, rotation to ±360; prompt omitted so the
 * integration decides: it plays the voice prompt only on the first step of a session,
 * device.py remote_control_move_step).
 *
 * Send rate: device.py remote_control_move_step has no throttling or queueing; every call is
 * a blocking set_property round trip (local miio or cloud) via the executor. So we send at most
 * every SEND_MS and never while the previous call is still in flight, which keeps HA from
 * piling up executor jobs on a slow link. On release we send one final 0/0 so the robot stops
 * immediately instead of finishing its last step.
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import "../components.js";
import "../map-view.js";

const SEND_MS = 250;
const MAX_V = 600;
const MAX_R = 360;
// Reverse is blind (no rear bumper), so it is capped at half of forward speed.
const MAX_REVERSE_V = 300;
const DEAD = 0.12; // dead zone, fraction of half-travel
const FINE = 0.3; // Shift / Ctrl multiplier
// Sign of rotation for "slider right / D key". Assumes positive spdw turns left (counter-clockwise).
const ROTATE_RIGHT = -1;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const dz = (x) => (Math.abs(x) < DEAD ? 0 : Math.sign(x) * ((Math.abs(x) - DEAD) / (1 - DEAD)));

class DocRemote extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    _v: { state: true }, // -1..1 slider position (after dead zone)
    _r: { state: true }, // -1..1, +1 = right
    _drag: { state: true },
    _focus: { state: true },
  };

  static styles = [
    base,
    css`
      .layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
          "map map"
          "warn warn"
          "left right";
        gap: 8px;
        padding: 0 0 8px;
      }
      doc-map {
        grid-area: map;
      }
      .warn {
        grid-area: warn;
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin: 0 16px;
        padding: 8px 12px;
        border-radius: var(--doc-radius);
        background: color-mix(in srgb, var(--doc-warn) 15%, transparent);
        font-size: 0.85em;
        line-height: 1.35;
      }
      .warn ha-icon {
        color: var(--doc-warn);
        flex: none;
      }
      .left {
        grid-area: left;
      }
      .right {
        grid-area: right;
      }
      .ctl {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px;
        outline: none;
      }
      .lbl {
        font-size: 0.8em;
        color: var(--doc-muted);
        font-variant-numeric: tabular-nums;
      }
      .track {
        position: relative;
        background: var(--doc-surface-2);
        border-radius: 36px;
        touch-action: none;
        user-select: none;
        cursor: grab;
      }
      .track.v {
        width: 72px;
        height: 220px;
      }
      .track.h {
        width: min(220px, 100%);
        height: 72px;
      }
      .track::before {
        content: "";
        position: absolute;
        background: var(--doc-divider);
      }
      .track.v::before {
        left: 50%;
        top: 12px;
        bottom: 12px;
        width: 2px;
        transform: translateX(-50%);
      }
      .track.h::before {
        top: 50%;
        left: 12px;
        right: 12px;
        height: 2px;
        transform: translateY(-50%);
      }
      .zone {
        position: absolute;
        background: color-mix(in srgb, var(--doc-muted) 18%, transparent);
        border-radius: 4px;
      }
      .track.v .zone {
        left: 8px;
        right: 8px;
        top: calc(50% - ${DEAD * 74}px);
        height: ${DEAD * 148}px;
      }
      .track.h .zone {
        top: 8px;
        bottom: 8px;
        left: calc(50% - ${DEAD * 50}%);
        width: ${DEAD * 100}%;
      }
      .thumb {
        position: absolute;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: var(--doc-accent);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        left: 50%;
        top: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-primary-color, #fff);
        transition: transform 0.18s ease-out;
        pointer-events: none;
      }
      .thumb.live {
        transition: none;
      }
      .thumb.reverse {
        background: var(--doc-error);
      }
      .focus-hint {
        grid-column: 1 / -1;
        text-align: center;
        font-size: 0.8em;
        color: var(--doc-muted);
      }
      .focused .track {
        box-shadow: 0 0 0 2px var(--doc-accent);
      }
      /* Landscape phones: sliders at the screen edges for two-thumb control, map between. */
      @media (orientation: landscape) and (max-height: 560px) {
        .layout {
          grid-template-columns: auto 1fr auto;
          grid-template-areas:
            "left map right"
            "left warn right";
          align-items: center;
        }
        doc-map {
          max-height: 70vh;
          overflow: hidden;
        }
        .track.v {
          height: min(220px, 60vh);
        }
        .track.h {
          width: 180px;
        }
      }
    `,
  ];

  constructor() {
    super();
    this._v = 0;
    this._r = 0;
    this._drag = { v: null, r: null }; // pointerId per axis
    this._keys = new Set();
    this._inflight = false;
    this._timer = null;
    this._sentNonZero = false;
    this._halted = false;
    this._lastStep = { v: 0, r: 0 };
    this._onBlur = () => this._releaseAll();
    this._onVis = () => document.hidden && this._releaseAll();
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("blur", this._onBlur);
    document.addEventListener("visibilitychange", this._onVis);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("blur", this._onBlur);
    document.removeEventListener("visibilitychange", this._onVis);
    this._releaseAll();
  }

  // ---- values -------------------------------------------------------------
  get _fineV() {
    return this._keys.has("Shift");
  }
  get _fineR() {
    return this._keys.has("Control");
  }
  /** Payload for the current state. */
  _payload() {
    const v = Math.round(clamp(this._v * MAX_V * (this._fineV ? FINE : 1), -MAX_REVERSE_V, MAX_V));
    const r = Math.round(clamp(this._r * MAX_R * (this._fineR ? FINE : 1) * ROTATE_RIGHT, -MAX_R, MAX_R));
    return { velocity: v || 0, rotation: r || 0 };
  }

  _set(axis, value) {
    const prev = axis === "v" ? this._v : this._r;
    if (axis === "v") this._v = value;
    else this._r = value;
    this._haptic(prev, value);
    this._schedule();
  }

  // Tick when leaving the dead zone and at every quarter of travel.
  _haptic(prev, next) {
    const step = (x) => (x === 0 ? 0 : Math.sign(x) * Math.ceil(Math.abs(x) * 4));
    if (step(prev) !== step(next)) navigator.vibrate?.(next === 0 ? 15 : 8);
  }

  // ---- sending -------------------------------------------------------------
  _schedule() {
    const active = this._v !== 0 || this._r !== 0;
    if (active && !this._timer && !this._halted) {
      this._tick();
      this._timer = setInterval(() => this._tick(), SEND_MS);
    } else if (!active && this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      this._stop();
    } else if (!active && this._halted) {
      this._halted = false;
    }
  }

  async _tick() {
    if (this._inflight || this._halted) return;
    const p = this._payload();
    if (p.velocity === 0 && p.rotation === 0) return;
    this._inflight = true;
    this._sentNonZero = true;
    const ok = await this.ctx.vac("vacuum_remote_control_move_step", p);
    this._inflight = false;
    if (!ok) {
      // Don't spam toasts every tick (e.g. robot washing / fast mapping); wait for release.
      this._halted = true;
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _stop() {
    if (!this._sentNonZero) return;
    this._sentNonZero = false;
    // Wait for the in-flight step so the stop is the last command the robot sees.
    for (let i = 0; this._inflight && i < 40; i++) await new Promise((r) => setTimeout(r, 50));
    if (this._v !== 0 || this._r !== 0) return; // user grabbed again meanwhile
    this.ctx.vac("vacuum_remote_control_move_step", { velocity: 0, rotation: 0 });
  }

  _releaseAll() {
    this._keys.clear();
    this._drag = { v: null, r: null };
    if (this._v !== 0 || this._r !== 0) {
      this._v = 0;
      this._r = 0;
      this._schedule();
    }
  }

  // ---- pointer ---------------------------------------------------------------
  _pos(axis, ev) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const raw =
      axis === "v"
        ? (rect.top + rect.height / 2 - ev.clientY) / (rect.height / 2 - 36)
        : (ev.clientX - (rect.left + rect.width / 2)) / (rect.width / 2 - 36);
    return dz(clamp(raw, -1, 1));
  }
  _down(axis, ev) {
    if (ev.button > 0) return;
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {}
    this._drag = { ...this._drag, [axis]: ev.pointerId };
    this._set(axis, this._pos(axis, ev));
  }
  _move(axis, ev) {
    if (this._drag[axis] !== ev.pointerId) return;
    this._set(axis, this._pos(axis, ev));
  }
  _up(axis, ev) {
    if (this._drag[axis] !== ev.pointerId) return;
    this._drag = { ...this._drag, [axis]: null };
    this._set(axis, this._keyValue(axis));
  }

  // ---- keyboard --------------------------------------------------------------
  _keyValue(axis) {
    const k = this._keys;
    if (axis === "v") return (k.has("w") || k.has("ArrowUp") ? 1 : 0) - (k.has("s") || k.has("ArrowDown") ? 1 : 0);
    return (k.has("d") || k.has("ArrowRight") ? 1 : 0) - (k.has("a") || k.has("ArrowLeft") ? 1 : 0);
  }
  _keyName(ev) {
    return ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  }
  _keydown(ev) {
    const key = this._keyName(ev);
    if (!["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift", "Control"].includes(key)) return;
    ev.preventDefault();
    if (ev.repeat && this._keys.has(key)) return;
    this._keys.add(key);
    this._applyKeys();
  }
  _keyup(ev) {
    const key = this._keyName(ev);
    if (!this._keys.delete(key) && key !== "Shift" && key !== "Control") return;
    ev.preventDefault();
    this._applyKeys();
  }
  _applyKeys() {
    if (this._drag.v == null) this._set("v", this._keyValue("v"));
    if (this._drag.r == null) this._set("r", this._keyValue("r"));
    this.requestUpdate();
  }

  // ---- render ------------------------------------------------------------------
  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const paused = c.vacuum?.state === "paused" || c.attrs.paused;
    const p = this._payload();
    const vy = -this._v * (110 - 36); // px from center (track 220)
    const rx = this._r * 50; // % of half width handled in style below
    return html`<doc-page .ctx=${c} heading=${c.t("title", "remote_control", "Remote Control")}>
      <button
        slot="actions"
        class=${paused ? "primary" : ""}
        @click=${() => (paused ? c.vacuumCmd("start") : c.vacuumCmd("return_to_base"))}
      >
        <ha-icon icon=${paused ? "mdi:play" : "mdi:home-import-outline"}></ha-icon>
        ${paused ? c.t("action", "resume", "Resume") : "Return"}
      </button>

      <div
        class="layout ${this._focus ? "focused" : ""}"
        tabindex="0"
        @keydown=${this._keydown}
        @keyup=${this._keyup}
        @focus=${() => (this._focus = true)}
        @blur=${() => {
          this._focus = false;
          this._releaseAll();
        }}
        style="outline:none"
      >
        <doc-map .ctx=${c}></doc-map>
        <div class="warn">
          <ha-icon icon="mdi:alert"></ha-icon>
          <span
            >The robot has no rear bumper or sensors. Moving backward is blind and collisions go undetected, which can
            damage the robot or furniture. Use reverse with extreme caution.</span
          >
        </div>
        <div class="ctl left">
          <div
            class="track v"
            @pointerdown=${(e) => this._down("v", e)}
            @pointermove=${(e) => this._move("v", e)}
            @pointerup=${(e) => this._up("v", e)}
            @pointercancel=${(e) => this._up("v", e)}
          >
            <div class="zone"></div>
            <div
              class="thumb ${this._drag.v != null ? "live" : ""} ${this._v < 0 ? "reverse" : ""}"
              style="transform: translate(-50%, calc(-50% + ${vy}px))"
            >
              <ha-icon icon=${this._v < 0 ? "mdi:arrow-down-bold" : "mdi:arrow-up-bold"}></ha-icon>
            </div>
          </div>
          <span class="lbl">${p.velocity} mm/s${this._fineV ? " (fine)" : ""}</span>
        </div>
        <div class="ctl right">
          <div
            class="track h"
            @pointerdown=${(e) => this._down("r", e)}
            @pointermove=${(e) => this._move("r", e)}
            @pointerup=${(e) => this._up("r", e)}
            @pointercancel=${(e) => this._up("r", e)}
          >
            <div class="zone"></div>
            <div
              class="thumb ${this._drag.r != null ? "live" : ""}"
              style="left: calc(50% + (${rx} / 100) * (100% - 72px)); transform: translate(-50%, -50%)"
            >
              <ha-icon icon="mdi:rotate-right"></ha-icon>
            </div>
          </div>
          <span class="lbl">${p.rotation}°${this._fineR ? " (fine)" : ""}</span>
        </div>
        <div class="focus-hint">
          ${this._focus ? "Keyboard: W/S or ↑/↓ drive, A/D or ←/→ rotate, Shift fine drive, Ctrl fine rotate" : "Click here to use the keyboard"}
        </div>
      </div>
    </doc-page>`;
  }
}

customElements.get("doc-remote") || customElements.define("doc-remote", DocRemote);
