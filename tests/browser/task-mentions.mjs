import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const engines = { chromium, webkit };
const requestedEngines = (process.env.NEXUS_BROWSER_ENGINES ?? 'chromium,webkit').split(',').map(value=>value.trim()).filter(Boolean);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({ root, configFile:false, base:'/', server:{host:'127.0.0.1',port:4187,strictPort:true,hmr:false},
  plugins:[{name:'task-mention-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}],
});
await server.listen();
await mkdir('browser-results',{recursive:true});
try {
  for (const name of requestedEngines) {
    const engine=engines[name];
    if (!engine) throw new Error(`Unknown browser engine: ${name}`);
    const browser=await engine.launch();
    const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Berlin'});
    await context.addInitScript(()=>sessionStorage.setItem('nexusTest.taskMentionsFixture','1'));
    await context.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4187')?route.continue():route.abort());
    const page=await context.newPage(); page.setDefaultTimeout(15_000);
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    const comments=page.getByRole('region',{name:'Kommentare',exact:true});
    try {
      await page.clock.setFixedTime(new Date('2026-09-23T08:00:00Z'));
      await page.goto('http://127.0.0.1:4187/#/app/business?workspace=w1&view=projects');
      await page.getByRole('button',{name:/^Alle Projektaufgaben/}).click();
      await page.getByRole('article',{name:'Meine heutige Aufgabe',exact:true}).getByRole('button',{name:'Details & Zusammenarbeit',exact:true}).click();
      const input=comments.getByLabel('Neuer Kommentar',{exact:true});
      await input.fill('Bitte @dar');
      await comments.getByRole('button',{name:/Darlyn Beispiel/}).click();
      assert.equal(await input.inputValue(),'Bitte @Darlyn Beispiel ');
      await comments.getByRole('button',{name:'Person erwähnen',exact:true}).click();
      const guestChoice=comments.getByRole('button',{name:/Gast Person/});
      await guestChoice.waitFor();
      assert.match(await guestChoice.innerText(),/Gast · Lesezugriff/);
      await guestChoice.click();
      await input.pressSequentially('prüfen.');
      await comments.getByRole('button',{name:'Erwähnung von Darlyn Beispiel entfernen',exact:true}).waitFor();
      const removeGuest=comments.getByRole('button',{name:'Erwähnung von Gast Person entfernen',exact:true});
      await removeGuest.waitFor();
      await removeGuest.click();
      assert.equal(await input.inputValue(),'Bitte @Darlyn Beispiel prüfen.','Removing a chip must also remove its visible token');
      await input.focus(); await input.press('End');
      await comments.getByRole('button',{name:'Person erwähnen',exact:true}).click();
      await comments.getByRole('button',{name:/Gast Person/}).click();
      assert.equal(await input.inputValue(),'Bitte @Darlyn Beispiel prüfen. @Gast Person ');

      await page.evaluate(()=>{window.nexusTest.loseCollaborationResponse=true;});
      await comments.getByRole('button',{name:'Kommentar senden',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'Speichern fehlgeschlagen'}).waitFor();
      assert.equal(await input.inputValue(),'Bitte @Darlyn Beispiel prüfen. @Gast Person ','A lost response must preserve the exact draft');
      assert.equal(await page.evaluate(()=>window.nexusTest.collaborationWrites),1);
      assert.deepEqual(await page.evaluate(()=>window.nexusTest.mentionNotifications.map(item=>item.user_id).sort()),['guest-user','other']);

      await comments.getByRole('button',{name:'Kommentar senden',exact:true}).click();
      await page.getByText('Kommentar gespeichert.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.nexusTest.collaborationWrites),1,'Retry must not duplicate the committed mention');
      assert.equal(await page.evaluate(()=>window.nexusTest.mentionNotifications.length),2,'Mention notifications must be targeted once');
      const stored=await page.evaluate(()=>window.nexusTest.collaboration.task_comments[0]);
      assert.deepEqual(stored.mentioned_user_ids,['guest-user','other']);
      const created=comments.locator('.task-comments>li').filter({hasText:'Bitte @Darlyn Beispiel prüfen. @Gast Person'});
      await created.waitFor();
      await created.getByText('Darlyn Beispiel',{exact:true}).waitFor();
      await created.getByText('Gast Person',{exact:true}).waitFor();

      await page.evaluate(()=>{
        for(let i=0;i<45;i++) window.nexusTest.collaboration.task_comments.push({
          id:`new-${String(i).padStart(3,'0')}`,workspace_id:'w1',task_id:'mine',body:`Neuer Kommentar ${i}`,
          mentioned_user_ids:[],created_by:'other',created_at:new Date(Date.UTC(2026,8,24,8,i)).toISOString(),updated_at:new Date(Date.UTC(2026,8,24,8,i)).toISOString(),revision:1,
        });
        window.nexusTest.persistCollaboration(); window.nexusTest.emit('task_comments','INSERT');
      });
      const targetUrl=`http://127.0.0.1:4187/#/app/business?workspace=w1&view=tasks&project=p1&task=mine&comment=${encodeURIComponent(stored.id)}`;
      await page.goto(targetUrl);
      const target=page.locator(`#nexus-comment-${stored.id}`);
      await target.waitFor();
      await page.waitForFunction(id=>document.activeElement?.id===`nexus-comment-${id}`,stored.id);
      assert.equal(await target.evaluate(element=>element.classList.contains('is-mentioned-target')),true);
      assert.equal(await comments.locator('.task-comments>li').count(),41,'Focused older comment is merged with the newest page');

      await page.setViewportSize({width:320,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mention UI fits 320px');
      await page.screenshot({path:`browser-results/${name}-task-mentions.png`,fullPage:true});
      assert.deepEqual(errors,[]);
      console.log(`${name}: member and guest picker, chip removal, stable retry, targeted IDs, rendered badges, direct comment target and mobile width passed`);
    } catch(error) {
      await page.screenshot({path:`browser-results/${name}-task-mentions-failure.png`,fullPage:true});
      console.error('Browser errors:',errors); console.error('Test URL:',page.url());
      console.error('Test UI:',(await page.locator('body').innerText()).slice(0,7000)); throw error;
    } finally {await context.close();await browser.close();}
  }
} finally {await server.close();}
