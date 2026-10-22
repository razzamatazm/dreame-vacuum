/*
 * <doc-object-edit> — map object editor (DVC "Map Edit" / object editing).
 *
 * One mode per object family. Each mode loads a local draft from the live map
 * camera attributes, edits it on <doc-map>, and saves the whole list for that
 * family with one service call (every set_* service replaces its lists).
 *
 * params: { mode?: "restricted" | "carpets" | "thresholds" | "virtual_thresholds"
 *                   | "curtains" | "low_lying" | "furniture" | "points" }
 *
 * Tuple formats (derived from the integration source):
 *   restricted  walls [x0,y0,x1,y1]; zones/no_mops [x0,y0,x1,y1] or [.., angle]
 *               (each list uniform)                         device.py set_restricted_zone
 *   carpets     [x0,y0,x1,y1, id (-1 = new), ellipse 0/1]   map.py set_carpet_area / parse_carpets
 *               deleted_carpets [x0,y0,x1,y1]
 *   thresholds  lines [x0,y0,x1,y1]; ramps [x0,y0,x1,y1, angle]  map.py set_thresholds / parse_areas
 *   furniture   [id (-1 = new), type, segment_id, width, height, x, y, angle, scale, edit_type, modified]
 *                                                           map.py set_furnitures
 *   points      [x, y]  (device adds [.., 0, 1] itself)     device.py set_predefined_points
 */

import { LitElement, html, svg, css, nothing, base, prettify } from "../core.js";
import { normRect, areaCorners } from "../map-view.js";
import {
  MIN_SHAPE_MM,
  SAVE_SETTLE_MS,
  parseLine,
  parseArea,
  restrictionsPayload,
  uniformAreas,
  rectAt,
  lineAt,
  tooSmallRect,
  tooShortLine,
  roomAt,
  handle,
  handleAt,
  rectShape,
  ellipseShape,
  lineShape,
  editStyles,
  overlayStyle,
  mergeMapData,
} from "./edit-shared.js";

const STORE_KEY = "dreame-open-card:object-edit-mode";
const MAX_POINTS = 20;

// FurnitureType (dreame/types.py:2833). Keys match the furniture_type select translations.
const FURNITURE = {
  1: "single_bed", 2: "double_bed", 3: "arm_chair", 4: "two_seat_sofa", 5: "three_seat_sofa", 6: "dining_table",
  7: "nightstant", 8: "coffee_table", 9: "toilet", 10: "litter_box", 11: "pet_bed", 12: "food_bowl", 13: "pet_toilet",
  14: "refrigerator", 15: "washing_machine", 16: "enclosed_litter_box", 17: "air_conditioner", 18: "tv_cabinet",
  19: "bookshelf", 20: "shoe_cabinet", 21: "wardrobe", 22: "greenery", 23: "floor_mirror", 24: "l_shaped_sofa",
  25: "round_coffee_table", 26: "table", 29: "arm_chair_narrow", 30: "three_seat_sofa_narrow", 31: "l_shaped_sofa_right",
};
// Default footprint (mm) for newly placed furniture.
const FURNITURE_SIZE = { 1: [1000, 2000], 2: [1600, 2000], 5: [2000, 900], 4: [1500, 900], 6: [1400, 900], 21: [1200, 600], 24: [2400, 1600], 31: [2400, 1600] };

// Layers: one per object list. shape: line | rect | point | furn
const LAYERS = {
  wall: { shape: "line", t: ["action", "virtual_wall", "Virtual wall"], icon: "mdi:wall", size: 1500 },
  nogo: { shape: "rect", t: ["action", "no_go", "No-Go"], icon: "mdi:cancel", size: 1000 },
  nomop: { shape: "rect", t: ["action", "no_mop", "No-Mop"], icon: "mdi:water-off", size: 1000 },
  carpet: { shape: "rect", t: ["action", "square_carpet", "Square carpet"], icon: "mdi:rug", size: [1600, 1000] },
  deleted: { shape: "rect", t: ["action", "deleted_carpet", "Deleted carpet"], icon: "mdi:select-remove", size: 1000 },
  passable: { shape: "line", t: ["action", "passable_threshold", "Passable threshold"], icon: "mdi:door-open", size: 900 },
  impassable: { shape: "line", t: ["action", "impassable_threshold", "Impassable threshold"], icon: "mdi:door-closed-lock", size: 900 },
  ramp: { shape: "rect", t: ["action", "ramp", "Ramp"], icon: "mdi:slope-uphill", size: [1000, 600] },
  vthreshold: { shape: "line", t: ["action", "virtual_threshold", "Virtual threshold"], icon: "mdi:door-open", size: 900 },
  curtain: { shape: "line", t: ["action", "curtain", "Curtain"], icon: "mdi:curtains", size: 2000 },
  lowlying: { shape: "rect", t: ["action", "low_lying_area", "Low-lying area"], icon: "mdi:sofa-outline", readonly: true },
  furniture: { shape: "furn", t: ["title", "add_furniture", "Add furniture"], icon: "mdi:sofa" },
  point: { shape: "point", t: ["action", "predefined_point", "Point"], icon: "mdi:map-marker-plus" },
};

