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
type Expedition = { id: string; status: string; target_size: number; created_by_character_id: string; vote_window_seconds: number };

const VOTE_WINDOW_LABEL: Record<number, string> = { 180: "3 min", 3600: "1h", 21600: "6h", 86400: "24h" };
type Participant = { character_id: string; character: { name: string; level: number } };

const STAKES: { id: "forge" | "infirmerie" | "eclaireurs"; label: string; cost: number; description: string }[] = [
  { id: "forge", label: "Forge", cost: 4000, description: "+25% de butin sur toute l'expédition." },
  { id: "infirmerie", label: "Infirmerie", cost: 6000, description: "-25% de risque de mort sur toute l'expédition (jamais à zéro)." },
  { id: "eclaireurs", label: "Éclaireurs engagés", cost: 1500, description: "Le risque exact de chaque étape est révélé automatiquement à tout le groupe." },
];

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
  const [guildGold, setGuildGold] = useState<number | null>(null);
  const [stakes, setStakes] = useState<{ stake_type: string; cost: number }[]>([]);
  const [stakeBusy, setStakeBusy] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [availableBots, setAvailableBots] = useState<{ id: string; name: string }[]>([]);
  const [botAddBusy, setBotAddBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);

  const loadParticipants = useCallback(async (expeditionId: string) => {
    const { data } = await supabase
      .from("expedition_participants")
      .select("character_id, character:characters(name, level)")
      .eq("expedition_id", expeditionId);
    setParticipants((data as any) ?? []);
  }, []);

  const loadAvailableBots = useCallback(async (guildId: string, expeditionId: string | null) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data: bots } = await supabase
      .from("characters")
      .select("id, name")
      .eq("profile_id", session.user.id)
      .eq("guild_id", guildId)
      .eq("is_bot", true)
      .eq("is_alive", true);
    if (!bots) { setAvailableBots([]); return; }
    if (!expeditionId) { setAvailableBots(bots); return; }
    const { data: parts } = await supabase.from("expedition_participants").select("character_id").eq("expedition_id", expeditionId);
    const inExp = new Set((parts ?? []).map((p: any) => p.character_id));
    setAvailableBots(bots.filter((b) => !inExp.has(b.id)));
  }, []);

  const loadExpedition = useCallback(async (guildId: string) => {
    const { data } = await supabase
      .from("expeditions")
      .select("id, status, target_size, created_by_character_id, vote_window_seconds")
      .eq("guild_id", guildId)
      .in("status", ["waiting", "active"])
      .maybeSingle();
    setExpedition(data ?? null);
    if (data?.id) {
      await loadParticipants(data.id);
      const { data: stakeData } = await supabase
        .from("expedition_stakes").select("stake_type, cost").eq("expedition_id", data.id);
      setStakes(stakeData ?? []);
    }
    const { data: guild } = await supabase.from("guilds").select("gold").eq("id", guildId).maybeSingle();
    setGuildGold(guild?.gold ?? null);
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
        .eq("is_bot", false)
        .maybeSingle();
      if (!char?.guild_id) { navigate({ to: "/" }); return; }
      setCharacter(char);

      const { data: profileRow } = await supabase.from("profiles").select("is_admin").eq("id", session.user.id).maybeSingle();
      setIsAdmin(!!profileRow?.is_admin);

      const exp = await loadExpedition(char.guild_id);
      setReady(true);
      if (profileRow?.is_admin) void loadAvailableBots(char.guild_id, exp?.id ?? null);

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

  async function addBotToExpedition(botId: string) {
    if (!expedition) return;
    setBotAddBusy(botId); setError(null);
    const { error: insertError } = await supabase
      .from("expedition_participants")
      .insert({ expedition_id: expedition.id, character_id: botId });
    if (insertError) setError(insertError.message);
    else {
      await loadParticipants(expedition.id);
      if (character?.guild_id) await loadAvailableBots(character.guild_id, expedition.id);
    }
    setBotAddBusy(null);
  }

  async function copyDebugReport() {
    if (!expedition) return;
    const { data, error: rpcError } = await supabase.rpc("admin_debug_expedition", { p_expedition_id: expedition.id });
    if (rpcError) { setError(rpcError.message); return; }
    void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setDebugCopied(true);
    setTimeout(() => setDebugCopied(false), 2000);
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

  async function chooseStake(stakeType: "forge" | "infirmerie" | "eclaireurs") {
    if (!expedition || !character) return;
    setError(null); setStakeBusy(stakeType);
    const { error: rpcError } = await supabase.rpc("choose_expedition_stake", {
      p_expedition_id: expedition.id, p_character_id: character.id, p_stake_type: stakeType,
    });
    if (rpcError) setError(rpcError.message);
    else if (character.guild_id) await loadExpedition(character.guild_id);
    setStakeBusy(null);
  }

  async function cancelExpedition() {
    if (!expedition || !character) return;
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("cancel_expedition", {
      p_expedition_id: expedition.id,
      p_character_id: character.id,
    });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    setExpedition(null); setParticipants([]); setStakes([]);
    if (character.guild_id) await loadExpedition(character.guild_id);
    setBusy(false);
  }

  const isLeader = expedition?.created_by_character_id === character?.id;
  const isParticipant = participants.some((p) => p.character_id === character?.id);
  const canStart = isLeader && participants.length >= 3;

  if (!ready) return <LedgerPage bg="/guild_hall_bg.webp"><p className="text-center text-sm text-muted-foreground">Chargement…</p></LedgerPage>;

  return (
    <LedgerPage>
      {!expedition ? (
        <>
          <div style={{position:"fixed",inset:0,backgroundImage:"url(/expedition_staging.webp)",backgroundSize:"cover",backgroundPosition:"center",zIndex:-1,opacity:0.6}} />
          <LedgerCard title="Nouvelle expédition" subtitle="Choisis combien de membres peuvent rejoindre. Plus le groupe est grand, plus le butin est élevé — et plus la trahison est possible.">
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
              <div className="flex gap-2 flex-wrap items-stretch">
                <button onClick={() => setVoteWindow(180)}
                  className={`px-4 py-2 text-sm border rounded-sm ${voteWindow === 180 ? "border-amber-400 text-amber-300" : "border-amber-500/30 text-amber-400/60"}`}>
                  3 min ⚡
                </button>
                <div className="w-px bg-border/30 my-1" />
                {[
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
              <p className="mt-1.5 text-xs text-muted-foreground">
                {voteWindow <= 180
                  ? "⚡ Mode session : soyez tous en ligne au même moment, sans quoi l'étape restera bloquée en attente de vote."
                  : "Mode asynchrone : chacun vote quand il peut, pas besoin d'être connectés ensemble."}
              </p>
            </div>
            <LedgerError message={error} />
            <SealButton onClick={createExpedition} disabled={busy}>{busy ? "Création…" : "Ouvrir la salle d'attente"}</SealButton>
            <TextLink onClick={() => navigate({ to: "/" })}>Retour à la guilde</TextLink>
          </LedgerCard>
        </>
      ) : (
        <>
          <div style={{position:"fixed",inset:0,backgroundImage:"url(/expedition_staging.webp)",backgroundSize:"cover",backgroundPosition:"center",zIndex:-1,opacity:0.6}} />
          <LedgerCard
            title="Salle d'attente"
            subtitle={`${participants.length} / ${expedition.target_size} inscrits · en attente que chacun rejoigne depuis la page guilde`}
          >
          <div className="mb-4 border border-border/30 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              Durée de vote par étape : <span className="text-primary font-mono">{VOTE_WINDOW_LABEL[expedition.vote_window_seconds] ?? `${expedition.vote_window_seconds}s`}</span>
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {expedition.vote_window_seconds <= 180
                ? "Mode session — mieux vaut être tous en ligne en même temps pour voter."
                : "Mode asynchrone — chacun peut voter à son rythme, pas besoin d'être connectés ensemble."}
            </p>
          </div>
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

          {isParticipant && (
            <div className="mb-4 border border-border/30 px-3 py-3">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-1">Mises de guilde (cumulables, chacune définitive)</p>
              <p className="text-xs text-muted-foreground/70 mb-3">Trésor disponible : {guildGold !== null ? Math.round(guildGold) : "…"} or · payable par n'importe quel membre inscrit</p>
              <div className="space-y-2">
                {STAKES.map((s) => {
                  const taken = stakes.some(x => x.stake_type === s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => !taken && chooseStake(s.id)}
                      disabled={taken || stakeBusy === s.id || (guildGold ?? 0) < s.cost}
                      className={`w-full text-left border px-3 py-2 disabled:cursor-not-allowed ${taken ? "border-primary/50 bg-primary/5" : "border-border/30 hover:border-primary/40 disabled:opacity-30"}`}
                    >
                      <div className="flex justify-between">
                        <span className={`text-sm font-serif ${taken ? "text-primary" : "text-foreground"}`}>{taken ? "✓ " : ""}{s.label}</span>
                        <span className="font-mono text-xs text-primary">{s.cost} or</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                    </button>
                  );
                })}
              </div>
              {stakes.length > 0 && (
                <p className="text-xs text-primary/80 mt-2">Total misé : {stakes.reduce((sum, s) => sum + s.cost, 0)} or</p>
              )}
            </div>
          )}

          {!isParticipant && (
            <SealButton onClick={joinExpedition} disabled={busy}>{busy ? "Inscription…" : "Rejoindre l'expédition"}</SealButton>
          )}

          {isAdmin && availableBots.length > 0 && (
            <div className="mt-3 border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-3">
              <p className="text-xs tracking-[0.14em] uppercase text-amber-300 mb-2">Compagnons de test disponibles</p>
              <div className="flex flex-wrap gap-2">
                {availableBots.map((b) => (
                  <button key={b.id} onClick={() => addBotToExpedition(b.id)} disabled={botAddBusy === b.id}
                    className="text-xs uppercase tracking-[0.1em] border border-amber-500/50 text-amber-300 px-2.5 py-1 hover:bg-amber-500/10 disabled:opacity-30">
                    {botAddBusy === b.id ? "…" : `Ajouter ${b.name}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {isAdmin && (
            <button onClick={copyDebugReport}
              className="mt-3 w-full text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-3 py-1.5 hover:border-amber-500/40 hover:text-amber-300">
              {debugCopied ? "Copié ✓" : "Copier le rapport de debug (partage-le-moi)"}
            </button>
          )}
          {isLeader && (
            <button onClick={startExpedition} disabled={!canStart || busy}
              className="mt-3 w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-primary/60 text-primary hover:bg-primary/10">
              {canStart ? "Lancer l'expédition" : `En attente (${participants.length}/3 min.)`}
            </button>
          )}
          {isLeader && !confirmCancel && (
            <button onClick={() => setConfirmCancel(true)} disabled={busy}
              className="mt-2 w-full text-xs uppercase tracking-[0.1em] border border-red-400/30 text-red-400/70 hover:text-red-400 hover:border-red-400/50 transition-colors px-3 py-1.5">
              Annuler l'expédition
            </button>
          )}
          {isLeader && confirmCancel && (
            <div className="mt-2 border border-red-400/30 px-3 py-2">
              <p className="text-xs text-red-400/70 mb-2">
                {stakes.length > 0
                  ? `Les mises engagées (${stakes.reduce((sum, s) => sum + s.cost, 0)} or) seront intégralement remboursées à la guilde. Cette action est irréversible.`
                  : "Cette action est irréversible."}
              </p>
              <div className="flex gap-2">
                <button onClick={cancelExpedition} disabled={busy}
                  className="flex-1 text-xs uppercase tracking-[0.1em] border border-red-400/40 text-red-400 py-1.5 hover:bg-red-400/10 disabled:opacity-30">
                  {busy ? "Annulation…" : "Confirmer"}
                </button>
                <button onClick={() => setConfirmCancel(false)} disabled={busy}
                  className="flex-1 text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground py-1.5 hover:bg-border/10">
                  Retour
                </button>
              </div>
            </div>
          )}

          {!isLeader && isParticipant && (
            <p className="text-center text-xs text-muted-foreground mt-3">En attente que le chef lance l'expédition. Les autres membres de ta guilde peuvent encore rejoindre depuis leur page guilde.</p>
          )}

          <TextLink onClick={() => navigate({ to: "/" })}>Retour à la guilde</TextLink>
          </LedgerCard>
        </>
      )}
    </LedgerPage>
  );
}
