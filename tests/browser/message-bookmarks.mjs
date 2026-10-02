import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url)),stub=fileURLToPath(new URL('./supabase.mjs',import.meta.url));
const origin='http://127.0.0.1:4204';
const server=await createServer({root,configFile:false,base:'/',cacheDir:'node_modules/.vite-bookmarks-browser',server:{host:'127.0.0.1',port:4204,strictPort:true,hmr:false},plugins:[{name:'bookmarks-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
try{
  for(const [engineName,engine] of (process.env.NEXUS_BROWSER==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
    const browser=await engine.launch();
    try{
      for(const kind of ['direct','group']){
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(()=>{window.bookmarkOnline=true;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.bookmarkOnline});});
        const page=await context.newPage();page.setDefaultTimeout(12000);
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        const group=kind==='group',id=group?'gm1':'dm1',chatId=group?'g1':'c1';
        const url=`${origin}/#/app/${group?'groups?group=g1':'chats?conversation=c1'}`;
        const message=page.locator(`[data-message-id="${id}"]`),trigger=message.getByRole('button',{name:'Optionen',exact:true}),menu=page.getByRole('menu',{name:'Nachrichtenoptionen'});
        const openMenu=async()=>{
          await trigger.scrollIntoViewIfNeeded();
          await trigger.evaluate(el=>new Promise(resolve=>{let previous='',last=performance.now();const frame=()=>{const b=el.getBoundingClientRect(),shape=[b.x,b.y,b.width,b.height].join(':');if(shape!==previous){previous=shape;last=performance.now();}if(performance.now()-last<180)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);}));
          await trigger.click();await menu.waitFor();
        };
        const remember=async()=>{await openMenu();await menu.getByRole('menuitem',{name:'Nachricht merken',exact:true}).click();};
        const goList=async()=>{if(await page.getByRole('button',{name:'Hauptmenü öffnen',exact:true}).isVisible())await page.getByRole('button',{name:'Hauptmenü öffnen',exact:true}).click();await page.getByRole('navigation',{name:'Hauptnavigation'}).getByRole('button',{name:'Merkliste',exact:true}).click();await page.getByRole('heading',{name:'Gemerkte Nachrichten',exact:true}).waitFor();};
        const cards=page.locator('.bookmark-card');
        const refresh=()=>page.getByRole('button',{name:'Aktualisieren',exact:true}).click();
        try{
          await page.goto(url);await message.locator('.message-body').waitFor();
          const body='Angebot 👨‍👩‍👧‍👦\nhttps://example.invalid/?a=1&b=2\n<script>window.unsafe=true</script>';
          await page.evaluate(({group,body})=>{(group?window.nexusTest.groupMessages:window.nexusTest.directMessages)[0].body=body;window.nexusTest.emit(group?'group_messages':'direct_messages');},{group,body});
          await page.waitForFunction(({id,body})=>document.querySelector(`[data-message-id="${id}"] .message-body`)?.textContent===body,{id,body});
          const draft=page.locator('.composer input:not([type=file])');await draft.fill('Ungesendeter Entwurf');
          await remember();await page.getByRole('status').filter({hasText:'Nachricht gemerkt.'}).waitFor();
          assert.equal(await draft.inputValue(),'Ungesendeter Entwurf');
          assert.equal(await page.evaluate(()=>window.nexusTest.bookmarkRows.length),1);
          await openMenu();await menu.getByRole('menuitem',{name:'Markierung entfernen',exact:true}).click();
          await page.getByRole('status').filter({hasText:'Markierung entfernt.'}).waitFor();
          assert.equal(await page.evaluate(()=>window.nexusTest.bookmarkRows.length),0);

          await page.evaluate(()=>{window.nexusTest.loseBookmarkResponse=true;window.nexusTest.bookmarkCalls=[];});
          await remember();await page.getByRole('alert').filter({hasText:'Markierung nicht bestätigt'}).waitFor();
          await remember();await page.getByRole('status').filter({hasText:'Nachricht gemerkt.'}).waitFor();
          const calls=await page.evaluate(()=>window.nexusTest.bookmarkCalls);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
          assert.equal(await page.evaluate(()=>window.nexusTest.bookmarkRows.length),1,'Retry must not duplicate');
          await page.reload();await message.waitFor();await openMenu();await menu.getByRole('menuitem',{name:'Markierung entfernen',exact:true}).waitFor();await page.keyboard.press('Escape');
          await goList();await cards.first().waitFor();
          // Reload resets fixture messages, but the bookmark itself persists.
          await page.evaluate(({group,body})=>{(group?window.nexusTest.groupMessages:window.nexusTest.directMessages)[0].body=body;},{group,body});
          await refresh();await cards.getByText(body,{exact:true}).waitFor();
          assert.equal(await page.evaluate(()=>window.unsafe),undefined);
          for(const width of [320,390,1440]){
            await page.setViewportSize({width,height:844});
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Page overflow');
            for(const box of await cards.evaluateAll(rows=>rows.map(el=>{const b=el.getBoundingClientRect();return {x:b.x,right:b.right};})))assert.ok(box.x>=0&&box.right<=width,'Cards fit screen');
            await page.screenshot({path:`browser-results/${engineName}-${kind}-bookmarks-${width}.png`,fullPage:true});
          }
          await page.setViewportSize({width:390,height:844});
          const search=page.getByRole('searchbox',{name:'Merkliste durchsuchen'});
          await search.fill('Unauffindbar');await page.getByRole('button',{name:'Suchen',exact:true}).click();await page.getByRole('heading',{name:'Keine passenden Nachrichten'}).waitFor();
          await page.getByRole('button',{name:'Suche zurücksetzen'}).click();await cards.first().waitFor();
          await page.evaluate(group=>{(group?window.nexusTest.groupMessages:window.nexusTest.directMessages)[0].body='Aktualisierte Absprache';},group);
          await refresh();await cards.getByText('Aktualisierte Absprache',{exact:true}).waitFor();
          await cards.getByRole('link',{name:'Zur Nachricht'}).click();await message.getByText('Aktualisierte Absprache',{exact:true}).waitFor();
          assert.ok(page.url().includes('message='+id));
          await goList();await cards.first().waitFor();

          await page.evaluate(()=>{window.nexusTest.bookmarkWriteFailure=true;});
          await cards.getByRole('button',{name:'Markierung entfernen'}).click();await page.getByRole('alert').filter({hasText:'Markierung nicht bestätigt'}).waitFor();
          assert.equal(await cards.count(),1,'Failed removal must not disappear');
          await page.evaluate(()=>{window.nexusTest.bookmarkWriteFailure=false;window.nexusTest.loseBookmarkResponse=true;});
          await cards.getByRole('button',{name:'Markierung entfernen'}).click();await page.getByRole('alert').filter({hasText:'Markierung nicht bestätigt'}).waitFor();
          await cards.getByRole('button',{name:'Markierung entfernen'}).click();await page.getByRole('heading',{name:'Noch keine gemerkten Nachrichten'}).waitFor();
          assert.equal(await page.evaluate(()=>window.nexusTest.bookmarkRows.length),0);

          // Enough synthetic entries to cross a page boundary, including attachment-only text.
          await page.evaluate(({group,kind,chatId})=>{
            const messages=group?window.nexusTest.groupMessages:window.nexusTest.directMessages;
            for(let i=0;i<35;i++){
              const mid='saved-'+i;
              messages.push({message_id:mid,conversation_id:chatId,group_id:chatId,sender_id:'other',body:i===0?'':'Merkliste '+i,created_at:'2026-10-01T10:00:00Z',attachments:i===0?[{file_name:'Angebot.pdf'}]:[]});
              window.nexusTest.bookmarkRows.push({id:'bm-'+String(i).padStart(3,'0'),user_id:'me',kind,message_id:mid,saved_at:'2026-10-02T10:00:00Z'});
            }
          },{group,kind,chatId});
          await refresh();await page.waitForFunction(()=>document.querySelectorAll('.bookmark-card').length===30);
          await page.getByRole('button',{name:'Weitere laden'}).click();await page.waitForFunction(()=>document.querySelectorAll('.bookmark-card').length===35);
          assert.equal(new Set(await cards.evaluateAll(rows=>rows.map(el=>el.dataset.bookmarkId))).size,35);
          await search.fill('Angebot.pdf');await page.getByRole('button',{name:'Suchen',exact:true}).click();await cards.getByText('Anhang: Angebot.pdf',{exact:true}).waitFor();assert.equal(await cards.count(),1);
          await page.getByRole('button',{name:'Suche zurücksetzen'}).click();await cards.first().waitFor();
          await page.evaluate(()=>{window.nexusTest.bookmarkDenied=true;});await refresh();await page.getByRole('heading',{name:'Noch keine gemerkten Nachrichten'}).waitFor();
          await page.evaluate(()=>{window.nexusTest.bookmarkDenied=false;window.nexusTest.bookmarkReadFailure=true;});await refresh();await page.getByRole('alert').filter({hasText:'konnten nicht geladen'}).waitFor();assert.equal(await cards.count(),0);
          await page.evaluate(()=>{window.nexusTest.bookmarkReadFailure=false;});await page.getByRole('button',{name:'Erneut laden'}).click();await cards.first().waitFor();
          await page.evaluate(()=>{window.bookmarkOnline=false;window.dispatchEvent(new Event('offline'));});await page.getByText('Keine Internetverbindung.',{exact:false}).waitFor();assert.equal(await cards.count(),0);
          await page.evaluate(()=>{window.bookmarkOnline=true;window.dispatchEvent(new Event('online'));});await cards.first().waitFor();
          // A slow owner response must not restore their previews after switching accounts.
          await page.evaluate(()=>{window.nexusTest.bookmarkReadDelay=300;});await refresh();
          await page.evaluate(()=>window.nexusTest.switchUser('other'));await page.waitForTimeout(450);
          await page.getByRole('heading',{name:'Noch keine gemerkten Nachrichten'}).waitFor();assert.equal(await cards.count(),0);
          assert.deepEqual(errors,[]);
          console.log(`${engineName} ${kind}: save/remove, lost response, persistence, drafts, search, paging, deep links, edits, denied reads, offline and account isolation passed`);
        }catch(error){await page.screenshot({path:`browser-results/${engineName}-${kind}-bookmarks-failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-2000));throw error;}
        finally{await context.close();}
      }
    }finally{await browser.close();}
  }
}finally{await server.close();}
