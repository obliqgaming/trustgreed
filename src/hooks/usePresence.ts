import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Seuil au-delà duquel un profil n'est plus considéré comme en ligne. */
export const ONLINE_THRESHOLD_MS = 60_000;

export function isOnline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

/**
 * Envoie un heartbeat régulier tant que l'utilisateur est connecté et que
 * l'onglet est actif, pour alimenter la présence en ligne (profiles.last_seen_at).
 */
export function usePresenceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const beat = () => {
      if (document.visibilityState === "visible") {
        supabase.rpc("heartbeat").then(({ error }) => {
          if (error) console.error("[heartbeat] échec :", error.message);
        });
      }
    };

    beat();
    const interval = setInterval(beat, 25_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [enabled]);
}
