import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  LedgerCard,
  LedgerError,
  LedgerPage,
  TextLink,
} from "@/components/ledger";

export const Route = createFileRoute("/vote")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    expedition: String(search.expedition ?? ""),
  }),
  component: VotePage,
});

type Character = { id: string; name: string };
type Step = {
  id: string;
  step_number: number;
  event_type: string;
  risk_level: string;
  loot_min: number;
  loot_max: number;
  vote_deadline: string;
  resolved: boolean;
  deaths_count: number;
};
type Participant = { character_id: string; character: { name: string } };

const RISK_LABELS: Record<string, string> = {
  faible: "Faible",
  moyen: "Moyen",
  eleve: "Élevé",
};

const RISK_COLORS: Record<string, string> = {
  faible: "text-emerald-400",
  moyen: "text-amber-400",
  eleve: "text-red-400",
};

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
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState<{ deaths: number; loot: number; returned: boolean } | null>(null);

  const loadStep = useCallback(async () => {
    const { data } = await supabase
      .from("expedition_steps")
      .select("id, step_number, event_type, risk_level, loot_min, loot_max, vote_deadline, resolved, deaths_count")
      .eq("expedition_id", expeditionId)
      .order("step_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    setStep(data ?? null);
    return data;
  }, [expeditionId]);

  const loadVotedIds = useCallback(async (stepId: string) => {
    // On sait juste combien de gens ont voté (pas qui ni quoi) — secret préservé
    const { count } = await supabase
      .from("step_votes")
      .select("id", { count: "exact", head: true })
      .eq("step_id", stepId);
    // On ne récupère que les character_ids ayant voté, pas le contenu
    const { data } = await supabase
      .from("step_votes")
      .select("character_id")
      .eq("step_id", stepId);
    setVotedIds((data ?? []).map((v: any) => v.character_id));
  }, []);

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

      const currentStep = await loadStep();
      if (currentStep) await loadVotedIds(currentStep.id);

      setReady(true);

      // Realtime : mise à jour des votes en direct (sans révéler le contenu)
      const channel = supabase
        .channel(`votes_${expeditionId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "step_votes" }, async () => {
          const s = await loadStep();
          if (s) await loadVotedIds(s.id);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expedition_steps" }, async () => {
          await loadStep();
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    })();
  }, [expeditionId, navigate, loadStep, loadVotedIds]);

  // Minuteur
  useEffect(() => {
    if (!step?.vote_deadline || step.resolved) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(step.vote_deadline).getTime() - Date.now()) / 1000));
      setTimeLeft(left);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [step]);

  async function castVote(vote: "continuer" | "rentrer") {
    if (!step || !character || myVote) return;
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("cast_vote", {
      p_step_id: step.id,
      p_character_id: character.id,
      p_vote: vote,
    });
    if (rpcError) setError(rpcError.message);
    else setMyVote(vote);
    setBusy(false);
  }

  async function resolveStep() {
    if (!step) return;
    setResolving(true);
    const { data, error: rpcError } = await supabase.rpc("resolve_step", { p_step_id: step.id });
    if (rpcError) { setError(rpcError.message); setResolving(false); return; }
    const resolved = data as Step;

    // Vérifie si l'expédition est terminée
    const { data: exp } = await supabase
      .from("expeditions")
      .select("status, total_loot_kept")
      .eq("id", expeditionId)
      .maybeSingle();

    const returned = (resolved.deaths_count === 0 && votedIds.length === 0) || exp?.status === "completed";
    setResult({
      deaths: resolved.deaths_count,
      loot: Math.round(exp?.total_loot_kept ?? 0),
      returned: exp?.status === "completed",
    });
    await loadStep();
    setResolving(false);
  }

  const allVoted = participants.length > 0 && votedIds.length >= participants.length;
  const deadlineExpired = timeLeft !== null && timeLeft <= 0;
  const canResolve = (allVoted || deadlineExpired) && !step?.resolved && !resolving;

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Chargement…</p></LedgerPage>;

  if (result) {
    return (
      <LedgerPage>
        <LedgerCard
          title={result.returned ? "Expédition terminée" : result.deaths > 0 ? `${result.deaths} mort${result.deaths > 1 ? "s" : ""}` : "Étape franchie"}
          subtitle={result.returned ? `Butin rapporté à la guilde : ${result.loot} or` : "L'expédition continue…"}
        >
          {result.deaths > 0 && (
            <p className="text-sm text-muted-foreground mb-4">
              {result.deaths} membre{result.deaths > 1 ? "s ont" : " a"} péri. La guilde en porte les conséquences.
            </p>
          )}
          {result.returned ? (
            <TextLink onClick={() => navigate({ to: "/" })}>Retour à la guilde</TextLink>
          ) : (
            <button
              onClick={async () => { setResult(null); await loadStep(); }}
              className="mt-2 w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10"
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
        subtitle={step ? `Risque : ${RISK_LABELS[step.risk_level] ?? step.risk_level} · Butin potentiel : ${step.loot_min}–${step.loot_max} or` : ""}
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

            {/* Risque */}
            <div className="mb-4">
              <span className={`text-sm font-semibold ${RISK_COLORS[step.risk_level]}`}>
                ⚠ Risque {RISK_LABELS[step.risk_level]}
              </span>
            </div>

            {/* Vote */}
            {!myVote ? (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={() => castVote("continuer")}
                  disabled={busy}
                  className="py-4 border border-primary/60 text-primary font-serif tracking-[0.14em] uppercase rounded-sm hover:bg-primary/10 disabled:opacity-30"
                >
                  Continuer
                </button>
                <button
                  onClick={() => castVote("rentrer")}
                  disabled={busy}
                  className="py-4 border border-border/60 text-muted-foreground font-serif tracking-[0.14em] uppercase rounded-sm hover:bg-border/10 disabled:opacity-30"
                >
                  Rentrer
                </button>
              </div>
            ) : (
              <div className="mb-4 px-3 py-3 border border-border/40 text-sm text-muted-foreground text-center">
                Vote enregistré. En attente des autres…
              </div>
            )}

            {/* Compteur de votes (sans révéler qui a voté quoi) */}
            <div className="mb-4">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">
                Votes reçus : {votedIds.length} / {participants.length}
              </p>
              <div className="flex gap-1">
                {participants.map((p) => (
                  <div
                    key={p.character_id}
                    title={(p.character as any)?.name ?? ""}
                    className={`h-2 flex-1 rounded-sm ${votedIds.includes(p.character_id) ? "bg-primary/70" : "bg-border/30"}`}
                  />
                ))}
              </div>
            </div>

            <LedgerError message={error} />

            {/* Résolution — visible par tous, déclenche le résultat */}
            {canResolve && (
              <button
                onClick={resolveStep}
                disabled={resolving}
                className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-30"
              >
                {resolving ? "Résolution…" : "Révéler le résultat"}
              </button>
            )}
          </>
        )}
      </LedgerCard>
    </LedgerPage>
  );
}
