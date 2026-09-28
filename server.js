import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createJsonStore } from './lib/stores/json-store.js';
import { createSqliteStore } from './lib/stores/sqlite-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'data', 'database.json');
const SQLITE_PATH = path.join(__dirname, 'data', 'database.sqlite');
const CONFIG_PATH = path.join(__dirname, 'config', 'config.json');
const STORE_PLUGIN_DIR = path.join(__dirname, 'plugins', 'store');
const AUTH_PLUGIN_DIR = path.join(__dirname, 'plugins', 'auth');
const VALID_STATUSES = ['pending', 'accepted', 'rejected'];

/** Express query values can be string | string[] | ParsedQs | ParsedQs[] | undefined; every
 *  query param this server reads is a plain scalar, so coerce or drop anything else.
 *  @param {unknown} v @returns {string|undefined} */
const qs = (v) => (typeof v === 'string' ? v : undefined);

/**
 * @returns {import('./types.d.ts').ScoutConfig}
 */
const readConfig = () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { global: { theme: 'dark', name: 'ScoutJS' }, scraper: {}, persona: {} };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
};

/**
 * A host application can inject its own `ScoutStore` (SPEC: "a host application can inject its
 * own store") via a single file in `plugins/store/`, whose default export is a
 * `(config) => ScoutStore` factory — same discovery pattern as scrapers/actions. Falls back to
 * the built-in `JsonStore`/`SqliteStore`, chosen by `config.global.store`.
 * @param {import('./types.d.ts').ScoutConfig} config
 */
async function loadStore(config) {
  if (fs.existsSync(STORE_PLUGIN_DIR)) {
    const files = fs.readdirSync(STORE_PLUGIN_DIR).filter((f) => f.endsWith('.js'));
    if (files.length > 1) {
      throw new Error(`plugins/store/ must contain at most one store factory, found: ${files.join(', ')}`);
    }
    if (files.length === 1) {
      const mod = await import(path.join(STORE_PLUGIN_DIR, files[0]));
      console.log(`[ScoutJS] Using injected store: plugins/store/${files[0]}`);
      return mod.default(config);
    }
  }
  const kind = config.global?.store ?? 'json';
  if (kind === 'sqlite') return createSqliteStore(SQLITE_PATH);
  return createJsonStore(DB_PATH);
}

/**
 * Optional auth hook (SPEC: "ScoutJS has no auth today"), supplied the same way as a store —
 * a single file in `plugins/auth/`, default-exporting an `AuthHook`. No file present means no
 * auth, unchanged from before Targets existed.
 */
async function loadAuthHook() {
  if (fs.existsSync(AUTH_PLUGIN_DIR)) {
    const files = fs.readdirSync(AUTH_PLUGIN_DIR).filter((f) => f.endsWith('.js'));
    if (files.length === 1) {
      const mod = await import(path.join(AUTH_PLUGIN_DIR, files[0]));
      console.log(`[ScoutJS] Using auth hook: plugins/auth/${files[0]}`);
      return mod.default;
    }
  }
  return null;
}

const config = readConfig();
const store = await loadStore(config);
const authenticate = await loadAuthHook();

const app = express();
app.use(cors());
app.use(express.json());

