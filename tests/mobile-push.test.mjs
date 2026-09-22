import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { validEndpoint, pushPayload, deliverBatch } from '../supabase/functions/mobile-push/core.mjs';

test('Push endpoint validation rejects arbitrary hosts, lookalikes, redirects and credentials', () => {
  for (const url of ['https://fcm.googleapis.com/fcm/send/a', 'https://web.push.apple.com/a', 'https://updates.push.services.mozilla.com/wpush/a', 'https://wns.notify.windows.com/a']) assert.equal(validEndpoint(url), true, url);
  for (const url of ['http://fcm.googleapis.com/a','https://fcm.googleapis.com.evil.test/a','https://127.0.0.1/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:444/a','https://web.push.apple.com/a#b','https://evil.test/a',null]) assert.equal(validEndpoint(url), false, String(url));
});

test('Push payload hides private content by default and creates only scoped internal links', () => {
  const item = { delivery_id: 'j1', user_id: 'u1', device_id: 'd1', kind: 'direct_message', details: { title: 'Secret sender', chat_id: 'id&redirect=https://evil.test' }, preview: 'Secret message', previews: false };
  const hidden = pushPayload(item);
  assert.equal(hidden.title, 'Nexus'); assert.equal(hidden.body.includes('Secret'), false);
  assert.equal(hidden.path, '/app/chats?conversation=id%26redirect%3Dhttps%3A%2F%2Fevil.test');
  assert.equal(pushPayload({ ...item, previews: true }).body, 'Secret message');
  assert.equal(pushPayload({ ...item, kind: 'task_comment', details: { workspace_id:'w',project_id:'p',task_id:'t' } }).path, '/app/business?workspace=w&view=tasks&project=p&task=t');
  assert.throws(() => pushPayload({ ...item, kind:'task_comment', details:{} }), /Missing/);
});

test('Worker skips revoked records, expires vendor 410s, retries temporary failures and fences every completion', async () => {
  const outcomes = [201,410,429,503,400,0,'revoked','invalid'];
  const jobs = outcomes.map((_,i) => ({ id: String(i), lease_token:'lease-'+i }));
  const finished = [];
  const sent = [];
  const counts = await deliverBatch({
    rpc: async (name,args) => {
      if (name === 'claim_push_deliveries') return jobs;
      if (name === 'finish_push_delivery') { finished.push(args); return; }
      const index = Number(args.p_id);
      if (outcomes[index] === 'revoked') return null;
      return { delivery_id:args.p_id, kind:'test', endpoint: outcomes[index] === 'invalid' ? 'https://evil.test/' : 'https://fcm.googleapis.com/a', user_id:'u',device_id:'d' };
    },
    send: async item => { sent.push(item.delivery_id); const status=outcomes[Number(item.delivery_id)]; if (!status) throw new Error('timeout'); return status; },
  });
  assert.deepEqual(counts,{sent:1,discarded:1,retry:3,expired:1,failed:2});
  assert.equal(sent.length,6);
  assert.deepEqual(finished.map(x=>x.p_outcome).sort(),['sent','expired','retry','retry','failed','retry','discarded','failed'].sort());
  for (const result of finished) assert.equal(result.p_lease,'lease-'+result.p_id);
});

async function workerHarness() {
  const listeners = new Map(), state = new Map(), shown = [], navigation = [];
  const scope = 'https://nexus.test/Nexus-AI-Business-Messenger/';
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx = { objectStore() { return {
          get(key) { const out={result:structuredClone(state.get(key))}; queueMicrotask(()=>tx.oncomplete?.()); return out; },
          put(value,key) { state.set(key,structuredClone(value)); queueMicrotask(()=>tx.oncomplete?.()); return {}; },
          delete(key) { state.delete(key); queueMicrotask(()=>tx.oncomplete?.()); return {}; },
        }; } }; return tx;
      } }; request.onsuccess();
    }); return request;
  } };
  const self = { addEventListener(name,listener) {listeners.set(name,listener);}, registration: {
    scope, getNotifications:async()=>[], showNotification:async(title,options)=>shown.push({title,...options}),
  }, clients: { matchAll:async()=>[], openWindow:async url=>navigation.push(url) } };
  vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{ self,indexedDB,URL,Date,Object,String,Promise });
  const emit = async(name,event) => { let pending; listeners.get(name)({...event,waitUntil(p){pending=p;}}); await pending; };
  return {state,shown,navigation,scope,emit};
}

