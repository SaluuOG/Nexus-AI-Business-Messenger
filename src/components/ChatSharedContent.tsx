import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FileText, Images, Link as LinkIcon, RefreshCw, Search, X } from 'lucide-react';
import { loadChatSharedContent, signSharedItem, subscribeSharedContent, type SharedCategory, type SharedCursor, type SharedItem } from '../features/data/chatSharedContent';
import type { OrganizationKind } from '../features/data/chatOrganizationView';
import '../chat-shared-content.css';

type Props = { kind: OrganizationKind; chatId: string; name: string; enabled: boolean; onOpenMessage: (id: string) => void };
const categories = [['images','Bilder'],['files','Dateien'],['links','Links']] as const;
const itemKey = (item: SharedItem) => item.message_id+':'+item.item_id;
const dateLabel = (date: string) => new Date(date).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
const sizeLabel = (size: number) => size<1048576 ? `${Math.max(1,Math.round(size/1024))} KB` : `${(size/1048576).toFixed(1)} MB`;

export function ChatSharedContent(props: Props) {
  const [open,setOpen]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  const restoreFocus=useRef(false);
  const close=useCallback(()=>{restoreFocus.current=true;setOpen(false);},[]);
  useEffect(()=>{if(!open && restoreFocus.current){restoreFocus.current=false;trigger.current?.focus();}},[open]);
  useEffect(()=>{if(!props.enabled)setOpen(false);},[props.enabled]);
  return <>
    <button ref={trigger} className="shared-content-trigger" type="button" disabled={!props.enabled} onClick={()=>setOpen(true)}><Images size={16} aria-hidden="true" />Medien, Dateien & Links</button>
    {open && props.enabled && createPortal(<SharedDialog {...props} close={close} />,document.body)}
  </>;
}

function SharedDialog({kind,chatId,name,onOpenMessage,close}: Props & {close: () => void}) {
  const dialog=useRef<HTMLDialogElement>(null), heading=useId();
  const [category,setCategory]=useState<SharedCategory>('images');
  const [query,setQuery]=useState(''),[search,setSearch]=useState('');
  useEffect(()=>{
    const node=dialog.current;node?.showModal();
    const hide=()=>{if(document.hidden)close();};
    document.addEventListener('visibilitychange',hide);window.addEventListener('offline',close);
    return ()=>{node?.close();document.removeEventListener('visibilitychange',hide);window.removeEventListener('offline',close);};
  },[close]);
  return <dialog ref={dialog} className="chat-shared-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();close();}}>
    <header><div><h2 id={heading}>Medien, Dateien & Links</h2><p>{name}</p></div><button className="shared-close" type="button" autoFocus aria-label="Übersicht schließen" onClick={close}><X size={21}/></button></header>
    <div className="shared-category" role="group" aria-label="Inhaltsart">{categories.map(([key,label])=><button type="button" key={key} aria-pressed={category===key} onClick={()=>setCategory(key)}>{label}</button>)}</div>
    <form className="shared-search" onSubmit={event=>{event.preventDefault();setSearch(query.trim());}}>
      <label className="shared-search-label" htmlFor={heading+'-search'}>Dateiname oder Link suchen</label>
      <input id={heading+'-search'} type="search" maxLength={100} placeholder={category==='links'?'Links durchsuchen':'Dateinamen durchsuchen'} value={query} onChange={event=>{setQuery(event.target.value);if(!event.target.value)setSearch('');}} />
      <button type="submit" aria-label="Inhalte suchen"><Search size={19}/></button>
    </form>
    <SharedResults key={category+':'+search} kind={kind} chatId={chatId} category={category} query={search} onOpenMessage={id=>{close();onOpenMessage(id);}} />
  </dialog>;
}

