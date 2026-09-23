import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Task mention composer binds explicit members and inserts safe readable tokens', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const server = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const api = await server.ssrLoadModule('/src/features/data/taskMentions.ts');
    const members = [
      { user_id:'me',role:'owner',joined_at:'',full_name:'Samet',username:'samet',avatar_url:null },
      { user_id:'member',role:'member',joined_at:'',full_name:'Darlyn Beispiel',username:'darlyn',avatar_url:null },
      { user_id:'guest',role:'guest',joined_at:'',full_name:'Gast\n@Person',username:'gast',avatar_url:null },
    ];

    assert.deepEqual(api.findTaskMentionQuery('Bitte @dar', 10), { start:6,end:10,query:'dar' });
    assert.equal(api.findTaskMentionQuery('mail@example.com', 16), null);
    const inserted = api.insertTaskMention('Bitte @dar prüfen', { start:6,end:10,query:'dar' }, 'Darlyn Beispiel');
    assert.deepEqual(inserted, { value:'Bitte @Darlyn Beispiel prüfen',caret:23 });
    const started = api.beginTaskMention('Bitte prüfen', 5);
    assert.equal(started.value, 'Bitte @ prüfen');
    assert.deepEqual(started.query, { start:6,end:7,query:'' });

    assert.equal(api.taskMentionLabel(members[2]), 'Gast Person');
    assert.deepEqual(api.taskMentionCandidates(members,'me',[],'dar').map(member=>member.user_id),['member']);
    assert.deepEqual(api.taskMentionCandidates(members,'me',[{userId:'member',label:'Darlyn Beispiel'}],'').map(member=>member.user_id),['guest']);
    assert.equal(api.hasTaskMention('Hallo @Darlyn Beispiel, bitte prüfen.','Darlyn Beispiel'),true);
    assert.equal(api.hasTaskMention('Hallo @Darlyn BeispielExtra','Darlyn Beispiel'),false);
    assert.equal(api.hasTaskMention('mail@Darlyn Beispiel','Darlyn Beispiel'),false);
    assert.deepEqual(api.pruneTaskMentions('Hallo @Gleicher Name',[
      {userId:'first',label:'Gleicher Name'},{userId:'second',label:'Gleicher Name'},
    ]).map(mention=>mention.userId),['first']);
    assert.equal(api.removeTaskMention('Hallo @Darlyn Beispiel bitte prüfen.','Darlyn Beispiel'),'Hallo bitte prüfen.');
  } finally { await server.close(); }
});
