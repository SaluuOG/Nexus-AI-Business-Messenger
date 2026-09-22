import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url));
const stub=fileURLToPath(new URL('./template-service.mjs',import.meta.url));
const base='http://127.0.0.1:4190';
const server=await createServer({root,configFile:false,base:'/',server:{host:'127.0.0.1',port:4190,strictPort:true,hmr:false},plugins:[{name:'template-browser',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
const fits=async page=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow');
try{
 for(const[name,engine]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch();const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>sessionStorage.setItem('nexusTest.mobileBusinessFixture','1'));
  await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const source=page.locator('.business-project-card').filter({hasText:'Drittes Projekt'});
  const dialog=page.getByRole('dialog',{name:'Neues Projekt anlegen',exact:true});
  const saveDialog=page.getByRole('dialog',{name:'Als Vorlage speichern',exact:true});
  const openNew=async()=>{await page.getByRole('button',{name:'Projekt',exact:true}).click();await dialog.waitFor();};
  try{
   await page.goto(base+'/#/app/business?workspace=w3');await source.waitFor();
   await source.getByRole('button',{name:'Als Vorlage speichern',exact:true}).click();
   await saveDialog.getByLabel('Name der Vorlage *',{exact:true}).fill('Website Ablauf');
   await saveDialog.getByLabel('Startdatum des Ausgangsprojekts *',{exact:true}).fill('2026-10-01');
   await page.evaluate(()=>{window.nexusTemplateTest.loseSave=true;});
   await saveDialog.getByRole('button',{name:'Vorlage speichern',exact:true}).click();
   await saveDialog.getByRole('alert').waitFor();
   assert.equal(await saveDialog.getByLabel('Name der Vorlage *',{exact:true}).isDisabled(),true);
   await saveDialog.getByRole('button',{name:'Erneut versuchen',exact:true}).click();await saveDialog.waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>window.nexusTemplateTest.templates.length),1);
   assert.equal(await page.evaluate(()=>new Set(window.nexusTemplateTest.calls.map(c=>c.p_id)).size),1);
   await openNew();
   const picker=dialog.locator('.project-template-picker');
   const select=picker.getByLabel('Projektvorlage',{exact:true});
   await select.selectOption({label:'Website Ablauf'});
   await picker.getByLabel('Startdatum für die Vorlage',{exact:true}).fill('2026-11-01');
   await picker.getByRole('button',{name:'Vorlage übernehmen',exact:true}).click();
   assert.equal(await dialog.getByLabel('Deadline',{exact:true}).inputValue(),'2026-11-15');
   const first=dialog.getByRole('group',{name:'Aufgabe 1',exact:true});
   assert.equal(await first.getByLabel('Fällig am',{exact:true}).inputValue(),'2026-11-03');
   assert.equal(await first.getByLabel('Verantwortlich',{exact:true}).inputValue(),'');
   assert.equal(await first.getByLabel('Checkliste (ein Punkt pro Zeile)',{exact:true}).inputValue(),'Texte prüfen\nBilder freigeben');
   await dialog.getByLabel('Projekttitel *',{exact:true}).fill('Website November');
   await first.getByLabel('Verantwortlich',{exact:true}).selectOption('other');
   await first.getByLabel('Fällig am',{exact:true}).fill('2026-11-04');
   await first.getByLabel('Checkliste (ein Punkt pro Zeile)',{exact:true}).fill('Texte prüfen\nNeue Freigabe\n');
   // Selecting a different start cannot silently overwrite the reviewed draft.
   await picker.getByLabel('Startdatum für die Vorlage',{exact:true}).fill('2026-12-01');
   assert.equal(await first.getByLabel('Fällig am',{exact:true}).inputValue(),'2026-11-04');
   await picker.getByRole('button',{name:'Vorlage übernehmen',exact:true}).click();
   const confirm=picker.getByRole('group',{name:'Vorlagenaktion bestätigen',exact:true});await confirm.waitFor();
   await confirm.getByRole('button',{name:'Zurück',exact:true}).click();
   assert.equal(await dialog.getByLabel('Projekttitel *',{exact:true}).inputValue(),'Website November');
   for(const width of[320,390]){await page.setViewportSize({width,height:844});await fits(page);await page.screenshot({path:`browser-results/${name}-project-template-${width}.png`,fullPage:true});}
   await page.evaluate(()=>{window.nexusTemplateTest.loseCreate=true;});
   await dialog.getByRole('button',{name:'Projekt anlegen',exact:true}).click();await dialog.getByText(/Verbindung wurde unterbrochen/).waitFor();
   await dialog.getByRole('button',{name:'Projekt anlegen',exact:true}).click();await dialog.waitFor({state:'hidden'});
   const card=page.locator('.business-project-card').filter({hasText:'Website November'});await card.waitFor();
   const created=await page.evaluate(()=>{const state=window.nexusTest;const project=state.projects.find(p=>p.title==='Website November');return {projects:state.projects.filter(p=>p.title==='Website November').length,tasks:state.tasks.filter(t=>t.project_id===project.id),points:state.collaboration.task_checklist_items.filter(c=>c.task_id===state.tasks.find(t=>t.project_id===project.id).id)};});
   assert.equal(created.projects,1);assert.equal(created.tasks.length,1);assert.equal(created.tasks[0].status,'todo');assert.equal(created.tasks[0].assigned_to,'other');assert.equal(created.tasks[0].due_date,'2026-11-04');assert.deepEqual(created.points.map(c=>c.label),['Texte prüfen','Neue Freigabe']);assert.ok(created.points.every(c=>!c.is_completed));
   await card.getByRole('button',{name:/Aufgaben/}).click();
   await page.getByRole('article',{name:'Inhalte vorbereiten',exact:true}).getByRole('button',{name:'Details & Zusammenarbeit',exact:true}).click();
   await page.getByRole('region',{name:'Checkliste',exact:true}).getByText('Neue Freigabe',{exact:true}).waitFor();
   // Remove only the reusable snapshot, via an in-app confirmation.
   await page.getByRole('button',{name:'Zurück zu Projekten',exact:true}).click();
   await openNew();await select.selectOption({label:'Website Ablauf'});
   await picker.getByRole('button',{name:'Vorlage entfernen',exact:true}).click();
   await picker.getByRole('button',{name:'Entfernen bestätigen',exact:true}).click();
   await picker.getByText(/Vorlage entfernt/).waitFor();
   assert.equal(await page.evaluate(()=>window.nexusTest.projects.some(p=>p.title==='Website November')),true);
   // Manual project creation with a checklist remains available without a template.
   await dialog.getByLabel('Projekttitel *',{exact:true}).fill('Manuell mit Checkliste');
   await dialog.getByRole('button',{name:'Aufgabe hinzufügen',exact:true}).click();
   await first.getByLabel('Aufgabentitel *',{exact:true}).fill('Manuelle Aufgabe');
   await first.getByLabel('Checkliste (ein Punkt pro Zeile)',{exact:true}).fill('Manueller Punkt');
   await dialog.getByRole('button',{name:'Projekt anlegen',exact:true}).click();await dialog.waitFor({state:'hidden'});
   await page.locator('.business-project-card').filter({hasText:'Manuell mit Checkliste'}).waitFor();
   // A downgrade closes a pending save; its late reply cannot show stale success.
   await source.getByRole('button',{name:'Als Vorlage speichern',exact:true}).click();
   await saveDialog.getByLabel('Name der Vorlage *',{exact:true}).fill('Alter Entwurf');
   await page.evaluate(()=>{window.nexusTemplateTest.delaySave=true;});
   await saveDialog.getByRole('button',{name:'Vorlage speichern',exact:true}).click();await page.waitForFunction(()=>window.nexusTemplateTest.pending.length===1);
   await page.evaluate(()=>{window.nexusTest.memberships.find(m=>m.workspace_id==='w3'&&m.user_id==='me').role='member';window.nexusTest.emit('workspace_members','UPDATE');});
   await saveDialog.waitFor({state:'hidden'});
   await page.evaluate(()=>{window.nexusTemplateTest.delaySave=false;window.nexusTemplateTest.pending.splice(0).forEach(resolve=>resolve());});
   assert.equal(await page.getByRole('button',{name:'Als Vorlage speichern',exact:true}).count(),0);
   assert.equal(await page.getByText(/Vorlage „Alter Entwurf“ gespeichert/).count(),0);
   assert.ok(await source.getByRole('button',{name:/Aufgaben/}).isVisible());
   // An account change also discards a delayed template listing and draft.
   await page.evaluate(()=>{window.nexusTest.memberships.find(m=>m.workspace_id==='w3'&&m.user_id==='me').role='admin';window.nexusTest.emit('workspace_members','UPDATE');});
   await page.getByRole('button',{name:'Projekt',exact:true}).waitFor();
   await page.evaluate(()=>{window.nexusTemplateTest.delayRead=true;});await openNew();
   // StrictMode may start both a discarded and a current read. Release both.
   await page.waitForFunction(()=>window.nexusTemplateTest.pending.length>0);
   await page.evaluate(()=>{window.nexusTest.memberships.find(m=>m.workspace_id==='w3'&&m.user_id==='other').role='guest';window.nexusTest.switchUser('other');});
   await dialog.waitFor({state:'hidden'});
   await page.evaluate(()=>{window.nexusTemplateTest.delayRead=false;window.nexusTemplateTest.pending.splice(0).forEach(resolve=>resolve());});
   assert.equal(await page.getByRole('button',{name:'Als Vorlage speichern',exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'Projekt',exact:true}).count(),0);
   assert.deepEqual(errors,[]);
   console.log(`${name}: template save/select, dates, editable checklist/assignee, lost-response deduplication, manual creation, archive, 320/390px, role/account stale replies passed`);
  }catch(error){await page.screenshot({path:`browser-results/${name}-project-template-failure.png`,fullPage:true});console.error(await page.locator('body').innerText());console.error(await page.locator('body').ariaSnapshot());throw error;}
  finally{await context.close();await browser.close();}
 }
}finally{await server.close();}
