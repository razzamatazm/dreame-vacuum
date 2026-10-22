/*
 * <doc-saved-map-edit> — saved map editor (DVC "Saved Map Editing").
 *
 * params: { mapIndex }   index from vacuum attribute `maps[].index`
 *
 * Edit types: room name, visibility, floor material (local draft + bulk Save),
 * merge and split (applied immediately after confirmation), walls/doors (see note).
 *
 * Payload formats (derived from the integration source):
 *   vacuum_set_segment_type   { type: { "<segment>": [type, index, custom_name|null] } }
 *                             type 0 + custom_name = custom name             map.py set_segment_type
 *   vacuum_set_hidden_segments { segments: [segment, ...] } (all hidden ones) map.py set_hidden_segments
 *   vacuum_set_floor_material { material: { "<segment>": [material, direction] } }
 *                             every segment must be listed with 2 elements, a missing one is reset
 *                             to "none"; direction 0 | 90, used only for wood   device.py set_floor_material
 *   vacuum_merge_segments     { segments: [a, b] } (only the first two are used)
 *   vacuum_split_segments     { segment, line: [x0, y0, x1, y1] }
 */

import { LitElement, html, svg, css, nothing, base, prettify } from "../core.js";
import { polyPoints } from "../map-view.js";
import {
  MIN_SHAPE_MM,
  SAVE_SETTLE_MS,
  roomBox,
  roomAt,
  maybeNeighbors,
  lineCrossesBox,
  handle,
  editStyles,
  overlayStyle,
} from "./edit-shared.js";

const STORE_KEY = "dreame-open-card:saved-map-edit-mode";

// SEGMENT_TYPE_CODE_TO_NAME (dreame/types.py:12); keys match the segment_name select translations.
const SEGMENT_TYPES = {
  1: "living_room", 2: "primary_bedroom", 3: "study", 4: "kitchen", 5: "dining_hall", 6: "bathroom", 7: "balcony",
  8: "corridor", 9: "utility_room", 10: "closet", 11: "meeting_room", 12: "office", 13: "fitness_area",
  14: "recreation_area", 15: "secondary_bedroom",
};
// DreameVacuumFloorMaterial (types.py:823); Segment.as_dict publishes enum name .title()
const MATERIALS = { none: 0, wood: 1, tile: 2, medium_pile_carpet: 5, low_pile_carpet: 6, carpet: 7 };
const MATERIAL_ICONS = { 0: "mdi:close", 1: "mdi:view-parallel", 2: "mdi:checkerboard", 5: "mdi:rug", 6: "mdi:rug", 7: "mdi:rug" };

const MODES = {
  name: { t: ["title", "room_name", "Room name"], icon: "mdi:rename-outline", draft: true },
  visibility: { t: ["title", "room_visibility", "Visibility"], icon: "mdi:eye-off-outline", draft: true, cap: "segment_visibility" },
  material: { t: ["title", "floor_material", "Floor material"], icon: "mdi:texture-box", draft: true, cap: "floor_material" },
  merge: { t: ["title", "merge_rooms", "Merge"], icon: "mdi:vector-union" },
  split: { t: ["title", "split_rooms", "Split"], icon: "mdi:vector-line" },
  walls: { t: ["title", "wall", "Walls"], icon: "mdi:wall", cap: "walls", draft: true },
};

