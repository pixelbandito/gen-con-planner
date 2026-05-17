import { useEffect, useState } from 'react';
import type { GenConEvent } from '../types';
import type { ScheduleStatus } from '../lib/schedule';
import { fmtDateTime } from '../lib/time';
import { fmtCost, gameClass, STATUS_LABEL } from '../lib/style';

interface Props {
  event: GenConEvent;
  rank?: number;
  status?: ScheduleStatus;
  inWishlist: boolean;
  wishlistCount: number;
  hiddenIds: Set<number>;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onSetRank: (id: number, rank: number) => void;
  onToggleHidden: (id: number) => void;
  onClose: () => void;
}

export function EventModal({
  event,
  rank,
  status,
  inWishlist,
  wishlistCount,
  hiddenIds,
  onAdd,
  onRemove,
  onSetRank,
  onToggleHidden,
  onClose,
}: Props) {
  const isHidden = hiddenIds.has(event.id);
  const showRankInput = inWishlist && rank != null;
  // Local draft so typing an intermediate value doesn't immediately reorder.
  const [rankDraft, setRankDraft] = useState(rank != null ? String(rank) : '');
  useEffect(() => {
    setRankDraft(rank != null ? String(rank) : '');
  }, [rank]);

  function commitRank() {
    const n = Number(rankDraft);
    if (
      rank == null ||
      rankDraft.trim() === '' ||
      !Number.isFinite(n) ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > wishlistCount
    ) {
      setRankDraft(String(rank ?? ''));
      return;
    }
    if (n !== rank) onSetRank(event.id, n);
  }
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
            Wishlist rank #{rank} · {status ? STATUS_LABEL[status] : status}
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
          <div className="modal-section">
            <div className="modal-section-row">
              {inWishlist ? (
                <button
                  className="btn btn-danger"
                  onClick={() => onRemove(event.id)}
                >
                  Remove from wishlist
                </button>
              ) : (
                <button
                  className="btn btn-add btn-add-wide"
                  onClick={() => onAdd(event.id)}
                >
                  Add to wishlist
                </button>
              )}
              {showRankInput && (
                <label className="modal-rank-field">
                  Priority
                  <input
                    type="number"
                    min={1}
                    max={wishlistCount}
                    value={rankDraft}
                    onChange={(e) => setRankDraft(e.target.value)}
                    onBlur={commitRank}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRank();
                      }
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="modal-section">
            <span className="modal-section-caption">
              Temporary view options
            </span>
            <button
              className={`btn ${isHidden ? 'is-active' : ''}`}
              onClick={() => onToggleHidden(event.id)}
            >
              {isHidden ? 'Unhide from Agenda' : 'Hide from Agenda'}
            </button>
            <p className="modal-section-help">
              Hiding only affects the Agenda view — it does not remove the
              event from your wishlist and is not saved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
