import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url)),stub=fileURLToPath(new URL('./supabase.mjs',import.meta.url));
const origin='http://127.0.0.1:4198';
const server=await createServer({root,configFile:false,base:'/',cacheDir:'node_modules/.vite-organization-browser',server:{host:'127.0.0.1',port:4198,strictPort:true,hmr:false},plugins:[{name:'organization-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
try{
  for(const [engineName,engine] of (process.env.NEXUS_BROWSER==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
    const browser=await engine.launch();
    try{
      for(const kind of ['direct','group']){
        const group=kind==='group',first=group?'g1':'c1',second=group?'g2':'c2';
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(()=>{
          sessionStorage.setItem('nexusTest.messageHistoryFixture','1');
          window.organizationOnline=sessionStorage.getItem('nexusTest.organizationOffline')!=='1';
          Object.defineProperty(navigator,'onLine',{get:()=>window.organizationOnline,configurable:true});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        try{
          const url=`${origin}/#/app/${group?'groups':'chats'}`;
          await page.goto(url);
          const row=id=>page.locator(`.chat-list-row[data-chat-id="${id}"]`);
          const views=page.getByRole('group',{name:'Chatansicht'});
          const tab=name=>views.getByRole('button',{name,exact:name!=='Archiv'});
          const menu=page.getByRole('menu',{name:'Chat organisieren'});
          const action=async(id,label)=>{await row(id).getByRole('button',{name:/Chat-Optionen:/}).click();await menu.getByRole('menuitem',{name:label,exact:true}).click();};
          await row(first).waitFor();await row(second).waitFor();
          await action(second,'Als Favorit markieren');await row(second).getByLabel('Favorit',{exact:true}).waitFor();
          assert.equal(await page.locator('.chat-list-row').first().getAttribute('data-chat-id'),second);
          await tab('Favoriten').click();assert.equal(await page.locator('.chat-list-row').count(),1);
          await action(second,'Archivieren');await row(second).waitFor({state:'hidden'});
          await tab('Archiv').click();await row(second).waitFor();
          await page.reload();await row(first).waitFor();assert.equal(await row(second).count(),0,'Archived chat stays out of active list after reload');
          await tab('Archiv').click();await row(second).waitFor();
          // Opening an archive preserves it and uses the existing message route.
          await row(second).locator('button.chat').click();
          await page.locator('.conversation .messages').waitFor();
          assert.ok(page.url().includes(`${group?'group':'conversation'}=${second}`));
          await page.locator('.mobile-chat-backbar button').click();await row(second).waitFor();
          await action(second,'Aus Archiv holen');await row(second).waitFor({state:'hidden'});
          await tab('Aktiv').click();await row(second).waitFor();
          for(const width of [320,390,1440]){
            await page.setViewportSize({width,height:844});
            await row(second).getByRole('button',{name:/Chat-Optionen:/}).click();
            const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'Options fit viewport');
            await page.screenshot({path:`browser-results/${engineName}-${kind}-organization-${width}.png`,fullPage:true});
            await page.keyboard.press('Escape');
          }
          await page.setViewportSize({width:390,height:844});
          await action(second,'Archivieren');await row(second).waitFor({state:'hidden'});
          // A new message on the other participant's side revives an archive,
          // including after app restart; SQL tests verify the real trigger.
          await page.evaluate(({group,second})=>{
            const chat=(group?window.nexusTest.groupChats:window.nexusTest.conversations).find(c=>(c.group_id||c.conversation_id)===second);
            chat.last_message='Neue Nachricht';chat.last_message_at=new Date().toISOString();
            window.nexusTest.emit(group?'group_messages':'direct_messages','INSERT',{new:{id:'incoming-org',sender_id:'other',[group?'group_id':'conversation_id']:second}});
          },{group,second});
          await row(second).waitFor();await row(second).getByLabel('Favorit',{exact:true}).waitFor();
          // Remote device update for the same account; another account's event
          // must not be delivered to this account-scoped subscription.
          const delivered=await page.evaluate(({kind,second})=>{
            const prefs=window.nexusTest.organizationRows.find(p=>p.kind===kind&&p.chat_id===second&&p.user_id==='me');
            prefs.favorite=false;
            window.nexusTest.emit(kind+'_chat_preferences','UPDATE',{new:{...prefs}});
            return window.nexusTest.emit(kind+'_chat_preferences','UPDATE',{new:{user_id:'other',chat_id:second,favorite:true,archived:true}});
          },{kind,second});
          assert.equal(delivered,0,'No cross-account realtime subscription');
          await row(second).getByLabel('Favorit',{exact:true}).waitFor({state:'hidden'});
          await action(second,'Als Favorit markieren');await row(second).getByLabel('Favorit',{exact:true}).waitFor();
          // Save failure never hides a chat or invents a successful preference.
          await page.evaluate(()=>{window.nexusTest.organizationFailure=true;});
          await action(second,'Archivieren');await page.getByRole('alert').filter({hasText:'Chat-Einstellung konnte nicht gespeichert'}).waitFor();
          assert.equal(await row(second).count(),1);
          await page.evaluate(()=>{window.nexusTest.organizationFailure=false;});
          await action(second,'Archivieren');await row(second).waitFor({state:'hidden'});
          await tab('Archiv').click();await row(second).waitFor();
          await page.evaluate(()=>{sessionStorage.setItem('nexusTest.organizationOffline','1');window.organizationOnline=false;window.dispatchEvent(new Event('offline'));});
          await page.waitForFunction(()=>document.querySelector('.chat-list-options')?.disabled===true);
          assert.equal(await row(second).getByRole('button',{name:/Chat-Optionen:/}).isDisabled(),true);
          await page.reload();await tab('Archiv').click();await row(second).waitFor();
          await row(second).getByLabel('Favorit',{exact:true}).waitFor();
          assert.equal(await row(second).getByRole('button',{name:/Chat-Optionen:/}).isDisabled(),true,'Offline snapshot keeps personal organization read-only');
          await page.evaluate(()=>{sessionStorage.removeItem('nexusTest.organizationOffline');window.organizationOnline=true;window.dispatchEvent(new Event('online'));});
          await page.waitForFunction(()=>!document.querySelector('.chat-list-options')?.disabled);
          await action(second,'Aus Archiv holen');await row(second).waitFor({state:'hidden'});await tab('Aktiv').click();await row(second).waitFor();
          await action(second,'Favorit entfernen');await row(second).getByLabel('Favorit',{exact:true}).waitFor({state:'hidden'});
          // Late writes/reads from a previous account must not modify the next UI.
          await page.evaluate(()=>{window.nexusTest.organizationWriteDelay=400;});
          await action(second,'Archivieren');
          await page.evaluate(()=>window.nexusTest.switchUser('other'));
          await row(first).waitFor();await row(second).waitFor();
          await page.waitForTimeout(650);
          assert.equal(await row(second).count(),1,'Late previous-account save does not hide another account chat');
          assert.equal(await row(second).getByLabel('Favorit',{exact:true}).count(),0);
          assert.deepEqual(errors,[]);
          console.log(`${engineName} ${kind}: favorites, archive, restore, old messages, incoming revival, account-scoped realtime, offline reload, errors, mobile layouts and account fencing passed`);
        }catch(error){await page.screenshot({path:`browser-results/${engineName}-${kind}-organization-failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-2500));throw error;}
        finally{await context.close();}
      }
    }finally{await browser.close();}
  }
}finally{await server.close();}
