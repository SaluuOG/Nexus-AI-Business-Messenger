import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url)),stub=fileURLToPath(new URL('./supabase.mjs',import.meta.url));
const origin='http://127.0.0.1:4199';
const server=await createServer({root,configFile:false,base:'/',cacheDir:'node_modules/.vite-mute-browser',server:{host:'127.0.0.1',port:4199,strictPort:true,hmr:false},plugins:[{name:'mute-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
try{
  for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!process.env.NEXUS_BROWSER||process.env.NEXUS_BROWSER===name)){
    const browser=await engine.launch();
    try{
      for(const kind of ['direct','group']){
        const group=kind==='group',chatId=group?'g2':'c2';
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(()=>{
          sessionStorage.setItem('nexusTest.messageHistoryFixture','1');
          window.muteOnline=sessionStorage.getItem('nexusTest.muteOffline')!=='1';
          Object.defineProperty(navigator,'onLine',{get:()=>window.muteOnline,configurable:true});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        try{
          const url=`${origin}/#/app/${group?'groups':'chats'}`;
          await page.goto(url);
          const row=page.locator(`.chat-list-row[data-chat-id="${chatId}"]`),badge=row.getByLabel('Chat stummgeschaltet',{exact:true});
          const trigger=row.getByRole('button',{name:/Chat-Optionen:/}),menu=page.getByRole('menu',{name:'Chat organisieren'});
          const action=async label=>{await trigger.click();await menu.getByRole('menuitem',{name:label,exact:true}).click();};
          const count=async n=>page.getByRole('link',{name:`Benachrichtigungen: ${n} ungelesen`,exact:true}).waitFor();
          await row.waitFor();
          await page.evaluate(({kind,group,chatId})=>{
            const s=window.nexusTest;
            (group?s.groupChats:s.conversations).find(c=>(c.group_id||c.conversation_id)===chatId).unread_count=3;
            s.notifications=[{id:'901',recipient_id:'me',kind:kind+'_message',created_at:new Date().toISOString(),read_at:null,details:{title:'Hinweis im stummen Chat',detail:'Neue Nachricht',chat_id:chatId}},
              {id:'902',recipient_id:'me',kind:'task_assigned',created_at:new Date().toISOString(),read_at:null,details:{title:'Andere Aufgabe',detail:'Bleibt sichtbar',workspace_id:'w1',project_id:'p1',task_id:'mine'}}];
            s.persistNotifications();s.emit('notifications','INSERT');window.dispatchEvent(new Event('focus'));
          },{kind,group,chatId});
          await count(2);
          for(const [label,hours] of [['Für 1 Stunde stummschalten',1],['Für 8 Stunden stummschalten',8]]){
            await action(label);await badge.waitFor();await count(1);
            const remaining=await page.evaluate(({kind,chatId})=>Date.parse(window.nexusTest.organizationRows.find(p=>p.kind===kind&&p.chat_id===chatId).muted_until)-Date.now(),{kind,chatId});
            assert.ok(remaining>hours*3600000-10000 && remaining<=hours*3600000);
            await row.locator('em i').getByText('3',{exact:true}).waitFor();
          }
          await action('Wieder einschalten');await badge.waitFor({state:'hidden'});await count(2);
          await action('Dauerhaft stummschalten');await badge.waitFor();await count(1);
          await action('Als Favorit markieren');await row.getByLabel('Favorit',{exact:true}).waitFor();assert.equal(await badge.count(),1);
          for(const width of [320,390,1440]){
            await page.setViewportSize({width,height:844});await trigger.click();
            const rect=await menu.boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+1&&rect.y+rect.height<=845,'Mute menu fits viewport');
            await page.screenshot({path:`browser-results/${engineName}-${kind}-mute-${width}.png`,fullPage:true});await page.keyboard.press('Escape');
          }
          await page.setViewportSize({width:390,height:844});
          await page.reload();await badge.waitFor();await count(1);
          // Verify feed filtering through the real notifications UI, not just the list icon.
          await page.getByRole('link',{name:'Benachrichtigungen: 1 ungelesen',exact:true}).click();
          await page.getByText('Andere Aufgabe',{exact:true}).waitFor();
          assert.equal(await page.getByText('Hinweis im stummen Chat',{exact:true}).count(),0);
          await page.evaluate(url=>{location.href=url;},url);await badge.waitFor();
          await page.evaluate(()=>{window.muteOnline=false;sessionStorage.setItem('nexusTest.muteOffline','1');window.dispatchEvent(new Event('offline'));});
          await page.reload();await badge.waitFor();assert.equal(await trigger.isDisabled(),true);
          await page.evaluate(()=>{window.muteOnline=true;sessionStorage.removeItem('nexusTest.muteOffline');window.dispatchEvent(new Event('online'));});
          await page.waitForFunction(()=>!document.querySelector('.chat-list-options')?.disabled);
          await action('Wieder einschalten');await badge.waitFor({state:'hidden'});await count(2);
          await page.evaluate(()=>{window.nexusTest.organizationFailure=true;});
          await action('Dauerhaft stummschalten');await page.getByRole('alert').filter({hasText:'Chat-Einstellung konnte nicht gespeichert'}).waitFor();
          assert.equal(await badge.count(),0,'Failed save cannot invent mute');
          await page.evaluate(()=>{window.nexusTest.organizationFailure=false;});
          // A remote device changes this account's setting; another account must not leak.
          const delivered=await page.evaluate(({kind,chatId})=>{
            const s=window.nexusTest,p=s.organizationRows.find(p=>p.kind===kind&&p.chat_id===chatId&&p.user_id==='me');
            p.muted_forever=false;p.muted_until=new Date(Date.now()+1800).toISOString();
            s.emit(kind+'_chat_preferences','UPDATE',{new:{...p}});
            return s.emit(kind+'_chat_preferences','UPDATE',{new:{...p,user_id:'other',muted_forever:true,muted_until:null}});
          },{kind,chatId});
          assert.equal(delivered,0);await badge.waitFor();await count(1);
          await badge.waitFor({state:'hidden'}); // Real timer, no manual reload of the list.
          await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await count(2);
          await action('Dauerhaft stummschalten');await badge.waitFor();
          await page.evaluate(()=>window.nexusTest.switchUser('other'));
          await badge.waitFor({state:'hidden'});await row.waitFor();assert.equal(await badge.count(),0);
          assert.deepEqual(errors,[]);
          console.log(`${engineName} ${kind}: timed/permanent mute, feed/counts, unread messages, reload, offline, expiry, remote updates, failure, account isolation and responsive menu passed`);
        }catch(error){await page.screenshot({path:`browser-results/${engineName}-${kind}-mute-failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-2500));throw error;}
        finally{await context.close();}
      }
    }finally{await browser.close();}
  }
}finally{await server.close();}
