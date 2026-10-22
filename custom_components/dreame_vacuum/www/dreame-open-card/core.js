/*
 * Shared runtime for Dreame Open Card pages.
 *
 * Every page receives a `ctx` (Ctx instance). A new Ctx is created on every
 * hass update, so passing `.ctx=${ctx}` to a Lit element re-renders it.
 *
 * Integration API surface (all MIT, all public):
 *   ctx.vac(service, data)        -> dreame_vacuum.<service> on the vacuum
 *   ctx.action(key, value)        -> dreame_vacuum.vacuum_call_action (DreameVacuumDevice.<key>(value))
 *   ctx.setProp(key, value)       -> dreame_vacuum.vacuum_set_property
 *   ctx.call(domain, svc, data, target)
 * All return Promise<boolean> and toast the error message on failure.
 */

export { LitElement, html, css, svg, nothing } from "./vendor/lit.js";
export { classMap, styleMap, repeat, live, ifDefined } from "./vendor/lit.js";

export const DOMAIN = "dreame_vacuum";

const ROOM_RE = /_room_(\d+)_/;

// Index of the vacuum device's entities by translation key / entity_id suffix.
class EntityIndex {
  constructor(hass, deviceId) {
    this.byKey = new Map(); // "domain.key" -> entity_id
    this.rooms = new Map(); // "domain.key" -> Map(segmentId -> entity_id)
    if (!deviceId) return;
    for (const e of Object.values(hass.entities || {})) {
      if (e.device_id !== deviceId) continue;
      const id = e.entity_id;
      const domain = id.split(".")[0];
      const room = id.match(ROOM_RE);
      if (room) {
        // e.g. select.vac_room_3_suction_level -> key suction_level
        const key = id.slice(id.indexOf(room[0]) + room[0].length);
        const k = `${domain}.${key}`;
        if (!this.rooms.has(k)) this.rooms.set(k, new Map());
        this.rooms.get(k).set(Number(room[1]), id);
        continue;
      }
      if (e.translation_key) this.byKey.set(`${domain}.${e.translation_key}`, id);
    }
    // Fallback for entities without a translation key: match entity_id suffix.
    for (const e of Object.values(hass.entities || {})) {
      if (e.device_id !== deviceId || e.translation_key || ROOM_RE.test(e.entity_id)) continue;
      const [domain, obj] = e.entity_id.split(".");
      const parts = obj.split("_");
      for (let i = 1; i < parts.length; i++) {
        const k = `${domain}.${parts.slice(i).join("_")}`;
        if (!this.byKey.has(k)) this.byKey.set(k, e.entity_id);
      }
    }
  }
}

let indexCache = { sig: null, index: null };
const mapDataCache = new Map();

export class Ctx {
  constructor(card) {
    this.card = card;
    this.hass = card._hass;
    this.config = card._config;
    this.vacuumId = this.config.entity;
    this.deviceId = this.hass.entities?.[this.vacuumId]?.device_id;
    const sig = `${this.deviceId}|${Object.keys(this.hass.entities || {}).length}`;
    if (indexCache.sig !== sig) indexCache = { sig, index: new EntityIndex(this.hass, this.deviceId) };
    this.index = indexCache.index;
    this.mapId = this.config.map_entity || this.ent("camera", "map") || this._guessMap();
  }

  _guessMap() {
    return Object.values(this.hass.entities || {}).find(
      (e) => e.device_id === this.deviceId && e.entity_id.startsWith("camera.") && !e.entity_category
    )?.entity_id;
  }

  // ---- state ----------------------------------------------------------
  get vacuum() {
    return this.hass.states[this.vacuumId];
  }
  get attrs() {
    return this.vacuum?.attributes || {};
  }
  get map() {
    return this.hass.states[this.mapId];
  }
  get mapAttrs() {
    return this.map?.attributes || {};
  }
  // Capability flags published by the vacuum (`capabilities` attribute), if present.
  can(flag) {
    const caps = this.attrs.capabilities;
    return Array.isArray(caps) ? caps.includes(flag) : !!caps?.[flag];
  }