const has = (a, k) => a[k] !== undefined && a[k] !== null;
const rects = (list) => (list || []).map((x) => ({ g: parseArea(x) }));
const lines = (list) => (list || []).map((x) => ({ g: parseLine(x) }));

const MODES = {
  restricted: {
    t: ["title", "restricted_areas", "Restricted areas"],
    icon: "mdi:cancel",
    layers: ["wall", "nogo", "nomop"],
    avail: () => true,
    keys: ["virtual_walls", "no_go_areas", "no_mopping_areas"],
    load: (a) => ({ wall: lines(a.virtual_walls), nogo: rects(a.no_go_areas), nomop: rects(a.no_mopping_areas) }),
    save: (d) => [
      "vacuum_set_restricted_zone",
      restrictionsPayload({ wall: d.wall.map((i) => i.g), nogo: d.nogo.map((i) => i.g), nomop: d.nomop.map((i) => i.g) }),
    ],
  },
  carpets: {
    t: ["action", "carpet", "Carpets"],
    icon: "mdi:rug",
    layers: ["carpet", "deleted"],
    avail: (c, a) => has(a, "carpets") || has(a, "deleted_carpets") || has(a, "detected_carpets") || c.can("carpet_recognition"),
    keys: ["carpets", "deleted_carpets", "detected_carpets"],
    load: (a) => ({
      // Area.as_dict carries geometry only; id / ellipse are used when a future
      // integration version exposes them (see report), otherwise new ids are assigned.
      carpet: (a.carpets || []).map((x) => ({ g: [...parseArea(x).slice(0, 4), 0], id: x.id ?? null, ellipse: x.ellipse ? 1 : 0 })),
      deleted: (a.deleted_carpets || []).map((x) => ({ g: [...parseArea(x).slice(0, 4), 0] })),
    }),
    save: (d, c) => {
      const shape = c.can("carpet_shape") || d.carpet.some((i) => i.ellipse);
      return [
        "vacuum_set_carpet_area",
        {
          carpets: d.carpet.map((i) => {
            const t = [...normRect(i.g).slice(0, 4), i.id ?? -1];
            return shape ? [...t, i.ellipse ? 1 : 0] : t;
          }),
          deleted_carpets: d.deleted.map((i) => normRect(i.g).slice(0, 4)),
        },
      ];
    },
  },
  thresholds: {
    t: ["title", "thresholds", "Thresholds & ramps"],
    icon: "mdi:door-open",
    layers: ["passable", "impassable", "ramp"],
    avail: (c, a) => has(a, "passable_thresholds") || has(a, "impassable_thresholds") || has(a, "ramps"),
    layerAvail: (layer, c, a) => layer !== "ramp" || has(a, "ramps") || c.can("ramps"),
    keys: ["passable_thresholds", "impassable_thresholds", "ramps"],
    load: (a) => ({ passable: lines(a.passable_thresholds), impassable: lines(a.impassable_thresholds), ramp: rects(a.ramps) }),
    save: (d) => [
      "vacuum_set_threshold",
      {
        passable_thresholds: d.passable.map((i) => i.g.slice(0, 4)),
        impassable_thresholds: d.impassable.map((i) => i.g.slice(0, 4)),
        ramps: d.ramp.map((i) => [...normRect(i.g).slice(0, 4), Math.round(i.g[4] || 0)]),
      },
    ],
  },
  // Same robot list ("vws.vwsl") as passable thresholds; a model has one or the other.
  virtual_thresholds: {
    t: ["action", "virtual_threshold", "Virtual thresholds"],
    icon: "mdi:door-open",
    layers: ["vthreshold"],
    avail: (c, a) => has(a, "virtual_thresholds") && !has(a, "passable_thresholds"),
    keys: ["virtual_thresholds"],
    load: (a) => ({ vthreshold: lines(a.virtual_thresholds) }),
    save: (d) => ["vacuum_set_virtual_threshold", { virtual_thresholds: d.vthreshold.map((i) => i.g.slice(0, 4)) }],
  },
  curtains: {
    t: ["title", "curtains", "Curtains"],
    icon: "mdi:curtains",
    layers: ["curtain"],
    avail: (c, a) => has(a, "curtains") || c.can("curtains"),
    keys: ["curtains"],
    load: (a) => ({ curtain: lines(a.curtains) }),
    save: (d) => ["vacuum_set_curtain", { curtains: d.curtain.map((i) => i.g.slice(0, 4)) }],
  },
  // device.py set_low_lying_area always raises NotSupportedException("low_lying_area_editing")
  // when the map manager is active, so this mode only displays the areas.
  low_lying: {
    t: ["title", "low_lying_areas", "Low-lying areas"],
    icon: "mdi:sofa-outline",
    layers: ["lowlying"],
    readonly: true,
    avail: (c, a) => has(a, "low_lying_areas") || c.can("low_lying_areas"),
    keys: ["low_lying_areas"],
    load: (a) => ({ lowlying: rects(a.low_lying_areas) }),
  },
  furniture: {
    t: ["title", "furniture", "Furniture"],
    icon: "mdi:sofa",
    layers: ["furniture"],
    avail: (c, a) =>
      a.__md ? !!a.furniture_version && has(a, "furnitures") :
      has(a, "furnitures") || ["furnitures_v2", "furnitures_v3", "pet_furniture", "extended_furnitures"].some((f) => c.can(f)),
    keys: ["furnitures"],
    load: (a, page) =>
      (a.furnitures || [])
        .filter((f) => f.width && f.height)
        .map((f) => ({
          g: [f.x, f.y, f.width, f.height, f.angle || 0].map(Math.round),
          type: page._furnitureCode(f.type),
          id: f.furniture_id ?? null,
          room: f.room_id ?? null,
          scale: f.scale ?? 1,
          edit: f.edit_type ?? 0,
          modified: f.modified ? 1 : 0,
        }))
        .filter((f) => f.type)
        .reduce((d, f) => (d.furniture.push(f), d), { furniture: [] }),
    save: (d, c) => {
      const rooms = c.rooms({ includeHidden: true });
      return [
        "vacuum_set_furniture",
        {
          furnitures: d.furniture.map((f) => [
            f.id ?? -1,
            f.type,
            f.changed ? roomAt(rooms, f.g[0], f.g[1])?.id ?? f.room ?? 0 : f.room ?? roomAt(rooms, f.g[0], f.g[1])?.id ?? 0,
            Math.round(f.g[2]),
            Math.round(f.g[3]),
            Math.round(f.g[0]),
            Math.round(f.g[1]),
            Math.round(f.g[4] || 0),
            Number(f.scale ?? 1),
            f.edit ?? 0,
            f.changed || f.modified ? 1 : 0,
          ]),
        },
      ];
    },
  },
  points: {
    t: ["title", "predefined_points", "Predefined points"],
    icon: "mdi:map-marker-multiple",
    layers: ["point"],
    avail: (c, a) => c.can("cruising") || has(a, "predefined_points"),
    keys: ["predefined_points"],
    load: (a) => ({ point: (a.predefined_points || []).map((p) => ({ g: [Math.round(p.x), Math.round(p.y)] })) }),
    save: (d) => ["vacuum_set_predefined_points", { points: d.point.map((i) => i.g.slice(0, 2)) }],
  },
};

