import { Archive, ArchiveRestore, Bell, BellOff, Ellipsis, Star, StarOff } from 'lucide-react';
import { useEffect, useReducer } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredMenu } from './useAnchoredMenu';
import { isChatMuted, type ChatListView, type ChatOrganization, type OrganizationField, type ChatMuteMode } from '../features/data/chatOrganizationView';
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

function useMuted(state: ChatOrganization) {
  const [,refresh] = useReducer(value=>value+1,0);
  useEffect(()=>{
    if (state.muted_forever || !state.muted_until) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick=()=>{
      const delay=Date.parse(state.muted_until!)-Date.now();
      if (delay>0) timer=setTimeout(tick,Math.min(delay+30,2_147_483_647));
      else refresh();
    };
    tick();
    return ()=>clearTimeout(timer);
  },[state.muted_forever,state.muted_until]);
  return isChatMuted(state);
}

function muteLabel(state: ChatOrganization) {
  return state.muted_forever ? 'Dauerhaft stummgeschaltet' : `Stumm bis ${new Date(state.muted_until!).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`;
}

export function ChatMuted({state}: {state: ChatOrganization}) {
  const muted=useMuted(state);
  return muted ? <span className="chat-muted" title={muteLabel(state)}><BellOff size={13} aria-label="Chat stummgeschaltet" /></span> : null;
}

export function ChatListOptions({name,state,disabled,onChange,onMute}: {name: string; state: ChatOrganization; disabled: boolean; onChange: (field: OrganizationField,value: boolean) => void; onMute: (mode: ChatMuteMode) => void}) {
  const {id,trigger,menu,initialFocus,open,setOpen,closeMenu,onMenuKeyDown} = useAnchoredMenu();
  const muted=useMuted(state);
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
      <div className="chat-mute-caption">{muted ? muteLabel(state) : 'Nachrichtenhinweise'}</div>
      {muted && <button type="button" role="menuitem" tabIndex={-1} disabled={disabled} onClick={()=>{closeMenu();onMute('off');}}><Bell size={17} aria-hidden="true" />Wieder einschalten</button>}
      {([['1h','Für 1 Stunde stummschalten'],['8h','Für 8 Stunden stummschalten'],['forever','Dauerhaft stummschalten']] as const).map(([mode,label])=>
        <button type="button" key={mode} role="menuitem" tabIndex={-1} disabled={disabled} onClick={()=>{closeMenu();onMute(mode);}}><BellOff size={17} aria-hidden="true" />{label}</button>)}
    </div>,document.body)}
  </>;
}
