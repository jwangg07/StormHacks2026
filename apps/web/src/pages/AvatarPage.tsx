import { Link } from 'react-router';
import { RobotAvatar } from '../ui/RobotAvatar';

export function AvatarPage() {
  return (
    <main className="subpage">
      <header className="topbar">
        <Link className="wordmark" to="/" aria-label="Return to lobby">
          <span className="wordmark-mark" aria-hidden="true" />
          WebcamBoxer
        </Link>
        <Link className="back-link" to="/">
          ← Back to lobby
        </Link>
      </header>
      <section className="placeholder-page avatar-page">
        <div className="placeholder-copy">
          <span className="section-kicker">AVATAR STUDIO · PREVIEW</span>
          <h1>Your fighter starts here.</h1>
          <p>
            The avatar creator is a placeholder for now. Customize a fighter here once the ring is
            ready.
          </p>
          <Link className="primary-link" to="/">
            Return to lobby
          </Link>
        </div>
        <div className="avatar-display">
          <RobotAvatar />
        </div>
        <div className="coming-soon">
          CUSTOMIZATION
          <br />
          COMING SOON
        </div>
      </section>
    </main>
  );
}
