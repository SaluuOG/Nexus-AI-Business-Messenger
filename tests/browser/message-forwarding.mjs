import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const {chromium,webkit}=await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../../',import.meta.url)),stub=fileURLToPath(new URL('./supabase.mjs',import.meta.url));
const origin='http://127.0.0.1:4203';
const server=await createServer({root,configFile:false,base:'/',cacheDir:'node_modules/.vite-forward-browser',server:{host:'127.0.0.1',port:4203,strictPort:true,hmr:false},plugins:[{name:'forward-fixture',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')||source.endsWith('/lib/env'))return stub;}}]});
await server.listen();await mkdir('browser-results',{recursive:true});
try {
  for(const [name,engine] of (process.env.NEXUS_BROWSER==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
    const browser=await engine.launch();
    try {
      for(const kind of ['direct','group']){
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await context.addInitScript(()=>{window.forwardOnline=true;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.forwardOnline});});
        const page=await context.newPage();page.setDefaultTimeout(12000);
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        const group=kind==='group',sourceId=group?'gm1':'dm1';
        const url=`${origin}/#/app/${group?'groups?group=g1':'chats?conversation=c1'}`;
        const source=page.locator(`[data-message-id="${sourceId}"]`),trigger=source.getByRole('button',{name:'Optionen',exact:true});
        const menu=page.getByRole('menu',{name:'Nachrichtenoptionen'}),dialog=page.getByRole('dialog');
        const draft=page.locator('.composer input:not([type=file])');
        const openMenu=async()=>{
          await trigger.scrollIntoViewIfNeeded();
          await trigger.evaluate(el=>new Promise(resolve=>{
            let previous='',last=performance.now();
            const frame=()=>{const b=el.getBoundingClientRect(),shape=[b.x,b.y,b.width,b.height].join(':');if(shape!==previous){previous=shape;last=performance.now();}if(performance.now()-last<180)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);
          }));
          await trigger.click();await menu.waitFor();
        };
        const open=async()=>{await openMenu();await menu.getByRole('menuitem',{name:'Weiterleiten',exact:true}).click();await dialog.getByRole('searchbox',{name:'Zielchat suchen'}).waitFor();await dialog.locator('.forward-targets button').first().waitFor();};
        const preview=async target=>{
          await open();
          const type=target==='group'?'Gruppe':'Einzelchat';
          await dialog.locator('.forward-targets button').filter({has:page.locator('small',{hasText:new RegExp('^'+type+'$')})}).first().click();
          await dialog.getByRole('button',{name:'Vorschau',exact:true}).click();
        };
        try {
          await page.goto(url);await source.locator('.message-body').waitFor();
          const original=await source.locator('.message-body').innerText();
          const body='  Angebot 👨‍👩‍👧‍👦\nhttps://example.invalid/?a=1&b=2\nGrüße <script>window.unsafe=true</script>  ';
          await page.evaluate(({group,body})=>{const row=(group?window.nexusTest.groupMessages:window.nexusTest.directMessages)[0];row.body=body;window.nexusTest.emit(group?'group_messages':'direct_messages');},{group,body});
          await page.waitForFunction(({id,body})=>document.querySelector(`[data-message-id="${id}"] .message-body`)?.textContent===body,{id:sourceId,body});
          await draft.fill('Mein ungesendeter Entwurf');
          await preview('group');
          assert.equal(await dialog.locator('.forward-preview p').textContent(),body);
          assert.equal(await page.evaluate(()=>window.unsafe),undefined);
          assert.equal(await page.evaluate(()=>window.nexusTest.forwardCalls.length),0,'Selection and preview must never send');
          await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
          assert.equal(await draft.inputValue(),'Mein ungesendeter Entwurf');
          assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,'Cancel restores focus');

          await open();await dialog.getByRole('searchbox').fill('Unauffindbar');
          await dialog.getByText('Keine passenden Chats gefunden.',{exact:true}).waitFor();
          assert.equal(await dialog.getByRole('button',{name:'Vorschau',exact:true}).isDisabled(),true);
          await dialog.getByRole('searchbox').fill('');await dialog.locator('.forward-targets button').first().waitFor();
          await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();

          for(const target of ['direct','group']){
            await preview(target);
            if(target==='direct')for(const width of [320,390,1440]){
              await page.setViewportSize({width,height:844});
              const rect=await dialog.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width,'Dialog fits screen');
              assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'No horizontal overflow');
              await page.screenshot({path:`browser-results/${name}-${kind}-forward-${width}.png`,fullPage:true});
            }
            await page.setViewportSize({width:390,height:844});
            await page.evaluate(()=>{window.nexusTest.forwardDelay=100;});
            const before=await page.evaluate(()=>window.nexusTest.forwardWrites);
            await dialog.getByRole('button',{name:'Jetzt weiterleiten',exact:true}).evaluate(el=>{el.click();el.click();});
            await dialog.getByRole('heading',{name:'Nachricht weitergeleitet',exact:true}).waitFor();
            assert.equal(await page.evaluate(()=>window.nexusTest.forwardWrites),before+1,'Double submit sends once');
            assert.equal(await draft.inputValue(),'Mein ungesendeter Entwurf');
            const row=await page.evaluate(()=>window.nexusTest.forwardReceipts.at(-1));
            assert.equal(row.args.p_expected_body,body);
            await dialog.getByRole('button',{name:'Zurück zum Chat',exact:true}).click();
          }

          // Lost result after commit: manual retry must reuse the original request.
          await preview(group?'direct':'group');
          await page.evaluate(()=>{window.nexusTest.loseForwardResponse=true;window.nexusTest.forwardDelay=0;window.nexusTest.forwardCalls=[];});
          const before=await page.evaluate(()=>window.nexusTest.forwardWrites);
          await dialog.getByRole('button',{name:'Jetzt weiterleiten',exact:true}).click();
          await dialog.getByRole('alert').filter({hasText:'Versand nicht bestätigt'}).waitFor();
          assert.equal(await page.evaluate(()=>window.nexusTest.forwardWrites),before+1);
          await dialog.getByRole('button',{name:'Erneut versuchen',exact:true}).click();
          await dialog.getByRole('heading',{name:'Nachricht weitergeleitet',exact:true}).waitFor();
          const calls=await page.evaluate(()=>window.nexusTest.forwardCalls);
          assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
          assert.equal(await page.evaluate(()=>window.nexusTest.forwardWrites),before+1);
          const lastId=await page.evaluate(()=>window.nexusTest.forwardReceipts.at(-1).id);
          await dialog.getByRole('button',{name:'Zielchat öffnen',exact:true}).click();
          const forwarded=page.locator(`[data-message-id="${lastId}"]`);
          await forwarded.getByText('Weitergeleitet',{exact:true}).waitFor();
          assert.equal(await forwarded.locator('.message-body').textContent(),body);
          await page.reload();await forwarded.getByText('Weitergeleitet',{exact:true}).waitFor();
          await page.evaluate(()=>{window.forwardOnline=false;window.dispatchEvent(new Event('offline'));});
          await page.waitForTimeout(150);
          assert.equal(await forwarded.getByText('Weitergeleitet',{exact:true}).isVisible(),true);
          await forwarded.getByRole('button',{name:'Optionen',exact:true}).click();
          assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['Text kopieren'],'Offline menu stays local');
          await page.keyboard.press('Escape');
          await page.evaluate(()=>{window.forwardOnline=true;window.dispatchEvent(new Event('online'));});

          await page.goto(url);await source.locator('.message-body').waitFor();
          await preview('group');
          await page.evaluate(()=>{window.nexusTest.forwardDenied=true;});
          await dialog.getByRole('button',{name:'Jetzt weiterleiten',exact:true}).click();
          await dialog.getByRole('alert').filter({hasText:'Zielchat nicht mehr verfügbar'}).waitFor();
          assert.equal(await page.evaluate(()=>window.nexusTest.forwardWrites),0,'Revoked destination did not send');
          await dialog.getByRole('button',{name:'Schließen',exact:true}).click();
          await page.evaluate(()=>{window.nexusTest.forwardDenied=false;});

          // Author changes text after preview, even without a Realtime event.
          await preview('group');
          await page.evaluate(group=>{(group?window.nexusTest.groupMessages:window.nexusTest.directMessages)[0].body='Changed at source';},group);
          await dialog.getByRole('button',{name:'Jetzt weiterleiten',exact:true}).click();
          await dialog.getByRole('alert').filter({hasText:'Nachricht wurde geändert'}).waitFor();
          assert.equal(await page.evaluate(()=>window.nexusTest.forwardWrites),0);
          await dialog.getByRole('button',{name:'Schließen',exact:true}).click();
          await page.evaluate(({group,original})=>{(group?window.nexusTest.groupMessages:window.nexusTest.directMessages)[0].body=original;},{group,original});

          await preview('group');
          await page.evaluate(()=>{window.forwardOnline=false;window.dispatchEvent(new Event('offline'));});
          await dialog.waitFor({state:'hidden'}); // Cached mode removes server actions.
          assert.equal(await page.evaluate(()=>window.nexusTest.forwardWrites),0);
          await page.evaluate(()=>{window.forwardOnline=true;window.dispatchEvent(new Event('online'));});
          await trigger.waitFor();

          // An account change cannot retain an old dialog or revive late targets.
          await open();
          await page.evaluate(()=>window.nexusTest.switchUser('other'));
          await dialog.waitFor({state:'hidden'});
          assert.equal(await page.evaluate(()=>window.nexusTest.forwardWrites),0);
          assert.deepEqual(errors,[]);
          console.log(`${name} ${kind}: confirmation, exact text, cross-chat forwards, reload/offline flag, drafts, duplicate/lost responses, denied/stale source, offline and account fencing passed`);
        }catch(error){await page.screenshot({path:`browser-results/${name}-${kind}-forward-failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-2000));throw error;}
        finally{await context.close();}
      }
    }finally{await browser.close();}
  }
}finally{await server.close();}
