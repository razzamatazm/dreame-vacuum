/*
 * Map Management (doc-maps): multi-floor toggle, saved map list, create map,
 * temporary map banner. Also exports helpers shared by recovery.js / wifi-map.js.
 *
 * Saved-map cameras: camera.py creates one "saved_map" camera per map index
 * (unique_id `<mac>_map_<index>`, entity_id `<device>_map_<index>`) and, on
 * wifi_map models, a disabled-by-default "wifi_map" camera (`<device>_wifi_map_<index>`).
 * Both carry a boolean `selected` attribute, which the live camera never has.
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import { entityRows } from "../components.js";

const SAVED_RE = /_map_(\d+)$/;
const WIFI_RE = /_wifi_map_(\d+)$/;

/** Map(index -> { saved?: entity_id, wifi?: entity_id }) for the vacuum's per-map cameras. */
export function mapCameras(ctx) {
  const out = new Map();
  for (const e of Object.values(ctx.hass.entities || {})) {
    if (e.device_id !== ctx.deviceId || !e.entity_id.startsWith("camera.") || e.entity_id === ctx.mapId) continue;
    const st = ctx.hass.states[e.entity_id];
    const tk = e.translation_key;
    const wifi = tk === "wifi_map" || WIFI_RE.test(e.entity_id);
    const saved = !wifi && (tk === "saved_map" || SAVED_RE.test(e.entity_id));
    if (!wifi && !saved) continue;
    // Index: the map_index attribute when published, else the entity_id suffix.
    const m = e.entity_id.match(wifi ? WIFI_RE : SAVED_RE);
    const index = Number(st?.attributes?.map_index ?? (m ? m[1] : NaN));
    if (!index) continue;
    if (!out.has(index)) out.set(index, {});
    out.get(index)[wifi ? "wifi" : "saved"] = e.entity_id;
  }
  return out;
}

/** Saved maps from the vacuum `maps` attribute, active map first. */
export function savedMaps(ctx) {
  const a = ctx.attrs;
  const list = Array.isArray(a.maps) ? [...a.maps] : [];
  const active = (m) => m.id === a.selected_map_id;
  return list.sort((x, y) => active(y) - active(x) || (x.index ?? 0) - (y.index ?? 0)).map((m) => ({ ...m, active: active(m) }));
}

export function mapName(ctx, m) {
  if (!m) return "";
  return m.name || m.custom_name || ctx.t("title", "map_name_placeholder", "Map %index%").replace("%index%", m.index);
}

/** Recovery entries ({ index, key, type, date, picture, file }) for a map index, newest first. */
export function recoveryMaps(ctx, mapIndex) {
  const m = savedMaps(ctx).find((x) => Number(x.index) === Number(mapIndex));
  const cam = mapCameras(ctx).get(Number(mapIndex))?.saved;
  let attrs = cam && ctx.hass.states[cam]?.attributes;
  // The live camera publishes the selected map's recovery list too.
  if (!attrs?.recovery_map_picture && m?.active) attrs = ctx.mapAttrs;
  const pics = attrs?.recovery_map_picture || {};
  const files = attrs?.recovery_map_file || {};
  // Keys look like "<%x %X>: Map<N> (<type>)"; N is the 1-based recovery_map_index (camera.py RECOVERY_MAP_IMAGE_URL).
  const parse = (key) => {
    const r = String(key).match(/^(.*): Map(\d+) \((.*)\)$/);
    return r ? { date: r[1], index: Number(r[2]), type: r[3] } : null;
  };
  const keys = Object.keys(pics).length ? Object.keys(pics) : [...(m?.recovery_map || [])].reverse();
  return keys
    .map((key) => {
      const p = parse(key);
      return p && { ...p, key, picture: pics[key], file: files[key] };
    })
    .filter(Boolean)
    .sort((x, y) => y.index - x.index);
}

const fmtDate = (ctx, d) => {
  const t = d ? new Date(d) : null;
  return t && !isNaN(t) ? t.toLocaleString(ctx.hass.locale?.language, { dateStyle: "medium", timeStyle: "short" }) : "";
};

