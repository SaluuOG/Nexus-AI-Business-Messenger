import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url));
const stub=fileURLToPath(new URL('./attachment-service.mjs',import.meta.url));
const server=await createServer({root,configFile:false,base:'/',server:{host:'127.0.0.1',port:4189,strictPort:true,hmr:false},plugins:[{name:'attachment-browser',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
const png={name:'Entwurf.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64')};
const txt={name:'Notizen.txt',mimeType:'text/plain',buffer:Buffer.from('Nexus attachment acceptance')};
try{
 for(const[name,engine]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch();const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4189')?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('dialog',dialog=>dialog.accept());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const collaboration=page.getByRole('region',{name:'Zusammenarbeit',exact:true});
  const files=page.getByRole('region',{name:'Dateien',exact:true});
  const comments=page.getByRole('region',{name:'Kommentare',exact:true});
  const refreshed=()=>page.waitForFunction(()=>!document.querySelector('[aria-label="Zusammenarbeit aktualisieren"]')?.disabled);
  const openMine=async()=>{await page.getByRole('button',{name:/^Alle Projektaufgaben/}).click();await page.getByRole('article',{name:'Meine heutige Aufgabe',exact:true}).getByRole('button',{name:'Details & Zusammenarbeit',exact:true}).click();await files.getByLabel('Datei zur Aufgabe',{exact:true}).waitFor();};
  try{
   await page.goto('http://127.0.0.1:4189/#/app/business?workspace=w1&view=projects');await openMine();
   await files.getByLabel('Datei zur Aufgabe',{exact:true}).setInputFiles(png);
   await files.getByRole('button',{name:'Hochladen',exact:true}).click();
   await files.getByRole('button',{name:'Vorschau: Entwurf.png',exact:true}).waitFor();
   await files.getByRole('button',{name:'Vorschau: Entwurf.png',exact:true}).click();
   const preview=page.getByRole('dialog',{name:'Entwurf.png',exact:true});await preview.waitFor();
   await page.waitForFunction(()=>document.querySelector('.task-image-preview img')?.naturalWidth>0);
   await page.screenshot({path:`browser-results/${name}-task-image-preview.png`});
   await page.getByRole('button',{name:'Bildvorschau schließen',exact:true}).click();await preview.waitFor({state:'hidden'});
   await files.getByLabel('Datei zur Aufgabe',{exact:true}).setInputFiles(txt);
   await page.evaluate(()=>{window.nexusAttachmentTest.failUpload=true;});
   await files.getByRole('button',{name:'Hochladen',exact:true}).click();await files.getByRole('alert').waitFor();
   await page.evaluate(()=>{window.nexusAttachmentTest.failUpload=false;window.nexusAttachmentTest.loseFinish=true;});
   await files.getByRole('button',{name:'Erneut hochladen',exact:true}).click();
   await files.getByRole('button',{name:'Herunterladen: Notizen.txt',exact:true}).waitFor();
   await files.getByRole('button',{name:'Erneut hochladen',exact:true}).click();
   await files.getByRole('button',{name:'Erneut hochladen',exact:true}).waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>window.nexusTest.collaboration.task_attachments.filter(f=>f.file_name==='Notizen.txt').length),1);
   const downloadEvent=page.waitForEvent('download');await files.getByRole('button',{name:'Herunterladen: Notizen.txt',exact:true}).click();
   const download=await downloadEvent;assert.equal(download.suggestedFilename(),'Notizen.txt');
   const stream=await download.createReadStream();let content='';for await(const chunk of stream)content+=chunk;assert.equal(content,txt.buffer.toString());
   assert.equal(await page.evaluate(()=>window.nexusAttachmentTest.downloads.every(r=>r.cache==='no-store'&&r.hasSignal)),true);
   await comments.getByLabel('Neuer Kommentar',{exact:true}).fill('Datei am eigenen Kommentar');
   await comments.getByRole('button',{name:'Kommentar senden',exact:true}).click();
   const comment=comments.locator('.task-comments>li').filter({hasText:'Datei am eigenen Kommentar'});
   await comment.getByRole('button',{name:'Datei zum Kommentar hinzufügen',exact:true}).click();
   await comment.getByLabel('Datei zum Kommentar',{exact:true}).setInputFiles({...txt,name:'Kommentar.txt'});
   await comment.getByRole('button',{name:'Hochladen',exact:true}).click();
   await comment.getByRole('button',{name:'Herunterladen: Kommentar.txt',exact:true}).waitFor();
   assert.equal(await files.getByText('Kommentar.txt',{exact:true}).count(),0);
   for(const width of[320,390]){
    await page.setViewportSize({width,height:844});await files.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile horizontal overflow');
    await page.screenshot({path:`browser-results/${name}-task-files-${width}.png`,fullPage:true});
   }
   await refreshed();await comment.getByRole('button',{name:'Kommentar entfernen',exact:true}).click();await comment.waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>window.nexusTest.collaboration.task_attachments.filter(f=>f.file_name==='Kommentar.txt').length),0);
   await files.getByRole('button',{name:'Datei entfernen: Notizen.txt',exact:true}).click();await files.getByRole('button',{name:'Herunterladen: Notizen.txt',exact:true}).waitFor({state:'hidden'});
   // A downgrade keeps reading but removes all write controls, including an open draft.
   await files.getByLabel('Datei zur Aufgabe',{exact:true}).setInputFiles(txt);
   await page.evaluate(()=>{window.nexusTest.memberships.find(m=>m.workspace_id==='w1'&&m.user_id==='me').role='guest';window.nexusTest.emit('workspace_members','UPDATE');});
   await files.getByLabel('Datei zur Aufgabe',{exact:true}).waitFor({state:'hidden'});
   assert.equal(await files.getByRole('button',{name:/Datei entfernen/}).count(),0);
   await files.getByRole('button',{name:'Vorschau: Entwurf.png',exact:true}).click();await preview.waitFor();
   await page.getByRole('button',{name:'Bildvorschau schließen',exact:true}).click();
   // An account change while reservation is in flight cannot upload/finalize for the old account.
   await page.evaluate(()=>{window.nexusTest.memberships.find(m=>m.workspace_id==='w1'&&m.user_id==='me').role='member';window.nexusTest.emit('workspace_members','UPDATE');});
   await files.getByLabel('Datei zur Aufgabe',{exact:true}).waitFor();await files.getByLabel('Datei zur Aufgabe',{exact:true}).setInputFiles({...txt,name:'Alter-Entwurf.txt'});
   const before=await page.evaluate(()=>{window.nexusAttachmentTest.delayBegin=true;return window.nexusAttachmentTest.uploads.length;});
   await files.getByRole('button',{name:'Hochladen',exact:true}).click();await page.waitForFunction(()=>window.nexusAttachmentTest.waiting.length===1);
   await page.evaluate(()=>{window.nexusTest.memberships.push({workspace_id:'w1',user_id:'other',role:'member',full_name:'Other account'});window.nexusTest.switchUser('other');});
   await page.waitForFunction(()=>document.querySelector('.task-file-upload input')?.disabled===false);
   await page.evaluate(()=>{window.nexusAttachmentTest.delayBegin=false;window.nexusAttachmentTest.waiting.splice(0).forEach(resolve=>resolve());});
   await files.getByRole('button',{name:'Vorschau: Entwurf.png',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.nexusAttachmentTest.uploads.length),before);
   assert.equal(await files.getByRole('button',{name:/Datei entfernen/}).count(),0);
   // Read failure or removed membership clears data and an open blob preview.
   await files.getByRole('button',{name:'Vorschau: Entwurf.png',exact:true}).click();await preview.waitFor();
   await page.evaluate(()=>{window.nexusTest.failure='task_attachments';window.nexusTest.emit('task_attachments','UPDATE');});
   await collaboration.getByRole('alert').filter({hasText:'nicht geladen'}).waitFor();await preview.waitFor({state:'hidden'});
   assert.equal(await files.count(),0);
   await page.evaluate(()=>{window.nexusTest.failure=null;});await refreshed();await collaboration.getByRole('button',{name:'Zusammenarbeit aktualisieren',exact:true}).click();
   await files.getByRole('button',{name:'Vorschau: Entwurf.png',exact:true}).waitFor();
   await page.evaluate(()=>{window.nexusTest.revoked=true;window.nexusTest.emit('workspace_members','DELETE');});await collaboration.waitFor({state:'hidden'});
   assert.deepEqual(errors,[]);
   console.log(name+': task/comment uploads, image preview, download bytes, retry without duplicates, deletion, mobile layout, guest/author rights, account switch, failed reads and revoked membership passed');
  }catch(error){await page.screenshot({path:`browser-results/${name}-task-attachments-failure.png`,fullPage:true});console.error('Browser errors:',errors);console.error((await page.locator('body').innerText()).slice(0,10000));throw error;}
  finally{await context.close();await browser.close();}
 }
}finally{await server.close();}
