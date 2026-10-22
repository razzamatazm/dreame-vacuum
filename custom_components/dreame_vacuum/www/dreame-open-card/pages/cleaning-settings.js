/*
 * Cleaning Settings (doc-cleaning-settings): global cleaning parameters.
 *
 * Also exports small helpers shared by the other cleaning/dock pages:
 *   taskLock(ctx)      -> "scheduled" | "shortcut" | "cleangenius" | null
 *   cleanGeniusOn(ctx) -> bool
 *   navRow(...)        -> clickable row template + navRowStyles
 *
 * Backing API (integration source):
 *   select.cleangenius / cleangenius_mode, select.suction_level, water_volume,
 *   mop_pad_humidity (self-wash models), number.wetness_level, select.cleaning_mode,
 *   cleaning_route, auto_recleaning, switch.max_suction_power, switch.customized_cleaning.
 *   vacuum attrs: started, shortcut_task, cleangenius_cleaning (true when the
 *   CleanGenius setting is active, device.py), startup_method ("Scheduled Activation",
 *   "Through App", ... from StartupMethod names).
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import { entityRows, hasAny } from "../components.js";

/** Why settings are locked right now, or null. DVC: scheduled, shortcut and CleanGenius tasks use their own settings. */
export function taskLock(ctx) {
  const a = ctx.attrs;
  if (!a.started) return null;
  if (a.shortcut_task) return "shortcut";
  if (/scheduled/i.test(String(a.startup_method || ""))) return "scheduled";
  if (a.cleangenius_cleaning) return "cleangenius";
  return null;
}

/** CleanGenius setting enabled (select.cleangenius != off), falling back to the vacuum attribute. */
export function cleanGeniusOn(ctx) {
  const s = ctx.st("select", "cleangenius");
  if (s) return s.state !== "off" && s.state !== "unavailable" && s.state !== "unknown";
  return !!ctx.attrs.cleangenius_cleaning;
}

/** Banner text for a task lock. */
export function lockText(ctx, lock) {
  const what = {
    scheduled: ctx.t("title", "scheduled_task", "Scheduled Task"),
    shortcut: ctx.t("title", "shortcut_task", "Shortcut Task"),
    cleangenius: "CleanGenius",
  }[lock];
  return `${ctx.t("message", "active_task", "Vacuum has active task!")} ${what}: ${ctx.t(
    "message",
    "not_available",
    "Not available right now..."
  )}`;
}

export const navRowStyles = css`
  .nav {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    min-height: 32px;
    cursor: pointer;
    user-select: none;
  }
  .nav:hover {
    background: var(--doc-surface-2);
  }
  .nav .text {
    flex: 1;
    min-width: 0;
  }
  .nav .secondary {
    font-size: 0.85em;
    color: var(--doc-muted);
  }
  .nav ha-icon.lead {
    color: var(--state-icon-color, var(--doc-muted));
  }
  .banner {
    margin: 8px 16px;
    padding: 10px 12px;
    border-radius: var(--doc-radius);
    background: color-mix(in srgb, var(--doc-warn) 18%, transparent);
    border: 1px solid var(--doc-warn);
    font-size: 0.9em;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .note {
    margin: 4px 16px 8px;
    font-size: 0.85em;
    color: var(--doc-muted);
  }
`;

/** Clickable navigation row. */
export function navRow(icon, label, secondary, onClick) {
  return html`<div
    class="nav"
    role="button"
    tabindex="0"
    @click=${onClick}
    @keydown=${(e) => (e.key === "Enter" || e.key === " ") && onClick()}
  >
    <ha-icon class="lead" icon=${icon}></ha-icon>
    <div class="text">
      <div>${label}</div>
      ${secondary ? html`<div class="secondary">${secondary}</div>` : nothing}
    </div>
    <ha-icon icon="mdi:chevron-right"></ha-icon>
  </div>`;
}

const BASIC = [
  "select.suction_level",
  "switch.max_suction_power",
  "select.water_volume",
  "select.mop_pad_humidity",
  "number.wetness_level",
  "select.cleaning_mode",
  "select.cleaning_route",
  "select.auto_recleaning",
];

class CleaningSettings extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false } };
  static styles = [
    base,
    navRowStyles,
    css`
      .locked {
        opacity: 0.5;
        pointer-events: none;
      }
    `,
  ];

  render() {
    const c = this.ctx;
    if (!c) return nothing;
    const lock = taskLock(c);
    const cg = cleanGeniusOn(c);
    const hasCg = !!c.ent("select", "cleangenius");
    const custom = c.st("switch", "customized_cleaning");
    const roomsHaveSettings = c.rooms().some((r) => c.roomEnt("select", "suction_level", r.id));
    // DVC: on CleanGenius models the sequence lives in the main menu; elsewhere it is listed here.
    const showSequence =
      !hasCg && (c.ent("switch", "cleaning_sequence") || Array.isArray(c.attrs.cleaning_sequence) || c.rooms().some((r) => c.roomEnt("select", "order", r.id)));

    return html`<doc-page .ctx=${c} heading=${c.t("action", "cleaning_settings", "Cleaning settings")}>
      ${lock ? html`<div class="banner"><ha-icon icon="mdi:lock-outline"></ha-icon>${lockText(c, lock)}</div>` : nothing}
      <div class=${lock ? "locked" : ""} ?inert=${!!lock}>
        ${hasCg
          ? html`<doc-section heading="CleanGenius">
              ${entityRows(c, ["select.cleangenius", ...(cg ? ["select.cleangenius_mode"] : [])])}
              ${cg
                ? html`<div class="note">
                    ${c.t("message", "settings_will_applied", "Your settings will be applied at the next task.")}
                  </div>`
                : nothing}
            </doc-section>`
          : nothing}
        ${!cg && hasAny(c, BASIC)
          ? html`<doc-section>
              ${entityRows(c, BASIC)}
              ${custom?.state === "on"
                ? html`<div class="note">
                    ${c.t("title", "customized_cleaning", "Customized Cleaning")}: room settings override these for room cleaning.
                  </div>`
                : nothing}
            </doc-section>`
          : nothing}
        ${!cg && (custom || roomsHaveSettings || showSequence)
          ? html`<doc-section heading=${c.t("title", "customized_cleaning", "Customized Cleaning")}>
              ${entityRows(c, ["switch.customized_cleaning"])}
              ${roomsHaveSettings
                ? navRow(
                    "mdi:home-edit-outline",
                    c.t("title", "customized_cleaning", "Customized Cleaning"),
                    c.t("action", "rooms", "Rooms"),
                    () => c.navigate("room-cleaning")
                  )
                : nothing}
              ${showSequence
                ? navRow(
                    "mdi:order-numeric-ascending",
                    c.t("title", "cleaning_sequence", "Cleaning Sequence"),
                    "",
                    () => c.navigate("cleaning-sequence")
                  )
                : nothing}
            </doc-section>`
          : nothing}
      </div>
    </doc-page>`;
  }
}

customElements.get("doc-cleaning-settings") || customElements.define("doc-cleaning-settings", CleaningSettings);