class Maps extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false }, _sheet: { state: true } };
  static styles = [
    base,
    css`
      .item {
        padding: 10px 16px;
      }
      .secondary {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      .map {
        display: flex;
        gap: 12px;
        align-items: center;
      }
      .thumb {
        width: 88px;
        height: 66px;
        flex: none;
        border-radius: 8px;
        background: var(--doc-surface-2);
        object-fit: contain;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--doc-muted);
      }
      .info {
        flex: 1;
        min-width: 0;
      }
      .name {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .badge {
        display: inline-block;
        font-size: 0.75em;
        padding: 1px 8px;
        border-radius: 10px;
        background: var(--doc-accent);
        color: var(--text-primary-color, #fff);
        margin-left: 6px;
        vertical-align: middle;
      }
      .ops {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        margin-top: 4px;
      }
      .ops button {
        border: none;
        padding: 4px 8px;
        min-height: 30px;
        font-size: 0.85em;
        color: var(--doc-accent);
      }
      .ops ha-icon {
        --mdc-icon-size: 18px;
      }
      .banner {
        margin: 8px 16px;
        padding: 12px;
        border-radius: var(--doc-radius);
        background: var(--doc-surface-2);
        border-left: 4px solid var(--doc-warn);
      }
      .banner .row {
        margin-top: 8px;
        flex-wrap: wrap;
      }
      .empty {
        padding: 24px 16px;
        text-align: center;
      }
      .sheet-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 16px;
      }
    `,
  ];

  render() {
    const c = this.ctx;
    const a = c.attrs;
    const maps = savedMaps(c);
    const cams = mapCameras(c);
    const canCreate = c.ent("button", "start_fast_mapping") || c.ent("button", "start_mapping");
    return html`<doc-page .ctx=${c} heading=${c.t("title", "map_management", "Map Management")}>
      ${canCreate
        ? html`<button
            slot="actions"
            class="icon"
            title=${c.t("action", "add_map", "Create map")}
            ?disabled=${a.mapping_available === false || a.has_temporary_map}
            @click=${() => (this._sheet = { kind: "create" })}
          >
            <ha-icon icon="mdi:map-plus"></ha-icon>
          </button>`
        : nothing}
      ${a.has_temporary_map ? this._temporary(maps) : nothing}
      ${entityRows(c, ["switch.multi_floor_map"])}
      <doc-section heading=${c.t("title", "saved_map", "Saved Map")}>
        ${maps.length
          ? maps.map((m) => this._item(m, cams.get(Number(m.index))))
          : html`<div class="empty muted">${c.t("message", "no_map", "No saved maps")}</div>`}
      </doc-section>
      ${this._renderSheet(maps)}
    </doc-page>`;
  }

  _item(m, cams) {
    const c = this.ctx;
    const name = mapName(c, m);
    const pic = (cams?.saved && c.hass.states[cams.saved]?.attributes.entity_picture) || (m.active && c.mapAttrs.entity_picture);
    const hasWifi =
      c.can("wifi_map") && (c.mapAttrs.wifi_map_picture || (cams?.wifi && c.available(cams.wifi)) || cams?.saved && c.hass.states[cams.saved]?.attributes.wifi_map_picture);
    const op = (icon, key, fallback, run) =>
      html`<button @click=${run}><ha-icon icon=${icon}></ha-icon>${c.t("action", key, fallback)}</button>`;
    return html`<doc-list-item
      .actions=${[{ label: c.t("action", "delete", "Delete"), icon: "mdi:delete", danger: true, run: () => this._delete(m) }]}
    >
      <div class="item map">
        ${pic ? html`<img class="thumb" src=${c.url(pic)} alt="" />` : html`<div class="thumb"><ha-icon icon="mdi:map"></ha-icon></div>`}
        <div class="info">
          <div class="name">
            ${name}${m.active ? html`<span class="badge">${c.t("title", "selected", "Active")}</span>` : nothing}
          </div>
          <div class="secondary">${fmtDate(c, m.date)}</div>
          <div class="ops">
            ${op("mdi:rename-box", "rename", "Rename", () => this._rename(m))}
            ${op("mdi:restore", "restore", "Restore", () => c.navigate("recovery", { mapIndex: m.index }))}
            ${m.active ? nothing : op("mdi:check-circle-outline", "select_map", "Select map", () => this._select(m))}
            ${op("mdi:floor-plan", "rooms", "Rooms", () => c.navigate("saved-map-edit", { mapIndex: m.index }))}
            ${m.active ? op("mdi:sofa-outline", "objects", "Objects", () => c.navigate("object-edit")) : nothing}
            ${m.active && hasWifi ? op("mdi:wifi", "wifi_map", "WiFi map", () => c.navigate("wifi-map")) : nothing}
          </div>
        </div>
      </div>
    </doc-list-item>`;
  }

  _temporary(maps) {
    const c = this.ctx;
    return html`<div class="banner">
      <div><b>${c.t("title", "new_map", "New Map")}</b></div>
      <div class="row">
        <button class="primary" @click=${() => c.vac("vacuum_save_temporary_map")}>${c.t("action", "save", "Save")}</button>
        <button
          @click=${async () => {
            const ok = await c.confirm({ title: `${c.t("action", "discard", "Discard")}?`, text: c.t("title", "new_map", "New Map"), confirmText: c.t("action", "discard", "Discard"), destructive: true });
            if (ok) c.vac("vacuum_discard_temporary_map");
          }}
        >
          ${c.t("action", "discard", "Discard")}
        </button>
        ${maps.length ? html`<button @click=${() => (this._sheet = { kind: "replace" })}>${c.t("action", "replace", "Replace")}</button>` : nothing}
      </div>
    </div>`;
  }

  _renderSheet(maps) {
    const c = this.ctx;
    const s = this._sheet;
    if (!s) return nothing;
    const close = () => (this._sheet = null);
    if (s.kind === "create") {
      const opts = [
        ["start_fast_mapping", "mdi:map-plus", c.t("action", "fast_mapping", "Fast Mapping")],
        ["start_mapping", "mdi:broom", null],
      ].filter(([k]) => c.ent("button", k));
      return html`<doc-sheet open heading=${c.t("message", "create_map", "Create a new map?")} @closed=${close}>
        <div class="sheet-list">
          <div class="muted">${c.t("message", "select_mapping_type", "Select mapping type")}</div>
          ${opts.map(
            ([k, icon, label]) => html`<button
              ?disabled=${!c.available(c.ent("button", k))}
              @click=${async () => {
                close();
                if (await c.press(k)) c.toast(c.t("message", "mapping_started", "Mapping started..."));
              }}
            >
              <ha-icon icon=${icon}></ha-icon>${label || c.name(c.ent("button", k))}
            </button>`
          )}
        </div>
      </doc-sheet>`;
    }
    // replace temporary map: pick which saved map it overwrites
    return html`<doc-sheet open heading=${c.t("message", "replace_map", "Replace new map?")} @closed=${close}>
      <div class="sheet-list">
        ${maps.map(
          (m) => html`<button
            @click=${async () => {
              close();
              const ok = await c.confirm({
                title: `${c.t("action", "replace", "Replace")} ${mapName(c, m)}?`,
                text: c.t("message", "map_will_replaced", "Currently selected map will be replaced with the new map!"),
                confirmText: c.t("action", "replace", "Replace"),
                destructive: true,
              });
              if (ok) c.vac("vacuum_replace_temporary_map", { map_id: Number(m.id) });
            }}
          >
            ${mapName(c, m)}
          </button>`
        )}
      </div>
    </doc-sheet>`;
  }

  async _rename(m) {
    const c = this.ctx;
    const name = await c.prompt({ title: c.t("action", "rename", "Rename"), value: m.custom_name || mapName(c, m), maxlength: 40 });
    if (name) c.vac("vacuum_rename_map", { map_id: Number(m.id), map_name: name });
  }

  async _select(m) {
    const c = this.ctx;
    const name = mapName(c, m);
    const hidden = c.config.hidden_card_objects || [];
    if (!hidden.includes("map_change_confirmation")) {
      const ok = await c.confirm({
        title: c.t("message", "select_map", "Select %name%?").replace("%name%", name),
        text: c.t("message", "selected_map_will_changed", "Selected map will be changed to %name%!").replace("%name%", name),
        confirmText: c.t("action", "select_map", "Select map"),
      });
      if (!ok) return;
    }
    c.vac("vacuum_select_map", { map_id: Number(m.id) });
  }

  async _delete(m) {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("message", "delete_map", "Delete Map?"),
      text: c.t("message", "map_will_deleted", "%name% will be deleted!").replace("%name%", mapName(c, m)),
      confirmText: c.t("action", "delete", "Delete"),
      destructive: true,
    });
    if (ok) c.vac("vacuum_delete_map", { map_id: Number(m.id) });
  }
}

customElements.get("doc-maps") || customElements.define("doc-maps", Maps);