test('Service worker enforces device/account/privacy, suppresses retries and opens the exact task', async()=>{
  const h = await workerHarness();
  const bind = {userId:'u',deviceId:'d',enabled:true,messages:true,comments:true,assignments:true,previews:false};
  const payload={v:1,id:'j',recipient:'u',device:'d',kind:'task_comment',path:'/app/business?workspace=w&view=tasks&project=p&task=t',title:'Private task',body:'Private comment',generic:'Neuer Kommentar.',expires:Date.now()+60000};
  const push = data=>h.emit('push',{data:{json:()=>data}});
  await push(payload); assert.equal(h.shown.length,0);
  await h.emit('message',{source:{url:h.scope},data:{type:'NEXUS_PUSH_BINDING',binding:bind},ports:[]});
  await push({...payload,recipient:'other'}); await push({...payload,device:'other'}); await push({...payload,expires:1});
  assert.equal(h.shown.length,0);
  await push(payload); await push(payload);
  assert.equal(h.shown.length,1); assert.equal(h.shown[0].title,'Nexus'); assert.equal(h.shown[0].body,'Neuer Kommentar.');
  assert.equal(h.shown[0].icon,h.scope+'icons/nexus-192.png');
  await h.emit('notificationclick',{notification:{...h.shown[0],close(){}}});
  assert.deepEqual(h.navigation,[h.scope+'#'+payload.path]);
  await h.emit('message',{source:{url:h.scope},data:{type:'NEXUS_PUSH_BINDING',binding:null},ports:[]});
  await push({...payload,id:'later'});
  await h.emit('notificationclick',{notification:{...h.shown[0],close(){}}});
  assert.equal(h.shown.length,1); assert.equal(h.navigation.length,1);
  await h.emit('message',{source:{url:'https://evil.test/'},data:{type:'NEXUS_PUSH_BINDING',binding:bind},ports:[]});
  assert.equal(h.state.has('binding'),false);
});

test('Deadline payloads preserve privacy, distinguish both days and open the assigned task', () => {
  for (const [kind, word] of [['task_reminder_before','morgen'],['task_reminder_due','heute']]) {
    const item = { delivery_id:'reminder', user_id:'user', device_id:'device', kind, previews:false,
      details:{title:'Confidential task',workspace_id:'workspace',project_id:'project',task_id:'task'} };
    const payload = pushPayload(item);
    assert.equal(payload.title,'Nexus'); assert.match(payload.body,new RegExp(word));
    assert.equal(payload.body.includes('Confidential'),false);
    assert.equal(payload.path,'/app/business?workspace=workspace&view=tasks&project=project&task=task');
    assert.equal(pushPayload({...item,previews:true}).title,'Confidential task');
  }
});

test('Service worker requires reminder opt-in including devices from the previous app version', async () => {
  const h = await workerHarness();
  const binding = {userId:'user',deviceId:'device',enabled:true,messages:true,previews:false};
  const bind = value => h.emit('message',{source:{url:h.scope},data:{type:'NEXUS_PUSH_BINDING',binding:value},ports:[]});
  const payload = pushPayload({delivery_id:'reminder',user_id:'user',device_id:'device',kind:'task_reminder_due',previews:true,
    details:{title:'Private task',workspace_id:'w',project_id:'p',task_id:'t'}});
  const push = p => h.emit('push',{data:{json:()=>p}});
  await bind(binding); await push(payload); assert.equal(h.shown.length,0);
  await bind({...binding,deadlines:true}); await push(payload); await push(payload);
  assert.equal(h.shown.length,1); assert.equal(h.shown[0].title,'Nexus'); assert.match(h.shown[0].body,/heute/);
  await bind({...binding,deadlines:false}); await push({...payload,id:'next'}); assert.equal(h.shown.length,1);
});
