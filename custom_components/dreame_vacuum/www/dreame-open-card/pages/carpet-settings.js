/*
 * Per-carpet settings (doc-carpet-settings). params { carpet }.
 *
 * params.carpet: an entry from the map camera `carpets` (manual) or `detected_carpets`
 * list, plus how it was found. Fields read: id, object_type (0 = detected, 1 = manually
 * created, 2 = room carpet) or kind ("detected" | "created" | "room") or detected: true,
 * carpet_type | type (5..8), carpet_cleaning (-1/0 = not customized, 1..7),
 * carpet_preferences (list of names or the v3 bitmask), ellipse, x0..y3.
 * The page re-reads the same carpet from the live camera attrs by id when it can.
 *
 * Services (vacuum.py schemas, dreame/device.py semantics):
 *   vacuum_set_custom_carpet_cleaning { id, object_type, carpet_cleaning, carpet_preferences? }
 *     carpet_cleaning 0 -> -1 (follow global). Omitting carpet_preferences resets them to
 *     global (-1); a list of names (clean_carpets_first, carpet_boost,
 *     intensive_carpet_cleaning, side_brush_carpet_rotate, lift_chassis_on_carpet) sets them.
 *   vacuum_set_carpet_type { id, object_type, carpet_type }  5 = medium/high pile,
 *     6 = low pile, 7 = other (default), 8 = floor mat (DreameVacuumFloorMaterial codes).
 *   vacuum_set_carpet_area { carpets: [[x0,y0,x2,y2,id,ellipse]...], deleted_carpets: [[x0,y0,x2,y2]...] }
 *     replaces the whole list, so shape and delete resend every carpet.
 */
import { LitElement, html, css, nothing, base, carpetsFromMapData } from "../core.js";
import { navRowStyles, navRow } from "./cleaning-settings.js";

const CLEANING = { avoidance: 1, adaptation: 2, remove_mop: 3, adaptation_without_route: 4, vacuum_and_mop: 5, ignore: 6, cross: 7 };
const TYPES = { medium_pile: 5, low_pile: 6, other: 7, floor_mat: 8 };
const PREFS = ["clean_carpets_first", "carpet_boost", "intensive_carpet_cleaning", "side_brush_carpet_rotate", "lift_chassis_on_carpet"];
const PREF_BITS = { clean_carpets_first: 1, carpet_boost: 2, intensive_carpet_cleaning: 4, side_brush_carpet_rotate: 8, lift_chassis_on_carpet: 16 };
// Default per-carpet cleaning the integration applies when a type is set (map.py set_carpet_type).
const TYPE_DEFAULT = { 5: 1, 6: 3, 7: 2, 8: 7 };

export function objectType(c) {
  if (c?.object_type != null) return Number(c.object_type);
  if (c?.kind) return { detected: 0, created: 1, room: 2 }[c.kind] ?? 1;
  return c?.detected ? 0 : 1;
}

/** Normalized preferences: null = follow global, else Set of names. */
export function parsePrefs(p) {
  if (p == null || p === -1) return null;
  if (Array.isArray(p)) return new Set(p.map(String));
  const n = Number(p);
  if (!Number.isFinite(n) || n < 0) return null;
  return new Set(PREFS.filter((k) => n & PREF_BITS[k]));
}

const corners = (x) => {
  const xs = [x.x0, x.x1, x.x2, x.x3].filter((v) => v != null);
  const ys = [x.y0, x.y1, x.y2, x.y3].filter((v) => v != null);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round);
};

