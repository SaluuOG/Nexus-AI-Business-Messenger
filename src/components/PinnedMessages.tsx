import { Pin, PinOff } from 'lucide-react';
import type { useMessagePins } from '../features/data/useMessagePins';
import '../message-pins.css';

export function PinnedMessages({ pins, canManage, onOpen }: { pins: ReturnType<typeof useMessagePins>; canManage: boolean; onOpen: (id: string) => void }) {
  return <>
    {pins.error && <div className="chat-error pins-error" role="alert"><span>{pins.error}</span><button type="button" onClick={pins.refresh}>Erneut laden</button></div>}
    {pins.rows.length > 0 && <details className="message-pins" key={pins.rows[0].chat_id}>
      <summary><Pin size={15} aria-hidden="true" /><span>Angeheftet ({pins.rows.length})</span></summary>
      <ul>{pins.rows.map(pin => <li key={pin.message_id}>
        <button className="pin-open" type="button" onClick={() => onOpen(pin.message_id)} title="Zur Nachricht springen"><span>{pin.preview.trim() || 'Anhang / Sprachnachricht'}</span><small>Zur Nachricht</small></button>
        {canManage && <button className="pin-remove" type="button" disabled={!pins.ready || pins.pending(pin.message_id)} aria-label="Anheftung lösen" title="Anheftung lösen" onClick={() => pins.set(pin.message_id, false)}><PinOff size={17} aria-hidden="true" /></button>}
      </li>)}</ul>
    </details>}
  </>;
}
