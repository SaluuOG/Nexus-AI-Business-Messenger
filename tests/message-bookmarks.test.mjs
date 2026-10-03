import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Personal bookmarks: scoped reads, cursor validation, explicit writes and navigation',async t=>{
  const stubPath=fileURLToPath(new URL('./support/supabaseStub.mjs',import.meta.url));
  const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'bookmarks-unit',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase'))return stubPath;}}]});
  try {
    const stub=await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api=await server.ssrLoadModule('/src/features/data/messageBookmarks.ts');
    const row={id:'bookmark',kind:'direct',message_id:'message',chat_id:'chat',chat_name:'Client',sender_name:'Sender',preview:'Grüße 👋\nText',attachment_name:null,created_at:'2026-10-01T10:00:00Z',saved_at:'2026-10-02T10:00:00Z'};
    await t.test('Account binding and strict row/cursor validation',async()=>{
      stub.setResponse(()=>({data:{items:[row],has_more:false,next_cursor:null},error:null}));
      assert.deepEqual((await api.loadMessageBookmarks('me','  Text  ')).items,[row]);
      assert.equal(stub.requests[0].args.p_user_id,'me');assert.equal(stub.requests[0].args.p_query,'Text');
      for(const data of [{items:[row,row],has_more:false,next_cursor:null},{items:[{...row,saved_at:'bad'}],has_more:false,next_cursor:null},{items:[{...row,kind:'foreign'}],has_more:false,next_cursor:null},{items:[row],has_more:true,next_cursor:null},{items:[row],has_more:true,next_cursor:{saved_at:row.saved_at,id:'wrong'}},{items:[],has_more:true,next_cursor:{saved_at:row.saved_at,id:row.id}}]){
        stub.setResponse(()=>({data,error:null}));await assert.rejects(api.loadMessageBookmarks('me',''));
      }
      const cursor={saved_at:row.saved_at,id:row.id};
      stub.setResponse(()=>({data:{items:[row],has_more:true,next_cursor:cursor},error:null}));
      assert.deepEqual((await api.loadMessageBookmarks('me','')).next_cursor,cursor);
      await assert.rejects(api.loadMessageBookmarks('me','',cursor),'Non-advancing cursor rejected');
    });
    await t.test('Visible IDs are batched and foreign IDs cannot masquerade as saved',async()=>{
      const ids=Array.from({length:405},(_,i)=>'message-'+i);
      stub.setResponse(r=>({data:r.args.p_message_ids.slice(0,1),error:null}));
      const saved=await api.loadBookmarkStatus('me','group','g1',ids);
      assert.equal(stub.requests.length,3);assert.equal(saved.size,3);
      assert.ok(stub.requests.every(r=>r.args.p_message_ids.length<=200&&r.args.p_chat_id==='g1'&&r.args.p_user_id==='me'));
      for(const data of [['other'],[ids[0],ids[0]],null]){stub.setResponse(()=>({data,error:null}));await assert.rejects(api.loadBookmarkStatus('me','group','g1',ids.slice(0,2)));}
    });
    await t.test('Lost-response retry preserves desired state, not an inverted toggle',async()=>{
      stub.setResponse(r=>({data:r.args.p_saved,error:null}));
      await api.setMessageBookmark('me','direct','message',true);await api.setMessageBookmark('me','direct','message',true);
      assert.deepEqual(stub.requests[0],stub.requests[1]);
      await api.setMessageBookmark('me','direct','message',false);assert.equal(stub.requests[2].args.p_saved,false);
      for(const response of [{data:null,error:null},{data:false,error:null},{data:true,error:{code:'42501'} }]){stub.setResponse(()=>response);await assert.rejects(api.setMessageBookmark('me','direct','message',true));}
      stub.setResponse(()=>{throw Error('transport');});await assert.rejects(api.setMessageBookmark('me','group','message',true));
    });
    await t.test('Deep links carry the actual chat kind and safely encode IDs',()=>{
      assert.equal(api.bookmarkTarget({kind:'direct',chat_id:'a&b',message_id:'m?'}),'/app/chats?conversation=a%26b&message=m%3F');
      assert.equal(api.bookmarkTarget({...row,kind:'group'}),'/app/groups?group=chat&message=message');
    });
  }finally{await server.close();}
});
