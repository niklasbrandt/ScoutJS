# ScoutJS -- AI Agent Instructions

Instructions for AI coding agents (Copilot, Cursor, Claude Code, Gemini CLI, etc.) to rapidly understand, build upon, and extend this repository without breaking architecture or introducing regressions.

---

## 1. Core Architecture & Philosophy

ScoutJS is a domain-agnostic pipeline and review dashboard:

```
[ Data Sources ]
       |
       v
plugins/scrapers/*.js       --> Fetches raw data, returns normalized Item objects
       |
       v (POST /api/scrape)
server.js                   --> Deduplicates by item.id, prepends to data/database.json
       |
       +---> public/ (Web UI)        --> Human-in-the-loop review: Accept / Reject / Restore
       |
       +---> plugins/actions/*.js    --> Executes automated workflows on accepted items
```

### The Golden Rule
**Never put domain-specific code in core files.**
- Core files (`server.js`, `public/app.js`, `public/index.html`) must remain generic and domain-agnostic.
- All domain-specific data, fields, filters, and logic belong exclusively in:
  - `plugins/scrapers/*.js` (data collection)
  - `plugins/actions/*.js` (downstream automations)
  - `plugins/store/*.js` (at most one file — a host app's own `ScoutStore`, see §7)
  - `plugins/auth/*.js` (at most one file — an `AuthHook`, see §7)
  - `config/config.json` (runtime settings and credentials)
  - `public/plugin.js` (custom UI cards, detail panels and filters)

---

## 2. Item Data Contract

All scrapers must return items matching this exact structure:

```typescript
interface Item {
  id: string;          // Required. Globally unique identifier (used for deduplication)
  title: string;       // Required. Display heading on dashboard card
  description?: string;// Optional. Summary text or body content
  metadata?: Record<string, any>; // Optional. Domain attributes (price, tags, author, etc.)
  url?: string;        // Optional. External link to source record
  rank?: number;       // Optional. Queue sort key for `sort=rank`
  status?: string;     // Deprecated: only read as the item's *initial* decision on a target
}
```

Notes:
- The store deduplicates items by `id` across the whole store, independent of target.
- An item's actual lifecycle state is a `Decision` (`{itemId, targetId, status, note?, ...}`),
  **per target** — the same item can be `accepted` on one target and `pending` on another. See
  §7. `Item.status` is only consulted once, as the initial decision when a scraper's items are
  first inserted into a target.
- Put any domain-specific attributes inside `metadata` (e.g., `metadata.price`, `metadata.score`).

---

## 3. How to Add a Scraper Plugin

Create a new file in `plugins/scrapers/<name>.js`.

Requirements:
- Must `export default async function (config)`.
- Receives the parsed `config/config.json` object.
- Returns an array of items conforming to the `Item` schema.
- Must catch and handle its own network or parsing errors gracefully.
- May also `export const targets = ['some-target-id'];` to say which target(s) its items
  belong to (e.g. `products@domain-a`). Omit it and items land in the implicit `default`
  target, unchanged from before Targets existed.

Example template:
```javascript
// plugins/scrapers/my_source.js

/** @type {import('../../types.d.ts').ScraperPlugin} */
export default async function mySourceScraper(config) {
  try {
    const response = await fetch('https://api.example.com/feed');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    return data.items.map(entry => ({
      id: `source_${entry.id}`,
      title: entry.title,
      description: entry.summary,
      metadata: {
        source: 'my_source',
        category: entry.category,
        publishedAt: entry.date
      },
      url: entry.link
    }));
  } catch (err) {
    console.error('my_source scraper error:', err.message);
    return [];
  }
}
```

The server automatically discovers and runs all `.js` files in `plugins/scrapers/` on `POST /api/scrape` or when the user clicks "Run Scrapers" in the UI.

---

## 4. How to Add an Action Plugin

Create a new file in `plugins/actions/<name>.js`.

Requirements:
- File name must match `[a-zA-Z0-9_-]` (path traversal protection enforces this).
- Must `export default async function (item, config)`.
- Receives the target `item` object and the parsed `config` object.
- Returns an object summarizing the result (e.g., `{ success: true, ... }`).

Example template:
```javascript
// plugins/actions/notify_webhook.js

/** @type {import('../../types.d.ts').ActionPlugin} */
export default async function notifyWebhook(item, config) {
  const webhookUrl = config.webhookUrl || process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('No webhook URL configured');
  }

  const payload = {
    event: 'item.accepted',
    item: {
      id: item.id,
      title: item.title,
      url: item.url,
      metadata: item.metadata
    },
    timestamp: new Date().toISOString()
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return { success: res.ok, status: res.status };
}
```

Actions are invoked via `POST /api/action/<actionName>` with JSON body `{"itemId": "<id>"}`.

---

## 5. How to Customize the Dashboard UI

Do NOT edit `public/app.js` or `public/index.html`. Instead, implement hooks in `public/plugin.js`:

```javascript
// public/plugin.js

/** @type {import('../types.d.ts').ScoutUIPlugin} */
window.ScoutUIPlugin = {
  // Return custom card HTML string, or null to fall back to the default card
  renderCard(item, currentFilter) {
    // IMPORTANT: Always escape dynamic strings with escapeHtml(str)
    return null;
  },

  // Inject custom filter buttons or controls into the header bar
  renderCustomFilters() {
    return null;
  },

  // Called after items are rendered to the DOM
  onRenderEnd(items, container) {
    // Custom post-processing if needed
  }
};
```

---

## 6. Configuration Management

All settings belong in `config/config.json`:
- `config.global`: Visual or global framework settings.
- `config.scraper`: Shared scraping rules (keywords, exclude terms, rate limits).
- `config.persona`: User/operator details for templating or notifications.
- Custom keys: Feel free to add top-level keys for API keys, target endpoints, or domain options.

---

## 7. Storage Engine, Targets, Decisions

- Persistence goes through the `ScoutStore` interface (`types.d.ts`):
  `listTargets, listItems, getItem, upsertItems, decide, decideBatch`.
- **`JsonStore`** (default): `data/database.json`, shape `{ items, decisions, targets }`.
  Auto-initialized on startup if missing. A pre-Targets file (`{pending, accepted, rejected}`)
  is migrated automatically on first read, with the original backed up to
  `data/database.pre-targets-backup.json` first. `data/database.json` is gitignored so user
  data is never committed.
- **`SqliteStore`**: `data/database.sqlite`. Enable with `"global": {"store": "sqlite"}` in
  `config/config.json`.
- **A host application can inject its own store**: put exactly one file in `plugins/store/`,
  default-exporting a `(config) => ScoutStore` factory. This is the intended way for a host app
  to back triage decisions directly with its own database — no sync between two databases.
- **Targets**: a named queue (`{id, label, group?}`). Items without an explicit target live in
  the implicit `default` target.
- **Decisions**: `{itemId, targetId, status, decidedAt?, decidedBy?, note?}` — the actual
  lifecycle state, per (item, target) pair. The same item can be `accepted` on one target and
  `pending` on another.
- **Auth**: put exactly one file in `plugins/auth/`, default-exporting an `AuthHook`:
  `(req) => boolean | Promise<boolean>`. No file means no auth (unchanged default).

---

## 8. Verification & Development Commands

```bash
# Typecheck entire codebase (zero build required)
npm run typecheck

# Check syntax of all files
node -c server.js
node -c public/app.js
node -c plugins/actions/generate_message.js
node -c plugins/scrapers/mock_scraper.js

# Start server (default port 3000)
npm start

# Start on custom port
PORT=3001 npm start

# Trigger scrape programmatically
curl -s -X POST http://localhost:3000/api/scrape

# Change item status (legacy alias, acts on the `default` target)
curl -s -X POST http://localhost:3000/api/items/<id>/status \
  -H "Content-Type: application/json" \
  -d '{"status":"accepted"}'

# List targets
curl -s http://localhost:3000/api/targets

# List items on a target, paginated/sorted
curl -s "http://localhost:3000/api/items?target=products@domain-a&status=pending&sort=rank&limit=20"

# Record a decision on a specific target
curl -s -X POST http://localhost:3000/api/decisions \
  -H "Content-Type: application/json" \
  -d '{"itemId":"<id>","targetId":"products@domain-a","status":"accepted"}'

# Record several decisions at once
curl -s -X POST http://localhost:3000/api/decisions/batch \
  -H "Content-Type: application/json" \
  -d '{"decisions":[{"itemId":"<id>","targetId":"products@domain-a","status":"accepted"}]}'

# Execute action
curl -s -X POST http://localhost:3000/api/action/generate_message \
  -H "Content-Type: application/json" \
  -d '{"itemId":"<id>"}'
```
