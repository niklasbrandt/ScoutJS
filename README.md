# ScoutJS

[![CI](https://github.com/niklasbrandt/ScoutJS/actions/workflows/ci.yml/badge.svg)](https://github.com/niklasbrandt/ScoutJS/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)
[![Type Safety](https://img.shields.io/badge/types-TypeScript%20(zero--build)-informational.svg)](types.d.ts)

A modular, extensible pipeline and review dashboard for crawling, aggregating, inspecting, and executing automated actions on structured data items.

ScoutJS provides an engine for monitoring data sources, collecting incoming items into a standardized triage inbox, reviewing them through a web dashboard, and dispatching approved records to downstream action workflows (e.g., webhook dispatch, message generation, alerting, or third-party integrations).

---

## Architecture Schemata

```
+-----------------------------------------------------------------------------+
|                                DATA SOURCES                                 |
|       [ Public APIs ]          [ Web Scraping ]          [ Feeds / RSS ]    |
+-----------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------+
|                            SCRAPER PLUGINS LAYER                            |
|                            (plugins/scrapers/)                              |
|                                                                             |
|   +-----------------------+              +------------------------------+   |
|   |   mock_scraper.js     |     ...      |   custom_scraper.js          |   |
|   |   (fetch & normalize) |              |   (fetch & normalize)        |   |
|   +-----------------------+              +------------------------------+   |
|                                       |                                     |
|                       Normalize to Common Item Schema                       |
+---------------------------------------+-------------------------------------+
                                        |
                                        | POST /api/scrape
                                        v
+-----------------------------------------------------------------------------+
|                             SCOUTJS CORE ENGINE                             |
|                                 (server.js)                                 |
|                                                                             |
|      +---------------------------------------------------------------+      |
|      |    Deduplication  ·  Auth Hook (plugins/auth/)                |      |
|      +---------------------------------------------------------------+      |
|                                       |                                     |
|                                       v                                     |
|                 +-------------------------------------------+               |
|                 |   SCOUTSTORE — Targets x Decisions        |               |
|                 |   JsonStore (default) / SqliteStore /     |               |
|                 |   host app's own store (plugins/store/)   |               |
|                 |                                           |               |
|                 |  Item[]  x  Decision{itemId, targetId,    |               |
|                 |             status, note, decidedAt}      |               |
|                 +-------------------------------------------+               |
|                        ^                                 |                  |
+------------------------|---------------------------------|------------------+
                         |                                 |
 GET /api/items?target=&status=&sort=&cursor=              | Trigger Action
 POST /api/decisions[/batch]  ·  GET /api/targets           | POST /api/action/:name
                         v                                 v
+------------------------------------+   +------------------------------------+
|         WEB DASHBOARD UI           |   |        ACTION PLUGINS LAYER        |
|             (public/)              |   |         (plugins/actions/)         |
|                                    |   |                                    |
|   - Real-time Item Grid & Matrix   |   |   +----------------------------+   |
|   - Status Triage (Accept/Reject)  |   |   | generate_message.js        |   |
|   - Scraper Execution Trigger      |   |   | (template rendering)       |   |
|   - Extensible Card Customization  |   |   +----------------------------+   |
|     (public/plugin.js)             |   |   +----------------------------+   |
|                                    |   |   | Custom Integrations        |   |
|                                    |   |   | (webhooks, alerts, sync)   |   |
|                                    |   |   +----------------------------+   |
+------------------------------------+   +------------------------------------+
                                                           |
                                                           v
                                         +------------------------------------+
                                         |         DOWNSTREAM TARGETS         |
                                         |   [ Webhooks ] [ APIs ] [ Alerts ] |
                                         +------------------------------------+
```

---

## Features

- Modular Scraper Plugins: Drop self-contained fetchers into `plugins/scrapers/` to pull data from any API, database, or web page.
- Pluggable Action System: Implement custom post-processing, templating, webhooks, or automation handlers in `plugins/actions/`.
- Targets & Per-Target Decisions: the same item can be `accepted` on one queue and still `pending` on another (`products@domain-a` vs. `products@domain-b`) — see [Targets, Decisions and Stores](#targets-decisions-and-stores).
- Human-in-the-Loop Review: a dashboard with `pending`/`accepted`/`rejected` tabs, a target switcher, rank or recency sorting, cursor pagination, multi-select with shift-click, "approve all visible ≥ rank X", keyboard shortcuts (`j`/`k`/`a`/`r`/`u`/`x`), a reject note, and an undo toast.
- Pluggable Storage: `JsonStore` (default, auto-migrates a pre-Targets file) or `SqliteStore` ship in `lib/stores/`; a host application can inject its own `ScoutStore` via `plugins/store/` to back triage decisions directly with its own database.
- Optional Auth Hook: `plugins/auth/` for a host application's own request gate — none by default.
- Deduplication by Default: Incoming items are automatically deduplicated against existing store records using unique IDs.
- Template Rendering Engine: Built-in placeholder substitution (`{{item.title}}`, `{{config.persona.name}}`) for message crafting and export.
- UI Plugin Architecture: Inject custom card layouts, a side-panel detail view, and custom filters into the frontend via `public/plugin.js` without touching core code.
- Zero-Build Type Safety: Built-in TypeScript declarations (`types.d.ts`), `checkJs` validation, and `npm run typecheck` script providing complete IntelliSense and autocomplete without requiring transpilation or build pipelines.
- Modern ECMAScript Stack: Built using Node.js ES Modules, Express, Tailwind CSS, and vanilla JavaScript.

---

## Repository Structure

```
scoutjs/
|-- .github/
|   `-- workflows/
|       `-- ci.yml                 # Automated CI workflow (typecheck + syntax validation)
|-- config/
|   `-- config.json                # Global settings, scraper keywords, persona, store kind
|-- data/
|   |-- .gitkeep                   # Data directory placeholder
|   |-- database.json              # JsonStore: { items, decisions, targets } (gitignored)
|   `-- database.sqlite            # SqliteStore, if config.global.store = "sqlite" (gitignored)
|-- lib/
|   `-- stores/
|       |-- json-store.js          # Default ScoutStore impl (auto-migrates a pre-Targets file)
|       `-- sqlite-store.js        # SQLite-backed ScoutStore impl
|-- plugins/
|   |-- actions/
|   |   `-- generate_message.js    # Sample action plugin with template interpolation
|   |-- auth/                      # At most one file: an AuthHook (req) => boolean — none by default
|   |-- scrapers/
|   |   `-- mock_scraper.js        # Sample scraper plugin returning normalized items
|   `-- store/                     # At most one file: a host app's own ScoutStore factory
|-- public/
|   |-- app.js                     # Frontend dashboard logic and API client
|   |-- index.html                 # Dashboard markup (Tailwind CSS)
|   |-- logo.svg                   # Application vector logo
|   `-- plugin.js                  # Frontend UI plugin hook for card/filter overrides
|-- .agents/
|   `-- rules/
|       `-- scoutjs-development.md # Development guidelines for AI and contributors
|-- .env.example                   # Environment variable template
|-- .gitignore                     # Git ignore rules
|-- AGENTS.md                      # AI agent instructions and architectural contracts
|-- LICENSE                        # MIT License
|-- package.json                   # Project metadata and dependencies
|-- server.js                      # Express backend API server and plugin loader
|-- tsconfig.json                  # TypeScript compiler settings for JSDoc typechecking
|-- types.d.ts                     # TypeScript declarations for Item, plugins, and config
`-- README.md                      # Project documentation
```

---

## Prerequisites

- Node.js 18.0.0 or higher
- npm 9.0.0 or higher

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/niklasbrandt/scoutjs.git
cd scoutjs
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure settings

Copy the environment template (optional):

```bash
cp .env.example .env
```

Edit `config/config.json` to suit your requirements:

```json
{
  "global": {
    "theme": "dark",
    "name": "ScoutJS"
  },
  "scraper": {
    "keywords": ["sample query"],
    "exclude": ["spam"]
  },
  "persona": {
    "name": "Default Operator"
  }
}
```

Add `"global": {"store": "sqlite"}` to use `SqliteStore` instead of the default `JsonStore` — see [Targets, Decisions and Stores](#targets-decisions-and-stores).

### 4. Start the server

```bash
npm start
```

By default, the server runs on port `3000`. You can configure the port using the `PORT` environment variable:

```bash
PORT=8080 npm start
```

### 5. Access the dashboard

Open your browser and navigate to:

```
http://localhost:3000
```

Click **Run Scrapers** in the top navigation to trigger all scrapers configured in `plugins/scrapers/`.

---

## Item Data Schema

All scrapers must normalize collected items into the standard item format:

```json
{
  "id": "unique_string_identifier",
  "title": "Item Headline or Title",
  "description": "Text body, summary, or details",
  "metadata": {
    "source": "api_or_scraper_name",
    "category": "electronics",
    "custom_field": "custom_value"
  },
  "url": "https://example.com/item/123",
  "status": "pending"
}
```

Field descriptions:
- `id` (string, required): Unique identifier across all sources to avoid duplicates.
- `title` (string, required): Display title for the dashboard card.
- `description` (string, optional): Text summary or body content.
- `metadata` (object, optional): Freeform key-value pairs specific to your domain. Displayed in the item card and accessible to action templates.
- `url` (string, optional): External link to the original resource.
- `status` (string, deprecated): Only used as the item's *initial* decision when a scraper first inserts it into a target. The source of truth for an item's current lifecycle state is now its `Decision` on each `Target` — see the next section.
- `rank` (number, optional): Queue sort key for `sort=rank`.

---

## Targets, Decisions and Stores

A single item can be **accepted on one target and still pending on another** — e.g. a product
that's a fit for `products@domain-a` but hasn't been reviewed for `products@domain-b` yet.
This replaces the original single-status-per-item model.

- **Target**: a named queue (`{ id, label, group? }`). Items that don't specify one live in the
  implicit `default` target, so a pre-Targets scraper/UI needs zero changes.
- **Decision**: `{ itemId, targetId, status, decidedAt?, decidedBy?, note? }` — the actual
  lifecycle state, now separate from the item record itself.
- **Store**: the persistence layer is pluggable via the `ScoutStore` interface
  (`listTargets`, `listItems`, `getItem`, `upsertItems`, `decide`, `decideBatch` — see
  `types.d.ts`). Two implementations ship in `lib/stores/`:
  - `JsonStore` (default) — the original `data/database.json`, extended to hold
    `{ items, decisions, targets }`. A pre-Targets file (`{pending, accepted, rejected}`) is
    **migrated automatically** on first read; the original is backed up next to it as
    `database.pre-targets-backup.json` first.
  - `SqliteStore` — set `"global": { "store": "sqlite" }` in `config/config.json` to use it
    instead (`data/database.sqlite`).
- **Injecting your own store**: put a single file in `plugins/store/`, default-exporting a
  `(config) => ScoutStore` factory (a `StoreFactory`, see `types.d.ts`). This is how a host
  application backs triage decisions directly by its own database instead of ScoutJS's file —
  no sync between two databases.
- **Auth**: ScoutJS itself still has no auth. Put a single file in `plugins/auth/`,
  default-exporting an `AuthHook`: `(req) => boolean | Promise<boolean>`. Returning `false`
  (or throwing) responds `401` before any route runs. No file present means no auth, unchanged
  from before.
- **A scraper can declare its target(s)** by exporting `targets: string[]` alongside its
  default export — e.g. `export const targets = ['products@domain-a'];`. Omitting it keeps
  landing items in `default`, unchanged from before Targets existed.

---

## Plugin Development

### 1. Creating a Scraper Plugin

Add a new JavaScript file in `plugins/scrapers/` (e.g., `plugins/scrapers/custom_feed.js`).

Every scraper must export a default async function accepting the configuration object and returning an array of items matching the standard schema:

```javascript
// plugins/scrapers/custom_feed.js

/** @type {import('../../types.d.ts').ScraperPlugin} */
export default async function customFeedScraper(config) {
  const keywords = config.scraper?.keywords || [];
  
  // Fetch data from external API or website
  const response = await fetch('https://api.example.com/items');
  const data = await response.json();

  // Normalize results to standard schema
  return data.map(entry => ({
    id: `custom_${entry.id}`,
    title: entry.name,
    description: entry.summary,
    metadata: {
      source: 'custom_feed',
      score: entry.score
    },
    url: entry.link
  }));
}
```

When you click **Run Scrapers** or send `POST /api/scrape`, the core engine dynamically loads all `.js` files in `plugins/scrapers/`, executes them, deduplicates entries, and stores new items into the `pending` queue.

### 2. Creating an Action Plugin

Add a new JavaScript file in `plugins/actions/` (e.g., `plugins/actions/send_webhook.js`).

Actions receive the selected `item` and the active `config` object:

```javascript
// plugins/actions/send_webhook.js

/** @type {import('../../types.d.ts').ActionPlugin} */
export default async function sendWebhookAction(item, config) {
  const payload = {
    event: 'item.accepted',
    item: {
      id: item.id,
      title: item.title,
      url: item.url,
      metadata: item.metadata
    },
    triggeredBy: config.persona?.name,
    timestamp: new Date().toISOString()
  };

  const response = await fetch('https://webhook.site/your-endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return {
    success: response.ok,
    status: response.status
  };
}
```

Trigger your action via the REST API:

```bash
curl -X POST http://localhost:3000/api/action/send_webhook \
  -H "Content-Type: application/json" \
  -d '{"itemId": "custom_123"}'
```

### 3. UI Plugin Customization

You can customize card rendering and add filter controls without modifying core frontend code. Edit `public/plugin.js`:

```javascript
// public/plugin.js

/** @type {import('../types.d.ts').ScoutUIPlugin} */
window.ScoutUIPlugin = {
  // Render custom card HTML for an item (item is a TargetedItem: the Item plus its
  // status/decidedAt/note/targetId on the currently viewed target)
  renderCard(item, currentFilter) {
    // Return an HTML string to override default card, or return null for default card
    return null;
  },

  // Render a side-panel detail view when an item card is clicked (not on a button/link/
  // checkbox). Return null for no detail view.
  renderDetail(item, targetId) {
    return null;
  },

  // Add custom filter buttons to the navigation bar
  renderCustomFilters() {
    return null;
  },

  // Callback executed after items are rendered
  onRenderEnd(items, container) {
    // Optional post-render operations
  }
};
```

### 4. Zero-Build Type Checking

ScoutJS achieves full type safety using JSDoc types mapped to `types.d.ts`. This requires **zero build step** and no transpilation—native Node.js executes your `.js` files directly.

To typecheck the entire project (including custom plugins):

```bash
npm run typecheck
```

In modern editors (VS Code, Cursor, Windsurf), typing your plugins provides immediate autocomplete, parameter tooltips, and compile-time error highlighting out of the box.

---

## Extending with AI Agents

This repository is optimized for AI-assisted development (Claude, Cursor, Copilot, Gemini CLI, Windsurf):

- **Architectural Rules**: AI agents should read [AGENTS.md](AGENTS.md) and [`.agents/rules/scoutjs-development.md`](.agents/rules/scoutjs-development.md) before making edits. The core constraint is to keep domain logic strictly within `plugins/`, `config/`, and `public/plugin.js`.
- **Scraper Prompt**: *"Create a new scraper in plugins/scrapers/<name>.js that queries <source>, normalizes results into the standard Item schema, and handles network errors."*
- **Action Prompt**: *"Create a new action plugin in plugins/actions/<name>.js that takes an accepted item and dispatches it to <service/webhook>."*
- **UI Customization Prompt**: *"Implement renderCard in public/plugin.js to display metadata.<field> cleanly on each card without modifying core files."*

---

## REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/items` | With **no** query params: the original `{pending, accepted, rejected}` shape, scoped to the `default` target (unchanged behavior). With any of `target`/`status`/`sort`/`limit`/`cursor`: `{ items, nextCursor?, total }`, scoped to `target` (default `default`), optionally filtered by `status`, sorted by `sort=rank\|recent`, paginated by `limit`/`cursor`. |
| `GET` | `/api/targets` | Lists all known `Target`s. |
| `POST` | `/api/items/:id/status` | **Legacy alias**, acts on the `default` target. Body: `{"status": "accepted" \| "rejected" \| "pending"}`. |
| `POST` | `/api/decisions` | Records one decision. Body: `{"itemId", "targetId", "status", "note"?, "decidedBy"?}`. |
| `POST` | `/api/decisions/batch` | Records several decisions at once. Body: `{"decisions": [...]}` (same shape as above, each entry). |
| `GET` | `/api/config` | Retrieves the parsed configuration from `config/config.json`. |
| `POST` | `/api/scrape` | Executes all scraper plugins in `plugins/scrapers/`, deduplicates items, and inserts new items into each scraper's declared target(s) (`default` if none declared). |
| `POST` | `/api/action/:actionName` | Executes the specified action plugin in `plugins/actions/:actionName.js`. Body: `{"itemId": "..."}`. |

---

## Contributing

Contributions are welcome. To contribute:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`.
3. Commit your changes: `git commit -m "Add new feature"`.
4. Push to the branch: `git push origin feature/my-feature`.
5. Open a Pull Request detailing the changes and motivations.

Please ensure all code follows standard ES module conventions, keeps domain logic separated into plugins, and avoids hardcoding domain-specific fields in core files.

---

## License

This project is licensed under the [MIT License](LICENSE).