if (authenticate) {
  app.use(async (req, res, next) => {
    try {
      const ok = await authenticate(req);
      if (!ok) return res.status(401).json({ error: 'Unauthorized' });
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  });
}

// __dirname-relative, not cwd-relative — a real bug fixed here: serving from a bare 'public'
// meant this only worked when the process happened to be launched from this directory.
app.use(express.static(path.join(__dirname, 'public')));

// --- Endpoints ---

// Get all items. With no query params at all, returns the original {pending,accepted,rejected}
// shape for the `default` target — a caller built against the pre-Targets API keeps working
// unchanged. With any of target/status/sort/limit/cursor, returns the new flat, paginated,
// target-scoped shape (types.d.ts's ListItemsResult).
app.get('/api/items', async (req, res) => {
  try {
    const target = qs(req.query.target);
    const status = qs(req.query.status);
    const sort = qs(req.query.sort);
    const limit = qs(req.query.limit);
    const cursor = qs(req.query.cursor);
    if (!target && !status && !sort && !limit && !cursor) {
      /** @param {import('./types.d.ts').ListItemsResult} r */
      const strip = (r) => r.items.map((i) => ({
        id: i.id, title: i.title, description: i.description, metadata: i.metadata, url: i.url, status: i.status,
      }));
      const [pending, accepted, rejected] = await Promise.all(
        VALID_STATUSES.map((s) => store.listItems({ target: 'default', status: s, limit: Number.MAX_SAFE_INTEGER })),
      );
      return res.json({ pending: strip(pending), accepted: strip(accepted), rejected: strip(rejected) });
    }
    const result = await store.listItems({
      target: target || 'default',
      status: status && VALID_STATUSES.includes(status) ? status : undefined,
      sort: sort === 'rank' ? 'rank' : 'recent',
      limit: limit ? Number(limit) : undefined,
      cursor: cursor || undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to list items:', err);
    res.status(500).json({ error: 'Failed to read database' });
  }
});

// List targets.
app.get('/api/targets', async (req, res) => {
  try {
    res.json(await store.listTargets());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list targets' });
  }
});

// Legacy alias: update an item's status on the `default` target.
app.post('/api/items/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try {
    const item = await store.getItem(id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await store.decide({ itemId: id, targetId: 'default', status });
    res.json({ success: true, item: { ...item, status } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Record one decision on a given target.
app.post('/api/decisions', async (req, res) => {
  const { itemId, targetId, status, note, decidedBy } = req.body;
  if (!itemId || !targetId || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'itemId, targetId and a valid status are required' });
  }
  try {
    const item = await store.getItem(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await store.decide({ itemId, targetId, status, note, decidedBy });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record decision' });
  }
});

// Record several decisions at once (e.g. "approve all visible ≥ rank X").
app.post('/api/decisions/batch', async (req, res) => {
  const { decisions } = req.body;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return res.status(400).json({ error: 'decisions must be a non-empty array' });
  }
  for (const d of decisions) {
    if (!d.itemId || !d.targetId || !VALID_STATUSES.includes(d.status)) {
      return res.status(400).json({ error: 'Each decision needs itemId, targetId and a valid status' });
    }
  }
  try {
    await store.decideBatch(decisions);
    res.json({ success: true, count: decisions.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record decisions' });
  }
});

// Get Config
app.get('/api/config', (req, res) => {
  try {
    res.json(readConfig());
  } catch (err) {
    res.status(500).json({ error: 'Failed to read config' });
  }
});

// --- Dynamic Actions ---
app.post('/api/action/:actionName', async (req, res) => {
  const { actionName } = req.params;
  const { itemId } = req.body;

  // Guard against path traversal
  if (/[^a-zA-Z0-9_-]/.test(actionName)) {
    return res.status(400).json({ error: 'Invalid action name' });
  }

  try {
    const item = await store.getItem(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Dynamic import of action plugin
    const actionPath = path.join(__dirname, 'plugins', 'actions', `${actionName}.js`);
    if (!fs.existsSync(actionPath)) {
      return res.status(404).json({ error: `Action ${actionName} not found` });
    }

    const plugin = await import(actionPath);
    const result = await plugin.default(item, readConfig());

    res.json({ success: true, result });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Action ${actionName} failed:`, err);
    res.status(500).json({ error: `Action failed: ${errorMsg}` });
  }
});

// Trigger Scraper. A scraper module may export `targets: string[]` alongside its default
// export to say which target(s) its items belong to; omitting it keeps landing items in
// `default`, unchanged from before Targets existed.
app.post('/api/scrape', async (req, res) => {
  try {
    const scraperConfig = readConfig();
    const scrapersDir = path.join(__dirname, 'plugins', 'scrapers');
    let newItemsCount = 0;

    if (fs.existsSync(scrapersDir)) {
      const files = fs.readdirSync(scrapersDir).filter((f) => f.endsWith('.js'));
      for (const file of files) {
        const scraper = await import(path.join(scrapersDir, file));
        /** @type {import('./types.d.ts').Item[]} */
        const items = await scraper.default(scraperConfig);
        const targetIds = Array.isArray(scraper.targets) && scraper.targets.length > 0 ? scraper.targets : ['default'];
        const { inserted } = await store.upsertItems(items, targetIds);
        newItemsCount += inserted;
      }
    }

    res.json({ success: true, newItemsCount });
  } catch (err) {
    console.error('Scraping failed:', err);
    res.status(500).json({ error: 'Scraping failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ScoutJS listening on port ${PORT}`);
});
