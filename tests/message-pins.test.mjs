import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Message pins validate scoped data, idempotent writes and realtime scope', async t => {
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs',import.meta.url));
  const server = await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'pins-unit',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase')) return stubPath;}}]});
  try {
    const stub = await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api = await server.ssrLoadModule('/src/features/data/messagePins.ts');
    const row = {message_id:'message',chat_id:'chat',preview:'Hinweis',created_at:'2026-09-30T10:00:00Z'};
    await t.test('Read and reject malformed/foreign/duplicate pins',async()=>{
      stub.setResponse(()=>({data:[row],error:null}));
      assert.deepEqual(await api.loadMessagePins('direct','chat'),[row]);
      for(const rows of [[{...row,chat_id:'foreign'}],[{...row,preview:null}],[{...row,created_at:'bad'}],[row,row]]){
        stub.setResponse(()=>({data:rows,error:null}));
        await assert.rejects(api.loadMessagePins('direct','chat'));
      }
    });
    await t.test('Explicit state is safe to retry; errors are not success',async()=>{
      stub.setResponse(()=>({data:null,error:null}));
      await api.setMessagePin('group','chat','message',true);
      await api.setMessagePin('group','chat','message',true);
      assert.deepEqual(stub.requests[0],stub.requests[1]);
      await api.setMessagePin('group','chat','message',false);
      assert.equal(stub.requests[2].args.p_pinned,false);
      stub.setResponse(()=>({data:null,error:{message:'denied'}}));
      await assert.rejects(api.setMessagePin('group','chat','message',true));
    });
    await t.test('Scoped pin + message updates, no unfiltered deletes',()=>{
      stub.setResponse(()=>({data:[],error:null}));
      let refreshes=0; api.subscribeMessagePins('group','chat',()=>refreshes++);
      assert.equal(refreshes,1);
      assert.equal(stub.subscriptions.length,4);
      assert.ok(stub.subscriptions.every(s=>s.filter.filter==='group_id=eq.chat' && ['INSERT','UPDATE'].includes(s.filter.event)));
    });
  } finally {await server.close();}
});
