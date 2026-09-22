import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url));
const stub=fileURLToPath(new URL('./push-service.mjs',import.meta.url));
const server=await createServer({root,configFile:false,base:'/',server:{host:'127.0.0.1',port:4189,strictPort:true,hmr:false},
  plugins:[{name:'push-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
try {for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4189')?r.continue():r.abort());
  await context.addInitScript(()=>{
    window.pushPermission='denied';window.pushPromptCount=0;
    Object.defineProperty(window,'Notification',{configurable:true,value:{get permission(){return sessionStorage.getItem('pushPermission')||'default';},async requestPermission(){window.pushPromptCount++;sessionStorage.setItem('pushPermission',window.pushPermission);return window.pushPermission;}}});
    Object.defineProperty(window,'PushManager',{configurable:true,value:class{}});
    const subscription=()=>({options:{},toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'B'+'A'.repeat(86),auth:'B'.repeat(22)}}),async unsubscribe(){sessionStorage.removeItem('pushSubscription');return true;}});
    const reg={active:{postMessage(message,ports){sessionStorage.setItem('pushBinding',JSON.stringify(message.binding));ports[0].postMessage({ok:true});}},pushManager:{
      async getSubscription(){return sessionStorage.getItem('pushSubscription')?subscription():null;},async subscribe(){sessionStorage.setItem('pushSubscription','1');return subscription();},
    }};
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{async register(){return reg;},async getRegistration(){return reg;},ready:Promise.resolve(reg)}});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const panel=page.getByRole('region',{name:'Auf diesem Gerät',exact:true});
  const enable=()=>panel.getByRole('button',{name:'Push aktivieren',exact:true});
  try{
    await page.goto('http://127.0.0.1:4189/#/app/settings?category=notifications');
    await enable().waitFor();assert.equal(await page.evaluate(()=>window.pushPromptCount),0);
    await enable().click();await panel.getByRole('alert').getByText(/blockiert/).waitFor();
    await page.evaluate(()=>{window.pushPermission='granted';window.nexusPushTest.fail='register';});
    await enable().click();await panel.getByRole('alert').getByText('Simulierter Push-Fehler.').waitFor();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('pushSubscription')),null);
    await page.evaluate(()=>window.nexusPushTest.fail='');await enable().click();
    await panel.getByText('Push ist auf diesem Gerät aktiv.',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('switch',{name:'Inhalte auf dem Sperrbildschirm',exact:true}).isChecked(),false);
    await panel.getByRole('switch',{name:'Inhalte auf dem Sperrbildschirm',exact:true}).click();
    await panel.getByText('Geräteeinstellung gespeichert.',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('switch',{name:'Inhalte auf dem Sperrbildschirm',exact:true}).isChecked(),true);
    await page.reload();await panel.getByText('Push ist auf diesem Gerät aktiv.',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('switch',{name:'Inhalte auf dem Sperrbildschirm',exact:true}).isChecked(),true);
    await page.evaluate(()=>window.nexusPushTest.fail='options');
    await panel.getByRole('switch',{name:'Chats und Gruppen',exact:true}).click();
    await panel.getByRole('alert').waitFor();assert.equal(await panel.getByRole('switch',{name:'Chats und Gruppen',exact:true}).isChecked(),true);
    await page.evaluate(()=>window.nexusPushTest.fail='');
    const reminders=panel.getByRole('group',{name:'Aufgaben-Erinnerungen',exact:true});
    assert.equal(await reminders.getByRole('switch').isChecked(),false);
    await reminders.getByRole('switch').click();
    await reminders.getByLabel('Uhrzeit',{exact:true}).fill('08:45');
    await reminders.getByLabel('Zeitzone',{exact:true}).selectOption('Europe/Berlin');
    await reminders.getByLabel('Am Vortag',{exact:true}).uncheck();
    await reminders.getByLabel('Am Fälligkeitstag',{exact:true}).uncheck();
    assert.equal(await reminders.getByRole('button',{name:'Erinnerungen speichern'}).isDisabled(),true);
    await reminders.getByRole('alert').getByText('Wähle mindestens einen Erinnerungstag.').waitFor();
    await reminders.getByLabel('Am Fälligkeitstag',{exact:true}).check();
    await page.evaluate(()=>window.nexusPushTest.fail='options');
    await reminders.getByRole('button',{name:'Erinnerungen speichern'}).click();
    await panel.getByRole('alert').getByText('Simulierter Push-Fehler.').waitFor();
    assert.equal(await reminders.getByLabel('Uhrzeit',{exact:true}).inputValue(),'08:45');
    await page.evaluate(()=>window.nexusPushTest.fail='');
    await reminders.getByRole('button',{name:'Erinnerungen speichern'}).click();
    await panel.getByText('Erinnerungen gespeichert.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('pushBinding')).deadlines),true);
    await page.reload();await panel.getByText('Push ist auf diesem Gerät aktiv.',{exact:true}).waitFor();
    assert.equal(await reminders.getByRole('switch').isChecked(),true);
    assert.equal(await reminders.getByLabel('Uhrzeit',{exact:true}).inputValue(),'08:45');
    assert.equal(await reminders.getByLabel('Zeitzone',{exact:true}).inputValue(),'Europe/Berlin');
    assert.equal(await reminders.getByLabel('Am Vortag',{exact:true}).isChecked(),false);
    assert.equal(await reminders.getByLabel('Am Fälligkeitstag',{exact:true}).isChecked(),true);
    await panel.getByRole('button',{name:'Test senden',exact:true}).click();
    await panel.getByText(/Test angefordert/).waitFor();assert.equal(await page.evaluate(()=>window.nexusPushTest.calls.filter(c=>c.action==='test').length),1);
    for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`browser-results/${name}-push-${width}.png`,fullPage:true});}
    await panel.getByRole('button',{name:'Auf diesem Gerät ausschalten',exact:true}).click();await enable().waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('pushBinding'))),null);
    await page.evaluate(()=>{window.pushPermission='granted';window.nexusPushTest.hold=true;});await enable().click();
    await page.waitForFunction(()=>window.nexusPushTest.pending.length===1);
    await page.evaluate(()=>window.nexusTest.switchUser('different'));await enable().waitFor();
    await page.evaluate(()=>window.nexusPushTest.pending.splice(0).forEach(resolve=>resolve()));
    await panel.getByText('Push ist auf diesem Gerät ausgeschaltet.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('pushBinding'))),null);
    assert.deepEqual(errors,[]);
    console.log(`${name}: push plus deadline opt-in, time/zone/day preferences, validation, persistence, failed saves, account switch and 320/390px passed (vendor delivery mocked)`);
  }finally{await browser.close();}
}}finally{await server.close();}
