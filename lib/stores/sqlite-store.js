import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * A SQLite-backed `ScoutStore` (types.d.ts) — the second built-in store SPEC calls for,
 * alongside `JsonStore`. Useful once item/decision counts outgrow a single JSON file being
 * rewritten whole on every write.
 *
 * @param {string} dbPath
 * @returns {import('../../types.d.ts').ScoutStore}
 */
export function createSqliteStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      url TEXT,
      rank REAL,
      ingested_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      target_group TEXT
    );
    CREATE TABLE IF NOT EXISTS decisions (
      item_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      note TEXT,
      PRIMARY KEY (item_id, target_id)
    );
  `);
  db.prepare(`INSERT OR IGNORE INTO targets (id, label) VALUES ('default', 'Default')`).run();

  /**
   * @typedef {{ id: string, title: string, description: string|null, metadata: string|null,
   *   url: string|null, rank: number|null, ingested_at: string }} ItemRow
   * @typedef {ItemRow & { status: string, decided_at: string|null, decided_by: string|null, note: string|null }} JoinedRow
   * @typedef {{ id: string, label: string, group: string|null }} TargetRow
   */

  /** @param {ItemRow} row */
  const rowToItem = (row) => ({
    id: row.id, title: row.title, description: row.description ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    url: row.url ?? undefined, rank: row.rank ?? undefined, ingestedAt: row.ingested_at,
  });

  /** @param {import('../../types.d.ts').Decision} d */
  const decide = (d) => {
    db.prepare(`INSERT OR IGNORE INTO targets (id, label) VALUES (?, ?)`).run(d.targetId, d.targetId);
    db.prepare(
      `INSERT INTO decisions (item_id, target_id, status, decided_at, decided_by, note)
       VALUES (@itemId, @targetId, @status, @decidedAt, @decidedBy, @note)
       ON CONFLICT(item_id, target_id) DO UPDATE SET
         status = excluded.status, decided_at = excluded.decided_at,
         decided_by = excluded.decided_by, note = excluded.note`,
    ).run({
      itemId: d.itemId, targetId: d.targetId, status: d.status,
      decidedAt: d.decidedAt ?? new Date().toISOString(), decidedBy: d.decidedBy ?? null, note: d.note ?? null,
    });
  };

  return {
    listTargets() {
      const rows = /** @type {TargetRow[]} */ (db.prepare(`SELECT id, label, target_group as "group" FROM targets`).all());
      return rows.map((r) => (r.group === null ? { id: r.id, label: r.label } : { id: r.id, label: r.label, group: r.group }));
    },

    listItems(q) {
      const targetId = q.target ?? 'default';
      const conditions = ['d.target_id = ?'];
      const params = [targetId];
      if (q.status) {
        conditions.push('d.status = ?');
        params.push(q.status);
      }
      const where = conditions.join(' AND ');
      const orderBy = q.sort === 'rank' ? 'i.rank DESC' : 'i.ingested_at DESC';

      const totalRow = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) as n FROM decisions d JOIN items i ON i.id = d.item_id WHERE ${where}`).get(...params)
      );
      const total = totalRow.n;

      const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString('utf8')) || 0 : 0;
      const limit = q.limit ?? 50;
      const rows = /** @type {JoinedRow[]} */ (db.prepare(
        `SELECT i.*, d.status, d.decided_at, d.decided_by, d.note FROM decisions d
         JOIN items i ON i.id = d.item_id WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      ).all(...params, limit, offset));

      const items = rows.map((r) => ({
        ...rowToItem(r), targetId, status: /** @type {import('../../types.d.ts').ItemStatus} */ (r.status),
        decidedAt: r.decided_at ?? undefined, decidedBy: r.decided_by ?? undefined, note: r.note ?? undefined,
      }));
      const nextOffset = offset + limit;
      const nextCursor = nextOffset < total ? Buffer.from(String(nextOffset)).toString('base64url') : undefined;
      return { items, nextCursor, total };
    },

    getItem(id) {
      const row = /** @type {ItemRow|undefined} */ (db.prepare(`SELECT * FROM items WHERE id = ?`).get(id));
      return row ? rowToItem(row) : undefined;
    },

    upsertItems(items, targetIds) {
      let inserted = 0;
      let newTargetMemberships = 0;
      const now = new Date().toISOString();
      const insertTarget = db.prepare(`INSERT OR IGNORE INTO targets (id, label) VALUES (?, ?)`);
      const insertItem = db.prepare(
        `INSERT INTO items (id, title, description, metadata, url, rank, ingested_at)
         VALUES (@id, @title, @description, @metadata, @url, @rank, @ingestedAt)
         ON CONFLICT(id) DO NOTHING`,
      );
      const insertDecision = db.prepare(
        `INSERT OR IGNORE INTO decisions (item_id, target_id, status) VALUES (?, ?, ?)`,
      );

      const tx = db.transaction(() => {
        for (const targetId of targetIds) insertTarget.run(targetId, targetId);
        for (const incoming of items) {
          const exists = db.prepare(`SELECT 1 FROM items WHERE id = ?`).get(incoming.id);
          const result = insertItem.run({
            id: incoming.id, title: incoming.title, description: incoming.description ?? null,
            metadata: incoming.metadata ? JSON.stringify(incoming.metadata) : null,
            url: incoming.url ?? null, rank: incoming.rank ?? null, ingestedAt: incoming.ingestedAt ?? now,
          });
          if (!exists && result.changes > 0) inserted++;
          for (const targetId of targetIds) {
            const r = insertDecision.run(incoming.id, targetId, incoming.status ?? 'pending');
            if (r.changes > 0) newTargetMemberships++;
          }
        }
      });
      tx();
      return { inserted, newTargetMemberships };
    },

    decide(d) {
      decide(d);
    },

    decideBatch(ds) {
      const tx = db.transaction(() => { for (const d of ds) decide(d); });
      tx();
    },
  };
}