class ObjectEdit extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    _mode: { state: true },
    _md: { state: true },
    _draft: { state: true },
    _sel: { state: true },
    _dirty: { state: true },
    _busy: { state: true },
    _tool: { state: true },
    _picker: { state: true },
  };

  static styles = [
    base,
    editStyles,
    css`
      .furn-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 6px;
        padding: 4px 16px 8px;
      }
      .furn-grid button {
        justify-content: flex-start;
        text-align: left;
        border-radius: 10px;
      }
    `,
  ];

  constructor() {
    super();
    this._mode = null;
    this._draft = null;
    this._draftSig = null;
    this._sel = null; // { layer, index } ; layer "detected" for detected carpets
    this._dirty = false;
    this._busy = false;
    this._saved = null;
    this._drag = null;
    this._tool = null;
    this._picker = null; // { action: "add" | "change" }
  }

  // ---- mode & draft ----------------------------------------------------
  get _modes() {
    const a = this._A;
    return Object.keys(MODES).filter((m) => MODES[m].avail(this.ctx, a));
  }
  get _def() {
    return MODES[this._mode];
  }
  _layers(mode = this._mode) {
    const def = MODES[mode];
    return def.layers.filter((l) => !def.layerAvail || def.layerAvail(l, this.ctx, this._A));
  }

  willUpdate(changed) {
    if (!this.ctx) return;
    if (changed.has("ctx")) this._fetchMapData();
    this._A = mergeMapData(this.ctx.mapAttrs, this._md);
    if (!this._mdReady) return;
    if (this._mode && !this._modes.includes(this._mode) && !this._dirty) this._mode = null;
    if (!this._mode) {
      const modes = this._modes;
      let stored = null;
      try {
        stored = localStorage.getItem(STORE_KEY);
      } catch (_) {}
      this._mode = [this.params?.mode, stored].find((m) => m && modes.includes(m)) || modes[0];
      this._tool = this._layers()[0];
    }
    if (changed.has("ctx") || changed.has("_md")) this._sync();
  }

  // Full map JSON (ids, ellipse, edit_type, furniture_version, unsupported lists as null).
  // Editing waits for it so a save never drops ids the attributes do not carry.
  _fetchMapData() {
    const p = this.ctx.mapData ? this.ctx.mapData() : Promise.resolve(null);
    if (p === this._mdPromise) return;
    this._mdPromise = p;
    p.then((md) => {
      if (this._mdPromise !== p) return;
      this._md = md;
      this._mdReady = true;
      this.requestUpdate("_md");
    });
  }

  _sig(mode = this._mode) {
    const a = this._A;
    return JSON.stringify(MODES[mode].keys.map((k) => a[k] ?? null));
  }

  // Keep the draft in step with the device unless there are unsaved changes,
  // or we just saved and the map hasn't caught up yet.
  _sync(force = false) {
    const sig = this._sig();
    if (!force && (this._dirty || this._drag || sig === this._draftSig)) return;
    if (!force && this._saved && this._saved.sig === sig && Date.now() - this._saved.at < SAVE_SETTLE_MS) return;
    this._saved = null;
    const draft = this._def.load(this._A, this);
    for (const l of this._def.layers) draft[l] ||= [];
    this._draft = draft;
    this._draftSig = sig;
    this._sel = null;
  }

  async _setMode(mode) {
    if (mode === this._mode) return;
    if (this._dirty) {
      const ctx = this.ctx;
      const save = await ctx.confirm({
        title: ctx.t("message", "save_changes", "Save changes?"),
        text: ctx.t("message", "unsaved_changes_present", "You have unsaved changes that will be lost!"),
        confirmText: ctx.t("action", "save", "Save"),
      });
      if (save) {
        if (!(await this._save(false))) return;
      } else {
        const discard = await ctx.confirm({
          title: ctx.t("action", "discard", "Discard"),
          text: ctx.t("message", "unsaved_changes_present", "You have unsaved changes that will be lost!"),
          confirmText: ctx.t("action", "discard", "Discard"),
          destructive: true,
        });
        if (!discard) return;
      }
    }
    this._mode = mode;
    this._tool = this._layers()[0];
    this._dirty = false;
    this._saved = null;
    this._draftSig = null;
    try {
      localStorage.setItem(STORE_KEY, mode);
    } catch (_) {}
    this._sync(true);
  }

  async _save(leave = true) {
    const [service, data] = this._def.save(this._draft, this.ctx);
    this._busy = true;
    const ok = await this.ctx.vac(service, data);
    this._busy = false;
    if (ok) {
      this._dirty = false;
      this._sel = null;
      this._saved = { sig: this._draftSig, at: Date.now() };
      this._draftSig = null; // resync once the map reports the new state
      this.ctx.toast(this.ctx.t("message", "saved", "Successfully saved"));
      if (leave) this.ctx.back();
    }
    return ok;
  }

  _discard() {
    this._dirty = false;
    this._saved = null;
    this._sync(true);
  }

  _touch() {
    this._dirty = true;
    this.requestUpdate();
  }

  // ---- geometry helpers -------------------------------------------------
  _center() {
    const v = this._view;
    if (!v) return [0, 0];
    return v.tf.toVacuum(v.w / 2, v.h / 2);
  }

  _newItem(layer, at, meta = {}) {
    const def = LAYERS[layer];
    const [w, h] = Array.isArray(def.size) ? def.size : [def.size, def.size];
    if (def.shape === "line") return { g: lineAt(at, w), ...meta };
    if (def.shape === "rect") return { g: rectAt(at, w, h), ...meta };
    if (def.shape === "point") return { g: [Math.round(at[0]), Math.round(at[1])] };
    return null;
  }

  _add(layer, meta = {}) {
    this._tool = layer;
    const item = this._newItem(layer, this._center(), meta);
    if (!item) return;
    if (layer === "carpet") item.id = null;
    this._draft[layer].push(item);
    this._sel = { layer, index: this._draft[layer].length - 1 };
    this._touch();
  }

  _addFurniture(type) {
    const [w, h] = FURNITURE_SIZE[type] || [800, 800];
    const [x, y] = this._center();
    this._draft.furniture.push({ g: [x, y, w, h, 0], type, id: null, room: null, scale: 1, edit: 0, modified: 1, changed: true });
    this._sel = { layer: "furniture", index: this._draft.furniture.length - 1 };
    this._touch();
  }

  _deleteSelected() {
    const s = this._sel;
    if (!s || s.layer === "detected") return;
    this._draft[s.layer].splice(s.index, 1);
    this._sel = null;
    this._touch();
  }

  // Deleted-carpet override covering an automatically detected carpet.
  _overrideDetected() {
    const c = (this._A.detected_carpets || [])[this._sel?.index];
    if (!c) return;
    this._draft.deleted.push({ g: [...parseArea(c).slice(0, 4), 0] });
    this._sel = { layer: "deleted", index: this._draft.deleted.length - 1 };
    this._touch();
  }

  _furnitureName(type) {
    const key = FURNITURE[type];
    return this.ctx.hass.localize?.(`component.dreame_vacuum.entity.select.furniture_type.state.${key}`) || prettify(key);
  }

  // Furniture.as_dict exposes the type as a localized name; map it back to the enum.
  _furnitureCode(name) {
    if (typeof name === "number") return name;
    const n = String(name || "").toLowerCase();
    for (const [code, key] of Object.entries(FURNITURE)) {
      if (n === this._furnitureName(Number(code)).toLowerCase() || n === key.replace(/_/g, " ")) return Number(code);
    }
    return null;
  }

  _furnitureTypes() {
    const c = this.ctx;
    const ext = c.can("extended_furnitures");
    return Object.keys(FURNITURE)
      .map(Number)
      .filter((t) => (ext || ((t <= 13 && t !== 8) || t === 25)) && (c.can("pet_furniture") || t < 10 || t > 13));
  }

  // ---- pointer handling -------------------------------------------------
  _down(e) {
    const d = e.detail;
    const def = this._def;
    if (!this._draft || def.readonly || this._busy) return;
    const data = d.data || {};
    const p = [d.x, d.y];
    const sel = this._sel;
    const capture = () => d.map.capture(d.event);

    if (data.kind === "handle" && sel && sel.layer !== "detected") {
      const item = this._draft[sel.layer][sel.index];
      const shape = LAYERS[sel.layer].shape;
      if (shape === "line") this._drag = { kind: "end", item, end: Number(data.h) };
      else if (shape === "rect") this._drag = { kind: "corner", item, fixed: areaCorners(item.g)[(Number(data.h) + 2) % 4] };
      else if (shape === "furn") this._drag = { kind: data.h === "rot" ? "rot" : "size", item };
      capture();
      return;
    }
    if (data.kind === "item" && this._layers().includes(data.layer)) {
      const index = Number(data.index);
      const item = this._draft[data.layer][index];
      this._sel = { layer: data.layer, index };
      this._drag = { kind: "move", item, start: p, orig: [...item.g] };
      capture();
      return;
    }
    if (data.kind === "detected") {
      this._sel = { layer: "detected", index: Number(data.index) };
      return;
    }
    // Empty space.
    if (this._mode === "points") {
      const list = this._draft.point;
      if (list.length >= MAX_POINTS) return this.ctx.toast(`Up to ${MAX_POINTS} points`);
      if (!roomAt(this.ctx.rooms({ includeHidden: true }), d.x, d.y)) {
        this._sel = null;
        return;
      }
      list.push({ g: p });
      this._sel = { layer: "point", index: list.length - 1 };
      this._drag = { kind: "move", item: list[list.length - 1], start: p, orig: [...p] };
      this._touch();
      capture();
      return;
    }
    const layer = this._tool;
    const shape = LAYERS[layer]?.shape;
    if (shape !== "line" && shape !== "rect") {
      this._sel = null;
      return;
    }
    const item = { g: shape === "line" ? [p[0], p[1], p[0], p[1]] : [p[0], p[1], p[0], p[1], 0] };
    if (layer === "carpet") Object.assign(item, { id: null, ellipse: 0 });
    this._draft[layer].push(item);
    this._sel = { layer, index: this._draft[layer].length - 1 };
    this._drag = shape === "line" ? { kind: "end", item, end: 1, isNew: true, layer } : { kind: "corner", item, fixed: p, isNew: true, layer };
    capture();
    this.requestUpdate();
  }

  _move(e) {
    const drag = this._drag;
    if (!drag) return;
    const { x, y, mx, my } = e.detail;
    const g = drag.item.g;
    if (drag.kind === "corner") {
      g.splice(0, 4, ...normRect([drag.fixed[0], drag.fixed[1], x, y]).slice(0, 4));
    } else if (drag.kind === "end") {
      g[drag.end * 2] = x;
      g[drag.end * 2 + 1] = y;
    } else if (drag.kind === "move") {
      const dx = x - drag.start[0];
      const dy = y - drag.start[1];
      if (!dx && !dy && !drag.moved) return;
      drag.moved = true;
      if (g.length === 2 || LAYERS[this._sel?.layer]?.shape === "furn") {
        g[0] = drag.orig[0] + dx;
        g[1] = drag.orig[1] + dy;
      } else {
        g[0] = drag.orig[0] + dx;
        g[1] = drag.orig[1] + dy;
        g[2] = drag.orig[2] + dx;
        g[3] = drag.orig[3] + dy;
      }
    } else if (drag.kind === "size" || drag.kind === "rot") {
      const tf = this._view.tf;
      const [cx, cy] = tf.toMap(g[0], g[1]);
      const dx = mx - cx;
      const dy = my - cy;
      if (drag.kind === "rot") {
        let a = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI / 5) * 5;
        g[4] = (a + 360) % 360;
      } else {
        const t = ((g[4] || 0) * Math.PI) / 180;
        const lx = dx * Math.cos(t) + dy * Math.sin(t);
        const ly = -dx * Math.sin(t) + dy * Math.cos(t);
        g[2] = Math.max(200, Math.round((2 * Math.abs(lx)) / tf.scale));
        g[3] = Math.max(200, Math.round((2 * Math.abs(ly)) / tf.scale));
      }
    }
    drag.item.changed = true;
    if (!drag.isNew) this._dirty = true;
    this.requestUpdate();
  }

  _up() {
    const drag = this._drag;
    if (!drag) return;
    this._drag = null;
    if (drag.isNew) {
      const list = this._draft[drag.layer];
      const g = drag.item.g;
      const small = LAYERS[drag.layer].shape === "line" ? tooShortLine(g) : tooSmallRect(g);
      if (small) {
        // A tap on empty space just clears the selection.
        list.splice(list.indexOf(drag.item), 1);
        this._sel = null;
      } else this._dirty = true;
    }
    if (this._mode === "points" && drag.item.g.length === 2) {
      const [x, y] = drag.item.g;
      if (!roomAt(this.ctx.rooms({ includeHidden: true }), x, y)) {
        // Points must stay on the floor: snap back.
        drag.item.g.splice(0, 2, ...drag.orig.slice(0, 2));
        this.ctx.toast("Points must be inside a room");
      }
    }
    this.requestUpdate();
  }

  // ---- overlay ----------------------------------------------------------
  _overlay(tf, u, [w, h]) {
    this._view = { tf, u, w, h };
    if (!this._draft) return nothing;
    const out = [overlayStyle];
    const a = this._A;
    const sel = this._sel;
    const isSel = (layer, i) => sel && sel.layer === layer && sel.index === i;

    if (this._mode === "carpets") {
      (a.detected_carpets || []).forEach((c, i) =>
        out.push(rectShape(tf, parseArea(c), `detected ${isSel("detected", i) ? "sel" : ""}`, { kind: "detected", index: i }))
      );
    }
    for (const layer of this._layers()) {
      const L = LAYERS[layer];
      const data = (i) => (L.readonly ? {} : { kind: "item", layer, index: i });
      (this._draft[layer] || []).forEach((item, i) => {
        const s = isSel(layer, i);
        const cls = `item ${layer} ${s ? "sel" : ""}`;
        if (L.shape === "line") {
          out.push(lineShape(tf, u, item.g, cls, data(i)));
          if (s) out.push(handle(tf, u, item.g[0], item.g[1], 0), handle(tf, u, item.g[2], item.g[3], 1));
        } else if (L.shape === "rect") {
          out.push(item.ellipse ? ellipseShape(tf, normRect(item.g), cls, data(i)) : rectShape(tf, item.g, cls, data(i)));
          // Rotated rects can be moved and deleted; resizing them here would distort them.
          if (s && !item.g[4]) areaCorners(item.g).forEach(([x, y], h) => out.push(handle(tf, u, x, y, h)));
        } else if (L.shape === "point") {
          const [px, py] = tf.toMap(item.g[0], item.g[1]);
          out.push(svg`<g class="item point ${s ? "sel" : ""}" data-kind="item" data-layer="point" data-index=${i}
            transform="translate(${px} ${py})"><circle r=${11 * u}></circle>
            <text dy="0.35em" font-size=${12 * u}>${i + 1}</text></g>`);
        } else if (L.shape === "furn") {
          out.push(this._furnShape(tf, u, item, i, s));
        }
      });
    }
    return out;
  }

  _furnShape(tf, u, item, i, s) {
    const [cx, cy] = tf.toMap(item.g[0], item.g[1]);
    const k = tf.scale;
    const w = item.g[2] * k;
    const h = item.g[3] * k;
    const ang = item.g[4] || 0;
    const parts = [
      svg`<g class="item furn ${s ? "sel" : ""}" data-kind="item" data-layer="furniture" data-index=${i}
        transform="translate(${cx} ${cy}) rotate(${ang})">
        <rect x=${-w / 2} y=${-h / 2} width=${w} height=${h} rx=${3 * u}></rect>
        <text dy="0.35em" font-size=${11 * u}>${this._furnitureName(item.type)}</text></g>`,
    ];
    if (s) {
      const t = (ang * Math.PI) / 180;
      const at = (lx, ly) => [cx + lx * Math.cos(t) - ly * Math.sin(t), cy + lx * Math.sin(t) + ly * Math.cos(t)];
      [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ].forEach(([lx, ly], n) => {
        const [x, y] = at(lx, ly);
        parts.push(handleAt(u, x, y, n));
      });
      const [rx, ry] = at(0, -h / 2 - 26 * u);
      parts.push(handleAt(u, rx, ry, "rot", "rot"));
    }
    return parts;
  }

  // ---- render -----------------------------------------------------------
  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const modes = this._modes;
    const def = this._def;
    const title = c.t("title", "map_edit", "Edit map");
    if (!this._mdReady) return html`<doc-page .ctx=${c} heading=${title}><div class="note">Loading map data…</div></doc-page>`;
    if (!def) return html`<doc-page .ctx=${c} heading=${title}><div class="note">No editable objects on this map.</div></doc-page>`;
    const running = c.attrs.started || c.attrs.running;
    return html`<doc-page .ctx=${c} heading=${title}>
      ${def.readonly
        ? nothing
        : html`<button slot="actions" class="icon" title=${c.t("action", "discard", "Discard")} ?disabled=${!this._dirty || this._busy}
              @click=${() => this._discard()}><ha-icon icon="mdi:undo-variant"></ha-icon></button>
            <button slot="actions" class="icon" title=${c.t("action", "save", "Save")} ?disabled=${!this._dirty || this._busy}
              @click=${() => this._save()}><ha-icon icon="mdi:content-save-outline"></ha-icon></button>`}
      <doc-tabs
        .tabs=${modes.map((m) => ({ id: m, label: c.t(...MODES[m].t), icon: MODES[m].icon }))}
        .selected=${this._mode}
        @select=${(e) => this._setMode(e.detail.id)}
      ></doc-tabs>
      <doc-map
        .ctx=${c}
        dim
        .overlay=${(tf, u, s) => this._overlay(tf, u, s)}
        @map-down=${this._down}
        @map-move=${this._move}
        @map-up=${this._up}
      ></doc-map>
      <div class="hint">${this._hint()}</div>
      ${running && !def.readonly
        ? html`<div class="note warn">${c.t("message", "active_task", "Vacuum has active task!")} Some edits are rejected until it is idle.</div>`
        : nothing}
      ${def.readonly
        ? html`<div class="note">
            The integration does not support editing low-lying areas yet (vacuum_set_low_lying_area is rejected with
            "low_lying_area_editing not supported"). Areas detected by the robot are shown above.
          </div>`
        : html`${this._addBar()}${this._selBar()}`}
      ${this._renderPicker()}
    </doc-page>`;
  }

  _hint() {
    const s = this._sel;
    if (this._def.readonly) return "";
    if (s?.layer === "detected") return "Automatically detected carpet. Add a deleted-carpet override to stop the robot treating it as carpet.";
    if (s) {
      if (this._mode === "points") return "Drag to move the point.";
      if (this._mode === "furniture") return "Drag to move, corners to resize, the filled handle to rotate.";
      return "Drag to move, drag a handle to resize, or tap empty space to deselect.";
    }
    if (this._mode === "points") return "Tap a room to add a point. Tap a point to select it.";
    if (this._mode === "furniture") return "Tap furniture to select it, or add one.";
    const L = LAYERS[this._tool];
    return L ? `Drag on the map to draw: ${this.ctx.t(...L.t)}. Tap an object to select it.` : "";
  }

  _addBar() {
    const c = this.ctx;
    const layers = this._layers();
    const btn = (layer, label, icon, run) => html`<button @click=${run}>
      <ha-icon icon=${icon}></ha-icon>${label}${this._draft?.[layer] ? html` <span class="count">${this._draft[layer].length}</span>` : nothing}
    </button>`;
    const buttons = [];
    for (const layer of layers) {
      const L = LAYERS[layer];
      if (layer === "furniture") {
        buttons.push(html`<button @click=${() => (this._picker = { action: "add" })}><ha-icon icon=${L.icon}></ha-icon>${c.t(...L.t)}</button>`);
      } else if (layer === "point") {
        buttons.push(
          html`<button ?disabled=${this._draft?.point.length >= MAX_POINTS} @click=${() => this._add("point")}>
            <ha-icon icon=${L.icon}></ha-icon>${c.t("action", "add", "Add")}
            <span class="count">${this._draft?.point.length || 0}/${MAX_POINTS}</span>
          </button>`
        );
      } else {
        buttons.push(btn(layer, c.t(...L.t), L.icon, () => this._add(layer, layer === "carpet" ? { ellipse: 0 } : {})));
        if (layer === "carpet" && c.can("carpet_shape")) {
          buttons.push(
            html`<button @click=${() => this._add("carpet", { ellipse: 1 })}>
              <ha-icon icon="mdi:circle-outline"></ha-icon>${c.t("action", "round_carpet", "Round carpet")}
            </button>`
          );
        }
      }
    }
    return html`<div class="bar">${buttons}</div>`;
  }

  _selBar() {
    const c = this.ctx;
    const s = this._sel;
    const items = [];
    if (s?.layer === "detected") {
      items.push(html`<button @click=${() => this._overrideDetected()}>
        <ha-icon icon="mdi:select-remove"></ha-icon>${c.t("action", "delete_carpet", "Delete carpet")}</button>`);
    } else if (s) {
      const item = this._draft[s.layer]?.[s.index];
      if (!item) return nothing;
      if (s.layer === "carpet" && c.can("carpet_shape")) {
        items.push(html`<button @click=${() => ((item.ellipse = item.ellipse ? 0 : 1), this._touch())}>
          <ha-icon icon=${item.ellipse ? "mdi:square-outline" : "mdi:circle-outline"}></ha-icon>
          ${item.ellipse ? c.t("action", "square_carpet", "Square carpet") : c.t("action", "round_carpet", "Round carpet")}
        </button>`);
      }
      if (s.layer === "furniture") {
        const rot = (d) => () => {
          item.g[4] = (((item.g[4] || 0) + d) % 360 + 360) % 360;
          item.changed = true;
          this._touch();
        };
        items.push(
          html`<button @click=${() => (this._picker = { action: "change" })}><ha-icon icon="mdi:swap-horizontal"></ha-icon>${this._furnitureName(item.type)}</button>`,
          html`<button class="icon" title=${c.t("action", "rotate_left", "Rotate left")} @click=${rot(-90)}><ha-icon icon="mdi:rotate-left"></ha-icon></button>`,
          html`<button class="icon" title=${c.t("action", "rotate_right", "Rotate right")} @click=${rot(90)}><ha-icon icon="mdi:rotate-right"></ha-icon></button>`
        );
      }
      items.push(html`<button @click=${() => this._deleteSelected()}><ha-icon icon="mdi:delete-outline"></ha-icon>${c.t("action", "delete", "Delete")}</button>`);
    }
    return html`<div class="bar">
      ${items}
      <span class="spacer"></span>
      ${this._dirty ? html`<span class="dirty">Unsaved changes</span>` : nothing}
    </div>`;
  }

  _renderPicker() {
    if (!this._picker) return nothing;
    const c = this.ctx;
    const pick = (type) => {
      if (this._picker.action === "add") this._addFurniture(type);
      else {
        const item = this._draft.furniture[this._sel?.index];
        if (item) {
          item.type = type;
          item.changed = true;
          this._touch();
        }
      }
      this._picker = null;
    };
    return html`<doc-sheet open heading=${c.t("title", "add_furniture", "Add furniture")} @closed=${() => (this._picker = null)}>
      <div class="furn-grid">
        ${this._furnitureTypes().map((t) => html`<button @click=${() => pick(t)}>${this._furnitureName(t)}</button>`)}
      </div>
    </doc-sheet>`;
  }
}

customElements.get("doc-object-edit") || customElements.define("doc-object-edit", ObjectEdit);

// Exported for payload tests.
export { MODES, LAYERS, FURNITURE, uniformAreas, MIN_SHAPE_MM };
