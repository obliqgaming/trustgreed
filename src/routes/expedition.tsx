import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  LedgerCard,
  LedgerError,
  LedgerPage,
  SealButton,
  TextLink,
} from "@/components/ledger";

export const Route = createFileRoute("/expedition")({
  ssr: false,
  component: ExpeditionPage,
});

type Character = { id: string; name: string; level: number; guild_id: string | null };
type Expedition = { id: string; status: string; target_size: number; created_by_character_id: string };
type Participant = { character_id: string; character: { name: string; level: number } };

function ExpeditionPage() {
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [expedition, setExpedition] = useState<Expedition | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [targetSize, setTargetSize] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const loadCharacter = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate({ to: "/" }); return; }
    const { data: char } = await supabase
      .from("characters")
      .select("id, name, level, guild_id")
      .eq("profile_id", session.user.id)
      .eq("is_alive", true)
      .maybeSingle();
    if (!char?.guild_id) { navigate({ to: "/" }); return; }
    setCharacter(char);
    setReady(true);
  }, [navigate]);

  const loadExpedition = useCallback(async (guildId: string) => {
    // Cherche une expédition en salle d'attente pour cette guilde
    const { data } = await supabase
      .from("expeditions")
      .select("id, status, target_size, created_by_character_id")
      .eq("guild_id", guildId)
      .eq("status", "waiting")
      .maybeSingle();
    setExpedition(data ?? null);
    if (data) loadParticipants(data.id);
  }, []);

  const loadParticipants = async (expeditionId: string) => {
    const { data } = await supabase
      .from("expedition_participants")
      .select("character_id, character:characters(name, level)")
      .eq("expedition_id", expeditionId);
    setParticipants((data as any) ?? []);
  };

  useEffect(() => { void loadCharacter(); }, [loadCharacter]);

  useEffect(() => {
    if (!character?.guild_id) return;
    void loadExpedition(character.guild_id);

    // Realtime : mise à jour automatique quand quelqu'un s'inscrit
    const channel = supabase
      .channel("expedition_participants")
      .on("postgres_changes", { event: "*", schema: "public", table: "expedition_participants" }, () => {
        if (expedition?.id) loadParticipants(expedition.id);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [character, expedition?.id, loadExpedition]);

  async function createExpedition() {
    if (!character?.guild_id) return;
    setError(null); setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("create_expedition", {
      p_guild_id: character.guild_id,
      p_character_id: character.id,
      p_target_size: targetSize,
    });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    // S'inscrire automatiquement comme premier participant
    await supabase.from("expedition_participants").insert({ expedition_id: data.id, character_id: character.id });
    await loadExpedition(character.guild_id);
    setBusy(false);
  }

  async function joinExpedition() {
    if (!expedition || !character) return;
    setError(null); setBusy(true);
    const { error: insertError } = await supabase
      .from("expedition_participants")
      .insert({ expedition_id: expedition.id, character_id: character.id });
    if (insertError) setError(insertError.message);
    else await loadParticipants(expedition.id);
    setBusy(false);
  }

  async function startExpedition() {
    if (!expedition || !character) return;
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("start_expedition", {
      p_expedition_id: expedition.id,
      p_character_id: character.id,
    });
    if (rpcError) setError(rpcError.message);
    else navigate({ to: `/vote?expedition=${expedition.id}` });
    setBusy(false);
  }

  const isLeader = expedition?.created_by_character_id === character?.id;
  const isParticipant = participants.some((p) => p.character_id === character?.id);
  const canStart = isLeader && participants.length >= 3;

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Chargement…</p></LedgerPage>;

  return (
    <LedgerPage>
      {!expedition ? (
        <LedgerCard title="Nouvelle expédition" subtitle="Définis la taille du groupe cible.">
          <div className="mb-4">
            <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Taille cible du groupe</p>
            <div className="flex gap-2">
              {[3, 4, 5, 6, 8, 10].map((n) => (
                <button key={n} onClick={() => setTargetSize(n)}
                  className={`flex-1 py-2 text-sm font-mono border rounded-sm ${targetSize === n ? "border-primary text-primary" : "border-border/40 text-muted-foreground"}`}>
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Plus le groupe est grand, plus le butin potentiel est élevé.</p>
          </div>
          <LedgerError message={error} />
          <SealButton onClick={createExpedition} disabled={busy}>{busy ? "Création…" : "Ouvrir la salle d'attente"}</SealButton>
          <TextLink onClick={() => navigate({ to: "/" })}>Retour à la guilde</TextLink>
        </LedgerCard>
      ) : (
        <LedgerCard
          title="Salle d'attente"
          subtitle={`${participants.length} / ${expedition.target_size} participants · minimum 3 pour lancer`}
        >
          <ul className="space-y-1 mb-4">
            {participants.map((p) => (
              <li key={p.character_id} className={`flex justify-between px-3 py-2 text-sm border ${p.character_id === character?.id ? "border-primary/60 text-primary" : "border-border/30"}`}>
                <span>{(p.character as any)?.name ?? "—"}{p.character_id === character?.id ? " (toi)" : ""}</span>
                <span className="font-mono text-xs text-muted-foreground">niv. {(p.character as any)?.level}</span>
              </li>
            ))}
            {Array.from({ length: Math.max(0, expedition.target_size - participants.length) }).map((_, i) => (
              <li key={`empty-${i}`} className="flex px-3 py-2 text-sm border border-border/20 text-muted-foreground/40 italic">
                En attente…
              </li>
            ))}
          </ul>

          <LedgerError message={error} />

          {!isParticipant && (
            <SealButton onClick={joinExpedition} disabled={busy}>{busy ? "Inscription…" : "Rejoindre l'expédition"}</SealButton>
          )}

          {isLeader && (
            <button
              onClick={startExpedition}
              disabled={!canStart || busy}
              className="mt-3 w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-primary/60 text-primary hover:bg-primary/10"
            >
              {canStart ? "Lancer l'expédition" : `Attente de membres (${participants.length}/3 min.)`}
            </button>
          )}

          {!isLeader && isParticipant && (
            <p className="text-center text-xs text-muted-foreground mt-3">En attente du chef de groupe…</p>
          )}

          <TextLink onClick={() => navigate({ to: "/" })}>Retour à la guilde</TextLink>
        </LedgerCard>
      )}
    </LedgerPage>
  );
}
