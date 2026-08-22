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
  const [voteWindow, setVoteWindow] = useState(180);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const loadParticipants = useCallback(async (expeditionId: string) => {
    const { data } = await supabase
      .from("expedition_participants")
      .select("character_id, character:characters(name, level)")
      .eq("expedition_id", expeditionId);
    setParticipants((data as any) ?? []);
  }, []);

  const loadExpedition = useCallback(async (guildId: string) => {
    const { data } = await supabase
      .from("expeditions")
      .select("id, status, target_size, created_by_character_id")
      .eq("guild_id", guildId)
      .in("status", ["waiting", "active"])
      .maybeSingle();
    setExpedition(data ?? null);
    if (data?.id) await loadParticipants(data.id);
    return data;
  }, [loadParticipants]);

  useEffect(() => {
    let expChannel: ReturnType<typeof supabase.channel> | null = null;
    let partChannel: ReturnType<typeof supabase.channel> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    void (async () => {
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

      const exp = await loadExpedition(char.guild_id);
      setReady(true);

      if (exp?.status === "active") {
        navigate({ to: "/vote", search: { expedition: exp.id } });
        return;
      }

      if (!exp) return;

      // Poll de 8 secondes — fallback si Realtime manque un participant
      pollInterval = setInterval(async () => {
        const fresh = await loadExpedition(char.guild_id!);
        if (fresh?.status === "active") {
          navigate({ to: "/vote", search: { expedition: fresh.id } });
          if (pollInterval) clearInterval(pollInterval);
        }
      }, 8000);

      partChannel = supabase
        .channel(`ep_part_${exp.id}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "expedition_participants",
          filter: `expedition_id=eq.${exp.id}`,
        }, () => { void loadParticipants(exp.id); })
        .subscribe();

      expChannel = supabase
        .channel(`ep_status_${exp.id}`)
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "expeditions",
          filter: `id=eq.${exp.id}`,
        }, (payload) => {
          if ((payload.new as any)?.status === "active") {
            navigate({ to: "/vote", search: { expedition: exp.id } });
            if (pollInterval) clearInterval(pollInterval);
          }
        })
        .subscribe();
    })();

    return () => {
      if (partChannel) supabase.removeChannel(partChannel);
      if (expChannel) supabase.removeChannel(expChannel);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [navigate, loadExpedition, loadParticipants]);

  async function createExpedition() {
    if (!character?.guild_id) return;
    setError(null); setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("create_expedition", {
      p_guild_id: character.guild_id,
      p_character_id: character.id,
      p_target_size: targetSize,
    });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    const expId = (data as any).id;
    // Sauvegarder la durée choisie
    await supabase.from("expeditions").update({ vote_window_seconds: voteWindow }).eq("id", expId);
    await supabase.from("expedition_participants").insert({ expedition_id: expId, character_id: character.id });
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
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    // Le Realtime redirigera automatiquement tout le monde via le channel expédition
    // Le chef est redirigé ici directement
    navigate({ to: "/vote", search: { expedition: expedition.id } });
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
            <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Taille cible</p>
            <div className="flex gap-2 flex-wrap">
              {[3, 4, 5, 10, 20].map((n) => (
                <button key={n} onClick={() => setTargetSize(n)}
                  className={`px-4 py-2 text-sm font-mono border rounded-sm ${targetSize === n ? "border-primary text-primary" : "border-border/40 text-muted-foreground"}`}>
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Plus le groupe est grand, plus le butin potentiel est élevé.</p>
          </div>

          <div className="mb-4">
            <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Durée de vote par étape</p>
            <div className="flex gap-2 flex-wrap">
              {[
                { label: "3 min", value: 180 },
                { label: "1h", value: 3600 },
                { label: "6h", value: 21600 },
                { label: "24h", value: 86400 },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setVoteWindow(opt.value)}
                  className={`px-4 py-2 text-sm border rounded-sm ${voteWindow === opt.value ? "border-primary text-primary" : "border-border/40 text-muted-foreground"}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {voteWindow <= 180 ? "Mode session — tous connectés en même temps." : "Mode asynchrone — chacun vote dans son temps."}
            </p>
          </div>
          <LedgerError message={error} />
          <SealButton onClick={createExpedition} disabled={busy}>{busy ? "Création…" : "Ouvrir la salle d'attente"}</SealButton>
          <TextLink onClick={() => navigate({ to: "/" })}>Retour à la guilde</TextLink>
        </LedgerCard>
      ) : (
        <LedgerCard
          title="Salle d'attente"
          subtitle={`${participants.length} / ${expedition.target_size} · minimum 3 pour lancer`}
        >
          <ul className="space-y-1 mb-4">
            {participants.map((p) => (
              <li key={p.character_id} className={`flex justify-between px-3 py-2 text-sm border ${p.character_id === character?.id ? "border-primary/60 text-primary" : "border-border/30"}`}>
                <span>{(p.character as any)?.name ?? "—"}{p.character_id === character?.id ? " (toi)" : ""}</span>
                <span className="font-mono text-xs text-muted-foreground">niv. {(p.character as any)?.level}</span>
              </li>
            ))}
            {Array.from({ length: Math.max(0, expedition.target_size - participants.length) }).map((_, i) => (
              <li key={`empty-${i}`} className="px-3 py-2 text-sm border border-border/20 text-muted-foreground/40 italic">En attente…</li>
            ))}
          </ul>

          <LedgerError message={error} />

          {!isParticipant && (
            <SealButton onClick={joinExpedition} disabled={busy}>{busy ? "Inscription…" : "Rejoindre l'expédition"}</SealButton>
          )}
          {isLeader && (
            <button onClick={startExpedition} disabled={!canStart || busy}
              className="mt-3 w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-primary/60 text-primary hover:bg-primary/10">
              {canStart ? "Lancer l'expédition" : `En attente (${participants.length}/3 min.)`}
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
