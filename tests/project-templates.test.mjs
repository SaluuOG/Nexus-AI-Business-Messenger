import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Project templates: calendar dates, independent drafts and scoped requests', async t => {
 const root=fileURLToPath(new URL('../',import.meta.url));
 const stubPath=fileURLToPath(new URL('./support/supabaseStub.mjs',import.meta.url));
 const server=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'template-test',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase'))return stubPath;}}]});
 try {
  const stub=await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
  const api=await server.ssrLoadModule('/src/features/data/projectTemplates.ts');
  const template={id:'v1',workspace_id:'w1',name:'Website',description:'Briefing',priority:'high',deadline_offset:14,tasks:[{title:'Planung',description:'Details',priority:'medium',due_offset:2,checklist:['Inhalte','Freigabe']},{title:'Vorbereitung',description:null,priority:'low',due_offset:-1,checklist:[]},{title:'Später',description:null,priority:'low',due_offset:null,checklist:[]}]};
  await t.test('Calendar offsets survive leap days, DST transitions and timezone changes',()=>{
   const previous=process.env.TZ;
   try { for(const tz of ['Europe/Berlin','America/Los_Angeles','Pacific/Kiritimati']) {
    process.env.TZ=tz;
    assert.equal(api.shiftTemplateDate('2028-02-28',1),'2028-02-29');
    assert.equal(api.shiftTemplateDate('2026-03-29',1),'2026-03-30');
    assert.equal(api.shiftTemplateDate('2026-10-25',-1),'2026-10-24');
    assert.equal(api.shiftTemplateDate('2026-12-31',1),'2027-01-01');
   }} finally { if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous; }
   for(const [start,days] of [['2026-02-30',0],['bad',0],['2026-01-01',0.5],['9999-12-31',1],['1900-01-01',-1]])assert.throws(()=>api.shiftTemplateDate(start,days));
   assert.equal(api.shiftTemplateDate('2026-01-01',null),null);
  });
  await t.test('Copies have new identities, reset status/assignment and do not mutate the snapshot',()=>{
   const a=api.projectFromTemplate(template,'2026-10-01'),b=api.projectFromTemplate(template,'2026-11-01');
   assert.equal(a.deadline,'2026-10-15');assert.equal(a.tasks[0].due_date,'2026-10-03');
   assert.equal(a.tasks[1].due_date,'2026-09-30');assert.equal(a.tasks[2].due_date,null);
   assert.equal(b.tasks[0].due_date,'2026-11-03');assert.notEqual(a.tasks[0].id,b.tasks[0].id);
   assert.ok(a.tasks.every(task=>task.status==='todo'&&task.assigned_to===null));
   a.tasks[0].checklist.push('Nur im Entwurf');assert.equal(template.tasks[0].checklist.length,2);
   assert.throws(()=>api.projectFromTemplate({...template,deadline_offset:null,tasks:[]},''));
  });
  await t.test('Checklist blanks are removed; invalid sizes stop creation before any request',()=>{
   const tasks=api.projectFromTemplate(template,'2026-10-01').tasks;
   tasks[0].checklist=[' Punkt ', '', '  '];assert.deepEqual(api.cleanInitialChecklists(tasks)[0].checklist,['Punkt']);
   assert.deepEqual(tasks[0].checklist,[' Punkt ', '', '  ']);
   for(const checklist of [['x'.repeat(241)],Array(101).fill('x')])assert.throws(()=>api.cleanInitialChecklists([{...tasks[0],checklist}]));
   assert.throws(()=>api.cleanInitialChecklists(Array(6).fill({...tasks[0],checklist:Array(100).fill('x')})));
  });
  await t.test('Reads are scoped; capture uses a stable intent and archiving carries workspace identity',async()=>{
   stub.setResponse(()=>({data:[template],error:null}));assert.equal((await api.loadProjectTemplates('w1'))[0].id,'v1');
   assert.deepEqual(stub.requests[0].filters,[['workspace_id','w1'],['archived',false]]);assert.deepEqual(stub.requests[0].range,[0,99]);
   stub.setResponse(()=>({data:template,error:null}));await api.saveProjectTemplate('v1','w1','p1',' Website ','2026-10-01');
   assert.deepEqual(stub.requests[0].args,{p_id:'v1',p_workspace:'w1',p_project:'p1',p_name:'Website',p_start:'2026-10-01'});
   await api.archiveProjectTemplate('v1','w1');assert.deepEqual(stub.requests[1].args,{p_id:'v1',p_workspace:'w1'});
  });
  await t.test('Permission failures hide internals and conflicting replies are rejected',async()=>{
   stub.setResponse(()=>({data:null,error:{code:'42501',message:'private details'}}));await assert.rejects(api.loadProjectTemplates('w1'),/Berechtigung/);
   stub.setResponse(()=>({data:{...template,workspace_id:'other'},error:null}));await assert.rejects(api.saveProjectTemplate('v1','w1','p1','Website','2026-10-01'),/bestätigt/);
  });
 } finally {await server.close();}
});
