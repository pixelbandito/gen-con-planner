import { describe, expect, it } from 'vitest';
import {
  isStale,
  normalizeEvent,
  parseSystemBuckets,
  slugify,
} from './gencon.mjs';

describe('slugify', () => {
  it('slugifies "Magic: The Gathering"', () => {
    expect(slugify('Magic: The Gathering')).toBe('magic-the-gathering');
  });

  it('slugifies "Dungeons & Dragons"', () => {
    expect(slugify('Dungeons & Dragons')).toBe('dungeons-dragons');
  });

  it('collapses punctuation with no leading/trailing/double dashes', () => {
    expect(slugify('  --Foo!!! & ??Bar--  ')).toBe('foo-bar');
  });
});

describe('isStale', () => {
  it('is false for a freshly-fetched timestamp', () => {
    expect(isStale(new Date().toISOString())).toBe(false);
  });

  it('is true for a timestamp 8 days in the past', () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 3600 * 1000,
    ).toISOString();
    expect(isStale(eightDaysAgo)).toBe(true);
  });
});

describe('parseSystemBuckets', () => {
  it('drops empty/whitespace keys, merges dupes, and sorts', () => {
    const metaJson = {
      filtered: {
        game_system: {
          buckets: [
            { key: '', doc_count: 9 },
            { key: '  ', doc_count: 1 },
            { key: ' Dungeons & Dragons', doc_count: 1 },
            { key: 'Dungeons & Dragons', doc_count: 1453 },
            { key: 'Magic: The Gathering', doc_count: 146 },
          ],
        },
      },
    };
    expect(parseSystemBuckets(metaJson)).toEqual([
      { name: 'Dungeons & Dragons', eventCount: 1453 },
      { name: 'Magic: The Gathering', eventCount: 146 },
    ]);
  });
});

describe('normalizeEvent', () => {
  it('maps a raw _source to the Event model', () => {
    const src = {
      id: 42,
      title: 'Epic Quest!',
      game_system: 'Dungeons & Dragons',
      printable_event_type_no_prefix: 'Roleplaying Game',
      start_date: '2026-07-30T10:00:00.000-04:00',
      end_date: '2026-07-30T14:00:00.000-04:00',
      group_sponsor: 'Acme Games',
    };
    const event = normalizeEvent(src);
    expect(event.id).toBe(42);
    expect(event.title).toBe('Epic Quest!');
    expect(event.gameSystem).toBe('Dungeons & Dragons');
    expect(event.start).toBe('2026-07-30T10:00:00.000-04:00');
    expect(event.dupKey).toBe('epic quest|acme games');
  });
});
