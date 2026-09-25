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
  /** Current triage lifecycle status */
  status?: ItemStatus;
}

/**
 * JSON database schema persisted in data/database.json.
 */
export interface Database {
  pending: Item[];
  accepted: Item[];
  rejected: Item[];
}

/**
 * ScoutJS runtime configuration loaded from config/config.json.
 */
export interface ScoutConfig {
  global?: {
    theme?: string;
    name?: string;
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
  renderCard?(item: Item, currentFilter: ItemStatus): string | null;
  /**
   * Return custom HTML string for additional filter buttons in the header.
   */
  renderCustomFilters?(): string | null;
  /**
   * Callback executed after items have finished rendering into the container.
   */
  onRenderEnd?(items: Item[], container: HTMLElement): void;
}

declare global {
  interface Window {
    ScoutUIPlugin?: ScoutUIPlugin | null;
  }
}
