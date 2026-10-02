import { Copy, Ellipsis } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from '../lib/copyText';
import { useAnchoredMenu } from './useAnchoredMenu';
import '../message-options.css';

export function useMessageCopy(text: string) {
  const [feedback, setFeedback] = useState('');
  const [copying, setCopying] = useState(false);
  const request = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    setFeedback('');
    setCopying(false);
    busy.current = false;
    return () => {
      request.current += 1;
      clearTimeout(timer.current);
    };
  }, [text]);

  const copy = () => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    const current = ++request.current;
    clearTimeout(timer.current);
    setCopying(true);
    setFeedback('');
    void copyText(text).then(success => {
      if (request.current !== current) return;
      busy.current = false;
      setCopying(false);
      setFeedback(success ? 'Text kopiert.' : 'Kopieren nicht möglich. Bitte versuche es erneut.');
      timer.current = setTimeout(() => setFeedback(''), success ? 3000 : 6000);
    });
  };

  return { copy, copying, feedback };
}

export function MessageCopyFeedback({ text }: { text: string }) {
  return text ? createPortal(<div className="message-copy-feedback" role="status" aria-live="polite">{text}</div>, document.body) : null;
}

// A copy-only menu keeps offline reading independent of auth and server actions.
export function CopyMessageOptions({ text }: { text: string }) {
  const { id, trigger, menu, initialFocus, open, setOpen, closeMenu, onMenuKeyDown } = useAnchoredMenu();
  const { copy, copying, feedback } = useMessageCopy(text);
  if (!text.trim()) return null;

  return <>
    <button ref={trigger} type="button" className="message-options-trigger" title="Optionen" aria-label="Optionen" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); initialFocus.current = 'first'; setOpen(true);
        }
      }}><Ellipsis size={19} aria-hidden="true" /></button>
    {open && createPortal(<div ref={menu} id={id} className="message-options-menu" role="menu" aria-label="Nachrichtenoptionen" onKeyDown={onMenuKeyDown}>
      <button type="button" role="menuitem" tabIndex={-1} disabled={copying} onClick={() => { closeMenu(); copy(); }}><Copy size={17} aria-hidden="true" />Text kopieren</button>
    </div>, document.body)}
    <MessageCopyFeedback text={feedback} />
  </>;
}
