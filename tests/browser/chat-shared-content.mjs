import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'vite';
const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url)),stub=fileURLToPath(new URL('./shared-content-service.mjs',import.meta.url));
const origin='http://127.0.0.1:4198';
const server=await createServer({root,configFile:false,base:'/',cacheDir:'node_modules/.vite-shared-browser',server:{host:'127.0.0.1',port:4198,strictPort:true,hmr:false},plugins:[{name:'shared-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
try{
  for(const [name,engine] of (process.env.NEXUS_BROWSER==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
    const browser=await engine.launch();
    try{for(const kind of ['direct','group']){
      const group=kind==='group',chatId=group?'g1':'c1',anchor=group?'gm-search-anchor':'dm-history-008';
      const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
      const external=[];
      await context.route('**/*',route=>{
        const url=route.request().url();
        if(url.startsWith(origin+'/__shared-file/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#5146a8"/><circle cx="320" cy="165" r="90" fill="#b4aaff"/><text x="320" y="315" text-anchor="middle" font-size="32" fill="white">Projektbild</text></svg>'});
        if(url.startsWith(origin))return route.continue();external.push(url);return route.abort();
      });
      await context.addInitScript(()=>{sessionStorage.setItem('nexusTest.messageHistoryFixture','1');window.sharedOnline=true;Object.defineProperty(navigator,'onLine',{get:()=>window.sharedOnline,configurable:true});});
      const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
      const dialog=page.getByRole('dialog',{name:'Medien, Dateien & Links',exact:true});
      const trigger=page.getByRole('button',{name:'Medien, Dateien & Links',exact:true});
      const count=async n=>page.waitForFunction(n=>document.querySelectorAll('.chat-shared-dialog [data-shared-item]').length===n,n);
      const search=async value=>{await dialog.getByRole('searchbox').fill(value);await dialog.getByRole('button',{name:'Inhalte suchen',exact:true}).click();};
      try{
        await page.goto(`${origin}/#/app/${group?'groups':'chats'}?${group?'group':'conversation'}=${chatId}`);
        await trigger.waitFor();assert.equal(await page.locator(`[data-message-id="${anchor}"]`).count(),0);
        await trigger.click();await count(24);
        await page.waitForFunction(()=>document.querySelector('.shared-image img')?.naturalWidth>0);
        await dialog.getByRole('button',{name:'Bild ansehen: Foto 29.png',exact:true}).click();
        await page.getByRole('dialog',{name:'Foto 29.png',exact:true}).waitFor();
        await page.keyboard.press('Escape');assert.equal(await page.locator('.shared-image-preview').count(),0);
        assert.equal(await dialog.isVisible(),true,'Escape only closes nested preview');
        for(const width of [320,390,1440]){
          await page.setViewportSize({width,height:844});
          const fits=await dialog.evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;});
          assert.ok(fits,`${width}px dialog fits without horizontal scrolling`);
          await page.screenshot({path:`browser-results/${name}-${kind}-shared-${width}.png`,fullPage:true});
        }
        await page.setViewportSize({width:390,height:844});
        await dialog.getByRole('button',{name:'Weitere laden',exact:true}).click();await count(30);
        await dialog.getByRole('button',{name:'Übersicht aktualisieren',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.shared-results')?.getAttribute('aria-busy')==='false');await count(30);
        assert.equal(new Set(await dialog.locator('[data-shared-item]').evaluateAll(els=>els.map(el=>el.dataset.sharedItem))).size,30);
        await dialog.getByRole('button',{name:'Dateien',exact:true}).click();await count(2);
        await search('100%_FERTIG');await count(1);
        await dialog.getByText('Angebot 100%_fertig.pdf',{exact:true}).waitFor();
        assert.match(await dialog.getByRole('link',{name:'Datei öffnen'}).getAttribute('href'),/\/__shared-file\//);
        await search('nicht vorhanden');await dialog.getByText('Keine passenden Inhalte gefunden.',{exact:true}).waitFor();
        await search('');await count(2);
        await dialog.getByRole('button',{name:'Links',exact:true}).click();await count(2);
        const links=dialog.locator('a.shared-link');
        assert.deepEqual((await links.evaluateAll(els=>els.map(el=>el.href))).sort(),['https://example.com/Projektplan','https://example.org/Team']);
        assert.deepEqual(external,[],'Overview must not fetch shared websites or tracking previews');
        await search('PROJEKTPLAN');await count(1);
        await dialog.getByRole('button',{name:'Zur Nachricht: https://example.com/Projektplan',exact:true}).click();
        await page.waitForFunction(({anchor,group})=>{const el=document.querySelector(`[data-message-id="${anchor}"]`);return group?el?.dataset.highlighted==='true':el?.getAttribute('aria-current')==='true';},{anchor,group});
        assert.ok(page.url().includes('message='+anchor));assert.equal(await dialog.count(),0);
        await trigger.click();await count(24);
        // Late image response cannot overwrite the newer file category.
        await page.evaluate(()=>{window.nexusSharedTest.defer=true;});
        await dialog.getByRole('button',{name:'Übersicht aktualisieren',exact:true}).click();
        await page.waitForFunction(()=>window.nexusSharedTest.waiting.length>0);
        await page.evaluate(()=>{window.nexusSharedTest.defer=false;});
        await dialog.getByRole('button',{name:'Dateien',exact:true}).click();await count(2);
        await page.evaluate(()=>{window.nexusSharedTest.waiting.splice(0).forEach(resolve=>resolve());});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await dialog.locator('.shared-image').count(),0);
        // Realtime edit/deletion updates the overview, including older sources.
        await page.evaluate(({kind,chatId,anchor})=>{
          const item=window.nexusSharedTest.items.find(i=>i.kind===kind&&i.item_id==='a:contract');item.title='Angebot korrigiert.pdf';
          window.nexusTest.emit(kind+'_messages','UPDATE',{new:{id:anchor,[kind==='direct'?'conversation_id':'group_id']:chatId}});
        },{kind,chatId,anchor});
        await dialog.getByText('Angebot korrigiert.pdf',{exact:true}).waitFor();
        await page.evaluate(({kind,chatId,anchor})=>{
          const msg=(kind==='direct'?window.nexusTest.directMessages:window.nexusTest.groupMessages).find(m=>m.message_id===anchor);msg.deleted_at=new Date().toISOString();
          window.nexusTest.emit(kind+'_messages','UPDATE',{new:{...msg,id:anchor,[kind==='direct'?'conversation_id':'group_id']:chatId}});
        },{kind,chatId,anchor});await count(1);
        await page.evaluate(()=>{window.nexusSharedTest.failure=true;});
        await dialog.getByRole('button',{name:'Übersicht aktualisieren',exact:true}).click();
        await dialog.getByRole('alert').waitFor();await count(0);
        await page.evaluate(()=>{window.nexusSharedTest.failure=false;});
        await dialog.getByRole('button',{name:'Erneut laden',exact:true}).click();await count(1);
        await page.evaluate(()=>{window.nexusSharedTest.signFailure=true;});
        await dialog.getByRole('button',{name:'Bilder',exact:true}).click();await count(24);
        await dialog.getByText('Vorschau oder Datei nicht verfügbar.',{exact:true}).first().waitFor();
        assert.equal(await dialog.getByRole('link',{name:'Datei öffnen'}).count(),0);
        await page.evaluate(()=>{window.nexusSharedTest.signFailure=false;});
        await dialog.getByRole('button',{name:'Erneut laden',exact:true}).first().click();
        await dialog.getByRole('button',{name:'Bild ansehen: Foto 29.png',exact:true}).waitFor();
        assert.ok(await page.evaluate(()=>window.nexusSharedTest.signs.every(s=>s.bucket==='nexus-chat-attachments'&&s.expiry===60)));
        await page.evaluate(()=>{window.sharedOnline=false;window.dispatchEvent(new Event('offline'));});await dialog.waitFor({state:'hidden'});
        assert.equal(await trigger.isDisabled(),true);
        await page.evaluate(()=>{window.sharedOnline=true;window.dispatchEvent(new Event('online'));});
        await page.waitForFunction(()=>!document.querySelector('.shared-content-trigger')?.disabled);
        await trigger.click();await count(24);
        await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
        assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Close restores focus');
        await page.evaluate(()=>{window.nexusSharedTest.defer=true;});await trigger.click();
        await page.waitForFunction(()=>window.nexusSharedTest.waiting.length>0);
        await page.evaluate(()=>{window.nexusTest.switchUser('other');window.nexusSharedTest.defer=false;window.nexusSharedTest.waiting.splice(0).forEach(resolve=>resolve());});
        await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('[data-shared-item]').count(),0);
        assert.deepEqual(errors,[]);
        console.log(`${name} ${kind}: gallery, preview, paging, search, old-message jump, edits/deletion, failures, offline, focus and account fencing passed`);
      }catch(error){await page.screenshot({path:`browser-results/${name}-${kind}-shared-failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-2500));throw error;}
      finally{await context.close();}
    }}finally{await browser.close();}
  }
}finally{await server.close();}
