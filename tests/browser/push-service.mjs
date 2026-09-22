import { supabase as base } from './supabase.mjs';
export { backendConfigured, initialAuthCallback, supabaseConfig } from './supabase.mjs';
const device = { enabled:false,messages:true,assignments:true,comments:true,previews:false };
const fixture = window.nexusPushTest = { devices: JSON.parse(sessionStorage.getItem('nexusPush.server') || '{}'), calls:[], fail:'', hold:false, pending:[] };
export const supabase = { ...base,
  functions: { ...base.functions, async invoke(name,args) {
    if(name!=='mobile-push')return base.functions.invoke(name,args);
    return {data:{publicKey:'B'+'A'.repeat(86)},error:null};
  } },
  async rpc(name,args) {
    if(name!=='manage_push_device')return base.rpc(name,args);
    const user=(await base.auth.getSession()).data.session.user.id;
    fixture.calls.push({action:args.p_action,user,options:args.p_options});
    if(fixture.fail===args.p_action)return {data:null,error:{message:'Simulierter Push-Fehler.'}};
    if(fixture.hold&&args.p_action==='register')await new Promise(resolve=>fixture.pending.push(resolve));
    let current=fixture.devices[user]||{...device};
    if(args.p_action==='register')current={...current,enabled:true};
    if(args.p_action==='remove')current={...device};
    if(args.p_action==='options')current={...current,...args.p_options};
    fixture.devices[user]=current;sessionStorage.setItem('nexusPush.server',JSON.stringify(fixture.devices));
    return {data:{...current},error:null};
  },
};
