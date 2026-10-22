/*
 * <doc-history> Cleaning History / Cruising History (params.cruising).
 *
 * Data sources (all public integration output):
 *   map.cleaning_history_picture / map.cruising_history_picture
 *     { "<index>: <date> - [Second ]<Status> (Completed|Interrupted)": "/api/camera_history_map_proxy/<cam>?token=..&index=N&v=<unix ts>" }
 *     built by camera.py get_key(); index 1 is the newest task.
 *   sensor.cleaning_history / sensor.cruising_history attributes
 *     { "<date>": { timestamp, cleaned_area: "42 m²", cleaning_time: "51 min", completed,
 *                   blocked_rooms?, cleanup_method?, interrupt_reason?, multiple_cleaning_time? } }
 *     (device.py DreameVacuumDeviceStatus.cleaning_history). Joined to the picture list by timestamp.
 */
import { LitElement, html, css, nothing, base, prettify } from "../core.js";
import "../components.js";

// ---- helpers shared with history-details.js --------------------------------

/** Translation from the integration's entity strings, e.g. ent(ctx, "sensor.startup_method", "app"). */
export function entLabel(ctx, path, value, fallback) {
  if (value == null || value === "") return fallback ?? "-";
  const [domain, key] = path.split(".");
  const v = ctx.hass.localize?.(`component.dreame_vacuum.entity.${domain}.${key}.state.${value}`);
  return v || fallback || prettify(value);
}

/** Read `name` query param from a relative URL. */
export function urlParam(url, name) {
  try {
    return new URL(url, "http://x").searchParams.get(name);
  } catch {
    return null;
  }
}

const KEY_RE = /^(\d+):\s*(.+?)\s+-\s+(Second\s+)?(.+?)\s*\((Completed|Interrupted)\)\s*$/;

/** Parse one picture-attribute key/url pair into a history entry. */
export function parseEntry(key, url) {
  const m = String(key).match(KEY_RE);
  const v = Number(urlParam(url, "v"));
  const idx = Number(urlParam(url, "index"));
  const e = {
    key,
    url,
    index: m ? Number(m[1]) : idx || 0,
    dateText: m ? m[2] : "",
    second: !!m?.[3],
    statusName: m ? m[4] : key,
    status: m ? m[4].trim().toLowerCase().replace(/\s+/g, "_") : "unknown",
    completed: m ? m[5] === "Completed" : true,
    ts: v || null,
  };
  if (!e.index && idx) e.index = idx;
  return e;
}

/** All entries of the cleaning or cruising list, newest first (index 1 = newest). */
export function historyEntries(ctx, cruising) {
  const pics = ctx.mapAttrs[cruising ? "cruising_history_picture" : "cleaning_history_picture"] || {};
  const sensor = ctx.st("sensor", cruising ? "cruising_history" : "cleaning_history");
  const byTs = new Map();
  for (const [k, a] of Object.entries(sensor?.attributes || {})) {
    if (a && typeof a === "object" && a.timestamp != null) byTs.set(Math.floor(Number(a.timestamp)), { ...a, _date: k });
  }
  return Object.entries(pics)
    .map(([k, u]) => {
      const e = parseEntry(k, u);
      e.info = e.ts != null ? byTs.get(e.ts) : undefined;
      return e;
    })
    .sort((a, b) => a.index - b.index);
}

/** Localized date/time of an entry. */
export function entryDate(ctx, e, opts = {}) {
  if (!e?.ts) return e?.dateText || "";
  const d = new Date(e.ts * 1000);
  const lang = ctx.hass.locale?.language || ctx.hass.language;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const h12 = ctx.hass.locale?.time_format === "12" ? true : ctx.hass.locale?.time_format === "24" ? false : undefined;
  return d.toLocaleString(lang, {
    weekday: opts.weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: h12,
  });
}

export const statusText = (ctx, e) => entLabel(ctx, "sensor.status", e.status, e.statusName);

const num = (s) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Group related consecutive tasks (second cleaning / CleanGenius recleaning).
 * A "Second" entry is the follow-up of the next older entry; entries sharing a
 * non-empty multiple_cleaning_time also belong together. Each group is ordered
 * oldest first, groups newest first (as DVC does).
 */
export function groupEntries(list) {
  const groups = [];
  let i = 0;
  while (i < list.length) {
    const g = [list[i]];
    while (i + 1 < list.length) {
      const cur = list[i];
      const next = list[i + 1];
      const multi = cur.info?.multiple_cleaning_time;
      const related = cur.second || (multi != null && multi !== "" && multi === next.info?.multiple_cleaning_time);
      if (!related) break;
      g.push(next);
      i++;
    }
    groups.push(g.reverse());
    i++;
  }
  return groups;
}

// ---------------------------------------------------------------------------

