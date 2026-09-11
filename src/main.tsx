import React,{useState}from'react';
import{createRoot}from'react-dom/client';
import{Bot,BriefcaseBusiness,Building2,CheckCircle2,ContactRound,House,LockKeyhole,MessageCircle,Plus,Search,Send,Settings,ShieldCheck,Sparkles,UserPlus,Users}from'lucide-react';
import'./styles.css';

type Tab='briefing'|'chats'|'contacts'|'business'|'ai'|'settings';
type Contact={name:string;username:string;type:'Kunde'|'Team'|'Privat';online?:boolean};
const seedContacts:Contact[]=[
{name:'Max Mustermann',username:'@max.mueller',type:'Kunde',online:true},
{name:'Lisa Bauer',username:'@lisa.bauer',type:'Kunde'},
{name:'Sula',username:'@sula',type:'Team',online:true},
{name:'Marco',username:'@marco',type:'Privat'}];
const chats=[
{name:'Max Mustermann',company:'Autohaus Müller',text:'Kannst du die Leasing-Seite noch ergänzen?',time:'12:48',badge:2},
{name:'Lisa Bauer',company:'Restaurant Bella',text:'Die neue Galerie sieht super aus 🙌',time:'11:20'},
{name:'Team Web',company:'WebWorkBalance',text:'Sula: Header ist fertig.',time:'09:15',badge:5},
{name:'Marco',company:'Privat',text:'Samstag 20 Uhr passt.',time:'Gestern'}];

function App(){
 const[tab,setTab]=useState<Tab>('briefing');
 const[selected,setSelected]=useState(0);
 const[contacts,setContacts]=useState(seedContacts);
 const[workspace,setWorkspace]=useState<'WebWorkBalance'|'Privat'>('WebWorkBalance');
 const[identity,setIdentity]=useState<'business'|'private'>('business');
 const[msg,setMsg]=useState('');
 const[messages,setMessages]=useState([
  {me:false,text:'Hi Samet, wir möchten auf der Startseite noch einen Button für Leasing ergänzen.'},
  {me:true,text:'Klar, kann ich mit aufnehmen. Soll er direkt auf eine neue Leasing-Seite führen?'},
  {me:false,text:'Ja genau. Bitte bis Montag fertigstellen.'}]);
 const send=()=>{if(!msg.trim())return;setMessages([...messages,{me:true,text:msg.trim()}]);setMsg('')};
 const openChat=(i:number)=>{setSelected(i);setTab('chats')};
 return <div className="app">
  <aside className="side">
   <div className="brand"><span className="logo"><Sparkles/></span><div><b>Nexus</b><small>AI Business Messenger</small></div></div>
   <nav>{[
    ['briefing',House,'Briefing'],['chats',MessageCircle,'Chats'],['contacts',ContactRound,'Kontakte'],['business',BriefcaseBusiness,'Business'],['ai',Bot,'AI Assistent'],['settings',Settings,'Einstellungen']
   ].map(([key,I,label]:any)=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}><I size={19}/><span>{label}</span></button>)}</nav>
   <div className="workspace"><small>WORKSPACE</small><select value={workspace} onChange={e=>setWorkspace(e.target.value as any)}><option>WebWorkBalance</option><option>Privat</option></select><span>{workspace==='WebWorkBalance'?'4 Mitglieder · Owner':'Nur du · Privat'}</span></div>
   <div className="profile"><div className="avatar">S</div><div><b>Samet</b><small>{identity==='business'?'@webworkbalance':'@samet'}</small></div></div>
  </aside>
  <main>
   {tab==='briefing'&&<Briefing openChat={()=>openChat(0)}/>} 
   {tab==='chats'&&<Chats selected={selected} setSelected={setSelected} messages={messages} msg={msg} setMsg={setMsg} send={send}/>} 
   {tab==='contacts'&&<Contacts contacts={contacts} setContacts={setContacts}/>} 
   {tab==='business'&&<Business/>} 
   {tab==='ai'&&<AI/>} 
   {tab==='settings'&&<SettingsPage identity={identity} setIdentity={setIdentity}/>} 
  </main>
 </div>
}

