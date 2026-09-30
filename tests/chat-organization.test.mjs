import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Personal chat organization validates reads, independent writes, views and cache',async t=>{
  const stubPath=fileURLToPath(new URL('./support/supabaseStub.mjs',import.meta.url));
  const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'organization-unit',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase'))return stubPath;}}]});
  try{
    const stub=await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api=await server.ssrLoadModule('/src/features/data/chatOrganization.ts');
    const cache=await server.ssrLoadModule('/src/features/offline/chatCache.ts');
    const row={chat_id:'chat',favorite:true,archived:false};
    await t.test('Only valid preference rows; failed metadata cannot silently undo archive filtering',async()=>{
      stub.setResponse(()=>({data:[row],error:null}));
      assert.deepEqual((await api.loadChatOrganization('direct')).get('chat'),{favorite:true,archived:false});
      for(const data of [null,[{...row,archived:'true'}],[{...row,chat_id:''}],[row,row]]){
        stub.setResponse(()=>({data,error:null}));await assert.rejects(api.loadChatOrganization('direct'));
      }
      stub.setResponse(()=>({data:null,error:{message:'denied'}}));
      const merged=await api.withChatOrganization('direct',async()=>({data:[{conversation_id:'chat'}],error:null}),r=>r.conversation_id);
      assert.ok(merged.error);assert.deepEqual(merged.data,[]);
      const network=await api.withChatOrganization('direct',async()=>({data:null,error:{message:'TypeError: Load failed'}}),r=>r.conversation_id);
      assert.equal(network.error,'TypeError: Load failed','Network errors retain offline fallback classification');
    });
    await t.test('Writes set one explicit field and propagate failure',async()=>{
      stub.setResponse(()=>({data:null,error:null}));
      await api.setChatOrganization('direct','chat','favorite',true);
      await api.setChatOrganization('direct','chat','archived',true);
      assert.deepEqual(stub.requests.map(r=>r.args),[
        {p_kind:'direct',p_chat_id:'chat',p_field:'favorite',p_value:true},
        {p_kind:'direct',p_chat_id:'chat',p_field:'archived',p_value:true},
      ]);
      stub.setResponse(()=>({data:null,error:{message:'denied'}}));await assert.rejects(api.setChatOrganization('group','chat','archived',false));
    });
    await t.test('Favorites sort stably, archive is separate and source order is untouched',()=>{
      const rows=[{id:1},{id:2,favorite:true},{id:3,archived:true,favorite:true},{id:4,favorite:true},{id:5}];
      assert.deepEqual(api.organizeChats(rows,'active').map(r=>r.id),[2,4,1,5]);
      assert.deepEqual(api.organizeChats(rows,'favorites').map(r=>r.id),[2,4]);
      assert.deepEqual(api.organizeChats(rows,'archive').map(r=>r.id),[3]);
      assert.deepEqual(rows.map(r=>r.id),[1,2,3,4,5]);
      const saved=cache.sanitizeRows('direct','list',[{conversation_id:'chat',favorite:true,archived:true,token:'secret'}]);
      assert.equal(saved[0].favorite,true);assert.equal(saved[0].archived,true);assert.equal(saved[0].token,undefined);
      assert.equal(cache.sanitizeRows('group','list',[{group_id:'g',favorite:'true',archived:'true'}])[0].archived,false);
    });
    await t.test('Realtime is scoped to the current account without unfiltered DELETE',()=>{
      stub.setResponse(()=>({data:[],error:null}));let refresh=0;
      api.subscribeChatOrganization('group','me',()=>refresh++);
      assert.equal(refresh,1);assert.equal(stub.subscriptions.length,2);
      assert.ok(stub.subscriptions.every(s=>s.filter.filter==='user_id=eq.me'&&s.filter.table==='group_chat_preferences'&&['INSERT','UPDATE'].includes(s.filter.event)));
    });
  }finally{await server.close();}
});
