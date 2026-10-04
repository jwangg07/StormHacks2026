import { useRef, useState } from 'react';

export function MusicToggle() {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  async function toggleMusic() {
    const player = audio.current;
    if (!player) return;

    if (playing) {
      player.pause();
      setPlaying(false);
      return;
    }

    try {
      await player.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  return (
    <>
      <audio ref={audio} src="/main-menu.mp3" loop preload="none" />
      <button
        className="music-toggle"
        type="button"
        onClick={toggleMusic}
        aria-pressed={playing}
        aria-label={playing ? 'Turn music off' : 'Turn music on'}
        title={playing ? 'Turn music off' : 'Turn music on'}
      >
        <span aria-hidden="true">&#9834;</span>
      </button>
    </>
  );
}
