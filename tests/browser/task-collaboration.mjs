import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({ root, configFile: false, base: '/',
  server: { host:'127.0.0.1', port:4185, strictPort:true, hmr:false },
  plugins:[{name:'collaboration-fixture',enforce:'pre',resolveId(source){
    if(source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub;
  }}],
});
await server.listen();
await mkdir('browser-results',{recursive:true});
try {
  for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Berlin'});
    await context.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4185')?route.continue():route.abort());
    const page=await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    const collaboration=page.getByRole('region',{name:'Zusammenarbeit',exact:true});
    const comments=page.getByRole('region',{name:'Kommentare',exact:true});
    const checklist=page.getByRole('region',{name:'Checkliste',exact:true});
    const history=page.getByRole('region',{name:'Änderungsverlauf',exact:true});
    const refreshed=async()=>{await collaboration.getByRole('button',{name:'Zusammenarbeit aktualisieren',exact:true}).waitFor(); await page.waitForFunction(()=>!document.querySelector('[aria-label="Zusammenarbeit aktualisieren"]')?.disabled);};
    try {
      await page.clock.setFixedTime(new Date('2026-09-16T10:00:00Z'));
      await page.goto('http://127.0.0.1:4185/#/app/business?workspace=w1&view=tasks');
      await page.getByRole('article',{name:'Meine heutige Aufgabe',exact:true}).getByRole('button',{name:'Details & Zusammenarbeit',exact:true}).click();
      await comments.getByText('Noch keine Kommentare.',{exact:true}).waitFor();
      assert.match(page.url(),/task=mine/);

      const body='Freigegebener Zwischenstand <script>window.unsafe = true</script>';
      await comments.getByLabel('Neuer Kommentar',{exact:true}).fill(body);
      await page.evaluate(()=>{window.nexusTest.loseCollaborationResponse=true;window.nexusTest.collaborationWriteDelay=700;});
      await comments.getByRole('button',{name:'Kommentar senden',exact:true}).click();
      assert.equal(await comments.getByRole('button',{name:'Kommentar senden',exact:true}).isEnabled(),false);
      await collaboration.getByRole('alert').filter({hasText:'Speichern fehlgeschlagen'}).waitFor();
      await refreshed();
      assert.equal(await comments.getByLabel('Neuer Kommentar',{exact:true}).inputValue(),body);
      assert.equal(await page.evaluate(()=>window.nexusTest.collaborationWrites),1);
      await comments.getByRole('button',{name:'Kommentar senden',exact:true}).click();
      await collaboration.getByText('Kommentar gespeichert.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.nexusTest.collaborationWrites),1,'Retry must not duplicate a committed comment');
      assert.equal(await comments.locator('.task-comments>li').count(),1);
      assert.equal(await page.evaluate(()=>window.unsafe),undefined);
      await page.evaluate(()=>{window.nexusTest.collaborationWriteDelay=0;});

      await checklist.getByLabel('Neuer Checklistenpunkt',{exact:true}).fill('Entwurf gemeinsam abstimmen');
      await checklist.getByRole('button',{name:'Hinzufügen',exact:true}).click();
      const checkbox=checklist.getByRole('checkbox',{name:'Entwurf gemeinsam abstimmen',exact:true});
      await checkbox.waitFor();
      await checkbox.check();
      await page.waitForFunction(()=>window.nexusTest.collaboration.task_checklist_items[0]?.is_completed===true);
      await refreshed();
      assert.equal(await checkbox.isChecked(),true);
      await checklist.getByRole('button',{name:'Checklistenpunkt Entwurf gemeinsam abstimmen bearbeiten',exact:true}).click();
      await checklist.getByLabel('Checklistenpunkt bearbeiten',{exact:true}).fill('Freigabe einholen');
      await checklist.getByRole('button',{name:'Speichern',exact:true}).click();
      await checklist.getByRole('checkbox',{name:'Freigabe einholen',exact:true}).waitFor();
      await history.getByText('Checklistenpunkt geändert · Text',{exact:true}).waitFor();

      // Persistence and an old edit snapshot must not overwrite a teammate.
      await page.reload();
      await comments.getByText(body,{exact:true}).waitFor();
      assert.equal(await checklist.getByRole('checkbox',{name:'Freigabe einholen',exact:true}).isChecked(),true);
      await comments.getByRole('button',{name:'Kommentar bearbeiten',exact:true}).click();
      await comments.getByLabel('Kommentar bearbeiten',{exact:true}).fill('Mein veralteter Entwurf');
      await page.evaluate(()=>{const c=window.nexusTest.collaboration.task_comments[0];c.body='Aktueller Serverstand';c.revision++;window.nexusTest.emit('task_comments','UPDATE');});
      await refreshed();
      await comments.getByRole('button',{name:'Speichern',exact:true}).click();
      await collaboration.getByRole('alert').filter({hasText:'inzwischen geändert'}).waitFor();
      assert.equal(await page.evaluate(()=>window.nexusTest.collaboration.task_comments[0].body),'Aktueller Serverstand');
      await comments.getByRole('button',{name:'Abbrechen',exact:true}).click();
      await comments.getByText('Aktueller Serverstand',{exact:true}).waitFor();
      await comments.getByRole('button',{name:'Kommentar bearbeiten',exact:true}).click();
      await comments.getByLabel('Kommentar bearbeiten',{exact:true}).fill('Gemeinsam freigegeben');
      await comments.getByRole('button',{name:'Speichern',exact:true}).click();
      await comments.getByText('Gemeinsam freigegeben',{exact:true}).waitFor();
      await history.getByText('Kommentar bearbeitet',{exact:true}).waitFor();
      await page.getByLabel('Status für Meine heutige Aufgabe',{exact:true}).selectOption('in_progress');
      await history.getByText('Aufgabe geändert · Status',{exact:true}).waitFor();

      for(const width of [390,320]) {
        await page.setViewportSize({width,height:844});
        const box=await collaboration.boundingBox();
        assert.ok(box.x>=0 && box.x+box.width<=width+1,'Collaboration fits mobile width');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow');
        await page.screenshot({path:`browser-results/${name}-task-collaboration-${width}.png`,fullPage:true});
      }
      await page.setViewportSize({width:1440,height:1000});

      // More than two pages with colliding timestamps, then a change outside the
      // newest page: the complete visible window must be refreshed.
      await page.evaluate(()=>{
        for(let i=0;i<85;i++) window.nexusTest.collaboration.task_comments.push({
          id:`seed-${String(i).padStart(3,'0')}`,workspace_id:'w1',task_id:'mine',body:`Kommentar ${String(i).padStart(3,'0')}`,
          created_by:'other',created_at:'2026-09-15T08:00:00Z',updated_at:'2026-09-15T08:00:00Z',revision:1,
        });
        window.nexusTest.emit('task_comments','INSERT');
      });
      await comments.getByRole('button',{name:'Ältere Kommentare laden',exact:true}).waitFor();
      assert.equal(await comments.locator('.task-comments>li').count(),40);
      await refreshed();
      await comments.getByRole('button',{name:'Ältere Kommentare laden',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.task-comments>li').length===80);
      await refreshed();
      await comments.getByRole('button',{name:'Ältere Kommentare laden',exact:true}).click();
      await comments.getByText('Kommentar 000',{exact:true}).waitFor();
      assert.equal(await comments.locator('.task-comments>li').count(),86);
      await page.evaluate(()=>{const c=window.nexusTest.collaboration.task_comments.find(c=>c.id==='seed-000');c.body='Ältester Kommentar aktualisiert';c.revision++;window.nexusTest.emit('task_comments','UPDATE');});
      await comments.getByText('Ältester Kommentar aktualisiert',{exact:true}).waitFor();
      await page.evaluate(()=>{window.nexusTest.collaboration.task_comments=window.nexusTest.collaboration.task_comments.filter(c=>c.id!=='seed-000');window.nexusTest.emit('task_comments','DELETE',{old:{id:'seed-000'}});});
      await comments.getByText('Ältester Kommentar aktualisiert',{exact:true}).waitFor({state:'hidden'});

      // Guest downgrade instantly clears editors and disables all write controls.
      await comments.getByLabel('Neuer Kommentar',{exact:true}).fill('Entwurf vor Rollenwechsel');
      await page.evaluate(()=>{window.nexusTest.memberships.find(m=>m.workspace_id==='w1'&&m.user_id==='me').role='guest';window.nexusTest.emit('workspace_members','UPDATE');});
      await collaboration.getByText(/Du hast Lesezugriff/).waitFor();
      assert.equal(await comments.getByLabel('Neuer Kommentar',{exact:true}).count(),0);
      assert.equal(await checklist.getByRole('checkbox',{name:'Freigabe einholen',exact:true}).isEnabled(),false);
      assert.equal(await comments.getByRole('button',{name:'Kommentar entfernen',exact:true}).count(),0);
      await page.evaluate(()=>{window.nexusTest.memberships.find(m=>m.workspace_id==='w1'&&m.user_id==='me').role='admin';window.nexusTest.emit('workspace_members','UPDATE');});
      await comments.getByLabel('Neuer Kommentar',{exact:true}).waitFor();
      const otherComment=comments.locator('.task-comments>li').filter({hasText:'Kommentar 084'});
      await otherComment.getByRole('button',{name:'Kommentar entfernen',exact:true}).waitFor();
      assert.equal(await otherComment.getByRole('button',{name:'Kommentar bearbeiten',exact:true}).count(),0);
      await otherComment.getByRole('button',{name:'Kommentar entfernen',exact:true}).click();
      await comments.getByText('Kommentar 084',{exact:true}).waitFor({state:'hidden'});
      await checklist.getByRole('button',{name:'Checklistenpunkt Freigabe einholen entfernen',exact:true}).click();
      await checklist.getByRole('checkbox',{name:'Freigabe einholen',exact:true}).waitFor({state:'hidden'});

      // A failing permission/data check must clear previous records, with a retry.
      await page.evaluate(()=>{window.nexusTest.failure='task_comments';window.nexusTest.emit('task_comments','UPDATE');});
      await collaboration.getByRole('alert').filter({hasText:'nicht geladen'}).waitFor();
      assert.equal(await comments.count(),0);
      await page.evaluate(()=>{window.nexusTest.failure=null;});
      await collaboration.getByRole('button',{name:'Zusammenarbeit aktualisieren',exact:true}).click();
      await comments.getByText('Gemeinsam freigegeben',{exact:true}).waitFor();

      // A response from a previous workspace must never populate the next one.
      await refreshed();
      await page.evaluate(()=>{window.nexusTest.collaborationDelay=800;});
      await collaboration.getByRole('button',{name:'Zusammenarbeit aktualisieren',exact:true}).click();
      await page.getByRole('complementary').getByRole('combobox').selectOption('w2');
      await page.getByRole('tab',{name:'Aufgaben 1',exact:true}).click();
      await page.getByRole('article',{name:'Aufgabe im zweiten Team',exact:true}).getByRole('button',{name:'Details & Zusammenarbeit',exact:true}).click();
      await comments.getByText('Noch keine Kommentare.',{exact:true}).waitFor();
      await page.waitForFunction(()=>window.nexusTest.collaborationPending===0);
      assert.equal(await page.getByText('Gemeinsam freigegeben',{exact:true}).count(),0);
      assert.equal(await comments.getByLabel('Neuer Kommentar',{exact:true}).count(),0);

      // Return, then change accounts while the first user's draft is open.
      await page.evaluate(()=>{window.nexusTest.collaborationDelay=0;});
      await page.getByRole('complementary').getByRole('combobox').selectOption('w1');
      await page.getByRole('tab',{name:/^Aufgaben /}).click();
      await page.getByRole('article',{name:'Meine heutige Aufgabe',exact:true}).getByRole('button',{name:'Details & Zusammenarbeit',exact:true}).click();
      await comments.getByLabel('Neuer Kommentar',{exact:true}).fill('Privater Entwurf von Konto eins');
      await page.evaluate(()=>{window.nexusTest.memberships.push({workspace_id:'w1',user_id:'other',role:'member',full_name:'Zweites Konto'});window.nexusTest.switchUser('other');});
      await comments.getByLabel('Neuer Kommentar',{exact:true}).waitFor();
      await page.waitForFunction(()=>document.querySelector('.collaboration-comment-form textarea')?.value==='');
      assert.equal(await comments.getByLabel('Neuer Kommentar',{exact:true}).inputValue(),'');
      const formerOwn=comments.locator('.task-comments>li').filter({hasText:'Gemeinsam freigegeben'});
      await formerOwn.waitFor();
      assert.equal(await formerOwn.getByRole('button',{name:'Kommentar bearbeiten',exact:true}).count(),0);

      await page.evaluate(()=>{window.nexusTest.revoked=true;window.nexusTest.emit('workspace_members','DELETE');});
      await collaboration.waitFor({state:'hidden'});
      assert.equal(await page.getByText('Gemeinsam freigegeben',{exact:true}).count(),0);
      assert.deepEqual(errors,[]);
      console.log(name+': comments, retry, editing, checklist, history, mobile, pagination, realtime, conflict, roles, moderation, failure, workspace/account changes and revoked access passed');
    } catch(error) {
      await page.screenshot({path:`browser-results/${name}-task-collaboration-failure.png`,fullPage:true});
      console.error('Browser errors:',errors);
      console.error('Test URL:',page.url());
      console.error('Test UI:',(await page.locator('body').innerText()).slice(0,8500));
      throw error;
    } finally {await context.close();await browser.close();}
  }
} finally {await server.close();}
