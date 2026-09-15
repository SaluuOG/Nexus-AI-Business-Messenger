import {
  ArrowRightLeft,
  LogOut,
  PencilLine,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  NexusWorkspace,
  NexusWorkspaceMember,
  WorkspaceRole,
} from '../features/data/nexusData';
import './WorkspaceLifecyclePanel.css';

type ActionResult = Promise<{ error: string | null }>;

export type WorkspaceLifecyclePanelProps = {
  selectedWorkspace: NexusWorkspace | null;
  currentUserId?: string;
  currentRole?: WorkspaceRole;
  members: NexusWorkspaceMember[];
  busy?: boolean;
  feedback?: { workspaceId: string; message: string; error: boolean } | null;
  onRename: (name: string) => ActionResult;
  onLeave: () => ActionResult;
  onTransfer: (newOwnerId: string) => ActionResult;
  onDelete: (confirmation: string) => ActionResult;
};

type PendingAction = 'leave' | 'transfer' | 'delete';
type LocalFeedback = { message: string; error: boolean } | null;

type ConfirmationDialogProps = {
  action: PendingAction;
  busy: boolean;
  error?: string | null;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
};

const dialogCopy: Record<PendingAction, { eyebrow: string; title: string; confirm: string }> = {
  leave: {
    eyebrow: 'WORKSPACE VERLASSEN',
    title: 'Workspace wirklich verlassen?',
    confirm: 'Workspace verlassen',
  },
  transfer: {
    eyebrow: 'OWNERSHIP ÜBERTRAGEN',
    title: 'Neue Owner-Person festlegen?',
    confirm: 'Ownership übertragen',
  },
  delete: {
    eyebrow: 'WORKSPACE LÖSCHEN',
    title: 'Workspace endgültig löschen?',
    confirm: 'Endgültig löschen',
  },
};