class DocHistory extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false } };
  static styles = [
    base,
    css`
      .totals {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        padding: 4px 16px 12px;
        text-align: center;
      }
      .total .v {
        font-size: 1.25em;
        font-weight: 500;
      }
      .total .l,
      .since {
        font-size: 0.8em;
        color: var(--doc-muted);
      }
      .since {
        text-align: center;
        margin: -6px 16px 8px;
      }
      .group {
        margin: 6px 12px;
        border: 1px solid var(--doc-divider);
        border-radius: var(--doc-radius);
        overflow: hidden;
      }
      .group.single {
        border-color: transparent;
        margin: 0 12px;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 4px 10px 8px;
      }
      .group:not(.single) doc-list-item + doc-list-item {
        border-top: 1px solid var(--doc-divider);
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex: none;
        background: var(--success-color, #43a047);
      }
      .dot.orange {
        background: var(--doc-warn);
      }
      .dot.red {
        background: var(--doc-error);
      }
      .text {
        flex: 1;
        min-width: 0;
      }
      .title {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .sub {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      .badge {
        font-size: 0.75em;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--doc-surface-2);
        color: var(--doc-muted);
      }
      .empty {
        padding: 32px 16px;
        text-align: center;
        color: var(--doc-muted);
      }
      .chev {
        color: var(--doc-muted);
      }
    `,
  ];

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const cruising = !!this.params?.cruising;
    const heading = cruising
      ? c.t("title", "cruising_history", "Cruising History")
      : c.t("title", "cleaning_history", "Cleaning History");
    if (cruising && !c.can("camera_streaming")) {
      return html`<doc-page .ctx=${c} heading=${heading}><div class="empty">Cruising is not supported by this robot.</div></doc-page>`;
    }
    const list = historyEntries(c, cruising);
    const groups = cruising ? list.map((e) => [e]) : groupEntries(list);
    return html`<doc-page .ctx=${c} heading=${heading}>
      ${cruising ? nothing : this._totals()}
      ${list.length
        ? groups.map(
            (g) => html`<div class="group ${g.length > 1 ? "" : "single"}">${g.map((e) => this._item(e, cruising))}</div>`
          )
        : html`<div class="empty">No history yet</div>`}
    </doc-page>`;
  }

  _totals() {
    const c = this.ctx;
    const val = (key) => {
      const s = c.st("sensor", key);
      return s && s.state !== "unavailable" && s.state !== "unknown" ? s.state : null;
    };
    const area = val("total_cleaned_area");
    const time = val("total_cleaning_time");
    const count = val("cleaning_count");
    if (area == null && time == null && count == null) return nothing;
    const first = val("first_cleaning_date");
    const label = (key, fb) => (c.ent("sensor", key) ? c.name(c.ent("sensor", key)) : fb);
    let firstText = first;
    if (first) {
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(first) ? `${first}T00:00:00` : first);
      if (!isNaN(d)) firstText = d.toLocaleDateString(c.hass.locale?.language, { year: "numeric", month: "short", day: "numeric" });
    }
    return html`<div class="totals">
        <div class="total"><div class="v">${c.area(area)}</div><div class="l">${label("total_cleaned_area", "Total area")}</div></div>
        <div class="total"><div class="v">${c.duration(time)}</div><div class="l">${label("total_cleaning_time", "Total time")}</div></div>
        <div class="total"><div class="v">${count ?? "-"}</div><div class="l">${label("cleaning_count", "Cleanings")}</div></div>
      </div>
      ${first ? html`<div class="since">${label("first_cleaning_date", "First cleaning")}: ${firstText}</div>` : nothing}`;
  }

  _item(e, cruising) {
    const c = this.ctx;
    const i = e.info || {};
    const blocked = i.blocked_rooms && Object.keys(i.blocked_rooms).length;
    const dot = !e.completed ? "red" : blocked ? "orange" : "";
    const area = num(i.cleaned_area);
    const time = num(i.cleaning_time ?? i.cruising_time);
    const sub = [cruising ? null : area != null ? c.area(area) : null, time != null ? c.duration(time) : null]
      .filter(Boolean)
      .join(" · ");
    const genius = String(i.cleanup_method || "").toLowerCase() === "cleangenius";
    return html`<doc-list-item clickable @item-click=${() => c.navigate("history-details", { index: e.index, cruising })}>
      <div class="item">
        <span
          class="dot ${dot}"
          title=${!e.completed ? entLabel(c, "sensor.cleaning_status", "interrupted", "Interrupted") : blocked ? "Blocked rooms" : ""}
        ></span>
        <div class="text">
          <div class="title">
            <span>${entryDate(c, e)}</span>
            ${e.second ? html`<span class="badge">${entLabel(c, "sensor.startup_method", "second_cleaning", "Second cleaning")}</span>` : nothing}
            ${genius ? html`<span class="badge">CleanGenius</span>` : nothing}
          </div>
          <div class="sub">${statusText(c, e)}${sub ? ` · ${sub}` : ""}</div>
        </div>
        <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
      </div>
    </doc-list-item>`;
  }
}

customElements.get("doc-history") || customElements.define("doc-history", DocHistory);
