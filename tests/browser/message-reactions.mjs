import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const origin = 'http://127.0.0.1:4196';
const server = await createServer({ root, configFile: false, base: '/', cacheDir: 'node_modules/.vite-reactions-browser', server: { host:'127.0.0.1', port:4196, strictPort:true, hmr:false },
  plugins: [{ name:'reaction-fixture', enforce:'pre', resolveId(source) { if(source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub; } }],
});
await server.listen();
await mkdir('browser-results',{recursive:true});
const online = (page,value) => page.evaluate(value => { window.reactionOnline=value; window.dispatchEvent(new Event(value?'online':'offline')); },value);
try {
  for(const [name,engine] of (process.env.NEXUS_BROWSER==='chromium' ? [['chromium',chromium]] : [['chromium',chromium],['webkit',webkit]])) {
    const browser=await engine.launch();
    try {
      for(const kind of ['direct','group']) {
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(()=>{window.reactionOnline=true;Object.defineProperty(navigator,'onLine',{get:()=>window.reactionOnline,configurable:true});});
        const page=await context.newPage();page.setDefaultTimeout(12000);
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        const groups=kind==='group',chatId=groups?'g1':'c1',id=groups?'gm1':'dm1';
        const url=`${origin}/#/app/${groups?'groups':'chats'}?${groups?'group':'conversation'}=${chatId}`;
        try {
          await page.goto(url);
          const message=page.locator(`[data-message-id="${id}"]`);
          const body=message.locator('.message-body');
          const picker=message.getByRole('button',{name:'Reaktion auswählen',exact:true});
          const menu=page.getByRole('menu',{name:'Reaktion auswählen',exact:true});
          const heart=()=>message.getByRole('button',{name:'Herz: 1, deine Reaktion entfernen',exact:true});
          const choose=async label=>{await picker.click();await menu.getByRole('menuitemradio',{name:label,exact:true}).click();};
          await page.waitForFunction(()=>document.querySelector('.message-reaction-trigger:not(:disabled)'));
          await body.dblclick();
          await heart().waitFor();
          assert.equal(await page.evaluate(()=>window.nexusTest.reactionCalls.length),1);
          await body.dblclick();
          assert.equal(await page.evaluate(()=>window.nexusTest.reactionCalls.length),1,'Repeated double-click must not remove or duplicate a heart');
          await choose('Gefällt mir');
          await message.getByRole('button',{name:'Gefällt mir: 1, deine Reaktion entfernen',exact:true}).waitFor();
          assert.equal(await heart().count(),0,'Selecting another emoji replaces the own reaction');
          await choose('Gefällt mir');
          await message.locator('.message-reactions').waitFor({state:'hidden'});

          await page.waitForTimeout(650); // Outside the duplicate mouse/touch-event fence.
          await body.tap();await body.tap();
          await heart().waitFor();
          await heart().click();
          await message.locator('.message-reactions').waitFor({state:'hidden'});
          const calls=await page.evaluate(()=>window.nexusTest.reactionCalls.length);
          await body.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:60,clientY:200});
          await body.dispatchEvent('pointermove',{pointerType:'touch',isPrimary:true,clientX:60,clientY:260});
          await body.dispatchEvent('pointerup',{pointerType:'touch',isPrimary:true,clientX:60,clientY:200});
          await body.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:60,clientY:200});
          await page.waitForTimeout(400);
          await body.dispatchEvent('pointerup',{pointerType:'touch',isPrimary:true,clientX:60,clientY:200});
          await message.getByRole('button',{name:'Optionen',exact:true}).dblclick();
          await page.keyboard.press('Escape');
          assert.equal(await page.evaluate(()=>window.nexusTest.reactionCalls.length),calls,'Scrolling, long press and interactive controls must not react');

          // Long press exposes the same actions and quick reactions without liking.
          await body.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:100,clientY:200});
          await page.waitForTimeout(550);
          const options=page.getByRole('menu',{name:'Nachrichtenoptionen',exact:true});
          await options.waitFor();
          await body.dispatchEvent('pointerup',{pointerType:'touch',isPrimary:true,clientX:100,clientY:200});
          assert.equal(await options.getByRole('menuitemradio').count(),6);
          assert.equal(await page.evaluate(()=>window.nexusTest.reactionCalls.length),calls);
          await options.getByRole('menuitemradio',{name:'Herz',exact:true}).click();
          await heart().waitFor(); await heart().click();
          await message.locator('.message-reactions').waitFor({state:'hidden'});
          // A right swipe selects a reply; vertical scrolling does not.
          await body.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:70,clientY:200});
          await body.dispatchEvent('pointermove',{pointerType:'touch',isPrimary:true,clientX:145,clientY:205});
          await body.dispatchEvent('pointerup',{pointerType:'touch',isPrimary:true,clientX:145,clientY:205});
          await page.locator('.composer-context').waitFor();

          for(const width of [320,390,1440]) {
            await page.setViewportSize({width,height:844});
            await picker.click();
            assert.equal(await menu.getByRole('menuitemradio').count(),6);
            const box=await menu.boundingBox();
            assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=width && box.y+box.height<=844,'Picker fits every viewport');
            await page.screenshot({path:`browser-results/${name}-${kind}-reactions-${width}.png`,fullPage:true});
            await page.keyboard.press('Escape');
            assert.equal(await picker.evaluate(el=>el===document.activeElement),true,'Escape restores trigger focus');
          }
          await page.setViewportSize({width:390,height:844});
          await page.evaluate(()=>{window.nexusTest.reactionDelay=450;});
          await choose('Herz');
          assert.equal(await picker.isDisabled(),true,'No concurrent writes for the same message');
          await heart().waitFor();
          await page.evaluate(()=>{window.nexusTest.reactionDelay=0;});

          // An incoming participant reaction updates the count through the scoped channel.
          await page.evaluate(({kind,chatId,id})=>{
            window.nexusTest.reactionRows.push({kind,chat_id:chatId,message_id:id,user_id:'other',emoji:'❤️'});
            window.nexusTest.emit(kind+'_message_reactions','INSERT',{new:{message_id:id,[kind==='direct'?'conversation_id':'group_id']:chatId}});
          },{kind,chatId,id});
          await message.getByRole('button',{name:'Herz: 2, deine Reaktion entfernen',exact:true}).waitFor();
          await page.evaluate(({kind,chatId,id})=>{
            window.nexusTest.reactionRows.find(row=>row.user_id==='other').emoji=null;
            window.nexusTest.emit(kind+'_message_reactions','UPDATE',{new:{message_id:id,[kind==='direct'?'conversation_id':'group_id']:chatId}});
          },{kind,chatId,id});
          await heart().waitFor();
          await page.reload();
          await heart().waitFor();
          await online(page,false);
          await picker.waitFor({state:'hidden'});
          assert.equal(await heart().isDisabled(),true);
          const beforeOffline=await page.evaluate(()=>window.nexusTest.reactionCalls.length);
          await body.dblclick();
          assert.equal(await page.evaluate(()=>window.nexusTest.reactionCalls.length),beforeOffline);
          await online(page,true);
          await page.waitForFunction(()=>document.querySelector('.message-reaction-trigger:not(:disabled)'));
          await page.evaluate(()=>{window.nexusTest.reactionFailure=true;});
          await choose('Danke');
          await page.getByRole('alert').filter({hasText:'Die Reaktion konnte nicht gespeichert werden'}).waitFor();
          assert.equal(await heart().count(),1,'Failure must not invent a saved reaction');
          await page.evaluate(()=>{window.nexusTest.reactionFailure=false;});
          await choose('Danke');
          await message.getByRole('button',{name:'Danke: 1, deine Reaktion entfernen',exact:true}).waitFor();

          // An account switch discards an in-flight response belonging to the old account.
          await page.evaluate(()=>{window.nexusTest.reactionDelay=500;});
          await choose('Lachen');
          await page.evaluate(()=>window.nexusTest.switchUser('other'));
          await page.waitForTimeout(650);
          await message.getByRole('button',{name:'Lachen: 1, reagieren',exact:true}).waitFor();
          assert.equal(await message.locator('.message-reactions [aria-pressed=true]').count(),0);
          await page.evaluate(groups=>{
            (groups?window.nexusTest.groupMessages:window.nexusTest.directMessages)[0].deleted_at=new Date().toISOString();
            window.nexusTest.emit(groups?'group_messages':'direct_messages');
          },groups);
          await message.getByText('Nachricht gelöscht',{exact:true}).waitFor();
          assert.equal(await picker.count(),0);
          assert.equal(await message.locator('.message-reactions').count(),0);
          assert.deepEqual(errors,[]);
          console.log(`${name} ${kind}: double-click/tap, gesture exclusions, emojis, counts, removal, realtime, reload, mobile/desktop, offline, failure and account fencing passed`);
        } catch(error) {
          await page.screenshot({path:`browser-results/${name}-${kind}-reactions-failure.png`,fullPage:true});
          console.error((await page.locator('body').innerText()).slice(-2500));
          throw error;
        } finally {await context.close();}
      }
    } finally {await browser.close();}
  }
} finally {await server.close();}
