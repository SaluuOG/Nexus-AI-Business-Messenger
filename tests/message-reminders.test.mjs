import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Personal reminders: local time, validated reads and version-bound writes',async t=>{
 const stubPath=fileURLToPath(new URL('./support/supabaseStub.mjs',import.meta.url));
 const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'reminders-unit',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase'))return stubPath;}}]});
 const oldTZ=process.env.TZ;
 try{
  const stub=await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
  const api=await server.ssrLoadModule('/src/features/data/messageReminders.ts');
  await t.test('Berlin calendar dates, year changes and nonexistent DST time',()=>{
   process.env.TZ='Europe/Berlin';
   assert.equal(api.reminderPreset('tomorrow',new Date('2026-12-31T22:00:00Z')),'2027-01-01T09:00');
   assert.equal(api.reminderPreset('tomorrow',new Date('2026-03-28T23:10:00+01:00')),'2026-03-29T09:00');
   assert.equal(api.parseReminderInput('2026-03-29T09:00',Date.parse('2026-03-28T00:00Z')),'2026-03-29T07:00:00.000Z');
   assert.throws(()=>api.parseReminderInput('2026-03-29T02:30',0),/existiert nicht/);
   assert.throws(()=>api.parseReminderInput('2026-02-30T12:00',0),/existiert nicht/);
   assert.throws(()=>api.parseReminderInput('2026-10-01T12:00',Date.parse('2026-10-02T00:00Z')),/zukünftigen/);
   assert.equal(api.reminderPreset('twoHours',new Date('2026-10-02T23:31:10+02:00')),'2026-10-03T01:32');
   process.env.TZ='America/New_York';
   assert.equal(api.parseReminderInput('2026-10-03T09:00',0),'2026-10-03T13:00:00.000Z');
  });
  const state={id:'r1',version:'v1',due_at:'2026-10-03T12:00:00Z'};
  const row={...state,kind:'direct',message_id:'m1',chat_id:'c1',chat_name:'Client',sender_name:'Sender',preview:'Text',attachment_name:null,created_at:'2026-10-01T00:00:00Z'};
  const page={items:[row],server_now:'2026-10-03T12:30:00Z',due_count:1,has_more:false,next_cursor:null};
  await t.test('Account-bound reads, malformed rows and non-advancing cursors',async()=>{
   stub.setResponse(()=>({data:state,error:null}));assert.deepEqual(await api.loadMessageReminder('me','direct','m1'),state);
   assert.deepEqual(stub.requests[0].args,{p_user_id:'me',p_kind:'direct',p_message_id:'m1'});
   stub.setResponse(()=>({data:null,error:null}));assert.equal(await api.loadMessageReminder('me','group','m1'),null);
   stub.setResponse(()=>({data:page,error:null}));assert.deepEqual(await api.loadMessageReminders('me','due'),page);
   for(const data of [{...page,items:[row,row]},{...page,items:[{...row,due_at:null}]},{...page,due_count:-1},{...page,server_now:'bad'},{...page,items:[{...row,kind:'foreign'}]},{...page,has_more:true}]){
    stub.setResponse(()=>({data,error:null}));await assert.rejects(api.loadMessageReminders('me','all'));
   }
   const cursor={due_at:row.due_at,id:row.id};stub.setResponse(()=>({data:{...page,has_more:true,next_cursor:cursor},error:null}));
   assert.deepEqual((await api.loadMessageReminders('me','all')).next_cursor,cursor);
   await assert.rejects(api.loadMessageReminders('me','all',cursor));
  });
  await t.test('Retries reuse the version, intent and request; unconfirmed writes never succeed',async()=>{
   const intent={version:'old',requestId:'new',dueAt:'2026-10-03T14:00:00.000Z'};
   stub.setResponse(()=>({data:{id:'r1',version:'new',due_at:'2026-10-03T14:00:00+00:00'},error:null}));
   await api.changeMessageReminder('me','group','m1',intent);await api.changeMessageReminder('me','group','m1',intent);
   assert.deepEqual(stub.requests[0],stub.requests[1]);assert.equal(stub.requests[0].args.p_expected_version,'old');
   for(const response of [{data:{...state,version:'new'},error:null},{data:state,error:null},{data:null,error:null},{data:state,error:{code:'40001'}},{data:state,error:{code:'42501'}}]){
    stub.setResponse(()=>response);await assert.rejects(api.changeMessageReminder('me','group','m1',intent));
   }
   stub.setResponse(()=>({data:{id:'r1',version:'done',due_at:null},error:null}));
   await api.changeMessageReminder('me','group','m1',{version:'new',requestId:'done',dueAt:null});
   assert.equal(stub.requests[0].args.p_due_at,null);
   stub.setResponse(()=>{throw new TypeError('Load failed');});
   await assert.rejects(api.changeMessageReminder('me','group','m1',intent),/Änderung nicht bestätigt/);
   await assert.rejects(api.loadMessageReminders('me','due'),/Wiedervorlagen konnten nicht geladen/);
  });
 }finally{if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ;await server.close();}
});
