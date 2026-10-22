/*
 * Customized Cleaning per room (doc-room-cleaning). params { room?: segmentId }.
 *
 * Map with room labels + room chips; the selected room's settings below.
 *
 * Writes: when the per-room entity (select.<dev>_room_<id>_<key>, number ..._wetness_level)
 * is available it is used directly (select.select_option / number.set_value). The
 * integration makes those entities unavailable while switch.customized_cleaning is off
 * (select.py segment_available_fn), so DVC's "editable any time" falls back to
 * dreame_vacuum.vacuum_set_custom_cleaning for that one room, with the integer codes
 * device.set_custom_cleaning validates (suction 0-3, water 1-3, repeats 1-3, mode 0-2,
 * route 1-4, mopping route -1..2, wetness 1-32, mop temperature 0-1, mop pressure 0|2).
 * Current values for the fallback come from the camera `rooms` attributes (Segment.as_dict).
 */
import { LitElement, html, css, nothing, base, svg } from "../core.js";
import { entityRows } from "../components.js";
import { polyPoints, areaCorners } from "../map-view.js";
import "../map-view.js";
import { cleanGeniusOn, navRowStyles } from "./cleaning-settings.js";

// key -> { attr (camera room attribute), param (service field), opts (option -> code), named (attr holds a Title name) }
const FIELDS = {
  cleaning_mode: { attr: "cleaning_mode", param: "cleaning_mode", opts: { sweeping: 0, mopping: 1, sweeping_and_mopping: 2 } },
  suction_level: { attr: "suction_level", param: "suction_level", opts: { quiet: 0, standard: 1, strong: 2, turbo: 3 } },
  water_volume: { attr: "water_volume", param: "water_volume", opts: { low: 1, medium: 2, high: 3 } },
  mop_pad_humidity: { attr: "water_volume", param: "water_volume", opts: { slightly_dry: 1, moist: 2, wet: 3 } },
  wetness_level: { attr: "wetness_level", param: "wetness_level", number: [1, 32] },
  cleaning_times: { attr: "cleaning_times", param: "repeats", opts: { "1x": 1, "2x": 2, "3x": 3 } },
  cleaning_route: { attr: "cleaning_route", param: "cleaning_route", opts: { standard: 1, intensive: 2, deep: 3, quick: 4 } },
  custom_mopping_route: { attr: "custom_mopping_route", param: "custom_mopping_route", opts: { off: -1, standard: 0, intensive: 1, deep: 2 } },
  mop_temperature: { attr: "mop_temperature", param: "mop_temperature", opts: { normal: 0, warm: 1 }, named: true },
  mop_pressure: { attr: "mop_pressure", param: "mop_pressure", opts: { light: 0, normal: 2 }, named: true },
};
const OPTIONAL = ["cleaning_mode", "cleaning_route", "custom_mopping_route", "mop_temperature", "mop_pressure"];

const domainOf = (key) => (FIELDS[key].number ? "number" : "select");

/** Integer code of a room's current value for a field, or undefined. */
function code(room, key) {
  const f = FIELDS[key];
  const v = room?.[f.attr];
  if (v == null) return undefined;
  if (f.named) return f.opts[String(v).toLowerCase().replace(/ /g, "_")];
  return Number(v);
}

/** vacuum_set_custom_cleaning payload for one room with one field changed. */
export function customCleaningPayload(room, key, value) {
  const get = (k) => (FIELDS[k].param === FIELDS[key].param ? value : code(room, k));
  const data = { segment_id: [room.id], suction_level: [get("suction_level")], repeats: [get("cleaning_times")] };
  const water = FIELDS[key].param === "water_volume";
  if (room.wetness_level != null && !water) data.wetness_level = [get("wetness_level")];
  else if (room.water_volume != null || water) data.water_volume = [water ? value : code(room, "water_volume")];
  for (const k of OPTIONAL) {
    const v = get(k);
    if (v !== undefined && room[FIELDS[k].attr] != null) data[FIELDS[k].param] = [v];
  }
  return data;
}

