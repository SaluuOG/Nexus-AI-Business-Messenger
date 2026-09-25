import { Heart } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { reactionChoices, reactionLabel, type MessageReaction, type ReactionEmoji } from '../features/data/messageReactions';
import { useAnchoredMenu } from './useAnchoredMenu';
import '../message-options.css';
import '../message-reactions.css';

type ReactionProps = { rows: MessageReaction[]; disabled: boolean; pending: boolean; onChoose: (emoji: ReactionEmoji) => void };

export function ReactionPicker({ rows, disabled, pending, onChoose }: ReactionProps) {
  const { id, trigger, menu, initialFocus, open, setOpen, closeMenu, onMenuKeyDown } = useAnchoredMenu();
  const own = rows.find(row => row.mine)?.emoji;
  return <>
    <button ref={trigger} className={`message-reaction-trigger${own ? ' has-reaction' : ''}`} type="button" aria-label="Reaktion auswählen" title="Reaktion auswählen" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled || pending}
      onClick={() => { initialFocus.current = 'first'; setOpen(value => !value); }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true); } }}>
      <Heart size={17} fill={own === '❤️' ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={id} className="message-options-menu reaction-picker" role="menu" aria-label="Reaktion auswählen" onKeyDown={onMenuKeyDown}>
      <p>Reaktion auswählen</p>
      {reactionChoices.map(choice => <button key={choice.emoji} type="button" role="menuitemradio" tabIndex={-1} aria-checked={own === choice.emoji} disabled={disabled || pending} onClick={() => { closeMenu(); onChoose(choice.emoji); }}>
        <span aria-hidden="true">{choice.emoji}</span>{choice.label}{own === choice.emoji && <small aria-hidden="true">✓</small>}
      </button>)}
      <small>Nochmal auswählen zum Entfernen</small>
    </div>, document.body)}
  </>;
}

export function MessageReactions({ rows, disabled, pending, onChoose }: ReactionProps) {
  if (!rows.length) return null;
  return <div className="message-reactions" role="group" aria-label="Reaktionen">
    {reactionChoices.flatMap(choice => {
      const row = rows.find(value => value.emoji === choice.emoji);
      return row ? [<button key={row.emoji} type="button" aria-pressed={row.mine} disabled={disabled || pending} onClick={() => onChoose(row.emoji)} title={`${reactionLabel(row.emoji)} · ${row.count}${row.mine ? ' · Du hast reagiert' : ''}`} aria-label={`${reactionLabel(row.emoji)}: ${row.count}${row.mine ? ', deine Reaktion entfernen' : ', reagieren'}`}>
        <span aria-hidden="true">{row.emoji}</span><span aria-hidden="true">{row.count}</span>
      </button>] : [];
    })}
  </div>;
}

const interactive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button,a,input,textarea,select,audio,video,[role="menu"],[contenteditable="true"]'));

export function ReactionBubble({ className, disabled, onLike, children }: { className: string; disabled: boolean; onLike: () => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number; time: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastLike = useRef(-Infinity);
  const lastTouch = useRef(-Infinity);
  const like = () => {
    const now = performance.now();
    if (disabled || now - lastLike.current < 600) return;
    lastLike.current = now;
    onLike();
  };
  return <div className={`${className} reaction-bubble`}
    onDoubleClick={event => { if (!disabled && performance.now() - lastTouch.current > 1000 && !interactive(event.target)) { event.preventDefault(); like(); } }}
    onPointerDown={event => {
      if (event.pointerType === 'touch') lastTouch.current = performance.now();
      if (disabled || event.pointerType !== 'touch' || !event.isPrimary || interactive(event.target)) { start.current = null; lastTap.current = null; return; }
      start.current = { x: event.clientX, y: event.clientY, time: performance.now(), moved: false };
    }}
    onPointerMove={event => { if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 12) start.current.moved = true; }}
    onPointerCancel={() => { start.current = null; lastTap.current = null; }}
    onPointerUp={event => {
      const down = start.current;
      start.current = null;
      if (!down) return;
      const now = performance.now();
      if (disabled || down.moved || now - down.time > 350 || interactive(event.target)) { lastTap.current = null; return; }
      const previous = lastTap.current;
      if (previous && now - previous.time < 350 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24) {
        event.preventDefault(); lastTap.current = null; like();
      } else lastTap.current = { x: event.clientX, y: event.clientY, time: now };
    }}>
    {children}
  </div>;
}
