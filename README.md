# BC Toolbox

Chrome extension (Manifest V3) for the web game **Bondage Club**: look up people you've
met, log chat, and browse your captured history — rebuilt from the ground up in
TypeScript. Successor to the old `bctoolbox` project; unlike the old version it hooks the
game itself via [bondage-club-mod-sdk](https://www.npmjs.com/package/bondage-club-mod-sdk)
instead of piggybacking on another extension's traffic.

## Stack

- **TypeScript** everywhere, with [bc-stubs](https://www.npmjs.com/package/bc-stubs)
  providing typed game globals for the page-world code and
  [bc-data](https://www.npmjs.com/package/bc-data) for asset metadata
- **Vue 3 + Vite + Tailwind CSS 4 + Reka UI** for the full-tab UI
- **Dexie** (IndexedDB) for storage, **Pinia** for UI state

## Architecture

```
game page (MAIN world)          extension origin
┌──────────────────────┐
│ injected.js          │  window.postMessage   ┌────────────────────┐
│  bcModSdk mod "BCT"  │ ◄──────────────────►  │ content.js (relay) │
│  ServerSocket capture│      envelopes        └─────────┬──────────┘
│  appearance capture  │                                 │ chrome.runtime port
└──────────────────────┘                                 ▼
                                               ┌────────────────────┐
┌──────────────────────┐   direct Dexie/IDB    │ background.js (SW) │
│ index.html (Vue UI)  │ ◄──────────────────►  │  capture → Dexie   │
│  reads the database  │      shared origin    │  tab/session state │
└──────────────────────┘ ◄──────────────────►  └────────────────────┘
                          chrome.runtime API
                          (live-game queries)
```

- `src/injected/` — page-world mod. Registers with the Mod SDK (coexists with
  FBC/BCX/LSCG…), attaches `onAny`/`prependAnyOutgoing` listeners to `ServerSocket`,
  hooks `LoginResponse` (session detection) and `CommonDrawAppearanceBuild`
  (appearance PNG capture, throttled). Compiled against bc-stubs.
- `src/content/` — thin relay between page `postMessage` envelopes and a
  `chrome.runtime` port, with reconnect handling for service-worker sleep.
- `src/background/` — service worker. `capture.ts` turns game events into database
  writes (members, chat, channels, seen-tracking, play sessions); `state.ts` tracks
  per-tab session state (mirrored to `chrome.storage.session` so SW restarts don't
  drop recording); `main.ts` routes ports and the UI API.
- `src/ui/` — the Vue app. Reads the database directly (same extension origin as the
  service worker) and uses the background API only for live-game queries and tab
  status.
- `src/shared/` — the single typed message protocol (`protocol.ts`), database record
  types (`records.ts`), and the Dexie schema (`db.ts`).

## Database

IndexedDB `bc-toolbox`, via Dexie:

| Table            | Keys/indexes                                     | Contents                                    |
| ---------------- | ------------------------------------------------ | ------------------------------------------- |
| `members`        | `memberNumber`, `isPlayer`, `name`               | Captured character profiles + appearance    |
| `chat`           | `++id`, `channelId`, `[channelId+created]`       | Chat/Emote/Activity/Whisper/Action lines    |
| `chatChannels`   | `++id`, `sessionId`                              | One row per room visit                      |
| `memberSeen`     | `++id`, unique `[member+viewer]`                 | First/last seen per member per character    |
| `playerSessions` | `++id`, `sessionId`, `member`                    | One row per login session                   |

## Development

```sh
yarn install
yarn build        # one-shot build into dist/
yarn dev          # watch mode (rebuilds all bundles on change)
yarn type-check   # vue-tsc across all three project configs
```

Load `dist/` as an unpacked extension at `chrome://extensions` (Developer mode →
"Load unpacked"). After changes, the extension needs a reload there; game tabs need a
refresh to re-inject.

`scripts/manifest.mjs` is the single source of truth for game domains; watch/dev
builds get the dev origins appended and the name suffixed with "(Dev)".

## Status / roadmap

Core capture loop and browsing UI are in place. Not yet ported from the old system:

- Faithful chat-log templating of Action/Activity lines (the old 10.7k-line hand
  copied dictionary is intentionally gone; plan is to generate game text at build
  time from the game's data files + bc-data)
- Relationships graph (owner/lover network), wardrobe viewer, beeps/friends pages
- Database import/restore
