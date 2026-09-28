import fs from 'fs';
import path from 'path';

/**
 * The original single-file ScoutJS store, extended to be Targets-aware (see types.d.ts's
 * `ScoutStore`). On-disk shape is `{ items, decisions, targets }` (`JsonDatabase`).
 *
 * Backward compatibility: a pre-Targets file (`{pending, accepted, rejected}`, three flat
 * arrays with `status` on each item) is auto-migrated on first load into `{ items, decisions:
 * { default: {...} }, targets: [{id:'default', label:'Default'}] }`. The legacy file is copied
 * to `<name>.pre-targets-backup.json` next to it before being overwritten, so a migration bug
 * can't silently lose real triage decisions.
 *
 * @param {string} dbPath
 * @returns {import('../../types.d.ts').ScoutStore}
 */
export function createJsonStore(dbPath) {
  /** @param {any} data */
  const isLegacy = (data) =>
    data && Array.isArray(data.pending) && Array.isArray(data.accepted) && Array.isArray(data.rejected) && !data.items;

  /** @param {any} legacy */
  const migrateLegacy = (legacy) => {
    /** @type {import('../../types.d.ts').JsonDatabase} */
    const migrated = { items: {}, decisions: { default: {} }, targets: [{ id: 'default', label: 'Default' }] };
    const now = new Date().toISOString();
    for (const status of /** @type {const} */ (['pending', 'accepted', 'rejected'])) {
      for (const item of legacy[status] || []) {
        const { status: _status, ...rest } = item;
        migrated.items[item.id] = { ...rest, ingestedAt: rest.ingestedAt ?? now };
        migrated.decisions.default[item.id] = {
          itemId: item.id, targetId: 'default', status,
          decidedAt: status === 'pending' ? undefined : now,
        };
      }
    }
    return migrated;
  };

  /** @returns {import('../../types.d.ts').JsonDatabase} */
  const read = () => {
    if (!fs.existsSync(dbPath)) {
      /** @type {import('../../types.d.ts').JsonDatabase} */
      const fresh = { items: {}, decisions: { default: {} }, targets: [{ id: 'default', label: 'Default' }] };
      write(fresh);
      return fresh;
    }
    const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    if (isLegacy(raw)) {
      const backupPath = dbPath.replace(/\.json$/, '.pre-targets-backup.json');
      if (!fs.existsSync(backupPath)) fs.copyFileSync(dbPath, backupPath);
      console.log(`[JsonStore] Migrating pre-Targets database at ${dbPath} (backup: ${backupPath})`);
      const migrated = migrateLegacy(raw);
      write(migrated);
      return migrated;
    }
    raw.decisions ??= {};
    raw.targets ??= [{ id: 'default', label: 'Default' }];
    return raw;
  };

  /** @param {import('../../types.d.ts').JsonDatabase} data */
  const write = (data) => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  };

  /**
   * @param {import('../../types.d.ts').JsonDatabase} data
   * @param {string} targetId
   */
  const ensureTarget = (data, targetId) => {
    if (!data.targets.some((t) => t.id === targetId)) {
      data.targets.push({ id: targetId, label: targetId });
    }
    data.decisions[targetId] ??= {};
  };

  return {
    listTargets() {
      return read().targets;
    },

    listItems(q) {
      const data = read();
      const targetId = q.target ?? 'default';
      const decisionsForTarget = data.decisions[targetId] ?? {};
      let rows = Object.entries(decisionsForTarget)
        .map(([itemId, decision]) => {
          const item = data.items[itemId];
          if (!item) return null; // decision for an item that no longer exists — skip, don't crash
          return { ...item, targetId, status: decision.status, decidedAt: decision.decidedAt, decidedBy: decision.decidedBy, note: decision.note };
        })
        .filter((r) => r !== null);

      if (q.status) rows = rows.filter((r) => r.status === q.status);

      if (q.sort === 'rank') {
        rows.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
      } else {
        rows.sort((a, b) => (b.ingestedAt ?? '').localeCompare(a.ingestedAt ?? ''));
      }

      const total = rows.length;
      const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString('utf8')) || 0 : 0;
      const limit = q.limit ?? 50;
      const page = rows.slice(offset, offset + limit);
      const nextOffset = offset + limit;
      const nextCursor = nextOffset < total ? Buffer.from(String(nextOffset)).toString('base64url') : undefined;

      return { items: page, nextCursor, total };
    },

    getItem(id) {
      return read().items[id];
    },

    upsertItems(items, targetIds) {
      const data = read();
      let inserted = 0;
      let newTargetMemberships = 0;
      const now = new Date().toISOString();
      for (const targetId of targetIds) ensureTarget(data, targetId);

      for (const incoming of items) {
        const { status: initialStatus, ...rest } = incoming;
        const isNew = !data.items[incoming.id];
        if (isNew) {
          data.items[incoming.id] = { ...rest, ingestedAt: rest.ingestedAt ?? now };
          inserted++;
        }
        for (const targetId of targetIds) {
          if (!data.decisions[targetId][incoming.id]) {
            data.decisions[targetId][incoming.id] = {
              itemId: incoming.id, targetId, status: initialStatus ?? 'pending',
            };
            newTargetMemberships++;
          }
        }
      }
      write(data);
      return { inserted, newTargetMemberships };
    },

    decide(d) {
      const data = read();
      ensureTarget(data, d.targetId);
      data.decisions[d.targetId][d.itemId] = { ...d, decidedAt: d.decidedAt ?? new Date().toISOString() };
      write(data);
    },

    decideBatch(ds) {
      const data = read();
      const now = new Date().toISOString();
      for (const d of ds) {
        ensureTarget(data, d.targetId);
        data.decisions[d.targetId][d.itemId] = { ...d, decidedAt: d.decidedAt ?? now };
      }
      write(data);
    },
  };
}
