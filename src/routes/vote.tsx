import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerCard, LedgerError, LedgerPage, TextLink } from "@/components/ledger";

export const Route = createFileRoute("/vote")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    expedition: String(search.expedition ?? ""),
  }),
  component: VotePage,
});

type Character = { id: string; name: string };
type Step = {
  id: string; step_number: number; event_type: string; risk_level: string;
  loot_min: number; loot_max: number; vote_deadline: string; resolved: boolean; deaths_count: number;
};
type Participant = { character_id: string; character: { name: string } };

const RISK_LABEL: Record<string, string> = { faible: "Faible", moyen: "Moyen", eleve: "Élevé" };
const RISK_COLOR: Record<string, string> = { faible: "text-emerald-400", moyen: "text-amber-400", eleve: "text-red-400" };

function VotePage() {
  const navigate = useNavigate();
  const { expedition: expeditionId } = useSearch({ from: "/vote" });
  const [character, setCharacter] = useState<Character | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [votedIds, setVotedIds] = useState<string[]>([]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<{ deaths: number; loot: number; ended: boolean; survivorCount: number } | null>(null);

  const loadVotedIds = useCallback(async (stepId: string) => {
    const { data } = await supabase
      .from("step_votes")
      .select("character_id")
      .eq("step_id", stepId);
    setVotedIds((data ?? []).map((v: any) => v.character_id));
  }, []);

  const loadStep = useCallback(async () => {
    const { data } = await supabase
      .from("expedition_steps")
      .select("id, step_number, event_type, risk_level, loot_min, loot_max, vote_deadline, resolved, deaths_count")
      .eq("expedition_id", expeditionId)
      .order("step_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setStep(data);
      setMyVote(null); // reset vote pour la nouvelle étape
      await loadVotedIds(data.id);
    }
    return data;
  }, [expeditionId, loadVotedIds]);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate({ to: "/" }); return; }

      const { data: char } = await supabase
        .from("characters")
        .select("id, name")
        .eq("profile_id", session.user.id)
        .eq("is_alive", true)
        .maybeSingle();
      if (!char) { navigate({ to: "/" }); return; }
      setCharacter(char);

      const { data: parts } = await supabase
        .from("expedition_participants")
        .select("character_id, character:characters(name)")
        .eq("expedition_id", expeditionId);
      setParticipants((parts as any) ?? []);

      // Vérifier si ce personnage est toujours vivant dans l'expédition
      const isParticipant = (parts ?? []).some((p: any) => p.character_id === char.id);
      if (!isParticipant) { navigate({ to: "/" }); return; }

      await loadStep();
      setReady(true);

      // Realtime : votes + nouvelles étapes
      const channel = supabase
        .channel(`vote_room_${expeditionId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "step_votes" },
          async () => { if (step?.id) await loadVotedIds(step.id); })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "expedition_steps",
          filter: `expedition_id=eq.${expeditionId}` },
          async () => { await loadStep(); })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expedition_steps",
          filter: `expedition_id=eq.${expeditionId}` },
          async () => { await loadStep(); })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    })();
  }, [expeditionId, navigate, loadStep, loadVotedIds]);

  // Minuteur
  useEffect(() => {
    if (!step?.vote_deadline || step.resolved) { setTimeLeft(null); return; }
    const tick = () => setTimeLeft(Math.max(0, Math.floor((new Date(step.vote_deadline).getTime() - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [step?.id, step?.vote_deadline, step?.resolved]);

  // Vérifier si j'ai déjà voté à cette étape
  useEffect(() => {
    if (!step?.id || !character?.id) return;
    if (votedIds.includes(character.id)) setMyVote("voté");
  }, [votedIds, step?.id, character?.id]);

  async function castVote(vote: "continuer" | "rentrer") {
    if (!step || !character || myVote) return;
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("cast_vote", {
      p_step_id: step.id,
      p_character_id: character.id,
      p_vote: vote,
    });
    if (rpcError) setError(rpcError.message);
    else { setMyVote(vote); await loadVotedIds(step.id); }
    setBusy(false);
  }

  async function resolveStep() {
    if (!step) return;
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc("resolve_step", { p_step_id: step.id });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }

    // Recharger l'étape résolue pour avoir deaths_count
    const { data: resolvedStep } = await supabase
      .from("expedition_steps")
      .select("deaths_count")
      .eq("id", step.id)
      .maybeSingle();

    const { data: exp } = await supabase
      .from("expeditions")
      .select("status, total_loot_kept")
      .eq("id", expeditionId)
      .maybeSingle();

    const { count: survivorCount } = await supabase
      .from("expedition_participants")
      .select("character_id", { count: "exact", head: true })
      .eq("expedition_id", expeditionId);

    setResult({
      deaths: resolvedStep?.deaths_count ?? 0,
      loot: Math.round(exp?.total_loot_kept ?? 0),
      ended: exp?.status === "completed",
      survivorCount: survivorCount ?? 0,
    });
    setBusy(false);
  }

  const aliveParticipants = participants.filter(p => !votedIds.includes(p.character_id) || votedIds.includes(p.character_id));
  const allVoted = participants.length > 0 && votedIds.length >= participants.length;
  const deadlineExpired = timeLeft !== null && timeLeft <= 0;
  const canResolve = (allVoted || deadlineExpired) && step && !step.resolved && !busy;
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Chargement…</p></LedgerPage>;

  // Écran de résultat d'une étape
  if (result) {
    return (
      <LedgerPage>
        <LedgerCard
          title={result.ended
            ? "Expédition terminée"
            : result.deaths > 0
              ? `${result.deaths} mort${result.deaths > 1 ? "s" : ""}`
              : "Étape franchie — on continue"}
          subtitle={result.ended
            ? `Butin rapporté à la guilde : ${result.loot} or`
            : result.deaths > 0
              ? "L'expédition continue avec les survivants."
              : "Une nouvelle épreuve vous attend."}
        >
          {result.deaths > 0 && !result.ended && (
            <p className="text-sm text-muted-foreground mb-4">
              {result.deaths} membre{result.deaths > 1 ? "s ont" : " a"} péri. La guilde en porte les conséquences.
            </p>
          )}
          {result.ended ? (
            <>
              {result.survivorCount === 0 && (
                <p className="text-sm text-red-400 mb-4">Expédition anéantie. Aucun survivant. Butin perdu.</p>
              )}
              <button
                onClick={() => navigate({ to: "/" })}
                className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10"
              >
                Retour à la guilde
              </button>
            </>
          ) : (
            <button
              onClick={() => { setResult(null); void loadStep(); }}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10"
            >
              Voir l'étape suivante
            </button>
          )}
        </LedgerCard>
      </LedgerPage>
    );
  }

  return (
    <LedgerPage>
      <LedgerCard
        title={step ? `Étape ${step.step_number} — ${step.event_type}` : "Expédition"}
        subtitle={step ? `Risque : ${RISK_LABEL[step.risk_level] ?? step.risk_level} · Butin potentiel : ${step.loot_min}–${step.loot_max} or` : ""}
      >
        {step && !step.resolved && (
          <>
            {/* Minuteur */}
            <div className="flex items-center justify-between mb-4 px-3 py-2 border border-border/40">
              <span className="text-xs tracking-[0.14em] uppercase text-muted-foreground">Temps restant</span>
              <span className={`font-mono text-lg ${timeLeft !== null && timeLeft < 30 ? "text-red-400" : "text-primary"}`}>
                {timeLeft !== null ? formatTime(timeLeft) : "—"}
              </span>
            </div>

            <p className={`text-sm font-semibold mb-4 ${RISK_COLOR[step.risk_level]}`}>
              ⚠ Risque {RISK_LABEL[step.risk_level]}
            </p>

            {/* Boutons de vote */}
            {!myVote ? (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button onClick={() => castVote("continuer")} disabled={busy}
                  className="py-4 border border-primary/60 text-primary font-serif tracking-[0.14em] uppercase rounded-sm hover:bg-primary/10 disabled:opacity-30">
                  Continuer
                </button>
                <button onClick={() => castVote("rentrer")} disabled={busy}
                  className="py-4 border border-border/60 text-muted-foreground font-serif tracking-[0.14em] uppercase rounded-sm hover:bg-border/10 disabled:opacity-30">
                  Rentrer
                </button>
              </div>
            ) : (
              <div className="mb-4 px-3 py-3 border border-border/40 text-sm text-muted-foreground text-center">
                Vote enregistré. En attente des autres…
              </div>
            )}

            {/* Compteur de votes — barres anonymes */}
            <div className="mb-4">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">
                Votes reçus : {votedIds.length} / {participants.length}
              </p>
              <div className="flex gap-1">
                {participants.map((p) => (
                  <div key={p.character_id}
                    className={`h-2 flex-1 rounded-sm transition-colors ${votedIds.includes(p.character_id) ? "bg-primary/70" : "bg-border/30"}`} />
                ))}
              </div>
            </div>

            <LedgerError message={error} />

            {/* Résolution disponible pour tous — n'importe qui peut déclencher */}
            {canResolve && (
              <button onClick={resolveStep} disabled={busy}
                className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-30">
                {busy ? "Résolution…" : "Révéler le résultat"}
              </button>
            )}

            {/* Liste des participants (sans révéler qui a voté quoi) */}
            <div className="mt-4 border-t border-border/20 pt-4">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Groupe</p>
              <ul className="space-y-1">
                {participants.map((p) => (
                  <li key={p.character_id}
                    className={`flex justify-between px-3 py-1.5 text-xs border ${p.character_id === character?.id ? "border-primary/40 text-primary" : "border-border/20 text-muted-foreground"}`}>
                    <span>{(p.character as any)?.name}{p.character_id === character?.id ? " (toi)" : ""}</span>
                    <span>{votedIds.includes(p.character_id) ? "✓" : "…"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </LedgerCard>
    </LedgerPage>
  );
}
