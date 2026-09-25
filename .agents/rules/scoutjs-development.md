# ScoutJS -- AI Development Context

## What This Is

A generic, plugin-based pipeline for crawling external data sources, triaging items through a human-in-the-loop web dashboard, and dispatching accepted items to downstream action handlers. The architecture is intentionally domain-agnostic: all domain logic lives in plugins, never in core files.

## Architecture Overview

```
Data Sources --> plugins/scrapers/*.js --> server.js (dedup + store) --> data/database.json
                                                                             |
                                                         +-------------------+-------------------+
                                                         v                                       v
                                                   public/ (dashboard UI)              plugins/actions/*.js
                                                   Accept / Reject items               (post-processing on accepted items)
```

**Core files (do NOT add domain logic here):**
- `server.js` -- Express API server, plugin loader, deduplication, state management
- `public/app.js` -- Dashboard frontend logic, API client, card rendering
- `public/index.html` -- Dashboard markup (Tailwind CSS via CDN)
- `public/plugin.js` -- UI plugin hook (override cards, filters, post-render)

**Extension points (add domain logic here):**
- `plugins/scrapers/*.js` -- Data fetchers (one file per source)
- `plugins/actions/*.js` -- Post-processing handlers (one file per action)
- `config/config.json` -- All runtime configuration and persona settings
- `public/plugin.js` -- UI customization without touching core frontend

## Rules

1. **Never hardcode domain-specific fields in core files.** Use the generic `metadata` object on items for all domain-specific attributes (e.g., price, salary, rating, location). Core files must remain reusable across any domain.

2. **Scraper contract.** Every file in `plugins/scrapers/` must `export default` an async function that:
   - Receives `(config)` -- the parsed `config/config.json` object
   - Returns `Array<Item>` matching the standard schema (see below)
   - Handles its own errors gracefully (try/catch around network calls)

3. **Action contract.** Every file in `plugins/actions/` must `export default` an async function that:
   - Receives `(item, config)` -- the target item and parsed config
   - Returns an object (the result is sent back to the caller as JSON)
   - Action names must match `[a-zA-Z0-9_-]` (enforced by server)

4. **Item schema.** All items flowing through the system must conform to:
   ```json
   {
     "id": "string (required, unique across all sources)",
     "title": "string (required, displayed as card heading)",
     "description": "string (optional, displayed as card body)",
     "metadata": { "key": "value (optional, freeform, displayed as JSON in card)" },
     "url": "string (optional, external link)",
     "status": "string (assigned by server: pending | accepted | rejected)"
   }
   ```

5. **Configuration.** All persona settings, API keys, scraper parameters, and domain-specific options belong in `config/config.json`. Access via `config.scraper`, `config.persona`, or custom top-level keys you define.

6. **Templating.** Use `{{key.subkey}}` (Handlebars-style curly syntax) in string templates to reference item or config data. The template engine in `generate_message.js` resolves dot-separated paths against the data context.

7. **UI plugin hooks.** To customize the dashboard without modifying core files, set `window.ScoutUIPlugin` in `public/plugin.js` to an object with optional methods:
   - `renderCard(item, currentFilter)` -- return HTML string or `null` for default
   - `renderCustomFilters()` -- return HTML string or `null`
   - `onRenderEnd(items, container)` -- post-render callback

8. **Frontend security.** All user-controlled fields are escaped via `escapeHtml()` before HTML insertion. If you add new fields to card rendering, always wrap them with `escapeHtml()`.

## REST API Quick Reference

| Method | Endpoint                  | Purpose                              |
|--------|---------------------------|--------------------------------------|
| GET    | /api/items                | Read all items (pending/accepted/rejected) |
| POST   | /api/items/:id/status     | Move item between lists. Body: `{"status": "accepted"}` |
| GET    | /api/config               | Read parsed config.json              |
| POST   | /api/scrape               | Run all scrapers, deduplicate, store new items |
| POST   | /api/action/:actionName   | Execute action plugin. Body: `{"itemId": "..."}` |

## Storage

- `data/database.json` -- JSON flat file with `{ pending: [], accepted: [], rejected: [] }`. Auto-created on first run. Gitignored.
- No external database required. To scale, replace `readDB`/`writeDB` in `server.js`.

## Common Extension Patterns

**Add a new data source:** Create `plugins/scrapers/my_source.js`, export default async function returning normalized items. It will be auto-loaded on next scrape.

**Add a post-processing step:** Create `plugins/actions/my_action.js`. Trigger via `POST /api/action/my_action` with `{"itemId": "..."}`. Wire a button in `public/plugin.js` renderCard if needed.

**Add config fields:** Add keys to `config/config.json`, access them as `config.myKey` in scrapers/actions.

**Customize dashboard cards:** Implement `renderCard()` in `public/plugin.js` to return custom HTML per item, based on metadata fields.