function ConfirmationDialog({
  action,
  busy,
  error,
  children,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const copy = dialogCopy[action];

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => {
      if (node?.open) node.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="workspace-lifecycle-dialog"
      aria-labelledby="workspace-lifecycle-dialog-title"
      aria-describedby="workspace-lifecycle-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="workspace-lifecycle-dialog-head">
        <div>
          <small>{copy.eyebrow}</small>
          <h2 id="workspace-lifecycle-dialog-title">{copy.title}</h2>
        </div>
        <button
          type="button"
          aria-label="Bestätigungsdialog schließen"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="workspace-lifecycle-dialog-body">
        <div id="workspace-lifecycle-dialog-description">{children}</div>
        {error && <p className="form-feedback error" role="alert">{error}</p>}
        <div className="workspace-lifecycle-dialog-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel} autoFocus>
            Abbrechen
          </button>
          <button
            type="button"
            className="workspace-danger-button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Wird ausgeführt…' : copy.confirm}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

function memberLabel(member: NexusWorkspaceMember) {
  if (member.full_name) return member.full_name;
  if (member.username) return `@${member.username}`;
  return `Nexus Nutzer ${member.user_id.slice(0, 8)}`;
}

export function WorkspaceLifecyclePanel({
  selectedWorkspace,
  currentUserId,
  currentRole,
  members,
  busy = false,
  feedback,
  onRename,
  onLeave,
  onTransfer,
  onDelete,
}: WorkspaceLifecyclePanelProps) {
  const [name, setName] = useState(selectedWorkspace?.name ?? '');
  const [successorId, setSuccessorId] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<LocalFeedback>(null);
  const actionLock = useRef(false);

  const successorCandidates = useMemo(
    () => members.filter((member) => (
      member.user_id !== currentUserId && (member.role === 'admin' || member.role === 'member')
    )),
    [currentUserId, members],
  );

  useEffect(() => {
    setName(selectedWorkspace?.name ?? '');
    setDeleteConfirmation('');
    setPendingAction(null);
    setLocalFeedback(null);
  }, [selectedWorkspace?.id, selectedWorkspace?.name]);

  useEffect(() => {
    if (!successorCandidates.some((member) => member.user_id === successorId)) {
      setSuccessorId(successorCandidates[0]?.user_id ?? '');
    }
  }, [successorCandidates, successorId]);

  const isBusy = busy || localBusy;
  const scopedFeedback = feedback?.workspaceId === selectedWorkspace?.id ? feedback : null;
  const visibleFeedback = localFeedback?.error
    ? localFeedback
    : scopedFeedback
      ? { message: scopedFeedback.message, error: scopedFeedback.error }
      : localFeedback;

  const runAction = async (
    action: () => ActionResult,
    successMessage: string,
  ) => {
    if (actionLock.current || busy) return false;

    actionLock.current = true;
    setLocalBusy(true);
    setLocalFeedback(null);
    try {
      const result = await action();
      if (result.error) {
        setLocalFeedback({ message: result.error, error: true });
        return false;
      }

      setLocalFeedback({ message: successMessage, error: false });
      return true;
    } catch {
      setLocalFeedback({
        message: 'Die Änderung konnte gerade nicht gespeichert werden. Bitte versuche es erneut.',
        error: true,
      });
      return false;
    } finally {
      actionLock.current = false;
      setLocalBusy(false);
    }
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!selectedWorkspace || nextName.length < 2 || nextName === selectedWorkspace.name) return;

    await runAction(
      () => onRename(nextName),
      `Workspace wurde in „${nextName}“ umbenannt.`,
    );
  };

  const confirmAction = async () => {
    if (!selectedWorkspace || !pendingAction) return;

    if (pendingAction === 'leave') {
      if (await runAction(onLeave, `Du hast „${selectedWorkspace.name}“ verlassen.`)) {
        setPendingAction(null);
      }
      return;
    }

    if (pendingAction === 'transfer') {
      const successor = successorCandidates.find((member) => member.user_id === successorId);
      if (!successor) return;
      if (await runAction(
        () => onTransfer(successor.user_id),
        `Ownership wurde an ${memberLabel(successor)} übertragen.`,
      )) {
        setPendingAction(null);
      }
      return;
    }

    if (deleteConfirmation !== selectedWorkspace.name) return;
    if (await runAction(
      () => onDelete(deleteConfirmation),
      `Workspace „${selectedWorkspace.name}“ wurde gelöscht.`,
    )) {
      setPendingAction(null);
    }
  };

  if (!selectedWorkspace) {
    return (
      <div className="panel workspace-lifecycle-panel">
        <ShieldAlert aria-hidden="true" />
        <h3>Workspace verwalten</h3>
        <p>Erstelle oder wähle zuerst einen Workspace.</p>
      </div>
    );
  }

  const canRename = currentRole === 'owner' || currentRole === 'admin';
  const isOwner = currentRole === 'owner';
  const canLeave = Boolean(currentRole && currentRole !== 'owner');
  const renameUnchanged = name.trim() === selectedWorkspace.name;
  const renameInvalid = name.trim().length < 2;
  const dialogError = localFeedback?.error ? localFeedback.message : null;
  const selectedSuccessor = successorCandidates.find((member) => member.user_id === successorId);

  return (
    <div className="panel workspace-lifecycle-panel">
      <div className="workspace-lifecycle-head">
        <div>
          <ShieldAlert aria-hidden="true" />
          <h3>Workspace verwalten</h3>
          <p>Name, Ownership und Mitgliedschaft sicher verwalten.</p>
        </div>
        <span className={`role-pill role-${currentRole ?? 'guest'}`}>
          {currentRole === 'owner' ? 'Owner' : currentRole === 'admin' ? 'Admin' : currentRole === 'member' ? 'Member' : 'Guest'}
        </span>
      </div>

      <div className="workspace-lifecycle-grid">
        <section className="workspace-lifecycle-section" aria-labelledby="workspace-rename-title">
          <div className="workspace-lifecycle-section-title">
            <PencilLine size={16} aria-hidden="true" />
            <div>
              <h4 id="workspace-rename-title">Workspace-Name</h4>
              <p>Der neue Name ist anschließend für das gesamte Team sichtbar.</p>
            </div>
          </div>
          {canRename ? (
            <form className="settings-form workspace-rename-form" onSubmit={(event) => void submitRename(event)}>
              <label htmlFor="workspace-lifecycle-name">
                Name
                <input
                  id="workspace-lifecycle-name"
                  value={name}
                  minLength={2}
                  maxLength={80}
                  required
                  disabled={isBusy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="secondary"
                disabled={isBusy || renameInvalid || renameUnchanged}
              >
                {isBusy ? 'Speichert…' : 'Namen speichern'}
              </button>
            </form>
          ) : (
            <p>Nur Owner und Admins können den Workspace umbenennen.</p>
          )}
        </section>

        <section className="workspace-lifecycle-section" aria-labelledby="workspace-membership-title">
          <div className="workspace-lifecycle-section-title">
            {isOwner ? <ArrowRightLeft size={16} aria-hidden="true" /> : <LogOut size={16} aria-hidden="true" />}
            <div>
              <h4 id="workspace-membership-title">{isOwner ? 'Ownership übertragen' : 'Mitgliedschaft'}</h4>
              <p>{isOwner
                ? 'Lege eine neue Owner-Person fest. Du bleibst anschließend als Admin im Team.'
                : 'Du kannst diesen Workspace und alle darin geteilten Bereiche verlassen.'}</p>
            </div>
          </div>

          {isOwner ? (
            successorCandidates.length ? (
              <div className="settings-form workspace-transfer-form">
                <label htmlFor="workspace-lifecycle-successor">
                  Neue Owner-Person
                  <select
                    id="workspace-lifecycle-successor"
                    value={successorId}
                    disabled={isBusy}
                    onChange={(event) => setSuccessorId(event.target.value)}
                  >
                    {successorCandidates.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {memberLabel(member)} · {member.role === 'admin' ? 'Admin' : 'Member'}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={isBusy || !successorId}
                  onClick={() => {
                    setLocalFeedback(null);
                    setPendingAction('transfer');
                  }}
                >
                  Ownership übertragen
                </button>
                <small className="workspace-owner-note">Owner können einen Workspace erst verlassen, nachdem sie die Ownership übertragen haben.</small>
              </div>
            ) : (
              <p>Für die Übergabe brauchst du mindestens ein weiteres Mitglied mit der Rolle Admin oder Member.</p>
            )
          ) : canLeave ? (
            <button
              type="button"
              className="secondary workspace-leave-button"
              disabled={isBusy}
              onClick={() => {
                setLocalFeedback(null);
                setPendingAction('leave');
              }}
            >
              <LogOut size={15} aria-hidden="true" />
              Workspace verlassen
            </button>
          ) : (
            <p>Deine Workspace-Rolle konnte nicht geladen werden.</p>
          )}
        </section>
      </div>

      {isOwner && (
        <section className="workspace-danger-zone" aria-labelledby="workspace-delete-title">
          <div className="workspace-lifecycle-section-title">
            <Trash2 size={16} aria-hidden="true" />
            <div>
              <h4 id="workspace-delete-title">Gefahrenbereich</h4>
              <p>Das Löschen entfernt den Workspace und seine Inhalte endgültig.</p>
            </div>
          </div>
          <div className="workspace-delete-confirmation">
            <label htmlFor="workspace-delete-confirmation">
              Gib zur Bestätigung <strong>{selectedWorkspace.name}</strong> ein.
              <input
                id="workspace-delete-confirmation"
                value={deleteConfirmation}
                autoComplete="off"
                disabled={isBusy}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="workspace-danger-button"
              disabled={isBusy || deleteConfirmation !== selectedWorkspace.name}
              onClick={() => {
                setLocalFeedback(null);
                setPendingAction('delete');
              }}
            >
              Workspace löschen
            </button>
          </div>
        </section>
      )}

      {isBusy && <p className="workspace-lifecycle-feedback" role="status">Änderung wird gespeichert…</p>}
      {!isBusy && visibleFeedback && (
        <p
          className={`workspace-lifecycle-feedback${visibleFeedback.error === true ? ' error' : visibleFeedback.error === false ? ' success' : ''}`}
          role={visibleFeedback.error ? 'alert' : 'status'}
        >
          {visibleFeedback.message}
        </p>
      )}

      {pendingAction && (
        <ConfirmationDialog
          action={pendingAction}
          busy={isBusy}
          error={dialogError}
          onCancel={() => {
            if (!isBusy) {
              setPendingAction(null);
              setLocalFeedback(null);
            }
          }}
          onConfirm={() => void confirmAction()}
        >
          {pendingAction === 'leave' && (
            <p>Du verlässt <strong>{selectedWorkspace.name}</strong>. Deine bisherige Mitgliedschaft und dein Zugriff werden entfernt.</p>
          )}
          {pendingAction === 'transfer' && (
            <p>
              <strong>{selectedSuccessor ? memberLabel(selectedSuccessor) : 'Das ausgewählte Mitglied'}</strong> wird Owner von <strong>{selectedWorkspace.name}</strong>. Du erhältst danach die Rolle Admin.
            </p>
          )}
          {pendingAction === 'delete' && (
            <p>Alle Daten von <strong>{selectedWorkspace.name}</strong> werden dauerhaft gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.</p>
          )}
        </ConfirmationDialog>
      )}
    </div>
  );
}
