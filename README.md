# BC Toolbox

Chrome extension (Manifest V3) for the web game **Bondage Club**: look up people you've
met, log chat, and browse your captured history — rebuilt from the ground up in
TypeScript. Successor to the old `bctoolbox` project; unlike the old version it hooks the
game itself via [bondage-club-mod-sdk](https://www.npmjs.com/package/bondage-club-mod-sdk)
instead of piggybacking on another extension's traffic.

## Features

- **Member profiles** — appearance snapshots, stats, bio, worn items (with crafted-item
  makers), skills, reputation, addon detection, name and relationship history
- **Auto tags** — Owner / Lover / Submissive / Friend / Whitelist / Blacklist / Ghosted,
  derived from your character's own relationship lists, alongside your manual tags & notes
- **Chat logging** — full room transcripts (as the game rendered them), whisper history
  per member, bookmarks, and beep conversations
- **Relationships graph** — the owner/lover/sub family network, with path finding
- **Wardrobe suite** — point-in-time wardrobe snapshots (incl. WCE extended slots),
  outfit previews, and a crafts browser
- **In-game overlay** — a BCT panel on the profile sheet showing what you know about a
  character, styled to match Themed when present
- **Search** — across members, chat, beeps, and notes
- **Alerts** — keyword pings and friend-online notifications, with a one-click busy mode
  to mute them all
- **Cheats** (opt-in) — money/skill/reputation editing and lock-password reveal, applied
  through the game's own change functions
- **Backups** — export/import of the whole database, with optional automatic backups

## Stack

- **TypeScript** everywhere, with [bc-stubs](https://www.npmjs.com/package/bc-stubs)
  providing typed game globals for the page-world code and
  [bc-data](https://www.npmjs.com/package/bc-data) for asset metadata
- **Vue 3 + Vite + Tailwind CSS 4** for the full-tab UI
- **Dexie** (IndexedDB) for storage, **Pinia** for UI state

## Architecture

```
game page (MAIN world)          extension origin
┌──────────────────────┐
│ injected.js          │  window.postMessage   ┌────────────────────┐
│  mod "BCToolbox"     │ ◄──────────────────►  │ content.js (relay) │
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
  (appearance capture, throttled), and draws the in-game overlay. Compiled against
  bc-stubs.
- `src/content/` — thin relay between page `postMessage` envelopes and a
  `chrome.runtime` port, with reconnect handling for service-worker sleep.
- `src/background/` — service worker. `capture.ts` turns game events into database
  writes (members, chat, channels, beeps, seen-tracking, play sessions) and fires
  notifications; `state.ts` tracks per-tab session state (mirrored to
  `chrome.storage.session` so SW restarts don't drop recording); `main.ts` routes
  ports and the UI API.
- `src/ui/` — the Vue app. Reads the database directly (same extension origin as the
  service worker) and uses the background API only for live-game queries and tab
  status.
- `src/popup/` — the toolbar popup: capture status, pause toggle, busy mode.
- `src/shared/` — the single typed message protocol (`protocol.ts`), database record
  types (`records.ts`), and the Dexie schema (`db.ts`).

## Database

IndexedDB `bc-toolbox`, via Dexie:

| Table               | Keys/indexes                               | Contents                                 |
| ------------------- | ------------------------------------------ | ---------------------------------------- |
| `members`           | `memberNumber`, `isPlayer`, `name`         | Captured character profiles + appearance |
| `chat`              | `++id`, `channelId`, `[channelId+created]` | Chat/Emote/Activity/Whisper/Action lines |
| `chatChannels`      | `++id`, `sessionId`                        | One row per room visit                   |
| `memberSeen`        | `++id`, unique `[member+viewer]`           | First/last seen per member per character |
| `playerSessions`    | `++id`, `sessionId`, `member`              | One row per login session                |
| `beeps`             | `++id`, `viewer`, `[viewer+member]`        | Sent/received beeps with metadata        |
| `notes`             | `++id`, unique `[member+viewer]`           | Personal notes and tags per member       |
| `bookmarks`         | `++id`, unique `[viewer+chatId]`           | Starred chat lines                       |
| `wardrobeSnapshots` | `++id`, `member`, `taken`                  | Point-in-time wardrobe copies            |

## Development

```sh
yarn install
yarn build        # one-shot build into dist/
yarn dev          # watch mode (rebuilds all bundles on change)
yarn type-check   # vue-tsc across all three project configs
yarn lint         # eslint --fix
```

Load `dist/` as an unpacked extension at `chrome://extensions` (Developer mode →
"Load unpacked"). After changes, the extension needs a reload there; game tabs need a
refresh to re-inject.

`scripts/manifest.mjs` is the single source of truth for game domains; watch/dev
builds get the dev origins appended and the name suffixed with "(Dev)".

### Firefox

`yarn build:firefox` additionally writes `dist-firefox/` — same files, gecko
manifest (Firefox MV3 uses a background event page instead of a service
worker). Load via `about:debugging` → "Load Temporary Add-on". Caveats: Firefox
treats MV3 host permissions as opt-in, so grant site access in the extension's
Permissions settings or capture silently won't run; Firefox support has not
been battle-tested the way Chrome has.

## Versioning

[Semver](https://semver.org/): **major** = breaking change to the database schema or backup
format without migration, **minor** = new features, **patch** = fixes. `package.json` is the
single source of truth — the manifest version and the in-app/mod version constants are all
generated from it at build time.

Cut a release with `yarn release:patch|minor|major` — this bumps the version, makes the
version commit + git tag (`vX.Y.Z`), and rebuilds `dist/`. Note Chrome manifests don't
allow pre-release suffixes (`-beta` etc.), so plain `X.Y.Z` only.
