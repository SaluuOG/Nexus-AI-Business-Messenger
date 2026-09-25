import { Heart } from 'lucide-react';
import { createContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { reactionChoices, reactionLabel, type MessageReaction, type ReactionEmoji } from '../features/data/messageReactions';
import { useAnchoredMenu } from './useAnchoredMenu';
import '../message-options.css';
import '../message-reactions.css';

export type ReactionProps = { rows: MessageReaction[]; disabled: boolean; pending: boolean; onChoose: (emoji: ReactionEmoji) => void };

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
      <ReactionChoices rows={rows} disabled={disabled} pending={pending} onChoose={emoji => { closeMenu(); onChoose(emoji); }} />
      <small>Nochmal auswählen zum Entfernen</small>
    </div>, document.body)}
  </>;
}

export function ReactionChoices({ rows, disabled, pending, onChoose }: ReactionProps) {
  const own = rows.find(row => row.mine)?.emoji;
  return <div className="reaction-choices" role="group" aria-label="Schnellreaktionen">
    {reactionChoices.map(choice => <button key={choice.emoji} type="button" role="menuitemradio" tabIndex={-1} aria-label={choice.label} title={choice.label} aria-checked={own === choice.emoji} disabled={disabled || pending} onClick={() => onChoose(choice.emoji)}>
      <span aria-hidden="true">{choice.emoji}</span>
    </button>)}
  </div>;
}

type GestureActions = { options: () => void; reply: (() => void) | undefined };
export const MessageGestureContext = createContext<RefObject<GestureActions | null> | null>(null);

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
  const actions = useRef<GestureActions | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; y: number; time: number; moved: boolean; held: boolean; swipe: boolean; cancelled: boolean } | null>(null);
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => { if (disabled) { clearTimer(); start.current = null; setOffset(0); } return clearTimer; }, [disabled]);
  const lastTap = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastLike = useRef(-Infinity);
  const lastTouch = useRef(-Infinity);
  const like = () => {
    const now = performance.now();
    if (disabled || now - lastLike.current < 600) return;
    lastLike.current = now;
    onLike();
  };
  return <MessageGestureContext.Provider value={actions}><div className={`${className} reaction-bubble${offset ? ' is-swiping' : ''}`} style={offset ? { transform: `translateX(${offset}px)` } : undefined}
    onContextMenu={event => {
      if (disabled || interactive(event.target) || !actions.current) return;
      event.preventDefault();
      // Touch selection can emit contextmenu even after a short tap. The hold
      // timer owns touch menus; only mouse/keyboard context menus open here.
      if (performance.now() - lastTouch.current < 1000) return;
      clearTimer(); lastTap.current = null; actions.current.options();
    }}
    onDoubleClick={event => { if (!disabled && performance.now() - lastTouch.current > 1000 && !interactive(event.target)) { event.preventDefault(); like(); } }}
    onPointerDown={event => {
      if (event.pointerType === 'touch') lastTouch.current = performance.now();
      if (disabled || event.pointerType !== 'touch' || !event.isPrimary || interactive(event.target)) { start.current = null; lastTap.current = null; return; }
      clearTimer();
      start.current = { x: event.clientX, y: event.clientY, time: performance.now(), moved: false, held: false, swipe: false, cancelled: false };
      timer.current = setTimeout(() => {
        if (!start.current || start.current.moved) return;
        start.current.held = true;
        lastTap.current = null;
        actions.current?.options();
      }, 500);
    }}
    onPointerMove={event => {
      const down = start.current;
      if (!down || down.held || down.cancelled) return;
      const dx = event.clientX - down.x, dy = event.clientY - down.y;
      if (Math.hypot(dx, dy) > 12) {
        clearTimer(); down.moved = true; lastTap.current = null;
        if (!down.swipe && (Math.abs(dy) >= Math.abs(dx) || dx < 0)) { down.cancelled = true; return; }
        if (actions.current?.reply && dx > Math.abs(dy) * 1.5) {
          down.swipe = true;
          setOffset(Math.max(0, Math.min(72, dx * .65)));
        }
      }
    }}
    onPointerCancel={() => { clearTimer(); start.current = null; lastTap.current = null; setOffset(0); }}
    onPointerUp={event => {
      clearTimer();
      const down = start.current;
      start.current = null;
      setOffset(0);
      if (!down) return;
      const now = performance.now();
      if (!disabled && down.swipe && !down.cancelled && event.clientX - down.x >= 64 && Math.abs(event.clientY - down.y) < 40) {
        event.preventDefault(); lastTap.current = null; actions.current?.reply?.(); return;
      }
      if (disabled || down.held || down.moved || now - down.time > 350 || interactive(event.target)) { lastTap.current = null; return; }
      const previous = lastTap.current;
      if (previous && now - previous.time < 350 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24) {
        event.preventDefault(); lastTap.current = null; like();
      } else lastTap.current = { x: event.clientX, y: event.clientY, time: now };
    }}>
    {offset > 0 && <span className="swipe-reply-hint" aria-hidden="true">↩</span>}
    {children}
  </div></MessageGestureContext.Provider>;
}
