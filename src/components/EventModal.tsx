import { useEffect } from 'react';
import type { GenConEvent } from '../types';
import type { ScheduleStatus } from '../lib/schedule';
import { fmtDateTime } from '../lib/time';
import { fmtCost, gameClass } from '../lib/style';

interface Props {
  event: GenConEvent;
  rank?: number;
  status?: ScheduleStatus;
  inWishlist: boolean;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
}

export function EventModal({
  event,
  rank,
  status,
  inWishlist,
  onAdd,
  onRemove,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const facts: [string, string][] = [
    ['When', fmtDateTime(event.start, event.end)],
    ['Duration', event.durationHours ? `${event.durationHours} hr` : '—'],
    ['Cost', fmtCost(event.cost)],
    [
      'Tickets available',
      event.ticketsAvailable != null ? String(event.ticketsAvailable) : '—',
    ],
    ['Game system', event.gameSystem || '—'],
    ['Event type', event.eventType || '—'],
    ['Format / edition', event.rulesEdition || '—'],
    ['Sponsor', event.groupSponsor || '—'],
    [
      'Location',
      [event.location, event.roomName, event.tableNumber]
        .filter(Boolean)
        .join(' · ') || '—',
    ],
    ['Age', event.ageRequirement || '—'],
    ['Experience', event.experienceRequired || '—'],
    ['Materials required', event.materialsRequired || '—'],
    ['Game code', event.gameCode || '—'],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal ${gameClass(event.gameSystem)}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{event.title}</h3>
          <button className="btn btn-mini" onClick={onClose}>✕</button>
        </div>

        {rank != null && (
          <div className={`modal-status status-${status}`}>
            Wishlist rank #{rank} · {status}
          </div>
        )}

        <dl className="modal-facts">
          {facts.map(([k, v]) => (
            <div key={k} className="modal-fact">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {event.shortDescription && (
          <p className="modal-short">{event.shortDescription}</p>
        )}
        {event.longDescription && (
          <p className="modal-long">{event.longDescription}</p>
        )}

        <div className="modal-actions">
          {inWishlist ? (
            <button
              className="btn btn-danger"
              onClick={() => onRemove(event.id)}
            >
              Remove from wishlist
            </button>
          ) : (
            <button className="btn btn-add" onClick={() => onAdd(event.id)}>
              Add to wishlist
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
