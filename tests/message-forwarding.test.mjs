import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Forward client validates destinations and sends immutable, account-scoped manual requests',async t=>{
  const stubPath=fileURLToPath(new URL('./support/supabaseStub.mjs',import.meta.url));
  const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'forward-unit',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase'))return stubPath;}}]});
  try {
    const stub=await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api=await server.ssrLoadModule('/src/features/data/messageForwarding.ts');
    const cache=await server.ssrLoadModule('/src/features/offline/chatCache.ts');
    const source={kind:'direct',messageId:'source',body:'  Grüße 👨‍👩‍👧‍👦\nhttps://example.invalid\n<b>Text</b>  ',chatName:'Source'};
    const target={kind:'group',chat_id:'target',name:'Team'};
    await t.test('Reject malformed and duplicate targets; preserve literal query',async()=>{
      stub.setResponse(()=>({data:{items:[target],has_more:false},error:null}));
      assert.deepEqual((await api.loadForwardTargets('  %_Team  ')).items,[target]);
      assert.equal(stub.requests[0].args.p_query,'%_Team');
      for(const data of [null,{items:[target,target],has_more:false},{items:[{...target,kind:'foreign'}],has_more:false},{items:[{...target,name:null}],has_more:false},{items:[],has_more:'yes'}]) {
        stub.setResponse(()=>({data,error:null}));await assert.rejects(api.loadForwardTargets(''));
      }
    });
    await t.test('Manual retries reuse body, account, source, destination and ID',async()=>{
      stub.setResponse(()=>({data:'sent',error:null}));
      assert.equal((await api.forwardTextMessage('me',source,target,'request')).id,'sent');
      await api.forwardTextMessage('me',source,target,'request');
      assert.deepEqual(stub.requests[0],stub.requests[1]);
      assert.equal(stub.requests[0].args.p_expected_body,source.body);
      assert.equal(stub.requests[0].args.p_user_id,'me');
    });
    await t.test('No false success or automatic retries on a lost response',async()=>{
      stub.setResponse(()=>{throw new Error('Network response lost');});
      const result=await api.forwardTextMessage('me',source,target,'request');
      assert.equal(result.id,null);assert.match(result.error,/Versand nicht bestätigt/);assert.equal(stub.requests.length,1);
      stub.setResponse(()=>({data:null,error:{code:'42501',message:'Zielchat nicht mehr verfügbar.'}}));
      assert.match((await api.forwardTextMessage('me',source,target,'request')).error,/Zielchat/);
      stub.setResponse(()=>({data:{id:'wrong-shape'},error:null}));
      assert.equal((await api.forwardTextMessage('me',source,target,'request')).id,null);
    });
    await t.test('Reject attachments, oversized/empty text; preserve offline flag but no source IDs',async()=>{
      stub.setResponse(()=>({data:'sent',error:null}));
      for(const value of [{...source,attachmentName:'file.pdf'},{...source,body:' '},{...source,body:'😀'.repeat(5001)}])assert.equal((await api.forwardTextMessage('me',value,target,'request')).id,null);
      assert.equal(stub.requests.length,0);
      const rows=cache.sanitizeRows('direct','chat',[{message_id:'message',body:source.body,is_forwarded:true,source_id:'private',source_sender:'private'}]);
      assert.equal(rows[0].is_forwarded,true);assert.equal(rows[0].source_id,undefined);
      assert.equal(cache.sanitizeRows('direct','chat',[{...rows[0],deleted_at:'2026-10-01'}])[0].is_forwarded,false);
    });
  }finally{await server.close();}
});
