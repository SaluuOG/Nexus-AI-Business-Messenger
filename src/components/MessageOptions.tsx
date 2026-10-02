import { AlarmClock, Bookmark, BookmarkMinus, CheckSquare2, Copy, Ellipsis, Forward, Pencil, Pin, PinOff, Reply, Trash2 } from 'lucide-react';
import { useContext, useLayoutEffect, useState } from 'react';
import { useAnchoredMenu } from './useAnchoredMenu';
import { createPortal } from 'react-dom';
import type { MessageTaskOrigin } from '../features/data/messageTasks';
import { MessageTaskDialog } from './MessageTaskDialog';
import '../message-options.css';
import { MessageGestureContext, ReactionChoices, type ReactionProps } from './MessageReactions';
import { MessageCopyFeedback, useMessageCopy } from './MessageCopy';
import { MessageForwardDialog } from './MessageForwardDialog';
import '../message-bookmarks.css';
import { MessageReminderDialog } from './MessageReminderDialog';

type Props = {
  source: MessageTaskOrigin;
  reactions?: ReactionProps;
  pin?: { active: boolean; disabled: boolean; onToggle: () => void };
  bookmark?: { active: boolean; disabled: boolean; onToggle: () => void };
  currentUserId?: string;
  workspaceId?: string | null;
  onReply: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  replyDisabled?: boolean;
  editDisabled?: boolean;
  deleteDisabled?: boolean;
};

export function MessageOptions({ bookmark, pin, reactions, source, currentUserId, workspaceId, onReply, onEdit, onDelete, replyDisabled, editDisabled, deleteDisabled }: Props) {
  const { id, trigger, menu, initialFocus, open, setOpen, closeMenu, onMenuKeyDown } = useAnchoredMenu();
  const [taskOpen, setTaskOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const { copy, copying, feedback } = useMessageCopy(source.body);
  const gestures = useContext(MessageGestureContext);
  useLayoutEffect(() => {
    if (!gestures) return;
    gestures.current = { options: () => { initialFocus.current = 'first'; setOpen(true); }, reply: replyDisabled ? undefined : onReply };
    return () => { gestures.current = null; };
  }, [gestures, onReply, replyDisabled, initialFocus, setOpen]);

  const select = (action: () => void) => { closeMenu(); action(); };

  return <>
    <button ref={trigger} type="button" className="message-options-trigger" title="Optionen" aria-label="Optionen" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { initialFocus.current = 'first'; setOpen(value => !value); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true);
        }
      }}><Ellipsis size={19} aria-hidden="true" /></button>
    {open && createPortal(<div ref={menu} id={id} className={`message-options-menu${reactions ? ' message-context-menu' : ''}`} role="menu" aria-label="Nachrichtenoptionen" onKeyDown={onMenuKeyDown}>
      {reactions && <ReactionChoices {...reactions} onChoose={emoji => select(() => reactions.onChoose(emoji))} />}
      <button type="button" role="menuitem" tabIndex={-1} disabled={!currentUserId} onClick={() => select(() => setTaskOpen(true))}><CheckSquare2 size={17} aria-hidden="true" />Als Aufgabe übernehmen</button>
      <button type="button" role="menuitem" tabIndex={-1} disabled={replyDisabled} onClick={() => select(onReply)}><Reply size={17} aria-hidden="true" />Antworten</button>
      {source.body.trim() && <button type="button" role="menuitem" tabIndex={-1} disabled={copying} onClick={() => select(copy)}><Copy size={17} aria-hidden="true" />Text kopieren</button>}
      {bookmark && <button type="button" role="menuitem" tabIndex={-1} disabled={bookmark.disabled} onClick={() => select(bookmark.onToggle)}>{bookmark.active ? <BookmarkMinus size={17} aria-hidden="true" /> : <Bookmark size={17} aria-hidden="true" />}{bookmark.active ? 'Markierung entfernen' : 'Nachricht merken'}</button>}
      {currentUserId && <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(() => setReminderOpen(true))}><AlarmClock size={17} aria-hidden="true" />Später erinnern</button>}
      {source.body.trim() && !source.attachmentName && currentUserId && <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(() => setForwardOpen(true))}><Forward size={17} aria-hidden="true" />Weiterleiten</button>}
      {pin && <button type="button" role="menuitem" tabIndex={-1} disabled={pin.disabled} onClick={() => select(pin.onToggle)}>{pin.active ? <PinOff size={17} aria-hidden="true" /> : <Pin size={17} aria-hidden="true" />}{pin.active ? 'Anheftung lösen' : 'Anheften'}</button>}
      {onEdit && <button type="button" role="menuitem" tabIndex={-1} disabled={editDisabled} onClick={() => select(onEdit)}><Pencil size={17} aria-hidden="true" />Bearbeiten</button>}
      {onDelete && <button type="button" role="menuitem" tabIndex={-1} className="message-options-delete" disabled={deleteDisabled} onClick={() => select(onDelete)}><Trash2 size={17} aria-hidden="true" />Löschen</button>}
    </div>, document.body)}
    <MessageCopyFeedback text={feedback} />
    {reminderOpen && currentUserId && <MessageReminderDialog key={currentUserId + ":" + source.kind + ":" + source.messageId} source={source} currentUserId={currentUserId} onClose={() => { setReminderOpen(false); trigger.current?.focus({ preventScroll: true }); }} />}
    {forwardOpen && currentUserId && <MessageForwardDialog key={currentUserId + ':' + source.kind + ':' + source.messageId} source={source} currentUserId={currentUserId} onClose={() => { setForwardOpen(false); trigger.current?.focus({ preventScroll: true }); }} />}
    {taskOpen && currentUserId && <MessageTaskDialog source={source} currentUserId={currentUserId} workspaceId={workspaceId} onClose={() => { setTaskOpen(false); trigger.current?.focus({ preventScroll: true }); }} />}
  </>;
}
