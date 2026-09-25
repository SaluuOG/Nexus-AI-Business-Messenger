import { CheckSquare2, Ellipsis, Pencil, Reply, Trash2 } from 'lucide-react';
import { useContext, useLayoutEffect, useState } from 'react';
import { useAnchoredMenu } from './useAnchoredMenu';
import { createPortal } from 'react-dom';
import type { MessageTaskOrigin } from '../features/data/messageTasks';
import { MessageTaskDialog } from './MessageTaskDialog';
import '../message-options.css';
import { MessageGestureContext, ReactionChoices, type ReactionProps } from './MessageReactions';

type Props = {
  source: MessageTaskOrigin;
  reactions?: ReactionProps;
  currentUserId?: string;
  workspaceId?: string | null;
  onReply: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  replyDisabled?: boolean;
  editDisabled?: boolean;
  deleteDisabled?: boolean;
};

export function MessageOptions({ reactions, source, currentUserId, workspaceId, onReply, onEdit, onDelete, replyDisabled, editDisabled, deleteDisabled }: Props) {
  const { id, trigger, menu, initialFocus, open, setOpen, closeMenu, onMenuKeyDown } = useAnchoredMenu();
  const [taskOpen, setTaskOpen] = useState(false);
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
      {onEdit && <button type="button" role="menuitem" tabIndex={-1} disabled={editDisabled} onClick={() => select(onEdit)}><Pencil size={17} aria-hidden="true" />Bearbeiten</button>}
      {onDelete && <button type="button" role="menuitem" tabIndex={-1} className="message-options-delete" disabled={deleteDisabled} onClick={() => select(onDelete)}><Trash2 size={17} aria-hidden="true" />Löschen</button>}
    </div>, document.body)}
    {taskOpen && currentUserId && <MessageTaskDialog source={source} currentUserId={currentUserId} workspaceId={workspaceId} onClose={() => { setTaskOpen(false); trigger.current?.focus({ preventScroll: true }); }} />}
  </>;
}