class SavedMapEdit extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    _mode: { state: true },
    _md: { state: true },
    _wallTool: { state: true },
    _wsel: { state: true },
    _draft: { state: true },
    _dirty: { state: true },
    _busy: { state: true },
    _sheet: { state: true },
    _merge: { state: true },
    _split: { state: true },
  };
  static styles = [
    base,
    editStyles,
    css`
      .options button ha-icon {
        margin-right: 8px;
      }
      .sheet-row button {
        flex: 1;
      }
    `,
  ];

  constructor() {
    super();
    this._mode = null;
    this._draft = null;
    this._draftSig = null;
    this._dirty = false;
    this._busy = false;
    this._saved = null;
    this._sheet = null; // { kind: "name" | "material", room }
    this._merge = [];
    this._split = null; // { room, line }
    this._drag = null;
  }

  // ---- data -------------------------------------------------------------
  get _mapIndex() {
    return this.params?.mapIndex ?? this.ctx.attrs.selected_map_index;
  }
  get _active() {
    const sel = this.ctx.attrs.selected_map_index;
    return this._mapIndex == null || sel == null || Number(this._mapIndex) === Number(sel);
  }
  get _mapInfo() {
    return (this.ctx.attrs.maps || []).find((m) => Number(m.index) === Number(this._mapIndex));
  }
  // The saved-map camera for this index (translation key "saved_map"), else the live map.
  get _cam() {
    const c = this.ctx;
    const cams = Object.values(c.hass.entities || {}).filter(
      (e) => e.device_id === c.deviceId && e.entity_id.startsWith("camera.") && e.translation_key === "saved_map"
    );
    const hit = cams.map((e) => c.hass.states[e.entity_id]).find((s) => s && Number(s.attributes.map_index) === Number(this._mapIndex));
    return hit || c.map;
  }
  get _attrs() {
    return this._cam?.attributes || {};
  }
  get _rooms() {
    return Object.entries(this._attrs.rooms || {}).map(([id, r]) => ({ ...r, id: Number(r.room_id ?? id) }));
  }
  get _dockRoom() {
    const ch = this._attrs.charger_position;
    return ch ? roomAt(this._rooms, ch.x, ch.y)?.id : undefined;
  }
  get _modes() {
    return Object.keys(MODES).filter((m) => !MODES[m].cap || this.ctx.can(MODES[m].cap));
  }

  _sig() {
    return JSON.stringify([
      this._md ? 1 : 0,
      this._md?.segments,
      this._md?.walls,
      this._md?.doors,
      this._attrs.rotation,
      this._rooms.map((r) => [r.id, r.type, r.index, r.custom_name, r.visibility, r.floor_material, r.floor_material_direction]),
    ]);
  }

  _material(r) {
    const m = MATERIALS[String(r.floor_material || "none").toLowerCase()];
    const d = String(r.floor_material_direction || "").toLowerCase();
    // The attribute is floor_material_rotated_direction (as shown on the rotated map); the draft keeps the raw value.
    return [m ?? -1, d ? this._rot(d === "vertical" ? 90 : 0) : null];
  }
  // Raw <-> on-screen wood direction: swapped when the map is rotated by 90 or 270 (map.py set_floor_material).
  _rot(dir) {
    if (dir == null) return dir;
    const r = Number(this._attrs.rotation) || 0;
    return r === 90 || r === 270 ? (dir === 90 ? 0 : 90) : dir;
  }

  // mapData segments row: [id, x, y, type, custom_name (base64), index, color_index, neighbors,
  // floor_material, floor_material_direction (raw), visibility, ...]   map.py get_data
  get _mdSegments() {
    const rows = this._md?.segments;
    if (!Array.isArray(rows)) return null;
    const out = {};
    for (const row of rows) out[Number(row[0])] = row;
    return out;
  }

  _load() {
    const names = {};
    const material = {};
    const hidden = new Set();
    const seg = this._mdSegments;
    if (seg) {
      for (const [id, row] of Object.entries(seg)) {
        const n = Number(id);
        const attr = this._rooms.find((r) => r.id === n);
        let custom = null;
        try {
          custom = row[4] ? decodeURIComponent(escape(atob(row[4]))) : null;
        } catch (_) {}
        names[n] = { type: row[3] ?? 0, index: row[5] ?? 0, custom, name: attr?.name };
        material[n] = [row[8] ?? 0, row[9] ?? null];
        if (row[10] === false || row[10] === 0) hidden.add(n);
      }
      return { names, material, hidden, ...this._loadWalls() };
    }
    for (const r of this._rooms) {
      names[r.id] = { type: r.type ?? 0, index: r.index ?? 0, custom: r.custom_name ?? null, name: r.name };
      material[r.id] = this._material(r);
      if (r.visibility === "Hidden") hidden.add(r.id);
    }
    return { names, material, hidden, ...this._loadWalls() };
  }

  // walls: { "<segment>": [[x0,y0,x1,y1, ix0,iy0,ix1,iy1, type, x, y], ...] }
  // doors: [[x0,y0,x1,y1, ix0,iy0,ix1,iy1, type, id, status], ...]   map.py get_data / set_walls
  _loadWalls() {
    const md = this._md;
    if (!md?.walls) return { walls: null, doors: null };
    const walls = {};
    for (const [k, list] of Object.entries(md.walls)) walls[k] = list.map((w) => [...w]);
    return { walls, doors: (md.doors || []).map((d) => [...d]) };
  }

  _sync(force = false) {
    const sig = this._sig();
    if (!force && (this._dirty || sig === this._draftSig)) return;
    if (!force && this._saved && this._saved.sig === sig && Date.now() - this._saved.at < SAVE_SETTLE_MS) return;
    this._saved = null;
    this._draft = this._load();
    this._draftSig = sig;
  }

  willUpdate(changed) {
    if (!this.ctx) return;
    if (changed.has("ctx")) this._fetchMapData();
    if (!this._mode) {
      let stored = null;
      try {
        stored = localStorage.getItem(STORE_KEY);
      } catch (_) {}
      const modes = this._modes;
      this._mode = [this.params?.mode, stored].find((m) => m && modes.includes(m)) || modes[0];
    }
    if (changed.has("ctx") || changed.has("_md")) this._sync();
  }

  _fetchMapData() {
    const cam = this._cam;
    const p = cam && this.ctx.mapData ? this.ctx.mapData(cam.entity_id) : Promise.resolve(null);
    if (p === this._mdPromise) return;
    this._mdPromise = p;
    p.then((md) => {
      if (this._mdPromise !== p) return;
      this._md = md;
      this.requestUpdate("_md");
    });
  }

  // ---- names ------------------------------------------------------------
  _typeName(type) {
    const key = SEGMENT_TYPES[type];
    return this.ctx.hass.localize?.(`component.dreame_vacuum.entity.select.segment_name.state.${key}`) || prettify(key);
  }
  // Segment.next_type_index (types.py:3882) over the draft.
  _nextIndex(type, id) {
    const n = this._draft.names;
    let index = 0;
    const ids = Object.keys(n)
      .map(Number)
      .sort((a, b) => (n[a].index ?? 0) - (n[b].index ?? 0));
    for (const other of ids) if (other !== id && n[other].type === type && n[other].index === index) index++;
    return index;
  }
  _displayName(id) {
    const n = this._draft?.names[id];
    if (!n) return `Room ${id}`;
    if (!n.changed && n.name) return n.name;
    if (n.custom) return n.custom;
    if (n.type > 0) return `${this._typeName(n.type)}${n.index > 0 ? ` ${n.index + 1}` : ""}`;
    return this.ctx.t("title", "segment_name_placeholder", "Room %index%").replace("%index%", id);
  }
  _setType(id, type) {
    const index = this._nextIndex(type, id);
    this._draft.names[id] = { type, index, custom: null, changed: true };
    this._dirty = true;
    this._sheet = null;
  }
  async _setCustom(id) {
    const value = await this.ctx.prompt({
      title: this.ctx.t("action", "rename", "Rename"),
      value: this._displayName(id),
      maxlength: 24,
    });
    if (!value) return;
    this._draft.names[id] = { type: 0, index: 0, custom: value, changed: true };
    this._dirty = true;
    this._sheet = null;
  }

  // ---- save -------------------------------------------------------------
  _payload() {
    const d = this._draft;
    if (this._mode === "name") {
      const type = {};
      for (const [id, n] of Object.entries(d.names)) if (n.changed) type[id] = [n.type, n.index, n.type === 0 ? n.custom : null];
      return ["vacuum_set_segment_type", { type }];
    }
    if (this._mode === "visibility") return ["vacuum_set_hidden_segments", { segments: [...d.hidden].sort((a, b) => a - b) }];
    if (this._mode === "material") {
      const material = {};
      for (const [id, [m, dir]] of Object.entries(d.material)) material[id] = [m < 0 ? 0 : m, dir ?? 0];
      return ["vacuum_set_floor_material", { material }];
    }
    if (this._mode === "walls" && d.walls) {
      // set_walls needs every wall of every segment and every door (counts must match).
      const walls = {};
      for (const [k, list] of Object.entries(d.walls)) walls[k] = list.map((w) => [...w.slice(0, 8).map(Math.round), ...w.slice(8)]);
      return ["vacuum_set_walls", { walls, doors: d.doors.map((x) => x.map((v) => Math.round(v ?? 0))) }];
    }
    return null;
  }

  async _save() {
    const p = this._payload();
    if (!p || !this._active) return false;
    this._busy = true;
    const ok = await this.ctx.vac(...p);
    this._busy = false;
    if (ok) {
      this._dirty = false;
      this._saved = { sig: this._draftSig, at: Date.now() };
      this._draftSig = null;
      this.ctx.toast(this.ctx.t("message", "saved", "Successfully saved"));
    }
    return ok;
  }

  _discard() {
    this._dirty = false;
    this._saved = null;
    this._sync(true);
  }

  async _setMode(mode) {
    if (mode === this._mode) return;
    if (this._dirty) {
      const c = this.ctx;
      const save = await c.confirm({
        title: c.t("message", "save_changes", "Save changes?"),
        text: c.t("message", "unsaved_changes_present", "You have unsaved changes that will be lost!"),
        confirmText: c.t("action", "save", "Save"),
      });
      if (save) {
        if (!(await this._save())) return;
      } else {
        const discard = await c.confirm({
          title: c.t("action", "discard", "Discard"),
          text: c.t("message", "unsaved_changes_present", "You have unsaved changes that will be lost!"),
          confirmText: c.t("action", "discard", "Discard"),
          destructive: true,
        });
        if (!discard) return;
        this._discard();
      }
    }
    this._mode = mode;
    this._merge = [];
    this._split = null;
    this._sheet = null;
    if (mode !== "merge" && mode !== "split") {
      try {
        localStorage.setItem(STORE_KEY, mode);
      } catch (_) {}
    }
  }

  // ---- merge / split ----------------------------------------------------
  _canMergeWith(id) {
    if (!this._merge.length || this._merge.includes(id)) return true;
    if (this._merge.length >= 2) return false;
    const nb = this._mdSegments?.[this._merge[0]]?.[7];
    if (Array.isArray(nb) && nb.length) return nb.map(Number).includes(id);
    const first = this._rooms.find((r) => r.id === this._merge[0]);
    const room = this._rooms.find((r) => r.id === id);
    return maybeNeighbors(first, room);
  }

  async _applyMerge() {
    const c = this.ctx;
    const [a, b] = this._merge;
    const ok = await c.confirm({
      title: c.t("title", "merge_rooms", "Merge rooms?"),
      text: `${this._displayName(a)} + ${this._displayName(b)}`,
      confirmText: c.t("action", "confirm", "Confirm"),
    });
    if (!ok) return;
    this._busy = true;
    const done = await c.vac("vacuum_merge_segments", { segments: [a, b] });
    this._busy = false;
    if (done) {
      this._merge = [];
      c.toast("Merge sent. The map refreshes when the robot confirms.");
    }
  }

  _defaultSplit(room) {
    const b = roomBox(room);
    if (!b) return null;
    const pad = Math.max(200, (b[2] - b[0]) * 0.1);
    const y = Math.round((b[1] + b[3]) / 2);
    return [Math.round(b[0] - pad), y, Math.round(b[2] + pad), y];
  }
  get _splitOk() {
    const s = this._split;
    if (!s?.line) return false;
    return lineCrossesBox(s.line, roomBox(this._rooms.find((r) => r.id === s.room)));
  }

  async _applySplit() {
    const c = this.ctx;
    const s = this._split;
    if (!this._splitOk) return;
    const ok = await c.confirm({
      title: c.t("title", "split_rooms", "Split room?"),
      text: this._displayName(s.room),
      confirmText: c.t("action", "confirm", "Confirm"),
    });
    if (!ok) return;
    this._busy = true;
    const done = await c.vac("vacuum_split_segments", { segment: s.room, line: s.line.map(Math.round) });
    this._busy = false;
    if (done) {
      this._split = null;
      c.toast("Split sent. The map refreshes when the robot confirms.");
    }
  }

  // ---- map actions ------------------------------------------------------
  async _rotate() {
    const c = this.ctx;
    const next = String(((Number(this._attrs.rotation) || 0) + 90) % 360);
    const sel = c.ent("select", "map_rotation");
    if (sel && (c.hass.states[sel].attributes.options || []).includes(next)) {
      await c.call("select", "select_option", { option: next }, { entity_id: sel });
    } else {
      await c.action("set_map_rotation", next);
    }
  }
  async _backup() {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("message", "backup_map", "Backup Map?"),
      text: c.t("message", "backup_map_will_overwritten", "Current backed up map will be overwritten!"),
      confirmText: c.t("action", "backup", "Backup"),
    });
    if (!ok) return;
    const data = this._mapInfo?.id ? { map_id: this._mapInfo.id } : {};
    if (await c.vac("vacuum_backup_map", data)) c.toast(c.t("message", "map_backup", "Map backup in progress"));
  }
  async _selectMap() {
    const c = this.ctx;
    const info = this._mapInfo;
    if (!info) return;
    const name = info.custom_name || info.name || `Map ${info.index}`;
    const ok = await c.confirm({
      title: c.t("message", "select_map", "Select %name%?").replace("%name%", name),
      text: c.t("message", "selected_map_will_changed", "Selected map will be changed to %name%!").replace("%name%", name),
      confirmText: c.t("action", "select_map", "Select map"),
    });
    if (ok) await c.vac("vacuum_select_map", { map_id: info.id });
  }

  // ---- pointer ----------------------------------------------------------
  _roomFromEvent(d) {
    if (d.data?.kind === "room") return Number(d.data.room);
    return roomAt(this._rooms, d.x, d.y)?.id;
  }

  _down(e) {
    const d = e.detail;
    if (!this._draft || this._busy || !this._active) return;
    const mode = this._mode;
    if (mode === "walls") return this._wallDown(d);
    if (mode === "split") {
      if (d.data?.kind === "handle" && this._split) {
        this._drag = { end: Number(d.data.h) };
        d.map.capture(d.event);
        return;
      }
      const id = this._roomFromEvent(d);
      if (id != null && (!this._split || (d.data?.kind === "room" && id !== this._split.room))) {
        const room = this._rooms.find((r) => r.id === id);
        this._split = { room: id, line: this._defaultSplit(room) };
        return;
      }
      if (this._split) {
        this._drag = { end: 1, isNew: true, prev: this._split.line };
        this._split = { ...this._split, line: [d.x, d.y, d.x, d.y] };
        d.map.capture(d.event);
      }
      return;
    }
    const id = this._roomFromEvent(d);
    if (id == null) return;
    if (mode === "name") this._sheet = { kind: "name", room: id };
    else if (mode === "material") this._sheet = { kind: "material", room: id };
    else if (mode === "visibility") {
      if (id === this._dockRoom) return this.ctx.toast("The dock's room cannot be hidden");
      const h = this._draft.hidden;
      h.has(id) ? h.delete(id) : h.add(id);
      this._dirty = true;
      this.requestUpdate();
    } else if (mode === "merge") {
      if (this._merge.includes(id)) this._merge = this._merge.filter((x) => x !== id);
      else if (this._canMergeWith(id)) this._merge = [...this._merge, id];
      else this.ctx.toast("Only neighboring rooms can be merged");
    }
  }

  // ---- walls & doors ----------------------------------------------------
  _wallDown(d) {
    const w = this._draft;
    if (!w.walls) return;
    const data = d.data || {};
    const p = [d.x, d.y];
    const sel = this._wsel;
    if (data.kind === "handle" && sel?.kind === "door") {
      const item = w.doors[sel.index];
      this._drag = { kind: "dend", item, end: Number(data.h), orig: [...item] };
    } else if (data.kind === "wall" && this._wallTool !== "door") {
      const item = w.walls[data.seg][Number(data.index)];
      this._wsel = { kind: "wall", seg: data.seg, index: Number(data.index) };
      this._drag = { kind: "wmove", item, start: p, orig: [...item] };
    } else if (data.kind === "door" && this._wallTool === "door") {
      const item = w.doors[Number(data.index)];
      this._wsel = { kind: "door", index: Number(data.index) };
      this._drag = { kind: "dmove", item, start: p, orig: [...item] };
    } else {
      this._wsel = null;
      return;
    }
    d.map.capture(d.event);
  }

  // Walls move across their own axis; doors slide along theirs and resize by their endpoints.
  _wallMove({ x, y }) {
    const drag = this._drag;
    if (!drag) return;
    const o = drag.orig;
    const len = Math.hypot(o[2] - o[0], o[3] - o[1]) || 1;
    const ux = (o[2] - o[0]) / len;
    const uy = (o[3] - o[1]) / len;
    const it = drag.item;
    if (drag.kind === "dend") {
      const t = (x - o[0]) * ux + (y - o[1]) * uy;
      it[drag.end * 2] = Math.round(o[0] + ux * t);
      it[drag.end * 2 + 1] = Math.round(o[1] + uy * t);
    } else {
      const dx = x - drag.start[0];
      const dy = y - drag.start[1];
      const [vx, vy] = drag.kind === "wmove" ? [-uy, ux] : [ux, uy];
      const t = dx * vx + dy * vy;
      for (let i = 0; i < 4; i += 2) {
        it[i] = Math.round(o[i] + vx * t);
        it[i + 1] = Math.round(o[i + 1] + vy * t);
      }
    }
    this._dirty = true;
    this.requestUpdate();
  }

  async _resetWalls() {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("message", "reset_walls", "Reset Walls?"),
      text: c.t("message", "walls_will_be_reset", "Walls will be restored to their initially mapped location!"),
      confirmText: c.t("action", "reset", "Reset"),
      destructive: true,
    });
    if (!ok) return;
    for (const list of Object.values(this._draft.walls)) for (const w of list) w.splice(0, 4, ...w.slice(4, 8));
    for (const door of this._draft.doors) door.splice(0, 4, ...door.slice(4, 8));
    this._wsel = null;
    this._dirty = true;
    this.requestUpdate();
  }

  _wallOverlay(tf, u) {
    const w = this._draft;
    const out = [];
    const tool = this._wallTool || "wall";
    const line = (g, cls, data) => {
      const [a, b] = [tf.toMap(g[0], g[1]), tf.toMap(g[2], g[3])];
      return svg`<g class=${cls} data-kind=${data.kind} data-seg=${data.seg ?? nothing} data-index=${data.index}>
        <line class="hit" x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]} stroke-width=${16 * u}></line>
        <line class="shape" x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]}></line></g>`;
    };
    for (const [seg, list] of Object.entries(w.walls))
      list.forEach((g, i) => {
        const sel = this._wsel?.kind === "wall" && this._wsel.seg === seg && this._wsel.index === i;
        out.push(line(g, `mwall ${tool === "wall" ? "" : "passive"} ${sel ? "sel" : ""}`, { kind: "wall", seg, index: i }));
      });
    w.doors.forEach((g, i) => {
      const sel = this._wsel?.kind === "door" && this._wsel.index === i;
      out.push(line(g, `door ${tool === "door" ? "" : "passive"} ${sel ? "sel" : ""}`, { kind: "door", index: i }));
      if (sel) out.push(handle(tf, u, g[0], g[1], 0), handle(tf, u, g[2], g[3], 1));
    });
    return out;
  }

  _move(e) {
    if (this._mode === "walls") return this._wallMove(e.detail);
    if (!this._drag || !this._split) return;
    const line = [...this._split.line];
    line[this._drag.end * 2] = e.detail.x;
    line[this._drag.end * 2 + 1] = e.detail.y;
    this._split = { ...this._split, line };
  }

  _up() {
    const drag = this._drag;
    if (!drag) return;
    this._drag = null;
    const l = this._split?.line;
    if (drag.isNew && l && Math.hypot(l[2] - l[0], l[3] - l[1]) < MIN_SHAPE_MM) this._split = { ...this._split, line: drag.prev };
  }

  // ---- overlay ----------------------------------------------------------
  _overlay(tf, u) {
    if (!this._draft) return nothing;
    const out = [overlayStyle];
    const mode = this._mode;
    if (mode === "walls" && this._draft.walls) return [...out, ...this._wallOverlay(tf, u)];
    const dock = this._dockRoom;
    const box = (r, cls) => {
      const b = roomBox(r);
      if (!b) return nothing;
      return svg`<polygon class="room-box ${cls}" points=${polyPoints(tf, [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]])}></polygon>`;
    };
    for (const r of this._rooms) {
      const hidden = this._draft.hidden.has(r.id);
      let cls = "";
      if (mode === "visibility" && hidden) cls = "off";
      if (mode === "merge" && this._merge.includes(r.id)) cls = "sel";
      if (mode === "merge" && this._merge.length && !this._canMergeWith(r.id)) cls = "blocked";
      if (mode === "split" && this._split?.room === r.id) cls = "sel";
      if (this._sheet?.room === r.id) cls = "sel";
      out.push(box(r, cls));
    }
    for (const r of this._rooms) {
      if (r.x == null || r.y == null) continue;
      const [x, y] = tf.toMap(r.x, r.y);
      const fs = 12 * u;
      const hidden = this._draft.hidden.has(r.id);
      let mark = "";
      let sub = "";
      if (mode === "visibility") mark = hidden ? "×" : "✓";
      else if (mode === "material") {
        const [m, dir] = this._draft.material[r.id] || [];
        mark = m === 1 ? (this._rot(dir) === 90 ? "↕" : "↔") : m > 0 ? "■" : "";
        sub = this._materialName(m);
      } else if (mode === "merge") mark = this._merge.indexOf(r.id) >= 0 ? String(this._merge.indexOf(r.id) + 1) : "+";
      const sel = (mode === "merge" && this._merge.includes(r.id)) || this._sheet?.room === r.id || this._split?.room === r.id;
      const off = mode === "visibility" && hidden;
      const disabled = mode === "visibility" && r.id === dock;
      out.push(svg`<g class="room ${sel ? "sel" : ""} ${off ? "off" : ""} ${disabled ? "disabled" : ""}" data-kind="room" data-room=${r.id}
        transform="translate(${x} ${y})">
        <circle r=${fs * 1.1}></circle>
        <text dy="0.35em" font-size=${fs}>${mark}</text>
        <text dy=${fs * 2.4} font-size=${fs * 0.9}>${this._displayName(r.id)}</text>
        ${sub ? svg`<text dy=${fs * 3.5} font-size=${fs * 0.75}>${sub}</text>` : nothing}
      </g>`);
    }
    if (mode === "split" && this._split?.line) {
      const [x0, y0, x1, y1] = this._split.line;
      const [a, b] = [tf.toMap(x0, y0), tf.toMap(x1, y1)];
      out.push(svg`<line class="split ${this._splitOk ? "ok" : ""}" x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]}></line>`);
      out.push(handle(tf, u, x0, y0, 0), handle(tf, u, x1, y1, 1));
    }
    return out;
  }

  _materialName(m) {
    const key = Object.keys(MATERIALS).find((k) => MATERIALS[k] === m);
    if (!key) return "";
    return this.ctx.hass.localize?.(`component.dreame_vacuum.entity.select.floor_material.state.${key}`) || prettify(key);
  }

  // ---- render -----------------------------------------------------------
  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const info = this._mapInfo;
    const heading = info?.custom_name || info?.name || c.t("title", "saved_map", "Saved map");
    const draftMode = MODES[this._mode]?.draft;
    const cam = this._cam;
    return html`<doc-page .ctx=${c} heading=${heading}>
      ${!this._active
        ? html`<button slot="actions" class="icon" title=${c.t("action", "select_map", "Select map")} @click=${() => this._selectMap()}>
            <ha-icon icon="mdi:map-check-outline"></ha-icon></button>`
        : nothing}
      ${draftMode
        ? html`<button slot="actions" class="icon" title=${c.t("action", "discard", "Discard")} ?disabled=${!this._dirty || this._busy}
              @click=${() => this._discard()}><ha-icon icon="mdi:undo-variant"></ha-icon></button>
            <button slot="actions" class="icon" title=${c.t("action", "save", "Save")} ?disabled=${!this._dirty || this._busy || !this._active}
              @click=${() => this._save()}><ha-icon icon="mdi:content-save-outline"></ha-icon></button>`
        : nothing}
      ${this._mode === "merge" && this._merge.length === 2
        ? html`<button slot="actions" class="icon" title=${c.t("action", "save", "Save")} ?disabled=${this._busy}
            @click=${() => this._applyMerge()}><ha-icon icon="mdi:content-save-outline"></ha-icon></button>`
        : nothing}
      ${this._mode === "split" && this._splitOk
        ? html`<button slot="actions" class="icon" title=${c.t("action", "save", "Save")} ?disabled=${this._busy}
            @click=${() => this._applySplit()}><ha-icon icon="mdi:content-save-outline"></ha-icon></button>`
        : nothing}
      ${!this._active
        ? html`<div class="note warn">
            Only the selected map can be edited.
            <button class="primary" @click=${() => this._selectMap()}>${c.t("action", "select_map", "Select map")}</button>
          </div>`
        : nothing}
      <doc-tabs
        .tabs=${this._modes.map((m) => ({ id: m, label: c.t(...MODES[m].t), icon: MODES[m].icon }))}
        .selected=${this._mode}
        @select=${(e) => this._setMode(e.detail.id)}
      ></doc-tabs>
      <doc-map
        .ctx=${c}
        .src=${cam ? c.url(cam.attributes.entity_picture) : undefined}
        .calibration=${cam?.attributes.calibration_points}
        .overlay=${(tf, u, s) => this._overlay(tf, u, s)}
        @map-down=${this._down}
        @map-move=${this._move}
        @map-up=${this._up}
      ></doc-map>
      <div class="hint">${this._hint()}</div>
      ${this._mode === "walls" && this._draft?.walls
        ? html`<div class="bar">
            <button class=${this._wallTool !== "door" ? "active" : ""} @click=${() => ((this._wallTool = "wall"), (this._wsel = null))}>
              <ha-icon icon="mdi:wall"></ha-icon>${c.t("title", "wall", "Walls")}</button>
            <button class=${this._wallTool === "door" ? "active" : ""} @click=${() => ((this._wallTool = "door"), (this._wsel = null))}>
              <ha-icon icon="mdi:door"></ha-icon>${c.t("title", "door", "Doors")}</button>
            <span class="spacer"></span>
            <button @click=${() => this._resetWalls()}><ha-icon icon="mdi:restore"></ha-icon>${c.t("action", "reset", "Reset")}</button>
          </div>`
        : nothing}
      ${this._mode === "walls" && !this._draft?.walls
        ? html`<div class="note">
            No wall data for this map. Walls and doors come from the saved map's data endpoint
            (camera_map_data_proxy), which only includes them for saved maps whose walls the robot has calculated.
          </div>`
        : nothing}
      ${this._mode === "merge" || this._mode === "split" ? this._applyBar() : nothing}
      <div class="bar">
        <button @click=${() => this._rotate()} ?disabled=${!this._active}>
          <ha-icon icon="mdi:rotate-right"></ha-icon>${c.t("action", "rotate_right", "Rotate")}</button>
        ${c.can("backup_map")
          ? html`<button @click=${() => this._backup()}><ha-icon icon="mdi:cloud-upload-outline"></ha-icon>${c.t("action", "backup", "Backup")}</button>`
          : nothing}
        ${c.can("backup_map") || info?.recovery_map
          ? html`<button @click=${() => c.navigate("recovery", { mapIndex: this._mapIndex })}>
              <ha-icon icon="mdi:history"></ha-icon>${c.t("title", "recovery_map_list", "Map Recovery")}</button>`
          : nothing}
        <span class="spacer"></span>
        ${this._dirty ? html`<span class="dirty">Unsaved changes</span>` : nothing}
      </div>
      ${this._renderSheet()}
    </doc-page>`;
  }

  _applyBar() {
    const c = this.ctx;
    if (this._mode === "merge") {
      return html`<div class="bar">
        <button ?disabled=${!this._merge.length} @click=${() => (this._merge = [])}>${c.t("action", "cancel", "Cancel")}</button>
        <button class="primary" ?disabled=${this._merge.length !== 2 || this._busy} @click=${() => this._applyMerge()}>
          <ha-icon icon="mdi:vector-union"></ha-icon>${c.t("title", "merge_rooms", "Merge")}</button>
      </div>`;
    }
    return html`<div class="bar">
      <button ?disabled=${!this._split} @click=${() => (this._split = null)}>${c.t("action", "cancel", "Cancel")}</button>
      <button class="primary" ?disabled=${!this._splitOk || this._busy} @click=${() => this._applySplit()}>
        <ha-icon icon="mdi:vector-line"></ha-icon>${c.t("title", "split_rooms", "Split")}</button>
    </div>`;
  }

  _hint() {
    if (!this._active) return "";
    switch (this._mode) {
      case "name":
        return "Tap a room to pick a room type or enter a custom name.";
      case "visibility":
        return "Tap a room to hide or show it. Hidden rooms are left out of the live map and room cleaning.";
      case "material":
        return "Tap a room to set its floor material.";
      case "merge":
        return this._merge.length === 2
          ? "Save to merge the selected rooms."
          : this._merge.length
            ? "Tap a neighboring room to merge with."
            : "Tap the first room to merge.";
      case "walls":
        return this._wallTool === "door"
          ? "Select a door to slide it along the wall or drag its ends to change its width. Doors cannot be added or removed."
          : "Select a wall to move it. Walls are visual only and do not change navigation; keep moves small.";
      case "split":
        if (!this._split) return "Tap a room to place a dividing line.";
        return this._splitOk ? "Drag the endpoints to adjust, then save to split." : "The line must cross the whole room.";
      default:
        return "";
    }
  }

  _renderSheet() {
    const s = this._sheet;
    if (!s) return nothing;
    const c = this.ctx;
    const close = () => (this._sheet = null);
    if (s.kind === "name") {
      const cur = this._draft.names[s.room];
      return html`<doc-sheet open heading=${this._displayName(s.room)} @closed=${close}>
        <div class="options">
          ${Object.keys(SEGMENT_TYPES).map((t) => {
            const type = Number(t);
            const index = this._nextIndex(type, s.room);
            return html`<button class=${cur?.type === type && !cur?.custom ? "active" : ""} @click=${() => this._setType(s.room, type)}>
              ${this._typeName(type)}${index > 0 ? ` ${index + 1}` : ""}
            </button>`;
          })}
          <button class=${cur?.type === 0 ? "active" : ""} @click=${() => this._setCustom(s.room)}>
            <ha-icon icon="mdi:pencil-outline"></ha-icon>${c.t("action", "rename", "Custom name")}…
          </button>
        </div>
      </doc-sheet>`;
    }
    const [m, dir] = this._draft.material[s.room] || [0, null];
    const set = (mat, d = dir) => {
      this._draft.material[s.room] = [mat, mat === 1 ? (d ?? 0) : null];
      this._dirty = true;
      this.requestUpdate();
    };
    const options = ["none", "tile", "wood", ...(c.can("carpet_material") ? ["medium_pile_carpet", "low_pile_carpet", "carpet"] : [])];
    return html`<doc-sheet open heading=${this._displayName(s.room)} @closed=${close}>
      <div class="options">
        ${options.map(
          (k) => html`<button class=${m === MATERIALS[k] ? "active" : ""} @click=${() => {
            set(MATERIALS[k]);
            if (MATERIALS[k] !== 1 || !c.can("floor_direction_cleaning")) close();
          }}>
            <ha-icon icon=${MATERIAL_ICONS[MATERIALS[k]]}></ha-icon>${this._materialName(MATERIALS[k])}
          </button>`
        )}
      </div>
      ${m === 1 && c.can("floor_direction_cleaning")
        ? html`<div class="sheet-row">
            ${[
              [0, "horizontal", "mdi:arrow-left-right"],
              [90, "vertical", "mdi:arrow-up-down"],
            ].map(
              ([d, key, icon]) => html`<button class=${this._rot(dir) === d ? "active" : ""} @click=${() => (set(1, this._rot(d)), close())}>
                <ha-icon icon=${icon}></ha-icon>${c.hass.localize?.(`component.dreame_vacuum.entity.select.floor_material_direction.state.${key}`) || prettify(key)}
              </button>`
            )}
          </div>`
        : nothing}
    </doc-sheet>`;
  }
}

customElements.get("doc-saved-map-edit") || customElements.define("doc-saved-map-edit", SavedMapEdit);
