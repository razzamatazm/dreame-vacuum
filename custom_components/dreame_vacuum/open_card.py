"""Serve and register the license-free Dreame Open Card."""

from __future__ import annotations

import hashlib
from pathlib import Path

from homeassistant.core import HomeAssistant

from .const import DOMAIN, LOGGER

CARD_DIR = Path(__file__).parent / "www" / "dreame-open-card"
ENTRY = "card.js"
URL_PREFIX = f"/{DOMAIN}_open/"
DATA_KEY = f"{DOMAIN}_open_card"


def _version() -> str:
    """Content hash of every card file, so any change gets a new URL."""
    digest = hashlib.sha256()
    for path in sorted(CARD_DIR.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(CARD_DIR).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


async def setup(hass: HomeAssistant) -> None:
    """Serve the card modules and add the entry as a Lovelace resource, once per HA start."""
    if hass.data.get(DATA_KEY) or not (CARD_DIR / ENTRY).is_file():
        return
    hass.data[DATA_KEY] = True

    # The version lives in the path rather than a query string, so relative
    # imports between the card's modules are cache-busted along with the entry.
    base_url = f"{URL_PREFIX}{await hass.async_add_executor_job(_version)}"
    url = f"{base_url}/{ENTRY}"

    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths([StaticPathConfig(base_url, str(CARD_DIR), True)])
    except ImportError:
        # Home Assistant before 2024.7
        hass.http.register_static_path(base_url, str(CARD_DIR), True)

    await _register_resource(hass, url)
    _register_websocket(hass)


# Raw device properties the card may read. The vacuum entity only publishes these
# parsed, which loses fields (e.g. schedule status 1 vs 2), so editors read the raw
# value and change only the task being edited.
RAW_PROPERTIES = {"schedule": "SCHEDULE", "dnd_task": "DND_TASK"}


def _register_websocket(hass: HomeAssistant) -> None:
    import voluptuous as vol

    from homeassistant.components import websocket_api
    from homeassistant.core import callback
    from homeassistant.helpers import entity_registry as er

    from .dreame.types import DreameVacuumProperty

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}_open/raw_property",
            vol.Required("entity_id"): str,
            vol.Required("key"): vol.In(list(RAW_PROPERTIES)),
        }
    )
    @callback
    def raw_property(hass: HomeAssistant, connection, msg) -> None:
        entry = er.async_get(hass).async_get(msg["entity_id"])
        coordinator = hass.data.get(DOMAIN, {}).get(entry.config_entry_id) if entry else None
        device = getattr(coordinator, "_device", None)
        if device is None:
            connection.send_error(msg["id"], "not_found", "No dreame_vacuum device for this entity")
            return
        value = device.get_property(DreameVacuumProperty[RAW_PROPERTIES[msg["key"]]])
        connection.send_result(msg["id"], {"value": value})

    websocket_api.async_register_command(hass, raw_property)


async def _register_resource(hass: HomeAssistant, url: str) -> None:
    try:
        from homeassistant.components.lovelace.const import LOVELACE_DATA, MODE_STORAGE
    except ImportError:
        LOVELACE_DATA, MODE_STORAGE = "lovelace", "storage"

    lovelace = hass.data.get(LOVELACE_DATA)
    mode = getattr(lovelace, "resource_mode", getattr(lovelace, "mode", None)) if lovelace else None

    if mode != MODE_STORAGE:
        # YAML dashboards (or Lovelace not loaded yet): load the module on every frontend page.
        from homeassistant.components.frontend import add_extra_js_url

        add_extra_js_url(hass, url)
        return

    try:
        resources = lovelace.resources
        if not resources.loaded:
            await resources.async_load()
            resources.loaded = True
        for item in list(resources.async_items()):
            item_url = item.get("url", "")
            if item_url.startswith(URL_PREFIX) and item_url != url:
                await resources.async_delete_item(item["id"])
        if not any(item.get("url") == url for item in resources.async_items()):
            await resources.async_create_item({"res_type": "module", "url": url})
    except Exception:  # noqa: BLE001
        LOGGER.warning("Could not register Dreame Open Card as a Lovelace resource; add %s manually", url)
