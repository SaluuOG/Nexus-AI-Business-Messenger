import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url)),stub=fileURLToPath(new URL('./supabase.mjs',import.meta.url));
const origin='http://127.0.0.1:4205';
const server=await createServer({root,configFile:false,base:'/',cacheDir:'node_modules/.vite-reminders-browser',server:{host:'127.0.0.1',port:4205,strictPort:true,hmr:false},plugins:[{name:'reminders-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
try{
 for(const [engineName,engine] of (process.env.NEXUS_BROWSER==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
  const browser=await engine.launch();
  try{for(const kind of ['direct','group']){
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,timezoneId:'Europe/Berlin'});
   await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
   await context.addInitScript(()=>{window.reminderOnline=true;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.reminderOnline});});
   const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const group=kind==='group',mid=group?'gm1':'dm1',chatId=group?'g1':'c1';
   const url=`${origin}/#/app/${group?'groups?group=g1':'chats?conversation=c1'}`;
   const message=page.locator(`[data-message-id="${mid}"]`),dialog=page.getByRole('dialog'),panel=page.getByRole('region',{name:'Deine Wiedervorlagen'}),cards=panel.locator('.reminder-card');
   const open=async()=>{
    const trigger=message.getByRole('button',{name:'Optionen',exact:true});await trigger.scrollIntoViewIfNeeded();
    await trigger.evaluate(el=>new Promise(resolve=>{let previous='',last=performance.now();const tick=()=>{const b=el.getBoundingClientRect(),shape=[b.x,b.y,b.width,b.height].join(':');if(shape!==previous){previous=shape;last=performance.now();}if(performance.now()-last<180)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);}));
    await trigger.click();await page.getByRole('menuitem',{name:'Später erinnern',exact:true}).click();await dialog.getByLabel('Datum und Uhrzeit').waitFor();
   };
   const close=()=>dialog.getByRole('button',{name:'Schließen',exact:true}).click();
   const goBriefing=async()=>{await page.getByRole('button',{name:'Hauptmenü öffnen'}).click();await page.getByRole('navigation',{name:'Hauptnavigation'}).getByRole('button',{name:'Briefing',exact:true}).click();await panel.waitFor();};
   const refresh=()=>panel.getByRole('button',{name:'Wiedervorlagen aktualisieren'}).click();
   try{
    await page.goto(url);await message.waitFor();
    const draft=page.locator('.composer input:not([type=file])');await draft.fill('Entwurf bleibt hier');
    await open();await dialog.getByLabel('Datum und Uhrzeit').fill('2020-01-01T09:00');await dialog.getByRole('button',{name:'Termin speichern'}).click();await dialog.getByRole('alert').filter({hasText:'zukünftigen Termin'}).waitFor();
    assert.equal(await page.evaluate(()=>window.nexusTest.reminderCalls.length),0);
    await dialog.getByRole('button',{name:'Morgen um 09:00'}).click();const expected=await dialog.getByLabel('Datum und Uhrzeit').inputValue();assert.ok(expected.endsWith('T09:00'));
    await page.evaluate(()=>{window.nexusTest.loseReminderResponse=true;});
    await dialog.getByRole('button',{name:'Termin speichern'}).click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByLabel('Datum und Uhrzeit').isDisabled(),true);
    await dialog.getByRole('button',{name:'Erneut versuchen'}).click();await dialog.getByRole('heading',{name:'Wiedervorlage gespeichert'}).waitFor();
    const calls=await page.evaluate(()=>window.nexusTest.reminderCalls);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.nexusTest.reminderRows.length),1);
    await close();assert.equal(await draft.inputValue(),'Entwurf bleibt hier');
    await open();assert.equal(await dialog.getByLabel('Datum und Uhrzeit').inputValue(),expected);
    // A second device changes the same reminder while this dialog is open.
    await page.evaluate(()=>{window.nexusTest.reminderRows[0].version=crypto.randomUUID();});
    await dialog.getByRole('button',{name:'In zwei Stunden'}).click();await dialog.getByRole('button',{name:'Termin speichern'}).click();await dialog.getByRole('alert').filter({hasText:'inzwischen geändert'}).waitFor();
    await dialog.getByRole('button',{name:'Aktuellen Stand laden'}).click();await dialog.getByLabel('Datum und Uhrzeit').waitFor();
    await dialog.getByRole('button',{name:'In zwei Stunden'}).click();await dialog.getByRole('button',{name:'Termin speichern'}).click();await dialog.getByRole('heading',{name:'Wiedervorlage gespeichert'}).waitFor();await close();
    await page.reload();await message.waitFor();await goBriefing();await panel.getByText('Keine fälligen Wiedervorlagen.',{exact:false}).waitFor();
    await panel.getByRole('button',{name:'Alle offenen',exact:true}).click();await cards.first().waitFor();
    await cards.getByRole('link',{name:'Zur Nachricht'}).click();await message.waitFor();assert.ok(page.url().includes('message='+mid));await goBriefing();
    // Simulate a due instant and a current source edit, without changing device time.
    await page.evaluate(({group})=>{window.nexusTest.reminderRows[0].due_at=new Date(Date.now()-60000).toISOString();(group?window.nexusTest.groupMessages:window.nexusTest.directMessages)[0].body='Aktuelle Wiedervorlage 👋 <script>window.unsafe=true</script>';},{group});
    await refresh();await cards.getByText('Aktuelle Wiedervorlage 👋 <script>window.unsafe=true</script>',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.unsafe),undefined);
    for(const width of [320,390,1440]){
     await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Page overflow');
     await cards.getByRole('button',{name:'Verschieben'}).click();await dialog.getByLabel('Datum und Uhrzeit').waitFor();
     const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,'Dialog fits');
     assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Dialog content overflow');
     await page.screenshot({path:`browser-results/${engineName}-${kind}-reminder-dialog-${width}.png`});
     await dialog.getByRole('button',{name:'Wiedervorlage schließen'}).click();await cards.first().waitFor();
     await page.screenshot({path:`browser-results/${engineName}-${kind}-reminders-${width}.png`,fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{window.nexusTest.reminderWriteFailure=true;});await cards.getByRole('button',{name:'Erledigen'}).click();await panel.getByRole('alert').waitFor();assert.equal(await cards.count(),1);
    await page.evaluate(()=>{window.nexusTest.reminderWriteFailure=false;window.nexusTest.loseReminderResponse=true;});await cards.getByRole('button',{name:'Erledigen'}).click();await panel.getByRole('alert').waitFor();
    await cards.getByRole('button',{name:'Erledigen'}).click();await panel.getByText('Keine fälligen Wiedervorlagen.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.nexusTest.reminderRows.filter(r=>r.due_at).length),0);
    // Page boundary and attachment-only messages.
    await page.evaluate(({group,kind,chatId})=>{const messages=group?window.nexusTest.groupMessages:window.nexusTest.directMessages;for(let i=0;i<25;i++){
     const id='remind-'+i;messages.push({message_id:id,conversation_id:chatId,group_id:chatId,sender_id:'other',body:i?'Wiedervorlage '+i:'',created_at:'2026-10-01T10:00:00Z',attachments:i?[]:[{file_name:'Angebot.pdf'}]});
     window.nexusTest.reminderRows.push({id:'r-'+String(i).padStart(3,'0'),user_id:'me',kind,message_id:id,version:crypto.randomUUID(),due_at:'2020-01-01T10:00:00Z'});
    }},{group,kind,chatId});
    await refresh();await page.waitForFunction(()=>document.querySelectorAll('.reminder-card').length===20);await cards.getByText('Anhang: Angebot.pdf').waitFor();
    await panel.getByRole('button',{name:'Weitere Wiedervorlagen laden'}).click();await page.waitForFunction(()=>document.querySelectorAll('.reminder-card').length===25);
    assert.equal(new Set(await cards.evaluateAll(rows=>rows.map(el=>el.dataset.reminderId))).size,25);
    await page.evaluate(()=>{window.nexusTest.reminderDenied=true;});await refresh();await panel.getByText('Keine fälligen Wiedervorlagen.',{exact:false}).waitFor();
    await page.evaluate(()=>{window.nexusTest.reminderDenied=false;window.nexusTest.reminderReadFailure=true;});await refresh();await panel.getByRole('alert').waitFor();assert.equal(await cards.count(),0);
    await page.evaluate(()=>{window.nexusTest.reminderReadFailure=false;});await panel.getByRole('button',{name:'Wiedervorlagen erneut laden'}).click();await cards.first().waitFor();
    await page.evaluate(()=>{window.reminderOnline=false;window.dispatchEvent(new Event('offline'));});await panel.getByText('Wiedervorlagen sind mit Internetverbindung verfügbar.').waitFor();assert.equal(await cards.count(),0);
    await page.evaluate(()=>{window.reminderOnline=true;window.dispatchEvent(new Event('online'));});await cards.first().waitFor();
    await page.evaluate(()=>{window.nexusTest.reminderReadDelay=300;});await refresh();await page.evaluate(()=>window.nexusTest.switchUser('other'));await page.waitForTimeout(450);
    await panel.getByText('Keine fälligen Wiedervorlagen.',{exact:false}).waitFor();assert.equal(await cards.count(),0);assert.deepEqual(errors,[]);
    console.log(`${engineName} ${kind}: schedule/retry/conflict, due briefing, links, reschedule dialog, completion, paging, rights, offline and account isolation passed`);
   }catch(error){await page.screenshot({path:`browser-results/${engineName}-${kind}-reminders-failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-2200));throw error;}
   finally{await context.close();}
  }}finally{await browser.close();}
 }
}finally{await server.close();}
