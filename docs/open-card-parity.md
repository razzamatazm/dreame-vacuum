# Dreame Open Card: parity checklist

Target: every feature on the paid Dreame Vacuum Card guide (https://dvc.tasshack.com/guide/),
rebuilt clean-room on the integration's public API. Never decrypt or patch the paid card.

Code: `custom_components/dreame_vacuum/www/dreame-open-card/` (served by `open_card.py`).
Dev harness: `node dev/harness/shot.mjs <page> [--fixture ...]` (see the file header).

API shorthand:
- `svc:x` = `dreame_vacuum.x` entity service on the vacuum
- `act:x` = `dreame_vacuum.vacuum_call_action` with `key: x` (public `DreameVacuumDevice.x`, one string arg max)
- `prop:x` = `dreame_vacuum.vacuum_set_property` with `key: x`
- `ent:domain.key` = device entity by translation key (skipped when the model lacks it)
- `vac.attr` / `map.attr` = vacuum / map camera attributes; `mapData` = camera JSON (`ctx.mapData()`, dreame/map.py get_data)
- `ws:raw` = `dreame_vacuum_open/raw_property` websocket command in open_card.py (raw schedule / dnd_task)

Status: `done` / `partial` / `n/a` (not feasible on the public API, with reason). `live-test` marks behavior
that is implemented but depends on a device detail the source doesn't pin down.

## Home screen
| Feature | Backing API | Status |
|---|---|---|
| Live map image | `map.entity_picture` | done |
| Status line: cleaned area, cleaning time, battery (charging / low) | `ent:sensor.cleaned_area/cleaning_time`, `vac.battery/charging` | done |
| Progress bar | `ent:sensor.cleaning_progress` | done |
| Imperial area (ft²), localized time units | `hass.config.unit_system` | done |
| Main menu: Locate, Cleaning/Cruising History, Accessory Usage (badge < 30%), Cleaning Sequence (CleanGenius), Remote Control, Map Management, Device Settings | see sections | done |

## Task types
| Feature | Backing API | Status |
|---|---|---|
| Global cleaning; auto-reset to Global when a task finishes (manual Stop keeps mode) | `vacuum.start` | done |
| Room cleaning in tap order | `svc:vacuum_clean_segment` | done |
| Zone cleaning: multiple zones, draw, move, resize, delete | `svc:vacuum_clean_zone` | done |
| Spot cleaning, 1.5 m squares; spot from obstacle popup | `svc:vacuum_clean_spot` | done |
| Go to point, predefined points | `svc:vacuum_goto`, `map.predefined_points` | done |
| Selector locked during a task; active-task icons (scheduled, shortcut) | `vac.started/segment_cleaning/zone_cleaning/spot_cleaning/cruising/shortcut_task/startup_method` | done |
| Tap furniture/carpet twice → zone of its bounds | `map.furnitures`, `map.carpets` | done |

## Action buttons
| Feature | Backing API | Status |
|---|---|---|
| Cleaning Settings: CleanGenius, suction, water/wetness, mode, route, humidity, re-clean, customized cleaning; locked during scheduled/shortcut/CleanGenius tasks | `ent:select/switch.*` | done |
| Dock Settings: Wash / Dry / Empty tabs (per model, last tab remembered) incl. self-clean frequency/area/time, manual wash/dry/bag dry/empty | `ent:*`, `act:start_washing/pause_washing/start_drying/stop_drying/start_dust_bag_drying/stop_dust_bag_drying`, `ent:button.start_auto_empty` | done |
| Shortcuts sheet: official shortcuts + custom scripts, usable mid-task | `vac.shortcuts`, `svc:vacuum_start_shortcut`, `script.turn_on` | done |
| Maps button | navigates to Map Management | done |
| Repeats (hidden for rooms when customized cleaning is on), Add area | card-local | done |
| Left-handed mode | `left_handed` config | done |

## Controls
| Feature | Backing API | Status |
|---|---|---|
| Clean, Pause, Resume, Stop (also stops wash/dry), Return | `vacuum.*`, `act:toggle_washing/toggle_drying` | done |
| Dock button (orange warning / red error) + Dock Actions: Wash, Dry, Dry Bag, Empty, Return; tank / bag / detergent status | `pages/dock-actions.js` | done |

## Object selection
| Feature | Backing API | Status |
|---|---|---|
| Obstacle bubble → photo sheet, download, ignore / un-ignore, open full size | `map.obstacles`, `map.obstacle_picture` (matched by `index=`), `svc:vacuum_set_obstacle_ignore` | done |
| Carpet bubble → per-carpet settings: customized cleaning, preferences, type, shape, delete, global link | `mapData.carpets` (ids), `svc:vacuum_set_custom_carpet_cleaning/set_carpet_type/set_carpet_area` | done |
| Furniture bubble → edit, zone from bounds | `map.furnitures`, object editor | done |

## Error reporting
| Feature | Backing API | Status |
|---|---|---|
| Error / warning / low-water / temporary-map banners; swipe or close; remembered until the fault changes; auto-clear | `vac.faults/has_error/low_water/has_temporary_map`, `ent:sensor.error` | done |
| Device-level clear on dismiss | `ent:button.clear_warning`, `act:clear_low_water_warning` | done |

## Custom room cleaning
| Feature | Backing API | Status |
|---|---|---|
| Per-room suction / water / repeats / mode / route / humidity / mop temp / pressure, editable any time | room select entities; `svc:vacuum_set_custom_cleaning` when they're unavailable | done |
| Customized cleaning toggle | `ent:switch.customized_cleaning` | done |
| Cleaning sequence: drag (touch + mouse) or up/down, strict vs non-strict | `svc:vacuum_set_cleaning_sequence`, `ent:switch.cleaning_sequence` | done |
| Per-room mop type | room `mop_type` selects, `ent:switch.auto_change_mop` | partial (shown in sequence; edited in Mopping Settings) |

## Map management
| Feature | Backing API | Status |
|---|---|---|
| Map list: multi-floor toggle, create (fast / full mapping), rename, restore, select (confirm, hideable), delete (swipe / long press / right click), thumbnails | `vac.maps`, saved-map cameras, `svc:vacuum_rename_map/select_map/delete_map`, `ent:button.start_fast_mapping/start_mapping` | done |
| Temporary map: save / discard / replace | `svc:vacuum_save/discard/replace_temporary_map` | done |
| Saved map: rotate, backup, recovery list | `ent:select.map_rotation`, `svc:vacuum_backup_map` | done |
| Room name (type or custom), visibility, floor material (+ wood direction), merge (real neighbors), split; bulk save; discard prompt | `svc:vacuum_set_segment_type/set_hidden_segments/set_floor_material/merge_segments/split_segments` | done |
| Walls and doors edit, reset walls | `mapData.walls/doors`, `svc:vacuum_set_walls` | done (saved maps that publish walls) |
| LiDAR / floor-plan display toggle | server-rendered image only | n/a (no per-request render option) |
| Object editing: no-go, no-mop, virtual wall | `svc:vacuum_set_restricted_zone` | done |
| Carpets square / round / deleted overrides | `svc:vacuum_set_carpet_area` | done |
| Passable / impassable thresholds, ramps; virtual thresholds | `svc:vacuum_set_threshold`, `svc:vacuum_set_virtual_threshold` | done |
| Curtains | `svc:vacuum_set_curtain` | done |
| Low-lying areas | `svc:vacuum_set_low_lying_area` | n/a: device.py `set_low_lying_area` always raises NotSupported (display only; DVC also lists it unsupported) |
| Furniture: add with type picker, move, resize, rotate | `svc:vacuum_set_furniture` | done |
| Predefined points | `svc:vacuum_set_predefined_points` | done |
| Recovery list, full view, revert, manual backup, download file | `map.recovery_map_picture/recovery_map_file`, `svc:vacuum_restore_map/backup_map` | done |
| Saved Wi-Fi map, move router, save | Wi-Fi camera (own calibration) or `map.wifi_map_picture`, `svc:vacuum_set_router_position` | done (exact placement needs the Wi-Fi camera entity enabled) |

## History
| Feature | Backing API | Status |
|---|---|---|
| Cleaning history list, status dots (red interrupted, orange blocked rooms), grouping, totals | `map.cleaning_history_picture`, `ent:sensor.cleaning_history/total_*/cleaning_count` | done (dirty-area dot n/a in list: only in per-entry JSON) |
| Cleaning details: area, time, auto-empty / wash counts, status, startup method, prev / next, info sheet, map types, download | history JSON (`&data=1`) | done |
| Clean again | `ent:button.start_recleaning` | partial: re-cleans all blocked rooms; per-room selection not exposed by the integration |
| Cruising history | `map.cruising_history_picture` | done |

## Device settings
| Feature | Backing API | Status |
|---|---|---|
| Scheduled cleanup: list, toggle, edit time + days, new, delete; DnD conflict warning | `vac.schedule`, `ws:raw` + `prop:schedule` (raw merge keeps untouched fields), `act:delete_scheduled_task` | done, live-test (weekday order of `repeats`) |
| Shortcuts: list, run, rename, delete, view tasks, reload | `vac.shortcuts`, `svc:vacuum_start_shortcut/rename_shortcut/delete_shortcut` | done (create: n/a, no API; same as DVC) |
| Audio | `ent:*` | done (voice pack change: n/a, same as DVC) |
| Carpet (global), Mopping, Camera & Obstacle, Battery, More functions | `ent:*` | done |
| DnD: multi-period list or single period, DnD side switches | `vac.dnd`, `ws:raw` + `prop:dnd_task`, `act:delete_dnd_task`, `ent:switch.dnd`, `ent:time.dnd_*` | done, live-test (weekday bit order) |
| Device info: hardware, network (SSID, BSSID, RSSI, IP, MAC), firmware, time zone | `vac.ap`, `vac.firmware_version`, device registry | done (time zone shown is HA's) |

## Other
| Feature | Backing API | Status |
|---|---|---|
| Remote control: two analog sliders, keyboard (WASD/arrows, Shift, Ctrl), haptics, landscape layout, live map, Resume / Return; reverse capped at half speed | `svc:vacuum_remote_control_move_step` | done, live-test (rotation sign) |
| Accessory usage: 17 consumables, % and time left, reset | `ent:sensor.*_left/*_time_left`, `ent:button.reset_*`, `svc:vacuum_reset_consumable` | done |
| Localization | integration `entity_component.frontend_*` + entity translations (40 languages) | done (a few labels without integration keys are English) |
| Advanced config: hidden_card_objects, task_types, shortcut scripts, left-handed | card config + visual editor | done |

## Needs one test on a real robot
1. Schedule `repeats`: which end is Sunday (`REPEATS_SUNDAY_FIRST` in pages/schedule.js).
2. DnD `wk` bit order (`wkToDays` in pages/dnd.js, bit 0 = Sunday assumed).
3. Remote rotation sign (`ROTATE_RIGHT` in pages/remote.js).
4. Furniture `modified` flag semantics (pages/object-edit.js).
