import { useEffect, useRef, useState } from 'react';
import { setChatOrganization, setChatMute, type ChatMuteMode, type OrganizationField, type OrganizationKind } from './chatOrganization';

export function useChatOrganization(kind: OrganizationKind, userId: string | undefined, enabled: boolean, onSaved: (id: string, field?: OrganizationField, value?: boolean) => Promise<void>) {
  const scope = JSON.stringify([kind,userId]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const alive = useRef(true);
  const pending = useRef(new Set<string>());
  const [state,setState] = useState<{scope: string; error: string | null; pending: Set<string>}>({scope,error:null,pending:new Set()});
  useEffect(() => { alive.current=true; return () => { alive.current=false; }; }, []);
  const perform = async (id: string, operation: () => Promise<void>, after: () => Promise<void>) => {
    const key = JSON.stringify([scope,id]);
    if (!enabled || !userId || pending.current.has(key) || navigator.onLine === false) return;
    pending.current.add(key);
    const valid = () => alive.current && currentScope.current === scope;
    setState({scope,error:null,pending:new Set(pending.current)});
    try {
      await operation();
      if (valid()) await after();
    } catch {
      if (valid()) setState(previous => ({...previous,error:'Chat-Einstellung konnte nicht gespeichert werden. Prüfe deine Verbindung und versuche es erneut.'}));
    } finally {
      pending.current.delete(key);
      if (valid()) setState(previous => ({...previous,pending:new Set(pending.current)}));
    }
  };
  return {
    error: state.scope===scope ? state.error : null,
    busy: (id: string) => state.scope===scope && state.pending.has(JSON.stringify([scope,id])),
    save: (id: string, field: OrganizationField, value: boolean) => void perform(id,()=>setChatOrganization(kind,id,field,value),()=>onSaved(id,field,value)),
    mute: (id: string, mode: ChatMuteMode) => void perform(id,()=>setChatMute(kind,id,mode),()=>onSaved(id)),
  };
}