class RoomCleaning extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false }, _room: { state: true } };
  static styles = [
    base,
    navRowStyles,
    css`
      doc-map {
        margin: 0 0 8px;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 4px 16px 8px;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
      }
      .item ha-icon {
        color: var(--state-icon-color, var(--doc-muted));
      }
      .item .label {
        flex: 1;
      }
      .locked {
        opacity: 0.5;
        pointer-events: none;
      }
      input[type="range"] {
        width: 120px;
      }
    `,
  ];

  _selected(rooms) {
    const want = this._room ?? this.params?.room;
    return rooms.find((r) => r.id === Number(want)) || rooms[0];
  }

  _overlay(rooms, sel) {
    return (tf, u) =>
      rooms.map((r) => {
        const active = r.id === sel?.id;
        const [cx, cy] = tf.toMap(r.x ?? (r.x0 + r.x1) / 2, r.y ?? (r.y0 + r.y1) / 2);
        const outline =
          active && r.x0 != null
            ? svg`<polygon points=${polyPoints(tf, areaCorners([r.x0, r.y0, r.x1, r.y1]))} fill="rgba(3,169,244,0.18)"
                stroke="var(--primary-color, #03a9f4)" stroke-width=${3 * u} pointer-events="none"></polygon>`
            : "";
        return svg`${outline}<g data-kind="room" data-id=${r.id} style="cursor:pointer">
          <circle cx=${cx} cy=${cy} r=${13 * u} fill=${active ? "var(--primary-color, #03a9f4)" : "rgba(255,255,255,0.92)"}
            stroke="var(--primary-color, #03a9f4)" stroke-width=${2 * u}></circle>
          <text x=${cx} y=${cy} dy=${4.5 * u} text-anchor="middle" font-size=${12 * u} font-weight="600"
            fill=${active ? "#fff" : "#333"}>${(r.cleaning_times ?? 1) + "x"}</text>
          <text x=${cx} y=${cy + 28 * u} text-anchor="middle" font-size=${12 * u} fill="#222"
            stroke="#fff" stroke-width=${3 * u} paint-order="stroke">${this.ctx.roomName(r)}</text>
        </g>`;
      });
  }

  _pick(e, rooms) {
    const d = e.detail;
    let id = d.data?.kind === "room" ? Number(d.data.id) : null;
    if (id == null) {
      // Tap inside a room's bounds; smallest room wins.
      const hit = rooms
        .filter((r) => r.x0 != null && d.x >= Math.min(r.x0, r.x1) && d.x <= Math.max(r.x0, r.x1) && d.y >= Math.min(r.y0, r.y1) && d.y <= Math.max(r.y0, r.y1))
        .sort((a, b) => Math.abs((a.x1 - a.x0) * (a.y1 - a.y0)) - Math.abs((b.x1 - b.x0) * (b.y1 - b.y0)));
      id = hit[0]?.id ?? null;
    }
    if (id != null) this._room = id;
  }

  _label(domain, key) {
    return this.ctx.hass.localize?.(`component.dreame_vacuum.entity.${domain}.${key}.name`) || key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  _optLabel(key, opt) {
    return this.ctx.hass.localize?.(`component.dreame_vacuum.entity.select.${key}.state.${opt}`) || opt.replace(/_/g, " ");
  }

  /** One setting row: the live entity when available, otherwise a service-backed control. */
  _field(room, key) {
    const c = this.ctx;
    const domain = domainOf(key);
    const id = c.roomEnt(domain, key, room.id);
    if (!id) return nothing;
    const label = this._label(domain, key);
    if (c.available(id)) return html`<doc-entity-row .ctx=${c} entity=${id} label=${label}></doc-entity-row>`;

    // Entity unavailable (customized cleaning off): edit through vacuum_set_custom_cleaning.
    const f = FIELDS[key];
    const cur = code(room, key);
    const canWrite = room.suction_level != null && room.cleaning_times != null && cur !== undefined;
    const send = (v) => c.vac("vacuum_set_custom_cleaning", customCleaningPayload(room, key, Number(v)));
    const st = c.hass.states[id];
    const icon = st?.attributes?.icon || "mdi:tune";
    let control;
    if (f.number) {
      control = html`<input type="range" min=${f.number[0]} max=${f.number[1]} step="1" .value=${String(cur ?? f.number[0])}
          ?disabled=${!canWrite} @change=${(e) => send(e.target.value)} /><span class="muted">${cur ?? "-"}</span>`;
    } else {
      control = html`<select ?disabled=${!canWrite} @change=${(e) => send(e.target.value)}>
        ${cur === undefined ? html`<option selected>-</option>` : nothing}
        ${Object.entries(f.opts).map(([opt, v]) => html`<option value=${v} ?selected=${v === cur}>${this._optLabel(key, opt)}</option>`)}
      </select>`;
    }
    return html`<div class="item"><ha-icon icon=${icon}></ha-icon><span class="label">${label}</span>${control}</div>`;
  }

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const rooms = c.rooms().sort((a, b) => a.id - b.id);
    const sel = this._selected(rooms);
    const custom = c.st("switch", "customized_cleaning");
    const started = !!c.attrs.started;
    return html`<doc-page .ctx=${c} heading=${c.t("title", "customized_cleaning", "Customized Cleaning")}>
      ${cleanGeniusOn(c)
        ? html`<div class="banner"><ha-icon icon="mdi:creation"></ha-icon>CleanGenius is on, room settings are not used while it is enabled.</div>`
        : nothing}
      ${custom && custom.state !== "on"
        ? html`<div class="banner"><ha-icon icon="mdi:information-outline"></ha-icon>${c.t("message", "customized_cleaning_disabled", "Customized cleaning is disabled!")}</div>`
        : nothing}
      ${entityRows(c, ["switch.customized_cleaning"])}
      <doc-map .ctx=${c} .overlay=${this._overlay(rooms, sel)} @map-down=${(e) => this._pick(e, rooms)}></doc-map>
      <div class="chips">
        ${rooms.map(
          (r) => html`<button class=${r.id === sel?.id ? "active" : ""} @click=${() => (this._room = r.id)}>
            ${r.icon ? html`<ha-icon icon=${r.icon}></ha-icon>` : nothing}${c.roomName(r)}
          </button>`
        )}
      </div>
      ${sel
        ? html`<doc-section heading=${c.roomName(sel)}>
            ${started ? html`<div class="note">${c.t("message", "active_task", "Vacuum has active task!")}</div>` : nothing}
            <div class=${started ? "locked" : ""} ?inert=${started}>${Object.keys(FIELDS).map((k) => this._field(sel, k))}</div>
          </doc-section>`
        : html`<p class="note">${c.t("title", "unavailable", "Unavailable")}</p>`}
    </doc-page>`;
  }
}

customElements.get("doc-room-cleaning") || customElements.define("doc-room-cleaning", RoomCleaning);
