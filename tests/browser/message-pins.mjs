import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url));
const stub=fileURLToPath(new URL('./supabase.mjs',import.meta.url));
const origin='http://127.0.0.1:4197';
const server=await createServer({root,configFile:false,base:'/',cacheDir:'node_modules/.vite-pins-browser',server:{host:'127.0.0.1',port:4197,strictPort:true,hmr:false},plugins:[{name:'pin-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen(); await mkdir('browser-results',{recursive:true});
try {
  for(const [name,engine] of (process.env.NEXUS_BROWSER==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
    const browser=await engine.launch();
    try {
      for(const kind of ['direct','group']){
        const group=kind==='group',chatId=group?'g1':'c1',anchor=group?'gm-search-anchor':'dm-history-008';
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(({kind,chatId,anchor})=>{
          window.pinMenuEvents=[];
          const record=event=>{
            const popup=document.querySelector('[role="menu"]');
            if(!popup&&!window.pinMenuRecording)return;
            const rect=popup?.getBoundingClientRect();
            window.pinMenuEvents.push({time:Math.round(performance.now()),type:event.type,target:event.target instanceof Element?event.target.className:event.target?.nodeName||'viewport',active:document.activeElement?.className,anchorY:document.querySelector('[aria-expanded="true"].message-options-trigger')?.getBoundingClientRect().y,menu:rect?{x:rect.x,y:rect.y,height:rect.height}:null,scroll:document.querySelector('.messages')?.scrollTop});
            if(window.pinMenuEvents.length>80)window.pinMenuEvents.shift();
          };
          for(const type of ['scroll','resize','focusin','pointerdown']){document.addEventListener(type,record,true);window.visualViewport?.addEventListener(type,record);}
          window.pinOnline=true;Object.defineProperty(navigator,'onLine',{get:()=>window.pinOnline,configurable:true});
          sessionStorage.setItem('nexusTest.messageHistoryFixture','1');
          if(!sessionStorage.getItem('nexusTest.pinInitialized')){
            sessionStorage.setItem('nexusTest.pinInitialized','1');sessionStorage.setItem('nexusTest.pinRole','admin');
            sessionStorage.setItem('nexusTest.pins',JSON.stringify([{kind,chat_id:chatId,message_id:anchor,pinned:true,created_at:'2026-09-30T10:00:00Z'}]));
          }
        },{kind,chatId,anchor});
        const page=await context.newPage();page.setDefaultTimeout(12000);
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        try {
          const url=`${origin}/#/app/${group?'groups':'chats'}?${group?'group':'conversation'}=${chatId}`;
          await page.goto(url);
          const bar=page.locator('.message-pins'),summary=bar.locator('summary');
          await summary.waitFor();
          assert.equal(await page.locator(`[data-message-id="${anchor}"]`).count(),0,'Old pin is outside the initial history window');
          await summary.click();await bar.locator('.pin-open').click();
          const message=page.locator(`[data-message-id="${anchor}"]`);
          await page.waitForFunction(({id,group})=>{
            const el=document.querySelector(`[data-message-id="${id}"]`);
            return group ? el?.dataset.highlighted==='true' : el?.getAttribute('aria-current')==='true';
          },{id:anchor,group});
          assert.ok(page.url().includes(`message=${anchor}`),'Pin uses authorized message-context navigation');
          for(const width of [320,390,1440]){
            await page.setViewportSize({width,height:844});
            if(!await bar.evaluate(el=>el.open))await summary.click();
            const rect=await bar.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width,'Pin strip fits viewport');
            await page.screenshot({path:`browser-results/${name}-${kind}-pins-${width}.png`,fullPage:true});
          }
          await page.setViewportSize({width:390,height:844});
          const menu=page.getByRole('menu',{name:'Nachrichtenoptionen'});
          const action=async label=>{
            const trigger=message.getByRole('button',{name:'Optionen',exact:true});
            // Viewport changes and removing the pin strip queue scroll/resize
            // events. Wait for the actual geometry and events to settle before
            // opening a menu that intentionally dismisses when either changes.
            await trigger.scrollIntoViewIfNeeded();
            await trigger.evaluate(element=>new Promise(resolve=>{
              let changed=performance.now(),previous='';
              const note=()=>{changed=performance.now();};
              const viewport=window.visualViewport;
              document.addEventListener('scroll',note,true);window.addEventListener('resize',note);
              viewport?.addEventListener('scroll',note);viewport?.addEventListener('resize',note);
              const frame=()=>{
                const b=element.getBoundingClientRect();
                const shape=[b.x,b.y,b.width,b.height,viewport?.width,viewport?.height,viewport?.offsetTop].join(':');
                if(shape!==previous){previous=shape;note();}
                if(performance.now()-changed<150){requestAnimationFrame(frame);return;}
                document.removeEventListener('scroll',note,true);window.removeEventListener('resize',note);
                viewport?.removeEventListener('scroll',note);viewport?.removeEventListener('resize',note);resolve();
              };requestAnimationFrame(frame);
            }));
            await page.evaluate(()=>{window.pinMenuEvents=[];window.pinMenuRecording=true;});
            await trigger.click();
            await menu.getByRole('menuitem',{name:label,exact:true}).click();
          };
          await action('Anheftung lösen');await bar.waitFor({state:'hidden'});
          await action('Anheften');await summary.waitFor();
          assert.equal(await page.evaluate(()=>window.nexusTest.pinRows.filter(p=>p.pinned).length),1,'No duplicate pins');
          await page.reload();await summary.waitFor();
          await page.evaluate(()=>{window.pinOnline=false;window.dispatchEvent(new Event('offline'));});
          await bar.waitFor({state:'hidden'});
          await page.evaluate(()=>{window.pinOnline=true;window.dispatchEvent(new Event('online'));});
          await summary.waitFor();
          // A pin changed by the other participant must update through Realtime.
          for(const pinned of [false,true]){
            await page.evaluate(({kind,chatId,anchor,pinned})=>{
              window.nexusTest.pinRows.find(pin=>pin.message_id===anchor).pinned=pinned;
              window.nexusTest.emit(kind+'_message_pins','UPDATE',{new:{message_id:anchor,[kind==='direct'?'conversation_id':'group_id']:chatId}});
            },{kind,chatId,anchor,pinned});
            if(pinned)await summary.waitFor();else await bar.waitFor({state:'hidden'});
          }
          if(!await bar.evaluate(el=>el.open))await summary.click();
          await bar.locator('.pin-open').click();
          if(group){
            await page.evaluate(()=>sessionStorage.setItem('nexusTest.pinRole','member'));
            await page.reload();await summary.waitFor();await summary.click();await bar.locator('.pin-open').click();
            assert.equal(await bar.getByRole('button',{name:'Anheftung lösen',exact:true}).count(),0,'Members can see but not remove pins');
            await message.getByRole('button',{name:'Optionen',exact:true}).click();
            assert.equal(await menu.getByRole('menuitem',{name:'Anheftung lösen',exact:true}).count(),0);
            await page.keyboard.press('Escape');
            await page.evaluate(()=>sessionStorage.setItem('nexusTest.pinRole','admin'));
            await page.reload();await summary.waitFor();await summary.click();await bar.locator('.pin-open').click();
          }
          await action('Anheftung lösen');await bar.waitFor({state:'hidden'});
          await page.evaluate(()=>{window.nexusTest.pinFailure=true;});
          await action('Anheften');await page.getByRole('alert').filter({hasText:'Anheftung konnte nicht gespeichert werden'}).waitFor();
          assert.equal(await bar.count(),0,'Write failure must not invent a pin');
          await page.evaluate(()=>{window.nexusTest.pinFailure=false;});
          await action('Anheften');await summary.waitFor();
          // An edit, then a soft delete on the other participant's side.
          await page.evaluate(({group,anchor})=>{
            const msg=(group?window.nexusTest.groupMessages:window.nexusTest.directMessages).find(m=>m.message_id===anchor);
            msg.body='Aktualisierte angeheftete Nachricht';window.nexusTest.emit(group?'group_messages':'direct_messages','UPDATE',{new:{...msg,id:msg.message_id}});
          },{group,anchor});
          if(!await bar.evaluate(el=>el.open))await summary.click();
          await bar.getByText('Aktualisierte angeheftete Nachricht',{exact:true}).waitFor();
          await page.evaluate(({group,anchor})=>{
            const msg=(group?window.nexusTest.groupMessages:window.nexusTest.directMessages).find(m=>m.message_id===anchor);
            msg.deleted_at=new Date().toISOString();msg.body='';window.nexusTest.emit(group?'group_messages':'direct_messages','UPDATE',{new:{...msg,id:msg.message_id}});
          },{group,anchor});
          await bar.waitFor({state:'hidden'});
          // An old response must not bring another account's preview back.
          await page.reload();await summary.waitFor();
          await page.evaluate(()=>{window.nexusTest.pinDelay=500;window.nexusTest.emit('direct_message_pins');window.nexusTest.emit('group_message_pins');});
          await page.waitForTimeout(130);
          await page.evaluate(()=>{window.nexusTest.pinReadFailure=true;window.nexusTest.switchUser('other');});
          await page.waitForTimeout(650);
          assert.equal(await bar.count(),0,'Account switch fences late preview responses');
          assert.deepEqual(errors,[]);
          console.log(`${name} ${kind}: pins, old-message jump, roles, reload, edits/deletion, offline, errors and account fencing passed`);
        }catch(error){console.error('Pin menu events',JSON.stringify(await page.evaluate(()=>window.pinMenuEvents)));await page.screenshot({path:`browser-results/${name}-${kind}-pins-failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-2000));throw error;}
        finally{await context.close();}
      }
    }finally{await browser.close();}
  }
}finally{await server.close();}
