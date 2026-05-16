/** A single Gen Con event, normalized from the event_search API. */
export interface GenConEvent {
  id: number;
  title: string;
  gameSystem: string;
  eventType: string;
  groupSponsor: string;
  shortDescription: string;
  longDescription: string;
  start: string | null;
  end: string | null;
  durationHours: number | null;
  location: string;
  roomName: string;
  tableNumber: string;
  cost: number | null;
  ticketsAvailable: number | null;
  maxPlayersUnlimited: boolean | null;
  ageRequirement: string;
  experienceRequired: string;
  rulesEdition: string;
  materialsRequired: string;
  gameCode: string;
  updatedAt: string | null;
  /** Normalized `title|sponsor`, used to detect hedge duplicates. */
  dupKey: string;
}

/** The bundled, read-only event dataset produced by the scraper. */
export interface EventsDataset {
  scrapedAt: string;
  conventionId: number | null;
  gameSystems: string[];
  events: GenConEvent[];
}

/** One entry in the ranked wishlist. Array position is the priority. */
export interface WishlistEntry {
  eventId: number;
  note?: string;
}

/** The user's single ranked wishlist (0 = top priority). */
export interface Wishlist {
  version: number;
  entries: WishlistEntry[];
}

/** A pending slot-search request raised by clicking the agenda grid. */
export type SlotSearch =
  | { kind: 'overlap'; ts: number }
  | { kind: 'contained'; start: number; end: number }
  | null;

/** Which slice of the wishlist the agenda renders. */
export type PriorityFilter =
  | { mode: 'layer'; layer: number }
  | { mode: 'range'; a: number; b: number };
