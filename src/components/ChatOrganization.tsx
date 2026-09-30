import { Archive, ArchiveRestore, Ellipsis, Star, StarOff } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAnchoredMenu } from './useAnchoredMenu';
import type { ChatListView, ChatOrganization, OrganizationField } from '../features/data/chatOrganization';
import '../message-options.css';
import '../chat-organization.css';

export function ChatListViews({value,onChange,archivedCount}: {value: ChatListView; onChange: (value: ChatListView) => void; archivedCount: number}) {
  return <div className="chat-list-views" role="group" aria-label="Chatansicht">
    {(['active','favorites','archive'] as const).map(view => <button type="button" key={view} aria-pressed={value===view} onClick={() => onChange(view)}>
      {view==='active' ? 'Aktiv' : view==='favorites' ? 'Favoriten' : `Archiv${archivedCount ? ` (${archivedCount})` : ''}`}
    </button>)}
  </div>;
}

export function ChatFavorite({active}: {active?: boolean}) {
  return active ? <Star size={13} className="chat-favorite" fill="currentColor" aria-label="Favorit" /> : null;
}

export function ChatListOptions({name,state,disabled,onChange}: {name: string; state: ChatOrganization; disabled: boolean; onChange: (field: OrganizationField,value: boolean) => void}) {
  const {id,trigger,menu,initialFocus,open,setOpen,closeMenu,onMenuKeyDown} = useAnchoredMenu();
  const select = (field: OrganizationField,value: boolean) => { closeMenu(); onChange(field,value); };
  return <>
    <button type="button" className="chat-list-options" ref={trigger} title={`Chat-Optionen: ${name}`} aria-label={`Chat-Optionen: ${name}`} disabled={disabled}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { initialFocus.current='first'; setOpen(value=>!value); }}
      onKeyDown={event => { if (event.key==='ArrowDown' || event.key==='ArrowUp') { event.preventDefault(); initialFocus.current=event.key==='ArrowUp'?'last':'first'; setOpen(true); } }}><Ellipsis size={19} aria-hidden="true" /></button>
    {open && createPortal(<div id={id} ref={menu} role="menu" aria-label="Chat organisieren" className="message-options-menu" onKeyDown={onMenuKeyDown}>
      <button type="button" role="menuitem" tabIndex={-1} disabled={disabled} onClick={() => select('favorite',!state.favorite)}>
        {state.favorite ? <StarOff size={17} aria-hidden="true" /> : <Star size={17} aria-hidden="true" />}{state.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
      </button>
      <button type="button" role="menuitem" tabIndex={-1} disabled={disabled} onClick={() => select('archived',!state.archived)}>
        {state.archived ? <ArchiveRestore size={17} aria-hidden="true" /> : <Archive size={17} aria-hidden="true" />}{state.archived ? 'Aus Archiv holen' : 'Archivieren'}
      </button>
    </div>,document.body)}
  </>;
}
