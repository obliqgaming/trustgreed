import { useEffect, useRef, useState } from "react";

const MUTED_KEY = "tg-music-muted";
const VOLUME_KEY = "tg-music-volume";
const TRACK_OPUS = "/trustandgreed.opus";
const TRACK_MP3 = "/trustandgreed.mp3";
const DEFAULT_VOLUME = 0.35;

function pickTrackSrc(): string {
  const probe = document.createElement("audio");
  const supportsOpus = probe.canPlayType('audio/ogg; codecs="opus"') || probe.canPlayType("audio/opus");
  return supportsOpus ? TRACK_OPUS : TRACK_MP3;
}

function getStoredMuted(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(MUTED_KEY);
  // Activée par défaut. Les navigateurs bloqueront quand même la lecture tant
  // qu'il n'y a pas eu d'interaction — on retente automatiquement au premier clic.
  return stored === "true";
}

function getStoredVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  const stored = window.localStorage.getItem(VOLUME_KEY);
  const parsed = stored !== null ? parseFloat(stored) : NaN;
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DEFAULT_VOLUME;
}

/**
 * Musique de fond persistante sur toute l'app : un seul <audio>, monté une fois
 * à la racine, ne redémarre pas au changement de page. Le contrôle (mute +
 * volume) est disponible partout, en haut à droite, et son état est mémorisé.
 */
export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState<boolean>(getStoredMuted);
  const [volume, setVolume] = useState<number>(getStoredVolume);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const audio = new Audio(pickTrackSrc());
    audio.loop = true;
    audio.volume = volume;
    audio.muted = muted;
    audioRef.current = audio;

    let fallenBack = false;
    const onError = () => {
      if (fallenBack) return;
      fallenBack = true;
      audio.src = audio.src.endsWith(".opus") ? TRACK_MP3 : TRACK_OPUS;
      void audio.play().catch(() => {});
    };
    audio.addEventListener("error", onError);

    void audio.play().catch(() => {
      const resume = () => {
        void audio.play().catch(() => {});
        window.removeEventListener("pointerdown", resume);
      };
      window.addEventListener("pointerdown", resume, { once: true });
    });

    return () => {
      audio.removeEventListener("error", onError);
      audio.pause();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
    window.localStorage.setItem(MUTED_KEY, String(muted));
  }, [muted]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    window.localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume]);

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
      {expanded && (
        <div className="flex items-center gap-2 bg-card/90 border border-border/60 backdrop-blur-sm rounded-full px-3 py-1.5">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              if (muted && v > 0) setMuted(false);
            }}
            className="w-24 accent-primary"
            aria-label="Volume de la musique"
          />
        </div>
      )}
      <button
        onClick={() => {
          if (expanded) setMuted((m) => !m);
          else setExpanded(true);
        }}
        onDoubleClick={() => setExpanded((e) => !e)}
        aria-label={muted ? "Activer la musique" : "Couper la musique"}
        title={muted ? "Activer la musique" : "Régler / couper la musique"}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/90 text-muted-foreground backdrop-blur-sm hover:text-primary hover:border-primary/40 transition-colors"
      >
        {muted ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        )}
      </button>
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          aria-label="Fermer le réglage"
          className="text-xs text-muted-foreground hover:text-primary"
        >
          ✕
        </button>
      )}
    </div>
  );
}
