import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

test('Shared content validates scope, pagination and safe links without leaking private metadata',async t=>{
  const path=fileURLToPath(new URL('./support/supabaseStub.mjs',import.meta.url));
  const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'shared-unit',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase'))return path;}}]});
  try {
    const stub=await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api=await server.ssrLoadModule('/src/features/data/chatSharedContent.ts');
    const image={item_id:'a:one',message_id:'old',created_at:'2026-01-01T10:00:00Z',kind:'direct',chat_id:'c1',title:'Foto.png',storage_path:'c1/me/one.png',mime_type:'image/png',file_size:100,url:null};
    const cursor=row=>({created_at:row.created_at,message_id:row.message_id,item_id:row.item_id});
    const page=(items,patch={})=>({items,has_more:false,next_cursor:items.length?cursor(items.at(-1)):null,...patch});
    const respond=data=>stub.setResponse(()=>({data,error:null}));
    await t.test('Reads and searches scoped pages with stable server cursors',async()=>{
      respond(page([image]));assert.deepEqual((await api.loadChatSharedContent('direct','c1','images','  FOTO ')).items,[image]);
      assert.equal(stub.requests[0].args.p_query,'FOTO');assert.equal(stub.requests[0].args.p_limit,24);
      const group={...image,kind:'group',chat_id:'g1',storage_path:'groups/g1/me/one.png'};
      respond(page([group]));assert.equal((await api.loadChatSharedContent('group','g1','images')).items.length,1);
      respond(page([]));assert.deepEqual(await api.loadChatSharedContent('direct','c1','images'),page([]));
    });
    await t.test('Rejects foreign data, malformed pages, unsafe paths and stalled cursors',async()=>{
      for(const data of [page([{...image,chat_id:'c2'}]),page([{...image,kind:'group'}]),page([{...image,storage_path:'c2/me/f.png'}]),page([{...image,file_size:NaN}]),page([{...image,mime_type:'application/pdf'}]),page([image,image]),page([image],{next_cursor:cursor({...image,message_id:'wrong'})}),page([],{has_more:true}),page([image],{has_more:null})]){
        respond(data);await assert.rejects(api.loadChatSharedContent('direct','c1','images'));
      }
      respond(page([image]));await assert.rejects(api.loadChatSharedContent('direct','c1','images','',cursor(image)));
      await assert.rejects(api.loadChatSharedContent('direct','c1','files','x'.repeat(101)));
      await assert.rejects(api.loadChatSharedContent('direct','c1','images','',{created_at:'bad'}));
      stub.setResponse(()=>({data:null,error:{message:'private SQL detail'}}));
      await assert.rejects(api.loadChatSharedContent('direct','c1','images'),error=>!error.message.includes('SQL'));
    });
    await t.test('Unsafe/mistyped URLs are skipped, including at a page boundary',async()=>{
      for(const url of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','//evil.invalid','https://user:pw@example.com','https://example.com/a b','https://example.com\\evil','http://x:bad'])assert.equal(api.safeSharedUrl(url),null,url);
      assert.equal(api.safeSharedUrl('https://example.com/a(b)?x=1&y=2'),'https://example.com/a(b)?x=1&y=2');
      const link={...image,item_id:'l:one',url:'https://example.com/one',title:'https://example.com/one',storage_path:null,mime_type:null,file_size:null};
      const invalid={...link,item_id:'l:two',url:'http://x:bad'};
      respond(page([link,invalid],{has_more:true}));
      const result=await api.loadChatSharedContent('direct','c1','links');
      assert.equal(result.items.length,1);assert.deepEqual(result.next_cursor,cursor(invalid));assert.equal(result.has_more,true);
    });
    await t.test('Private file URLs use the existing bucket and short validity',async()=>{
      const calls=[];let denied=false;
      stub.supabase.storage={from(bucket){return {async createSignedUrl(path,expiry){calls.push({bucket,path,expiry});return denied?{error:{message:'denied'}}:{data:{signedUrl:'https://files.example.invalid/private'}};}};}};
      assert.equal(await api.signSharedItem(image),'https://files.example.invalid/private');
      await api.signSharedItem({...image,kind:'group',storage_path:'groups/g1/me/file'});
      assert.ok(calls.every(call=>call.bucket==='nexus-chat-attachments'&&call.expiry===60));
      denied=true;await assert.rejects(api.signSharedItem(image));
    });
    await t.test('Realtime listens only to the selected chat and removes its channel',()=>{
      stub.setResponse(()=>({data:[],error:null}));let removed=0;stub.supabase.removeChannel=()=>removed++;
      const stop=api.subscribeSharedContent('group','g1',()=>{});
      assert.equal(stub.subscriptions.length,2);
      assert.ok(stub.subscriptions.every(s=>s.filter.table==='group_messages'&&s.filter.filter==='group_id=eq.g1'&&['INSERT','UPDATE'].includes(s.filter.event)));
      stop();assert.equal(removed,1);
    });
  }finally{await server.close();}
});