  /** entity_id for a device entity, e.g. ent("switch", "carpet_boost"); undefined if the model lacks it. */
  ent(domain, key) {
    const id = this.index.byKey.get(`${domain}.${key}`);
    return id && this.hass.states[id] ? id : undefined;
  }
  /** State object for ent(domain, key). */
  st(domain, key) {
    const id = this.ent(domain, key);
    return id ? this.hass.states[id] : undefined;
  }
  /** Per-room entity, e.g. roomEnt("select", "suction_level", 3). */
  roomEnt(domain, key, segmentId) {
    const id = this.index.rooms.get(`${domain}.${key}`)?.get(Number(segmentId));
    return id && this.hass.states[id] ? id : undefined;
  }
  available(id) {
    const s = id && this.hass.states[id];
    return !!s && s.state !== "unavailable";
  }

  /** Rooms of the current map from the camera attributes, hidden ones excluded unless asked. */
  rooms({ includeHidden = false } = {}) {
    const rooms = this.mapAttrs.rooms || {};
    return Object.entries(rooms)
      .map(([id, r]) => ({ ...r, id: Number(r.room_id ?? id) }))
      .filter((r) => includeHidden || r.visibility !== "Hidden");
  }
  roomName(r) {
    return r?.custom_name || r?.name || `Room ${r?.id}`;
  }

  // ---- services -------------------------------------------------------
  async call(domain, service, data = {}, target) {
    try {
      await this.hass.callService(domain, service, data, target);
      return true;
    } catch (err) {
      this.toast(err?.message || String(err));
      return false;
    }
  }
  vac(service, data = {}) {
    return this.call(DOMAIN, service, data, { entity_id: this.vacuumId });
  }
  vacuumCmd(service, data = {}) {
    return this.call("vacuum", service, data, { entity_id: this.vacuumId });
  }
  action(key, value) {
    const data = { key };
    if (value !== undefined && value !== null) data.value = String(value);
    return this.vac("vacuum_call_action", data);
  }
  setProp(key, value) {
    return this.vac("vacuum_set_property", { key, value });
  }
  /**
   * Full map JSON from the camera's own data endpoint (camera.py CameraDataView ->
   * DreameVacuumMapRenderer.get_data). Richer than the state attributes: carpets
   * with ids/ellipse/settings, walls, doors, furniture ids, segment neighbors, etc.
   * Tuple layouts are documented at dreame/map.py get_data (~8198-8865).
   * Cached per map update; resolves null on failure.
   */
  mapData(cameraId = this.mapId) {
    const pic = this.hass.states[cameraId]?.attributes?.entity_picture || "";
    const token = new URLSearchParams(pic.split("?")[1] || "").get("token");
    if (!token) return Promise.resolve(null);
    const key = `${cameraId}|${pic}`;
    const hit = mapDataCache.get(cameraId);
    if (hit?.key === key) return hit.promise;
    const url = this.hass.hassUrl(`/api/camera_map_data_proxy/${cameraId}?token=${token}`);
    const fetcher = this.hass.fetchWithAuth ? this.hass.fetchWithAuth(url) : fetch(url);
    const promise = fetcher.then((r) => (r.ok ? r.json() : null)).catch(() => null);
    mapDataCache.set(cameraId, { key, promise });
    return promise;
  }

  /**
   * Raw device property ("schedule" | "dnd_task") from the open card backend
   * (open_card.py). Resolves null when unavailable; callers fall back to the
   * parsed vacuum attributes.
   */
  async rawProperty(key) {
    try {
      const res = await this.hass.callWS({ type: `${DOMAIN}_open/raw_property`, entity_id: this.vacuumId, key });
      return res?.value ?? null;
    } catch {
      return null;
    }
  }
  press(key) {
    const id = this.ent("button", key);
    return id ? this.call("button", "press", {}, { entity_id: id }) : Promise.resolve(false);
  }

  // ---- shell ----------------------------------------------------------
  toast(message) {
    this.card.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }
  navigate(page, params = {}) {
    this.card.navigate(page, params);
  }
  back() {
    this.card.back();
  }
  /** Promise<boolean>. opts: { title, text, confirmText, destructive } */
  confirm(opts) {
    return this.card.confirm(opts);
  }
  /** Promise<string|null>. opts: { title, label, value, placeholder, maxlength } */
  prompt(opts) {
    return this.card.prompt(opts);
  }