function SharedResults({kind,chatId,category,query,onOpenMessage}: Pick<Props,'kind'|'chatId'|'onOpenMessage'> & {category: SharedCategory;query: string}) {
  const [items,setItems]=useState<SharedItem[]>([]),[cursor,setCursor]=useState<SharedCursor|null>(null),[more,setMore]=useState(false);
  const [loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const generation=useRef(0),alive=useRef(true),busy=useRef(false),pageCount=useRef(1);
  const load=useCallback(async (after: SharedCursor|null=null)=>{
    if(after && busy.current)return;
    const request=++generation.current;busy.current=true;setLoading(true);setError(null);
    try {
      let page=await loadChatSharedContent(kind,chatId,category,query,after);
      const fresh=[...page.items];let loaded=1;
      while(!after && loaded<pageCount.current && page.has_more) {
        if(!alive.current || request!==generation.current)return;
        page=await loadChatSharedContent(kind,chatId,category,query,page.next_cursor);
        fresh.push(...page.items);++loaded;
      }
      if(!alive.current || request!==generation.current)return;
      pageCount.current=after?pageCount.current+1:loaded;
      setItems(previous=>[...new Map([...(after?previous:[]),...fresh].map(item=>[itemKey(item),item])).values()]);
      setCursor(page.next_cursor);setMore(page.has_more);
    } catch {
      if(!alive.current || request!==generation.current)return;
      pageCount.current=1;setItems([]);setCursor(null);setMore(false);setError('Die Übersicht konnte nicht geladen werden. Prüfe deine Verbindung und deinen Zugriff auf den Chat.');
    } finally {if(alive.current && request===generation.current){busy.current=false;setLoading(false);}}
  },[kind,chatId,category,query]);
  useEffect(()=>{
    alive.current=true;void load();let timer: ReturnType<typeof setTimeout>;
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void load(),200);};
    const stop=subscribeSharedContent(kind,chatId,schedule);
    const interval=setInterval(()=>{if(!document.hidden)void load();},30000);
    window.addEventListener('focus',schedule);
    return ()=>{alive.current=false;++generation.current;clearTimeout(timer);clearInterval(interval);stop();window.removeEventListener('focus',schedule);};
  },[kind,chatId,load]);
  return <section className="shared-results" aria-label="Geteilte Inhalte" aria-busy={loading}>
    <div className="shared-results-toolbar"><small>{query?`Suche: ${query}`:'Neueste zuerst'}</small><button type="button" disabled={loading} onClick={()=>void load()} aria-label="Übersicht aktualisieren"><RefreshCw size={16}/></button></div>
    {error && <p role="alert" className="shared-error">{error} <button type="button" onClick={()=>void load()}>Erneut laden</button></p>}
    <div className={category==='images'?'shared-grid':'shared-list'}>{items.map(item=><article className="shared-item" key={itemKey(item)} data-shared-item={item.item_id}>
      {category==='links' ? <a className="shared-link" href={item.url!} target="_blank" rel="noopener noreferrer"><LinkIcon size={20}/><span><b>{new URL(item.url!).hostname}</b><small>{item.title}</small></span><ExternalLink size={16}/></a> : <SharedFile item={item} image={category==='images'}/>}
      <footer><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time><button type="button" onClick={()=>onOpenMessage(item.message_id)} aria-label={`Zur Nachricht: ${item.title}`}>Zur Nachricht</button></footer>
    </article>)}</div>
    {loading && <p role="status" className="shared-empty">Inhalte werden geladen…</p>}
    {!loading && !error && items.length===0 && <p className="shared-empty">{query?'Keine passenden Inhalte gefunden.':`Noch keine ${categories.find(([key])=>key===category)?.[1]} in diesem Chat.`}</p>}
    {more && <button className="secondary shared-more" type="button" disabled={loading} onClick={()=>void load(cursor)}>Weitere laden</button>}
  </section>;
}

function SharedFile({item,image}: {item: SharedItem;image: boolean}) {
  const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(false),[preview,setPreview]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;const sign=()=>void signSharedItem(item).then(url=>{if(active){setUrl(url);setError(false);}}).catch(()=>{if(active){setUrl(null);setError(true);}});
    sign();const timer=setInterval(sign,50000);
    return ()=>{active=false;clearInterval(timer);};
  },[item.kind,item.storage_path,retry]);
  return <>
    {image && url && !error && <button className="shared-image" type="button" aria-label={`Bild ansehen: ${item.title}`} onClick={()=>setPreview(true)}><img src={url} alt={item.title} loading="lazy" onError={()=>setError(true)}/></button>}
    <div className="shared-file"><FileText size={image?16:24}/><div><b>{item.title}</b><small>{sizeLabel(item.file_size!)}</small></div></div>
    {url && <a className="shared-file-open" href={url} target="_blank" rel="noopener noreferrer">Datei öffnen <ExternalLink size={14}/></a>}
    {error ? <div className="shared-file-error"><small>Vorschau oder Datei nicht verfügbar.</small><button type="button" onClick={()=>setRetry(value=>value+1)}>Erneut laden</button></div> : !url && <small role="status">Datei wird vorbereitet…</small>}
    {preview && url && <SharedImagePreview url={url} title={item.title} close={()=>setPreview(false)}/>}
  </>;
}

function SharedImagePreview({url,title,close}: {url: string;title: string;close: () => void}) {
  const ref=useRef<HTMLDialogElement>(null),heading=useId();
  const [failed,setFailed]=useState(false);
  useEffect(()=>{const node=ref.current;node?.showModal();return ()=>node?.close();},[]);
  return <dialog ref={ref} className="shared-image-preview" aria-labelledby={heading} onCancel={event=>{event.preventDefault();event.stopPropagation();close();}}><header><h3 id={heading}>{title}</h3><button type="button" autoFocus aria-label="Bildvorschau schließen" onClick={close}><X size={20}/></button></header>{failed?<p role="status" className="shared-empty">Das Bild konnte nicht angezeigt werden. Öffne die Datei über die Übersicht.</p>:<img src={url} alt={title} onError={()=>setFailed(true)}/>}</dialog>;
}
