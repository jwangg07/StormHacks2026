import { useEffect, useMemo, useState } from 'react';
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

export function InvitePanel() {
  const { connectionState, invite, error, createInvite, acceptInvite, declineInvite, clearError } =
    useMultiplayer();
  const [code, setCode] = useState('');
  const codeReady = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);
  const status = useMemo(() => {
    if (connectionState === 'CONNECTING') return 'Connecting to the gym…';
    if (connectionState === 'ERROR') return 'The sparring desk is offline.';
    if (connectionState === 'SEARCHING') return 'Looking for a random opponent…';
    return 'Private challenges expire after ten minutes.';
  }, [connectionState]);

  return (
    <section className="invite-panel" aria-labelledby="invite-title">
      <div className="invite-heading">
        <div>
          <span>SPARRING DESK</span>
          <h2 id="invite-title">Fight a friend</h2>
        </div>
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
    </section>
  );
}
