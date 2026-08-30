import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "tg-music-muted";
const TRACK_OPUS = "/trustandgreed.opus";
const TRACK_MP3 = "/trustandgreed.mp3";
const VOLUME = 0.35;

function pickTrackSrc(): string {
  const probe = document.createElement("audio");
  const supportsOpus = probe.canPlayType('audio/ogg; codecs="opus"') || probe.canPlayType("audio/opus");
  return supportsOpus ? TRACK_OPUS : TRACK_MP3;
}

function getStoredMuted(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  // Muet par défaut au tout premier chargement (politique autoplay des navigateurs
  // + on ne veut pas surprendre quelqu'un avec du son sans qu'il l'ait demandé).
  return stored === null ? true : stored === "true";
}

/**
 * Musique de fond persistante sur toute l'app : un seul <audio>, monté une fois
 * à la racine, ne redémarre pas au changement de page. Le bouton mute/unmute
 * est disponible partout et son état est mémorisé (localStorage).
 */
export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState<boolean>(getStoredMuted);

  useEffect(() => {
    const audio = new Audio(pickTrackSrc());
    audio.loop = true;
    audio.volume = VOLUME;
    audio.muted = muted;
    audioRef.current = audio;

    // Si la source choisie échoue au chargement (ex: mauvaise détection de support),
    // on retente une fois avec l'autre format avant d'abandonner silencieusement.
    let fallenBack = false;
    const onError = () => {
      if (fallenBack) return;
      fallenBack = true;
      audio.src = audio.src.endsWith(".opus") ? TRACK_MP3 : TRACK_OPUS;
      void audio.play().catch(() => {});
    };
    audio.addEventListener("error", onError);

    void audio.play().catch(() => {
      // Bloqué par la politique autoplay tant qu'il n'y a pas eu d'interaction :
      // on retente au premier clic/touch n'importe où sur la page.
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
    window.localStorage.setItem(STORAGE_KEY, String(muted));
  }, [muted]);

  return (
    <button
      onClick={() => setMuted((m) => !m)}
      aria-label={muted ? "Activer la musique" : "Couper la musique"}
      title={muted ? "Activer la musique" : "Couper la musique"}
      className="fixed bottom-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/90 text-muted-foreground backdrop-blur-sm hover:text-primary hover:border-primary/40 transition-colors"
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
  );
}
