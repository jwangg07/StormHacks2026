import { useEffect, useMemo, useRef, useState } from 'react';
import { useMultiplayer, type ActiveInvite } from '../net/MultiplayerProvider';

const ERROR_MESSAGES: Record<string, string> = {
  INVITE_NOT_FOUND: 'No open challenge uses that code. Check all six characters.',
  INVITE_EXPIRED: 'That challenge has expired. Ask for a fresh code.',
  INVITE_ALREADY_USED: 'Someone already claimed that challenge.',
  INVITE_SELF_ACCEPT: 'Share your code with another fighter instead.',
  ALREADY_IN_MATCH: 'One of you is already assigned to a fight.',
  CREATOR_DISCONNECTED: 'The host left the gym. Ask them to create another code.',
  RATE_LIMITED: 'Too many attempts. Take a breath and try again shortly.',
};

function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function InviteTicket({
  invite,
  declineInvite,
}: {
  invite: ActiveInvite;
  declineInvite: () => void;
}) {
  const [remaining, setRemaining] = useState(10 * 60 * 1_000);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(
      () => setRemaining(Math.max(0, invite.expiresAt - Date.now())),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [invite.expiresAt]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(invite.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="invite-ticket">
      <button type="button" className="invite-code" onClick={() => void copyCode()}>
        {invite.code}
        <small>{copied ? 'COPIED' : 'COPY'}</small>
      </button>
      <div className="invite-ticket-meta">
        <span>Closes in {formatRemaining(remaining)}</span>
        <button type="button" onClick={declineInvite}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FriendFight({ onBack }: { onBack: () => void }) {
  const { connectionState, invite, error, createInvite, acceptInvite, declineInvite, clearError } =
    useMultiplayer();
  const [code, setCode] = useState('');
  const codeReady = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);
  const status = useMemo(() => {
    if (connectionState === 'CONNECTING') return 'Connecting to the gym…';
    if (connectionState === 'ERROR') return 'The sparring desk is offline.';
    return 'Private challenges expire after ten minutes.';
  }, [connectionState]);

  return (
    <>
      <div className="session-bar">
        <button className="session-back" type="button" onClick={onBack}>
          ← Pick another session
        </button>
        <span className="invite-status-light" data-online={connectionState !== 'ERROR'}>
          {connectionState === 'CONNECTING' ? 'LINKING' : 'ONLINE'}
        </span>
      </div>

      <div className="invite-actions">
        <div className="invite-column">
          <span className="invite-label">Open challenge</span>
          {invite ? (
            <InviteTicket key={invite.inviteId} invite={invite} declineInvite={declineInvite} />
          ) : (
            <button
              className="invite-primary"
              type="button"
              onClick={createInvite}
              disabled={connectionState === 'CONNECTING' || connectionState === 'ERROR'}
            >
              Create a code
            </button>
          )}
        </div>

        <form
          className="invite-column"
          onSubmit={(event) => {
            event.preventDefault();
            if (codeReady) acceptInvite(code);
          }}
        >
          <label className="invite-label" htmlFor="invite-code-input">
            Join a partner
          </label>
          <input
            id="invite-code-input"
            value={code}
            onChange={(event) => {
              clearError();
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '')
                  .slice(0, 6),
              );
            }}
            placeholder="ABC234"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            maxLength={6}
            aria-describedby="invite-help"
          />
          <button
            className="invite-secondary"
            type="submit"
            disabled={!codeReady || connectionState === 'CONNECTING'}
          >
            Enter their ring
          </button>
        </form>
      </div>

      <p id="invite-help" className="invite-help" role={error ? 'alert' : 'status'}>
        {error ? (ERROR_MESSAGES[error.code] ?? error.message) : status}
      </p>
    </>
  );
}

type Session = 'choose' | 'friend';

/**
 * Opens once the lobby camera reaches the ring: the player picks solo bag work, or a private
 * fight against a friend through a shared invite code.
 */
export function SparringRoomDialog({
  onClose,
  onSolo,
}: {
  onClose: () => void;
  onSolo: () => void;
}) {
  const { invite } = useMultiplayer();
  // An open challenge means the player already chose a friend fight; reopen on its ticket.
  const [session, setSession] = useState<Session>(invite ? 'friend' : 'choose');
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  // Park focus on the close button, as the fighter card does, so neither session looks
  // preselected. Re-run per step: switching steps unmounts the button that was just pressed.
  useEffect(() => {
    closeButton.current?.focus();
  }, [session]);

  return (
    <div className="card-backdrop" onClick={onClose}>
      <section
        className="corner-board sparring-board"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sparring-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="board-heading">
          <span>SPARRING ROOM</span>
          <button ref={closeButton} className="board-close" type="button" onClick={onClose}>
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close sparring room</span>
          </button>
        </div>
        {session === 'choose' ? (
          <>
            <h1 id="sparring-title">Pick a session</h1>
            <p className="board-subtitle">WHO ARE YOU BOXING TODAY?</p>
            <div className="session-options">
              <button className="session-option" type="button" onClick={onSolo}>
                <strong>Spar solo</strong>
                <span>Work the bag through rolling 60-second rounds. No opponent.</span>
              </button>
              <button className="session-option" type="button" onClick={() => setSession('friend')}>
                <strong>Fight a friend</strong>
                <span>Share a six-character code, or enter the one they sent you.</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 id="sparring-title">Fight a friend</h1>
            <FriendFight onBack={() => setSession('choose')} />
          </>
        )}
      </section>
    </div>
  );
}
