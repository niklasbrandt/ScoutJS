import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const DB_PATH = path.join(__dirname, 'data', 'database.json');
const CONFIG_PATH = path.join(__dirname, 'config', 'config.json');

// --- Helper Functions ---

/**
 * @returns {import('./types.d.ts').Database}
 */
const readDB = () => {
  if (!fs.existsSync(DB_PATH)) {
    /** @type {import('./types.d.ts').Database} */
    const initialData = { pending: [], accepted: [], rejected: [] };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
};

/**
 * @param {import('./types.d.ts').Database} data
 */
const writeDB = (data) => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

/**
 * @returns {import('./types.d.ts').ScoutConfig}
 */
const readConfig = () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { global: { theme: 'dark', name: 'ScoutJS' }, scraper: {}, persona: {} };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
};

// --- Endpoints ---

// Get all items
app.get('/api/items', (req, res) => {
  try {
    res.json(readDB());
  } catch (err) {
    res.status(500).json({ error: 'Failed to read database' });
  }
});

// Update item status (accept/reject)
app.post('/api/items/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  /** @type {import('./types.d.ts').ItemStatus[]} */
  const VALID_STATUSES = ['pending', 'accepted', 'rejected'];
  
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  
  try {
    const db = readDB();
    /** @type {import('./types.d.ts').Item | null} */
    let foundItem = null;
    
    // Remove from current list
    VALID_STATUSES.forEach(list => {
      const idx = db[list].findIndex(i => i.id === id);
      if (idx !== -1) {
        foundItem = db[list].splice(idx, 1)[0];
      }
    });

    if (!foundItem) return res.status(404).json({ error: 'Item not found' });
    
    // Add to new list
    /** @type {import('./types.d.ts').ItemStatus} */
    const targetStatus = status;
    /** @type {import('./types.d.ts').Item} */ (foundItem).status = targetStatus;
    db[targetStatus].unshift(foundItem);
    
    writeDB(db);
    res.json({ success: true, item: foundItem });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
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
    const db = readDB();
    const config = readConfig();
    const item = db.accepted.find(i => i.id === itemId) || db.pending.find(i => i.id === itemId);
    
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Dynamic import of action plugin
    const actionPath = path.join(__dirname, 'plugins', 'actions', `${actionName}.js`);
    if (!fs.existsSync(actionPath)) {
        return res.status(404).json({ error: `Action ${actionName} not found` });
    }

    const plugin = await import(actionPath);
    const result = await plugin.default(item, config);
    
    res.json({ success: true, result });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Action ${actionName} failed:`, err);
    res.status(500).json({ error: `Action failed: ${errorMsg}` });
  }
});

// Trigger Scraper
app.post('/api/scrape', async (req, res) => {
  try {
    const config = readConfig();
    const scrapersDir = path.join(__dirname, 'plugins', 'scrapers');
    const db = readDB();
    let newItemsCount = 0;

    if (fs.existsSync(scrapersDir)) {
      const files = fs.readdirSync(scrapersDir).filter(f => f.endsWith('.js'));
      for (const file of files) {
        const scraper = await import(path.join(scrapersDir, file));
        /** @type {import('./types.d.ts').Item[]} */
        const items = await scraper.default(config);
        
        // Basic deduplication and insertion
        /** @type {import('./types.d.ts').ItemStatus[]} */
        const lists = ['pending', 'accepted', 'rejected'];
        items.forEach(newItem => {
           const exists = lists.some(list => 
               db[list].some(i => i.id === newItem.id)
           );
           if (!exists) {
               newItem.status = 'pending';
               db.pending.unshift(newItem);
               newItemsCount++;
           }
        });
      }
      writeDB(db);
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
