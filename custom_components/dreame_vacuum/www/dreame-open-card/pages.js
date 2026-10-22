/*
 * Page registry. Each page module defines its custom element (tag) when
 * imported. Pages receive `.ctx` (Ctx) and `.params` (object passed to
 * ctx.navigate). Navigate with ctx.navigate("<id>", params).
 */
export const PAGES = {
  home: { tag: "doc-home", load: () => import("./pages/home.js") },

  // Menu destinations
  "cleaning-history": { tag: "doc-history", load: () => import("./pages/history.js") }, // params { cruising?: bool }
  "history-details": { tag: "doc-history-details", load: () => import("./pages/history-details.js") }, // params { index, cruising? }
  accessories: { tag: "doc-accessories", load: () => import("./pages/accessories.js") },
  "cleaning-sequence": { tag: "doc-cleaning-sequence", load: () => import("./pages/cleaning-sequence.js") },
  remote: { tag: "doc-remote", load: () => import("./pages/remote.js") },
  maps: { tag: "doc-maps", load: () => import("./pages/maps.js") },
  "device-settings": { tag: "doc-device-settings", load: () => import("./pages/device-settings.js") }, // params { section? }

  // Action buttons
  "cleaning-settings": { tag: "doc-cleaning-settings", load: () => import("./pages/cleaning-settings.js") },
  "room-cleaning": { tag: "doc-room-cleaning", load: () => import("./pages/room-cleaning.js") }, // params { room? }
  "dock-settings": { tag: "doc-dock-settings", load: () => import("./pages/dock-settings.js") },
  "carpet-settings": { tag: "doc-carpet-settings", load: () => import("./pages/carpet-settings.js") }, // params { carpet }

  // Map management
  "saved-map-edit": { tag: "doc-saved-map-edit", load: () => import("./pages/saved-map-edit.js") }, // params { mapIndex }
  "object-edit": { tag: "doc-object-edit", load: () => import("./pages/object-edit.js") }, // params { mode? }
  recovery: { tag: "doc-recovery", load: () => import("./pages/recovery.js") }, // params { mapIndex }
  "wifi-map": { tag: "doc-wifi-map", load: () => import("./pages/wifi-map.js") },

  // Device settings sub-pages with list editors
  schedule: { tag: "doc-schedule", load: () => import("./pages/schedule.js") },
  dnd: { tag: "doc-dnd", load: () => import("./pages/dnd.js") },
  shortcuts: { tag: "doc-shortcuts", load: () => import("./pages/shortcuts.js") },
};
