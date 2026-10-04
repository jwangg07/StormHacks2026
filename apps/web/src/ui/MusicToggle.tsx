import { useEffect, useRef, useState } from 'react';

export function MusicToggle() {
  const audio = useRef<HTMLAudioElement>(null);
  const userInteracted = useRef(false);
  const cancelUnlock = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    let active = true;

    const play = async () => {
      try {
        await player.play();
        if (active) setPlaying(true);
        return true;
      } catch {
        return false;
      }
    };

    const clearUnlock = () => {
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      cancelUnlock.current = null;
    };
    const resume = () => {
      userInteracted.current = true;
      clearUnlock();
      void play();
    };

    void play().then((started) => {
      if (!started && active && !userInteracted.current) {
        document.addEventListener('pointerdown', resume, { once: true });
        document.addEventListener('keydown', resume, { once: true });
        cancelUnlock.current = clearUnlock;
      }
    });

    return () => {
      active = false;
      cancelUnlock.current?.();
      player.pause();
    };
  }, []);

  async function toggleMusic() {
    const player = audio.current;
    if (!player) return;
    userInteracted.current = true;
    cancelUnlock.current?.();

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
      <audio ref={audio} src="/main-menu.mp3" loop preload="auto" autoPlay />
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
