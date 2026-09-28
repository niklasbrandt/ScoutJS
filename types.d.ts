/**
 * Item status options within the triage dashboard.
 */
export type ItemStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Standard item schema accepted and managed by ScoutJS.
 */
export interface Item {
  /** Globally unique identifier used for deduplication across all sources */
  id: string;
  /** Display heading on dashboard card */
  title: string;
  /** Summary text or body content */
  description?: string;
  /** Domain-specific attributes (e.g. price, tags, author, scores) */
  metadata?: Record<string, any>;
  /** External URL to the source record */
  url?: string;
  /** Queue sort key — higher sorts first under `sort=rank`. Replaces ad-hoc `metadata.score`
   *  sorting from before Targets existed. */
  rank?: number;
  /** @deprecated Status is now per (item, target) via `Decision`, not a field on the item
   *  itself — a single item can be accepted on one target and pending on another. Kept so a
   *  scraper written before Targets existed still runs unmodified: `upsertItems` reads this as
   *  the item's *initial* decision on each target it's inserted into, then ignores it. */
  status?: ItemStatus;
  /** When the item was first ingested (ISO 8601). Set by the store, not the scraper. */
  ingestedAt?: string;
}

/**
 * A named queue an item can be decided in (e.g. `products@domain-a`, `content@domain-a`).
 * Items that aren't assigned to any target live in the implicit `default` target, so a
 * pre-Targets scraper/UI keeps working with zero changes.
 */
export interface Target {
  id: string;
  label: string;
  group?: string;
}

/**
 * The decision for one item on one target. Replaces `Item.status` as the source of truth for
 * triage state — an item's status is no longer global, it's per target.
 */
export interface Decision {
  itemId: string;
  targetId: string;
  status: ItemStatus;
  /** ISO 8601. Set by the store on `decide`/`decideBatch` if not provided. */
  decidedAt?: string;
  decidedBy?: string;
  /** Free-text reason, expected on reject. */
  note?: string;
}

export interface ListItemsQuery {
  /** Defaults to `'default'`. */
  target?: string;
  status?: ItemStatus;
  sort?: 'rank' | 'recent';
  limit?: number;
  /** Opaque — pass back `ListItemsResult.nextCursor` verbatim, don't construct one. */
  cursor?: string;
  /** Reserved for plugin-defined filtering (e.g. by `metadata` fields); not interpreted by the
   *  built-in stores today. */
  filter?: Record<string, any>;
}

/** An item merged with its decision on the queried target, for display and for feeding back
 *  into `decide`/`decideBatch`. */
export interface TargetedItem extends Item {
  targetId: string;
  status: ItemStatus;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export interface ListItemsResult {
  items: TargetedItem[];
  /** Present when more results exist beyond `limit`. */
  nextCursor?: string;
  /** Total items matching the query, ignoring `limit`/`cursor` — for "N pending" counts. */
  total: number;
}

export interface UpsertItemsResult {
  /** Items that didn't already exist in the store (a true first-time ingest, by id). */
  inserted: number;
  /** Existing items that also got registered into a target they weren't already in. */
  newTargetMemberships: number;
}

/**
 * The storage abstraction a host application can implement and inject (SPEC-driven design —
 * see the Hydra project's `HydraStore` for a DB-backed implementation). Two built-in
 * implementations ship with ScoutJS: `JsonStore` (the original single-file behaviour, now
 * Targets-aware) and `SqliteStore`.
 *
 * All methods may return a value directly or a Promise — callers should always `await` them.
 */
export interface ScoutStore {
  listTargets(): Target[] | Promise<Target[]>;
  listItems(q: ListItemsQuery): ListItemsResult | Promise<ListItemsResult>;
  getItem(id: string): (Item | undefined) | Promise<Item | undefined>;
  /** Registers items in the store (deduplicated by `id`, existing items are left alone except
   *  for target membership) and ensures each is a member of every id in `targetIds`, with an
   *  initial `pending` decision on any target it wasn't already in. */
  upsertItems(items: Item[], targetIds: string[]): UpsertItemsResult | Promise<UpsertItemsResult>;
  decide(d: Decision): void | Promise<void>;
  decideBatch(ds: Decision[]): void | Promise<void>;
}

/**
 * Optional auth middleware slot (ScoutJS itself has no auth). Return `true` to allow the
 * request, `false` (or throw) to reject it with 401. Supplied via `plugins/auth/*.js`.
 */
export type AuthHook = (req: import('express').Request) => boolean | Promise<boolean>;

/**
 * A pluggable store factory (SPEC's "a host application can inject its own store"). Supplied
 * via `plugins/store/*.js` — if exactly one file exists there, its default export is called
 * with the parsed config and used instead of the built-in `JsonStore`/`SqliteStore`.
 */
export type StoreFactory = (config: ScoutConfig) => ScoutStore | Promise<ScoutStore>;

/**
 * JSON database schema persisted in data/database.json (JsonStore's on-disk shape). The
 * pre-Targets shape (`{pending, accepted, rejected}`) is auto-migrated into this on first load
 * — see `lib/stores/json-store.js`.
 */
export interface JsonDatabase {
  items: Record<string, Item>;
  /** decisions[targetId][itemId] = Decision */
  decisions: Record<string, Record<string, Decision>>;
  targets: Target[];
}

/**
 * ScoutJS runtime configuration loaded from config/config.json.
 */
export interface ScoutConfig {
  global?: {
    theme?: string;
    name?: string;
    /** `'json'` (default) or `'sqlite'` — ignored if a `plugins/store/*.js` factory exists. */
    store?: 'json' | 'sqlite';
    [key: string]: any;
  };
  scraper?: {
    keywords?: string[];
    exclude?: string[];
    [key: string]: any;
  };
  persona?: {
    name?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Contract for a Scraper Plugin (plugins/scrapers/*.js).
 * Must export default an async function returning an array of Items.
 */
export type ScraperPlugin = (config: ScoutConfig) => Promise<Item[]>;

/**
 * Action result returned by an Action Plugin.
 */
export interface ActionResult {
  success?: boolean;
  message?: string;
  [key: string]: any;
}

/**
 * Contract for an Action Plugin (plugins/actions/*.js).
 * Must export default an async function accepting the item and config.
 */
export type ActionPlugin = (item: Item, config: ScoutConfig) => Promise<ActionResult>;

/**
 * Contract for the browser UI Plugin (public/plugin.js).
 */
export interface ScoutUIPlugin {
  /**
   * Return custom HTML string for an item card, or null for default card.
   */
  renderCard?(item: TargetedItem, currentFilter: ItemStatus): string | null;
  /**
   * Return custom HTML string for a side-panel item detail view, or null for none.
   */
  renderDetail?(item: TargetedItem, targetId: string): string | null;
  /**
   * Return custom HTML string for additional filter buttons in the header.
   */
  renderCustomFilters?(): string | null;
  /**
   * Callback executed after items have finished rendering into the container.
   */
  onRenderEnd?(items: TargetedItem[], container: HTMLElement): void;
}

declare global {
  interface Window {
    ScoutUIPlugin?: ScoutUIPlugin | null;
  }
}
