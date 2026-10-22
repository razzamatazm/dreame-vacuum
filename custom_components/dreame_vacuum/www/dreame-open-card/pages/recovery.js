/*
 * Map Recovery (doc-recovery), params { mapIndex }.
 *
 * Entries come from the saved-map camera of that index (or the live camera for
 * the active map): recovery_map_picture / recovery_map_file, keyed
 * "<date>: Map<N> (<type>)". N is the 1-based position in the map's
 * recovery_map_list and is exactly what vacuum_restore_map expects as
 * recovery_map_index (device.py restore_map uses recovery_map_list[index - 1]).
 */
import { LitElement, html, css, nothing, base } from "../core.js";
import { savedMaps, mapName, recoveryMaps } from "./maps.js";

class Recovery extends LitElement {
  static properties = { ctx: { attribute: false }, params: { attribute: false }, _view: { state: true } };
  static styles = [
    base,
    css`
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
      }
      .thumb {
        width: 72px;
        height: 54px;
        flex: none;
        border-radius: 6px;
        object-fit: contain;
        background: var(--doc-surface-2);
      }
      .text {
        flex: 1;
        min-width: 0;
      }
      .secondary {
        font-size: 0.85em;
        color: var(--doc-muted);
      }
      .empty {
        padding: 24px 16px;
        text-align: center;
      }
      .full img {
        width: 100%;
        display: block;
        background: var(--doc-surface-2);
      }
      .full .row {
        padding: 8px 16px;
        justify-content: flex-end;
      }
      a.dl {
        display: inline-flex;
        color: inherit;
        padding: 6px;
        border-radius: 50%;
      }
    `,
  ];

  get _map() {
    return savedMaps(this.ctx).find((m) => Number(m.index) === Number(this.params?.mapIndex ?? this.ctx.attrs.selected_map_index));
  }

  render() {
    const c = this.ctx;
    const m = this._map;
    const items = m ? recoveryMaps(c, m.index) : [];
    const title = c.t("title", "recovery_map_list", "Map Recovery");
    return html`<doc-page .ctx=${c} heading=${m ? `${title} - ${mapName(c, m)}` : title}>
      ${m && c.can("backup_map")
        ? html`<button slot="actions" class="icon" title=${c.t("action", "backup", "Backup")} @click=${() => this._backup(m)}>
            <ha-icon icon="mdi:cloud-upload"></ha-icon>
          </button>`
        : nothing}
      ${items.length
        ? items.map(
            (r) => html`<doc-list-item
              clickable
              @item-click=${() => (this._view = r)}
              .actions=${[{ label: c.t("action", "restore", "Restore"), icon: "mdi:restore", run: () => this._restore(m, r) }]}
            >
              <div class="item">
                ${r.picture ? html`<img class="thumb" src=${c.url(r.picture)} alt="" />` : nothing}
                <div class="text">
                  <div>${r.type} <span class="muted">#${r.index}</span></div>
                  <div class="secondary">${r.date}</div>
                </div>
                <button
                  class="icon"
                  title=${c.t("action", "restore_map", "Restore Map")}
                  @pointerdown=${(e) => e.stopPropagation()}
                  @click=${(e) => (e.stopPropagation(), this._restore(m, r))}
                >
                  <ha-icon icon="mdi:restore"></ha-icon>
                </button>
              </div>
            </doc-list-item>`
          )
        : html`<div class="empty muted">-</div>`}
      ${this._renderView(m)}
    </doc-page>`;
  }

  _renderView(m) {
    const c = this.ctx;
    const r = this._view;
    if (!r) return nothing;
    return html`<doc-sheet open heading=${`${r.type} - ${r.date}`} @closed=${() => (this._view = null)}>
      ${r.file
        ? html`<a slot="actions" class="dl" href=${c.url(r.file)} download title=${c.t("action", "download", "Download")}>
            <ha-icon icon="mdi:download"></ha-icon>
          </a>`
        : nothing}
      <div class="full">
        ${r.picture ? html`<img src=${c.url(r.picture)} alt="" />` : nothing}
        <div class="row">
          <button class="primary" @click=${() => this._restore(m, r)}>
            <ha-icon icon="mdi:restore"></ha-icon>${c.t("action", "restore_map", "Restore Map")}
          </button>
        </div>
      </div>
    </doc-sheet>`;
  }

  async _restore(m, r) {
    const c = this.ctx;
    this._view = null;
    const ok = await c.confirm({
      title: c.t("message", "restore_map", "Restore %name%?").replace("%name%", mapName(c, m)),
      text: c.t("message", "map_will_restored", "Saved map will be restored to the state at %date%").replace("%date%", r.date),
      confirmText: c.t("action", "restore", "Restore"),
      destructive: true,
    });
    if (!ok) return;
    if (await c.vac("vacuum_restore_map", { recovery_map_index: r.index, map_id: Number(m.id) }))
      c.toast(c.t("message", "map_recovery", "Map recovery in progress"));
  }

  async _backup(m) {
    const c = this.ctx;
    const ok = await c.confirm({
      title: c.t("message", "backup_map", "Backup Map?"),
      text: c.t("message", "backup_map_will_overwritten", "Current backed up map will be overwritten!"),
      confirmText: c.t("action", "backup", "Backup"),
    });
    if (!ok) return;
    if (await c.vac("vacuum_backup_map", { map_id: Number(m.id) })) c.toast(c.t("message", "map_backup", "Map backup in progress"));
  }
}

customElements.get("doc-recovery") || customElements.define("doc-recovery", Recovery);