class CarpetSettings extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false }, _md: { state: true } };
  static styles = [
    base,
    navRowStyles,
    css`
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
      }
      .item .label {
        flex: 1;
      }
      .item ha-icon {
        color: var(--state-icon-color, var(--doc-muted));
      }
      .seg {
        display: flex;
        gap: 4px;
      }
      .dim {
        opacity: 0.5;
      }
    `,
  ];

  // Carpet lists with ids: the camera attributes drop id/ellipse/settings
  // (Carpet has no as_dict), so prefer the camera's full map JSON.
  get _lists() {
    return carpetsFromMapData(this._md) || this.ctx.mapAttrs;
  }

  willUpdate(changed) {
    if (changed.has("ctx") && this.ctx) this.ctx.mapData().then((md) => md && md !== this._md && (this._md = md));
  }

  get _carpet() {
    const p = this.params?.carpet || {};
    const ot = objectType(p);
    const m = this._lists;
    const list = ot === 0 ? m.detected_carpets : ot === 1 ? m.carpets : null;
    const live = p.id != null && Array.isArray(list) ? list.find((x) => x.id === p.id) : null;
    const c = { ...p, ...(live || {}) };
    c.object_type = ot;
    c.carpet_type = Number(c.carpet_type ?? c.type ?? 7) || 7;
    c.carpet_cleaning = Number(c.carpet_cleaning ?? -1);
    return c;
  }

  _locStr(domain, key, fallback) {
    return this.ctx.hass.localize?.(`component.dreame_vacuum.entity.${domain}.${key}`) || fallback;
  }

  _cleaningOptions() {
    const g = this.ctx.st("select", "carpet_cleaning");
    const names = g?.attributes?.options?.filter((o) => o in CLEANING) || ["avoidance", "adaptation", "remove_mop"];
    return names;
  }

  async _ensureRecognition() {
    const c = this.ctx;
    const rec = c.st("switch", "carpet_recognition");
    if (!rec || rec.state === "on") return true;
    const ok = await c.confirm({
      title: c.t("message", "enable_carpet_recognition", "Carpet recognition will be enabled!"),
      text: c.t("message", "carpet_recognition_will_enabled", "Carpet recognition must be enabled to be able to set customized carpet cleaning"),
    });
    if (ok) await c.call("switch", "turn_on", {}, { entity_id: rec.entity_id });
    return ok;
  }

  async _setCleaning(carpet, cleaning, prefs) {
    if (cleaning > 0 && !(await this._ensureRecognition())) return;
    const data = { id: carpet.id, object_type: carpet.object_type, carpet_cleaning: cleaning };
    if (cleaning > 0 && prefs) data.carpet_preferences = [...prefs];
    await this.ctx.vac("vacuum_set_custom_carpet_cleaning", data);
  }

  async _setType(carpet, type) {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("message", "custom_carpet_settings_will_enabled", "Customized carpet cleaning will be enabled!"),
      text: c.t("message", "custom_carpet_settings_will_enabled_detail", "Custom carpet cleaning settings will be set suitable to the selected carpet type"),
    });
    if (ok) await c.vac("vacuum_set_carpet_type", { id: carpet.id, object_type: carpet.object_type, carpet_type: type });
    else this.requestUpdate();
  }

  /** Every carpet, for set_carpet_area. Null when the attrs lack ids (cannot round-trip safely). */
  _areaLists() {
    const m = this._lists;
    const carpets = Array.isArray(m.carpets) ? m.carpets : [];
    if (carpets.some((x) => x.id == null)) return null;
    return {
      carpets: carpets.map((x) => [...corners(x), x.id, x.ellipse ? 1 : 0]),
      deleted_carpets: (Array.isArray(m.deleted_carpets) ? m.deleted_carpets : []).map(corners),
    };
  }

  async _setShape(carpet, ellipse) {
    const lists = this._areaLists();
    if (!lists) return;
    lists.carpets = lists.carpets.map((x) => (x[4] === carpet.id ? [...x.slice(0, 5), ellipse ? 1 : 0] : x));
    await this.ctx.vac("vacuum_set_carpet_area", lists);
  }

  async _delete(carpet) {
    const c = this.ctx;
    const lists = this._areaLists();
    if (!lists) return;
    const ok = await c.confirm({
      title: c.t("message", "delete_carpet", "Delete Carpet?"),
      text: c.t("message", "carpet_will_deleted", "Carpet will be deleted!"),
      confirmText: c.t("action", "delete", "Delete"),
      destructive: true,
    });
    if (!ok) return;
    if (carpet.object_type === 1) lists.carpets = lists.carpets.filter((x) => x[4] !== carpet.id);
    else lists.deleted_carpets = [...lists.deleted_carpets, corners(carpet)];
    if (await c.vac("vacuum_set_carpet_area", lists)) c.back();
  }

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const carpet = this._carpet;
    if (carpet.id == null)
      return html`<doc-page .ctx=${c} heading=${c.t("title", "carpet_settings", "Carpet Settings")}>
        <p class="note">${c.t("message", "not_available", "Not available right now...")}</p>
      </doc-page>`;

    const heading = carpet.object_type === 0 ? c.t("title", "detected_carpet", "Automatically Detected Carpet") : carpet.object_type === 1 ? c.t("title", "created_carpet", "Manually Created Carpet") : c.t("title", "carpet_settings", "Carpet Settings");
    const custom = carpet.carpet_cleaning > 0;
    const prefsSupported = "carpet_preferences" in carpet;
    const prefs = parsePrefs(carpet.carpet_preferences);
    const prefsAllowed = custom && carpet.carpet_cleaning !== 6 && carpet.carpet_cleaning !== 7;
    const prefKeys = PREFS.filter((k) => c.ent("switch", k));
    const typeSupported = c.can("carpet_type");
    const shapeSupported = carpet.object_type === 1 && c.can("carpet_shape");
    const canEditArea = carpet.object_type !== 2 && !!this._areaLists() && !c.attrs.started;
    const global = c.st("select", "carpet_cleaning");
    const curName = Object.keys(CLEANING).find((k) => CLEANING[k] === carpet.carpet_cleaning);

    return html`<doc-page .ctx=${c} heading=${heading}>
      ${carpet.object_type !== 2
        ? html`<button slot="actions" class="icon" title=${c.t("action", "edit_carpet", "Edit carpet")}
              @click=${() => c.navigate("object-edit", { mode: "carpet", carpet })}>
              <ha-icon icon="mdi:pencil-outline"></ha-icon>
            </button>
            <button slot="actions" class="icon" title=${c.t("action", "delete_carpet", "Delete carpet")} ?disabled=${!canEditArea}
              @click=${() => this._delete(carpet)}>
              <ha-icon icon="mdi:delete-outline"></ha-icon>
            </button>`
        : nothing}

      <doc-section>
        <div class="item">
          <ha-icon icon="mdi:rug"></ha-icon>
          <span class="label">${this._locStr("switch", "customized_carpet_cleaning.name", "Customized Cleaning")}</span>
          <doc-toggle .checked=${custom}
            @change=${(e) => this._setCleaning(carpet, e.detail.checked ? TYPE_DEFAULT[carpet.carpet_type] || 2 : 0, prefs)}></doc-toggle>
        </div>
        ${custom
          ? html`<div class="item">
              <ha-icon icon="mdi:tune-variant"></ha-icon>
              <span class="label">${this._locStr("select", "carpet_cleaning.name", "Carpet Cleaning")}</span>
              <select @change=${(e) => this._setCleaning(carpet, Number(e.target.value), prefs)}>
                ${curName && !this._cleaningOptions().includes(curName) ? html`<option selected value=${carpet.carpet_cleaning}>${this._locStr("select", `carpet_cleaning.state.${curName}`, curName)}</option>` : nothing}
                ${this._cleaningOptions().map(
                  (o) => html`<option value=${CLEANING[o]} ?selected=${CLEANING[o] === carpet.carpet_cleaning}>
                    ${this._locStr("select", `carpet_cleaning.state.${o}`, o)}
                  </option>`
                )}
              </select>
            </div>`
          : nothing}
      </doc-section>

      ${prefsSupported && prefKeys.length
        ? html`<doc-section>
            <div class="item ${prefsAllowed ? "" : "dim"}">
              <ha-icon icon="mdi:playlist-check"></ha-icon>
              <span class="label">${this._locStr("switch", "carpet_preferences.name", "Customized Preferences")}</span>
              <doc-toggle .checked=${!!prefs} ?disabled=${!prefsAllowed}
                @change=${(e) =>
                  this._setCleaning(
                    carpet,
                    carpet.carpet_cleaning,
                    e.detail.checked ? new Set(prefKeys.filter((k) => c.st("switch", k)?.state === "on")) : null
                  )}></doc-toggle>
            </div>
            ${prefs && prefsAllowed
              ? prefKeys.map(
                  (k) => html`<div class="item">
                    <ha-icon icon="mdi:circle-small"></ha-icon>
                    <span class="label">${this._locStr("switch", `${k}.name`, k)}</span>
                    <doc-toggle .checked=${prefs.has(k)}
                      @change=${(e) => {
                        const next = new Set(prefs);
                        e.detail.checked ? next.add(k) : next.delete(k);
                        this._setCleaning(carpet, carpet.carpet_cleaning, next);
                      }}></doc-toggle>
                  </div>`
                )
              : nothing}
          </doc-section>`
        : nothing}

      ${typeSupported || shapeSupported
        ? html`<doc-section>
            ${typeSupported
              ? html`<div class="item">
                  <ha-icon icon="mdi:texture-box"></ha-icon>
                  <span class="label">${this._locStr("select", "carpet_type.name", "Carpet Type")}</span>
                  <select ?disabled=${!!c.attrs.started} @change=${(e) => this._setType(carpet, Number(e.target.value))}>
                    ${Object.entries(TYPES)
                      .filter(([k]) => k !== "floor_mat" || c.can("floor_mats") || carpet.carpet_type === 8)
                      .map(([k, v]) => html`<option value=${v} ?selected=${v === carpet.carpet_type}>${this._locStr("select", `carpet_type.state.${k}`, k)}</option>`)}
                  </select>
                </div>`
              : nothing}
            ${shapeSupported
              ? html`<div class="item">
                  <ha-icon icon=${carpet.ellipse ? "mdi:ellipse-outline" : "mdi:square-outline"}></ha-icon>
                  <span class="label">Shape</span>
                  <div class="seg">
                    <button class=${!carpet.ellipse ? "active" : ""} ?disabled=${!canEditArea} @click=${() => carpet.ellipse && this._setShape(carpet, false)}>
                      ${c.t("action", "square_carpet", "Square carpet")}
                    </button>
                    <button class=${carpet.ellipse ? "active" : ""} ?disabled=${!canEditArea} @click=${() => !carpet.ellipse && this._setShape(carpet, true)}>
                      ${c.t("action", "round_carpet", "Round carpet")}
                    </button>
                  </div>
                </div>`
              : nothing}
          </doc-section>`
        : nothing}

      <doc-section>
        ${navRow(
          "mdi:cog-outline",
          c.t("title", "global_carpet_settings", "Global Carpet Settings"),
          global ? `${c.name(global.entity_id)}: ${c.stateLabel(global)}` : "",
          () => c.navigate("device-settings", { section: "carpet" })
        )}
      </doc-section>
    </doc-page>`;
  }
}

customElements.get("doc-carpet-settings") || customElements.define("doc-carpet-settings", CarpetSettings);
