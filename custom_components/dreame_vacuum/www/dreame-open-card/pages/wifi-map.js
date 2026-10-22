/*
 * Saved Wi-Fi Map (doc-wifi-map) for the active map: RSSI heat map, router
 * marker that can be moved by tapping a floor area or dragging, Save button
 * -> vacuum_set_router_position {x, y} (device.py applies it to the selected map).
 *
 * Image + calibration source, in order of preference:
 *  1. The per-map "wifi_map" camera (camera.<device>_wifi_map_<index>, disabled
 *     by default). Its entity_picture, calibration_points and router_position
 *     all describe the same rendered wifi image, so coordinates are exact.
 *  2. The live camera's `wifi_map_picture` (/api/camera_wifi_map_proxy). That
 *     image is rendered from wifi_map_data by the live camera's proxy renderer,
 *     whose calibration is not published, so the live map calibration is used.
 *     Exact only when the wifi map shares the live map's dimensions.
 */
import { LitElement, html, css, svg, nothing, base } from "../core.js";
import "../map-view.js";
import { mapCameras } from "./maps.js";

class WifiMap extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false }, _pos: { state: true } };
  static styles = [
    base,
    css`
      .note {
        margin: 8px 16px;
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      doc-map {
        margin: 0;
      }
    `,
  ];

  constructor() {
    super();
    this._pos = null; // unsaved router position [x, y] in vacuum mm
  }

  /** { src, calibration, router, rooms, exact } */
  get _source() {
    const c = this.ctx;
    const index = Number(c.attrs.selected_map_index ?? c.mapAttrs.map_index);
    const wifiId = mapCameras(c).get(index)?.wifi;
    const w = wifiId && c.available(wifiId) ? c.hass.states[wifiId].attributes : null;
    if (w?.entity_picture && w.calibration_points) {
      return { src: c.url(w.entity_picture), calibration: w.calibration_points, router: w.router_position, rooms: w.rooms, exact: true };
    }
    const savedId = mapCameras(c).get(index)?.saved;
    const s = savedId ? c.hass.states[savedId]?.attributes : null;
    const pic = c.mapAttrs.wifi_map_picture || s?.wifi_map_picture;
    if (!pic) return null;
    return {
      src: c.url(pic),
      calibration: c.mapAttrs.calibration_points,
      router: c.mapAttrs.router_position || s?.router_position,
      rooms: c.mapAttrs.rooms || s?.rooms,
      exact: false,
    };
  }

  render() {
    const c = this.ctx;
    const src = this._source;
    const title = c.t("title", "wifi_map", "WiFi Map");
    return html`<doc-page .ctx=${c} heading=${title}>
      <button
        slot="actions"
        class=${this._pos ? "primary" : ""}
        ?disabled=${!this._pos || c.attrs.started}
        @click=${() => this._save()}
      >
        <ha-icon icon="mdi:content-save"></ha-icon>${c.t("action", "save", "Save")}
      </button>
      ${src
        ? html`<doc-map
              .ctx=${c}
              .src=${src.src}
              .calibration=${src.calibration}
              .overlay=${(tf, u) => this._overlay(tf, u, src)}
              @map-down=${(e) => this._down(e, src)}
              @map-move=${(e) => this._move(e, src)}
              @map-up=${() => (this._drag = false)}
            ></doc-map>
            <div class="note">
              ${c.t("config", "map_object_router", "Router")}:
              ${this._router(src) ? this._router(src).join(", ") : "-"}
              ${src.exact ? nothing : html`<br />Enable the "${c.t("title", "wifi_map", "WiFi Map")}" camera entity for exact router placement.`}
            </div>`
        : html`<div class="note">-</div>`}
    </doc-page>`;
  }

  _router(src) {
    if (this._pos) return this._pos;
    const r = src.router;
    const cur = Array.isArray(r) ? [Number(r[0]), Number(r[1])] : r && r.x != null ? [Number(r.x), Number(r.y)] : null;
    // Show the just-saved position until the integration publishes it.
    if (this._pending && (!cur || cur[0] !== this._pending[0] || cur[1] !== this._pending[1])) return this._pending;
    this._pending = null;
    return cur;
  }

  _overlay(tf, u, src) {
    const p = this._router(src);
    if (!p) return nothing;
    const [x, y] = tf.toMap(p[0], p[1]);
    const r = 16 * u;
    return svg`<g data-kind="router" style="cursor:grab">
      <circle cx=${x} cy=${y} r=${r * 1.6} fill="transparent"></circle>
      <circle cx=${x} cy=${y} r=${r} fill=${this._pos ? "var(--primary-color, #03a9f4)" : "#fff"} stroke="var(--primary-color, #03a9f4)" stroke-width=${3 * u}></circle>
      <path d="M ${x - r * 0.5} ${y - r * 0.1} q ${r * 0.5} ${-r * 0.5} ${r} 0 M ${x - r * 0.28} ${y + r * 0.15} q ${r * 0.28} ${-r * 0.28} ${r * 0.56} 0"
        fill="none" stroke=${this._pos ? "#fff" : "var(--primary-color, #03a9f4)"} stroke-width=${2.5 * u} stroke-linecap="round"></path>
      <circle cx=${x} cy=${y + r * 0.42} r=${2.5 * u} fill=${this._pos ? "#fff" : "var(--primary-color, #03a9f4)"}></circle>
    </g>`;
  }

  // A valid router spot is inside a room's bounds (and the image, when room bounds are unknown).
  _valid(e, src) {
    const { x, y, mx, my } = e.detail;
    const rooms = Object.values(src.rooms || {}).filter((r) => r.x0 != null && r.x1 != null);
    if (rooms.length) {
      return rooms.some((r) => x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) && y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1));
    }
    const img = e.detail.map?._size;
    return !img || (mx >= 0 && my >= 0 && mx <= img[0] && my <= img[1]);
  }

  _down(e, src) {
    if (e.detail.data?.kind === "router") {
      this._drag = true;
      e.detail.map.capture(e.detail.event);
      return;
    }
    if (this._valid(e, src)) this._pos = [e.detail.x, e.detail.y];
    else this.ctx.toast(this.ctx.t("title", "invalid", "invalid"));
  }

  _move(e, src) {
    if (this._drag && this._valid(e, src)) this._pos = [e.detail.x, e.detail.y];
  }

  async _save() {
    if (!this._pos) return;
    const [x, y] = this._pos.map((n) => Math.round(n));
    if (await this.ctx.vac("vacuum_set_router_position", { x, y })) {
      this._pending = [x, y];
      this._pos = null;
      this.ctx.toast(this.ctx.t("message", "saved", "Successfully saved"));
    }
  }
}

customElements.get("doc-wifi-map") || customElements.define("doc-wifi-map", WifiMap);
