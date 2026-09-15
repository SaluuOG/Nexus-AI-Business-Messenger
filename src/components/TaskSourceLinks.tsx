import { useEffect, useState } from 'react';
import { loadAccessibleTaskSources, type AccessibleTaskSource } from '../features/data/messageTasks';

// One paginated read per workspace, not one request per task card. The database
// only returns associations whose workspace AND source chat are still readable.
export function useTaskSourceLinks(workspaceId: string, tasksVersion: unknown) {
  const [snapshot, setSnapshot] = useState<{ workspaceId: string; sources: AccessibleTaskSource[]; error: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = async () => {
      const request = ++version;
      try {
        const result = await loadAccessibleTaskSources(workspaceId);
        if (active && version === request) setSnapshot({ workspaceId, sources: result.data, error: result.error });
      } catch { if (active && version === request) setSnapshot({ workspaceId, sources: [], error: 'Nachrichtenquellen konnten nicht geprüft werden.' }); }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [workspaceId, tasksVersion]);
  return snapshot?.workspaceId === workspaceId ? snapshot : { sources: [], error: null };
}
