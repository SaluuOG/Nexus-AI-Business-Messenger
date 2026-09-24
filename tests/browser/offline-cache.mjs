import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const origin = 'http://127.0.0.1:4191';
const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, base: '/', server: { host: '127.0.0.1', port: 4191, strictPort: true, hmr: false },
  plugins: [{ name: 'offline-cache-fixture', enforce: 'pre',
    configureServer(server) { server.middlewares.use('/cache-harness', (_req,res) => { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>Cache fixture</title>'); }); },
    resolveId(source) { if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub; },
    transform(code, id) { if (id !== stub) return; return code
      .replace('async rpcResult(name, args) {', `async rpcResult(name, args) {
        if (navigator.onLine === false) return { data: null, error: { message: 'TypeError: Load failed' } };`)
      .replace('getSession: async () => ({ data: { session: { user } }, error: null })', `getSession: async () => localStorage.getItem('nexusTest.expired') && !navigator.onLine
        ? ({ data: { session: null }, error: { message: 'Failed to fetch token refresh' } })
        : ({ data: { session: { user } }, error: null })`);
    }
  }],
});
await server.listen();
await mkdir('browser-results', { recursive: true });
const setOnline = (page, online) => page.evaluate(value => {
  localStorage.setItem('nexusTest.offline', value ? '0' : '1');
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}, online);
const init = async context => {
  await context.addInitScript(() => {
    sessionStorage.setItem('nexusTest.mobileBusinessFixture', '1');
    sessionStorage.setItem('nexusTest.messageHistoryFixture', '1');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => localStorage.getItem('nexusTest.offline') !== '1' });
  });
  await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
};
const saved = page => page.evaluate(async () => {
  const db = await new Promise((resolve,reject) => { const r=indexedDB.open('nexus-offline-chats-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
  return new Promise(resolve => { const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>{db.close();resolve(r.result);}; });
});
const waitSaved = async (page,kind,id) => {
  for (let i=0;i<80;i++) { if ((await saved(page)).some(row=>row.kind===kind && row.id===id)) return; await page.waitForTimeout(50); }
  throw new Error('Snapshot missing: '+kind+'/'+id);
};
try {
  for (const [name, engine] of (process.env.NEXUS_BROWSER === 'chromium' ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]])) {
    const browser = await engine.launch();
    try {
      for (const kind of ['direct','group']) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await init(context);
        try {
          let page = await context.newPage(); page.setDefaultTimeout(15000);
          const groups = kind==='group', id = groups?'g1':'c1', route = groups?'groups':'chats', label = groups?'Projektgruppe':'Test Kontakt';
          const latest = groups?'Gruppenverlauf 129':'Historie 129';
          const routeURL = `${origin}/#/app/${route}?${groups?'group':'conversation'}=${id}`;
          await page.goto(routeURL);
          await page.locator('.messages .message-body').filter({hasText: latest}).waitFor();
          await waitSaved(page,kind,id);
          await setOnline(page,false);
          await page.close(); // A fresh document must use IndexedDB, not React state.
          page=await context.newPage();page.setDefaultTimeout(15000);
          await page.goto(routeURL);
          await page.locator('.messages .message-body').filter({hasText:latest}).waitFor();
          await page.locator('.conversation [role=status]').filter({hasText:'Offline – zuletzt gespeichert:'}).waitFor();
          assert.equal(await page.locator('.message-actions').count(),0);
          assert.equal(await page.locator('[data-action=load-older-messages]').count(),0);
          assert.equal(await page.evaluate(()=>window.nexusTest.chatReadCalls.length),0,'No offline read receipts');
          // Fresh authoritative response removes a message and changes another.
          await page.evaluate(groups=>{
            const rows=groups?window.nexusTest.groupMessages:window.nexusTest.directMessages;
            rows.find(row=>row.message_id.endsWith('128')).body='Online bearbeitet';
            rows.splice(rows.findIndex(row=>row.message_id.endsWith('129')),1);
          },groups);
          await setOnline(page,true);
          await page.locator('.messages .message-body').filter({hasText:'Online bearbeitet'}).waitFor();
          assert.equal(await page.locator('.messages .message-body').filter({hasText:latest}).count(),0,'Deleted messages must not be merged back from cache');
          assert.equal(await page.locator('.conversation [role=status]').filter({hasText:'Offline – zuletzt gespeichert:'}).count(),0);
          await setOnline(page,false);
          await page.reload();
          await page.locator('.messages .message-body').filter({hasText:'Online bearbeitet'}).waitFor();
          assert.equal(await page.locator('.messages .message-body').filter({hasText:latest}).count(),0);
          // Expired auth offline must still permit local reading, but never create an authenticated user.
          await page.evaluate(()=>localStorage.setItem('nexusTest.expired','1'));
          await page.reload();
          await page.getByRole('heading',{name:'Gespeicherte Chats'}).waitFor();
          if(groups)await page.getByRole('button',{name:'Gruppen',exact:true}).click();
          await page.locator('.offline-reader-list button').filter({hasText:label}).click();
          await page.locator('.offline-message p').filter({hasText:'Online bearbeitet'}).waitFor();
          assert.equal(await page.locator('input, textarea, .composer').count(),0);
          await page.screenshot({path:`browser-results/offline-cache-${name}-${kind}.png`});
          assert.equal(await page.evaluate(()=>window.nexusTest.chatReadCalls.length),0);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
          await setOnline(page,true);
          await page.locator('.messages .message-body').filter({hasText:latest}).waitFor();
          // Switching accounts purges old snapshots, including late responses (harness below).
          await page.evaluate(()=>window.nexusTest.switchUser('second-account'));
          for(let i=0;i<80 && (await saved(page)).some(row=>row.owner==='me');i++)await page.waitForTimeout(50);
          assert.equal((await saved(page)).some(row=>row.owner==='me'),false);
          await page.evaluate(async()=>{const {supabase}=await import('/tests/browser/supabase.mjs');await supabase.auth.signOut();});
          for(let i=0;i<80 && (await saved(page)).length;i++)await page.waitForTimeout(50);
          assert.deepEqual(await saved(page),[]);
          assert.equal(await page.evaluate(()=>localStorage.getItem('nexus-offline-account-v1')),null);
          console.log(`${name} ${kind}: offline restart, expired-session reader, resync, account separation and logout passed`);
        } finally { await context.close(); }
      }
      const context=await browser.newContext();await init(context);
      try {
        const page=await context.newPage();await page.goto(origin+'/cache-harness');
        const result=await page.evaluate(async()=>{
          const cache=await import('/src/features/offline/chatCache.ts');
          const assert=(test,message)=>{if(!test)throw new Error(message);};
          const online=value=>localStorage.setItem('nexusTest.offline',value?'0':'1');
          const row=(body='before')=>({message_id:'m1',body,sender_id:'a',created_at:'2026-01-01T00:00:00Z',attachments:[{signed_url:'PRIVATE_URL',storage_path:'PRIVATE_PATH'}],access_token:'SECRET_TOKEN',reply_body:'OLD_REPLY'});
          const config={account:'a',kind:'direct',id:'c1',empty:[],rows:data=>data,restore:rows=>rows};
          const read=fetch=>cache.cachedChatRead({...config,fetch});
          await cache.syncOfflineChatAccount('a');
          await read(async()=>({data:[row()],error:null}));
          online(false);
          let saved=await read(()=>{throw Error('offline fetch');});
          assert(saved.cachedAt && saved.data.length===1,'saved snapshot available');
          assert(!/PRIVATE|SECRET|OLD_REPLY/.test(JSON.stringify(saved)),'no attachment credentials or redundant quote retained');
          online(true);
          await cache.patchSavedMessage('a','direct','c1','m1',{...row(),deleted_at:'2026-01-02'});
          online(false);saved=await read(()=>{throw Error('offline fetch');});
          assert(saved.data[0].body==='','deletion removes cached body');
          online(true);
          let finish;const late=read(()=>new Promise(resolve=>{finish=resolve;}));
          await read(async()=>({data:[row('newest')],error:null}));
          finish({data:[row('stale')],error:null});await late;
          online(false);saved=await read(()=>{throw Error('offline fetch');});
          assert(saved.data[0].body.startsWith('newest'),'older response cannot replace newer snapshot');
          online(true);
          await read(async()=>({data:[],error:'kein Zugriff'}));
          online(false);saved=await read(()=>{throw Error('offline fetch');});assert(saved.cachedAt===null,'access denial purges saved snapshot');
          online(true);
          const lateAccount=read(()=>new Promise(resolve=>{finish=resolve;}));
          await cache.syncOfflineChatAccount('b');finish({data:[row('account a secret')],error:null});await lateAccount;
          await cache.syncOfflineChatAccount('a');online(false);
          saved=await read(()=>{throw Error('offline fetch');});assert(saved.cachedAt===null,'late response cannot repopulate account cache');
          online(true);
          await read(async()=>({data:Array.from({length:150},(_,i)=>({...row(),message_id:'m'+i})),error:null}));
          online(false);saved=await read(()=>{throw Error('offline fetch');});assert(saved.data.length===100,'message storage is bounded');
          online(true);
          const lateRevoked=read(()=>new Promise(resolve=>{finish=resolve;}));
          await cache.cachedChatRead({...config,id:'list',fetch:async()=>({data:[],error:null})});
          finish({data:[row('removed chat')],error:null});await lateRevoked;
          online(false);saved=await read(()=>{throw Error('offline fetch');});assert(saved.cachedAt===null,'removed chat pruned on successful list refresh');
          online(true);
          const originalTransaction=IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction=function(){throw new Error('Storage unavailable');};
          try { const live=await read(async()=>({data:[row('online unaffected')],error:null}));assert(!live.error && live.data[0].body==='online unaffected','blocked storage never breaks online reads'); }
          finally {IDBDatabase.prototype.transaction=originalTransaction;}
          await cache.syncOfflineChatAccount(null);
          return 'bounded storage, sanitization, deletion, access revocation, stale responses and account fences passed';
        });
        console.log(`${name}: ${result}`);
      } finally {await context.close();}
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
