// Browser fixture only. SQL acceptance separately exercises actual policies/RPCs.
import { supabase as base } from './supabase.mjs';
export { backendConfigured, supabaseConfig, initialAuthCallback } from './supabase.mjs';
const state=window.nexusTest;
const fixture=window.nexusTemplateTest={templates:[],calls:[],loseSave:false,loseCreate:false,delayRead:false,delaySave:false,pending:[]};
let actor='me';const switchUser=state.switchUser;state.switchUser=id=>{actor=id;switchUser(id);};
const manager=workspace=>['owner','admin'].includes(state.memberships.find(m=>m.workspace_id===workspace&&m.user_id===actor)?.role);
const denied=()=>({data:null,error:{code:'42501',message:'permission denied'}});
const pause=()=>new Promise(resolve=>fixture.pending.push(resolve));
Object.assign(state.projects.find(p=>p.id==='p5'),{deadline:'2026-10-15',priority:'high',description:'Wiederverwendbarer Projektablauf'});
state.tasks.push({id:'template-task',workspace_id:'w3',project_id:'p5',title:'Inhalte vorbereiten',description:'Texte und Bilder sammeln',status:'done',priority:'high',assigned_to:'other',due_date:'2026-10-03',created_at:'2026-10-01T08:00:00Z',updated_at:'2026-10-01T08:00:00Z'});
state.collaboration.task_checklist_items.push(...['Texte prüfen','Bilder freigeben'].map((label,index)=>({id:'source-point-'+index,workspace_id:'w3',task_id:'template-task',label,is_completed:true,created_by:'me',created_at:'2026-10-01T08:00:00Z',revision:1})));
const offset=(date,start)=>date?Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000):null;
export const supabase={...base,
 from(table){
  if(table!=='project_templates')return base.from(table);
  const filters=[];
  return {select(){return this;},eq(...args){filters.push(args);return this;},order(){return this;},range(){return this;},async then(resolve,reject){
   try{const rows=structuredClone(fixture.templates.filter(row=>manager(row.workspace_id)&&filters.every(([key,value])=>row[key]===value)));if(fixture.delayRead)await pause();resolve({data:rows,error:null});}catch(error){reject(error);}
  }};
 },
 async rpc(name,args){
  if(name==='save_project_template'){
   fixture.calls.push(structuredClone(args));
   if(!manager(args.p_workspace))return denied();
   let row=fixture.templates.find(row=>row.id===args.p_id);
   if(!row){
    const project=state.projects.find(p=>p.id===args.p_project&&p.workspace_id===args.p_workspace);
    if(!project)return {data:null,error:{code:'23503'}};
    row={id:args.p_id,workspace_id:args.p_workspace,name:args.p_name,description:project.description,priority:project.priority,deadline_offset:offset(project.deadline,args.p_start),archived:false,
     tasks:state.tasks.filter(t=>t.project_id===project.id).map(task=>({title:task.title,description:task.description,priority:task.priority,due_offset:offset(task.due_date,args.p_start),checklist:state.collaboration.task_checklist_items.filter(c=>c.task_id===task.id).map(c=>c.label)}))};
    fixture.templates.push(row);
   }
   if(fixture.delaySave)await pause();
   if(fixture.loseSave){fixture.loseSave=false;throw new Error('Antwort verloren. Bitte erneut versuchen.');}
   return {data:structuredClone(row),error:null};
  }
  if(name==='archive_project_template'){
   if(!manager(args.p_workspace))return denied();
   fixture.templates.filter(row=>row.id===args.p_id&&row.workspace_id===args.p_workspace).forEach(row=>{row.archived=true;});
   return {data:null,error:null};
  }
  if(name==='create_project_with_tasks'){
   const existed=state.projects.some(p=>p.id===args.p_project_id);
   const result=await base.rpc(name,args);
   if(!result.error&&!existed){
    for(const task of state.tasks.filter(t=>t.project_id===args.p_project_id)){
     for(const label of task.checklist||[])state.collaboration.task_checklist_items.push({id:crypto.randomUUID(),workspace_id:task.workspace_id,task_id:task.id,label,is_completed:false,revision:1,created_by:actor,created_at:new Date().toISOString()});
    }
   }
   if(!result.error&&fixture.loseCreate){fixture.loseCreate=false;throw new Error('Lost response after commit');}
   return result;
  }
  return base.rpc(name,args);
 }
};