  // ---- text -----------------------------------------------------------
  /**
   * UI string from the integration's own translations (strings.json ->
   * entity_component.frontend_<group>.state.<key>), 40 languages.
   * group: "title" | "action" | "message" | "config"
   */
  t(group, key, fallback) {
    const v = this.hass.localize?.(`component.${DOMAIN}.entity_component.frontend_${group}.state.${key}`);
    return v || fallback || prettify(key);
  }
  /** Localized state of an entity option, e.g. stateLabel(stateObj, "quiet"). */
  stateLabel(stateObj, value = stateObj?.state) {
    if (!stateObj) return prettify(value);
    return this.hass.formatEntityState?.(stateObj, value) || prettify(value);
  }
  /** Entity name without the device prefix. */
  name(id) {
    const s = this.hass.states[id];
    if (!s) return id;
    const full = s.attributes.friendly_name || id;
    const dev = this.hass.devices?.[this.deviceId];
    const prefix = dev?.name_by_user || dev?.name;
    return prefix && full.startsWith(prefix + " ") ? full.slice(prefix.length + 1) : full;
  }
  get imperial() {
    return this.hass.config?.unit_system?.length === "mi";
  }
  /** m² -> "42 m²" or "452 ft²" */
  area(m2) {
    if (m2 == null || m2 === "") return "-";
    const n = Number(m2);
    return this.imperial ? `${Math.round(n * 10.7639)} ft²` : `${Math.round(n)} m²`;
  }
  /** minutes -> "51 min" / "1 h 5 min" (localized number) */
  duration(min) {
    if (min == null || min === "") return "-";
    const n = Math.round(Number(min));
    const fmt = (x) => x.toLocaleString(this.hass.locale?.language);
    if (n < 60) return `${fmt(n)} min`;
    return `${fmt(Math.floor(n / 60))} h ${n % 60 ? `${fmt(n % 60)} min` : ""}`.trim();
  }
  url(path) {
    return path ? this.hass.hassUrl(path) : "";
  }
}

/**
 * Carpet lists from ctx.mapData() tuples (dreame/map.py get_data ~8715-8780) as
 * dicts shaped like the camera attributes plus the fields those attributes drop.
 */
export function carpetsFromMapData(md) {
  if (!md) return null;
  const toDict = ([x0, y0, x1, y1, x2, y2, x3, y3, id, ellipse, carpet_cleaning, carpet_preferences, carpet_type, hidden, tassel] = []) => ({
    x0, y0, x1, y1, x2, y2, x3, y3, id, ellipse: !!ellipse, carpet_cleaning, carpet_preferences, carpet_type, hidden: !!hidden, tassel,
  });
  return {
    carpets: (md.carpets || []).map(toDict),
    detected_carpets: (md.detected_carpets || []).map(toDict),
    deleted_carpets: (md.deleted_carpets || []).map(toDict),
  };
}

export const prettify = (s) =>
  String(s ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Weekday bitmask helpers. Bit 0 = Sunday ... bit 6 = Saturday (Dreame convention). */
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Shared design tokens; every page's static styles should include `base`.
import { css } from "./vendor/lit.js";
export const base = css`
  :host {
    --doc-radius: 12px;
    --doc-gap: 8px;
    --doc-accent: var(--primary-color, #03a9f4);
    --doc-warn: var(--warning-color, #ffa600);
    --doc-error: var(--error-color, #db4437);
    --doc-muted: var(--secondary-text-color);
    --doc-divider: var(--divider-color, rgba(0, 0, 0, 0.12));
    --doc-surface: var(--card-background-color, #fff);
    --doc-surface-2: var(--secondary-background-color, #f4f4f4);
    color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, inherit);
  }
  button {
    font: inherit;
    border: 1px solid var(--doc-divider);
    background: none;
    color: var(--primary-text-color);
    border-radius: 18px;
    padding: 6px 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 36px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.primary {
    background: var(--doc-accent);
    border-color: var(--doc-accent);
    color: var(--text-primary-color, #fff);
  }
  button.danger {
    background: var(--doc-error);
    border-color: var(--doc-error);
    color: #fff;
  }
  button.icon {
    border: none;
    padding: 6px;
    border-radius: 50%;
    min-width: 36px;
  }
  button.active {
    background: var(--doc-accent);
    border-color: var(--doc-accent);
    color: var(--text-primary-color, #fff);
  }
  ha-icon {
    --mdc-icon-size: 20px;
  }
  select,
  input[type="text"],
  input[type="time"],
  input[type="number"] {
    font: inherit;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--doc-divider);
    background: var(--doc-surface);
    color: var(--primary-text-color);
  }
  .muted {
    color: var(--doc-muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--doc-gap);
  }
  .spacer {
    flex: 1;
  }
`;