function Header({kicker,title,sub}:any){return <header><small>{kicker}</small><h1>{title}</h1><p>{sub}</p></header>}
function Briefing({openChat}:any){return <section className="page"><Header kicker="GUTEN ABEND, SAMET" title="Dein AI Briefing" sub="Nexus verbindet Nachrichten, Kunden, Aufgaben und Entscheidungen."/><div className="stats"><Stat n="3" t="Kunden warten"/><Stat n="2" t="Deadlines diese Woche"/><Stat n="1" t="Rechnung offen"/><Stat n="4" t="AI Aufgaben erkannt"/></div><div className="grid"><div className="panel"><h3>Heute wichtig</h3><button className="priority" onClick={openChat}><div className="avatar">MM</div><span><b>Autohaus Müller</b><small>Feedback seit 2 Tagen unbeantwortet</small></span><em>Öffnen</em></button><div className="priority"><div className="avatar">RB</div><span><b>Restaurant Bella</b><small>Website morgen fällig</small></span><em>Deadline</em></div><div className="priority"><div className="avatar">ZM</div><span><b>Zahnarzt Meier</b><small>1.600 € Rechnung offen</small></span><em>Finanzen</em></div></div><div className="panel ai-card"><Sparkles/><h3>AI Insight</h3><p>Im Chat mit Autohaus Müller wurde eine neue Aufgabe erkannt: Leasing-Seite ergänzen, Deadline Montag.</p><button>Aufgabe prüfen</button></div></div></section>}
function Stat({n,t}:any){return <div className="stat"><b>{n}</b><span>{t}</span></div>}
function Chats({selected,setSelected,messages,msg,setMsg,send}:any){const c=chats[selected];return <div className="chat-layout"><section className="chat-list"><Header kicker="MESSENGER" title="Chats" sub="Privat, Team und Kunden an einem Ort."/><div className="search"><Search size={16}/><input placeholder="Chats durchsuchen"/></div>{chats.map((x,i)=><button className={selected===i?'chat active':''+' chat'} onClick={()=>setSelected(i)} key={x.name}><div className="avatar">{x.name.split(' ').map(v=>v[0]).join('').slice(0,2)}</div><span><b>{x.name}</b><small>{x.company}</small><p>{x.text}</p></span><em>{x.time}{x.badge&&<i>{x.badge}</i>}</em></button>)}</section><section className="conversation"><div className="chat-head"><div><b>{c.name}</b><small>{c.company}</small></div><div className="project-pill">In Arbeit · 2.400 € · Montag</div></div><div className="messages">{messages.map((m:any,i:number)=><div key={i} className={m.me?'bubble me':'bubble'}>{m.text}</div>)}<div className="detected"><Sparkles size={16}/><div><b>Neue Aufgabe erkannt</b><span>Leasing-Seite ergänzen · Deadline Montag</span></div><button>Übernehmen</button></div></div><div className="composer"><input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Nachricht schreiben…"/><button onClick={send}><Send size={18}/></button></div></section></div>}
function Contacts({contacts,setContacts}:any){const add=()=>{const name=prompt('Name des Kontakts?');if(!name)return;setContacts([...contacts,{name,username:'@'+name.toLowerCase().replace(/\s+/g,'.'),type:'Kunde'}])};return <section className="page"><div className="title-row"><Header kicker="IDENTITÄT & NETZWERK" title="Kontakte" sub="Kunden, Team und private Kontakte sauber getrennt."/><button className="primary" onClick={add}><Plus size={16}/>Kontakt hinzufügen</button></div><div className="contact-grid">{contacts.map((c:Contact)=><div className="contact" key={c.username}><div className="avatar big">{c.name.split(' ').map(v=>v[0]).join('').slice(0,2)}</div><b>{c.name}</b><span>{c.username}</span><small>{c.type}{c.online?' · online':''}</small><button>Chat öffnen</button></div>)}</div></section>}
function Business(){return <section className="page"><Header kicker="BUSINESS" title="Projekte & Kunden" sub="Jeder Chat kann direkt mit Auftrag, Status, Wert und Deadline verbunden sein."/><div className="panel"><h3>Aktive Projekte</h3>{[['Autohaus Müller','In Arbeit','2.400 €','Montag','72%'],['Restaurant Bella','Review','1.850 €','Morgen','91%'],['Zahnarzt Meier','Wartet auf Kunde','1.600 €','28. Sep','54%']].map(p=><div className="project" key={p[0]}><div><b>{p[0]}</b><span>{p[1]}</span></div><strong>{p[2]}</strong><small>{p[3]}</small><div className="bar"><i style={{width:p[4]}}/></div></div>)}</div></section>}
function AI(){return <section className="page"><Header kicker="NEXUS AI" title="Dein Business-Assistent" sub="Frage Nexus nach Kunden, Aufgaben, Deadlines oder Entscheidungen."/><div className="ai-hero"><Bot size={38}/><h2>Was möchtest du wissen?</h2><p>„Was wollte Autohaus Müller noch geändert haben?“</p><div><button>Chats zusammenfassen</button><button>Offene Aufgaben</button><button>Follow-ups finden</button><button>Angebot vorbereiten</button></div></div></section>}
function SettingsPage({identity,setIdentity}:any){return <section className="page"><Header kicker="ACCOUNT" title="Einstellungen" sub="Identität, Workspace, Teamrollen und Sicherheitsgrundlage."/><div className="panel"><h3>Deine Identität</h3><div className="identity"><button className={identity==='private'?'active':''} onClick={()=>setIdentity('private')}><Users/><span><b>Privat</b><small>Samet · @samet</small></span></button><button className={identity==='business'?'active':''} onClick={()=>setIdentity('business')}><Building2/><span><b>Business</b><small>WebWorkBalance · @webworkbalance</small></span></button></div></div><div className="settings-grid"><div className="panel"><ShieldCheck/><h3>Workspace & Rollen</h3><p>Owner, Admin, Member und Guest sind als Rollenmodell vorbereitet.</p><button className="secondary"><UserPlus size={15}/>Mitglied einladen</button></div><div className="panel"><LockKeyhole/><h3>Sicherheit & Geräte</h3><p>Passwort, Sessions, 2FA und spätere Schlüsselverwaltung sind architektonisch vorgesehen.</p><span className="ok"><CheckCircle2 size={15}/>Frontend speichert keine echten Secrets</span></div></div></section>}

createRoot(document.getElementById('root')!).render(<App/>);
