import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerError } from "@/components/ledger";
import { isOnline, usePresenceHeartbeat, ONLINE_THRESHOLD_MS } from "@/hooks/usePresence";

type PlayerRow = { id: string; username: string; last_seen_at: string | null };

/** Liste des joueurs en ligne, affichée directement (pas de clic requis), avec envoi de code d'invitation. */
export function OnlinePlayersPanel({ guildName }: { guildName?: string | null }) {
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePresenceHeartbeat(!!myProfileId);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setMyProfileId(session.user.id);

    const since = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();
    const { data } = await supabase
      .from("profiles")
      .select("id, username, last_seen_at")
      .gte("last_seen_at", since)
      .neq("id", session.user.id)
      .order("username", { ascending: true });
    setPlayers(data ?? []);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function sendInvite(recipientProfileId: string) {
    if (!myProfileId) return;
    setError(null); setSendingTo(recipientProfileId); setSentTo(null);
    const { data: invite, error: inviteError } = await supabase.rpc("create_invitation");
    if (inviteError) { setError(inviteError.message); setSendingTo(null); return; }
    const code = (invite as { code: string } | null)?.code;
    if (!code) { setError("Impossible de générer un code."); setSendingTo(null); return; }

    const body = guildName
      ? `Tu es invité à rejoindre la guilde "${guildName}".`
      : `Tu as reçu un code d'invitation.`;

    const { error: msgError } = await supabase.from("direct_messages").insert({
      sender_profile_id: myProfileId,
      recipient_profile_id: recipientProfileId,
      body,
      invitation_code: code,
    });
    if (msgError) setError(msgError.message); else setSentTo(recipientProfileId);
    setSendingTo(null);
  }

  return (
    <div className="mb-6">
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">
        Joueurs en ligne {players.length > 0 ? `(${players.length})` : ""}
      </p>
      <LedgerError message={error} />
      {players.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic">Personne d'autre en ligne pour l'instant.</p>
      ) : (
        <ul className="space-y-1.5">
          {players.map((p) => (
            <li key={p.id} className="flex items-center justify-between border border-border/40 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${isOnline(p.last_seen_at) ? "bg-green-500" : "bg-muted-foreground/30"}`} aria-hidden />
                {p.username}
              </span>
              <button
                onClick={() => sendInvite(p.id)}
                disabled={sendingTo === p.id}
                className="text-xs tracking-[0.1em] uppercase border border-primary/40 text-primary px-2.5 py-1 hover:bg-primary/10 disabled:opacity-30"
              >
                {sentTo === p.id ? "Envoyé ✓" : sendingTo === p.id ? "…" : "Envoyer un code"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
