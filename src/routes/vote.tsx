import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerCard, LedgerError, LedgerPage } from "@/components/ledger";

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
  loot_min: number; loot_max: number; vote_deadline: string;
  resolved: boolean; deaths_count: number; description: string | null;
};
type Participant = { character_id: string; character: { name: string } };
type Result = { deaths: number; loot: number; ended: boolean };

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
  const [result, setResult] = useState<Result | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const characterIdRef = useRef<string | null>(null);

  // Charge les votes pour un step donné
  const fetchVotes = useCallback(async (stepId: string) => {
    const { data } = await supabase
      .from("step_votes")
      .select("character_id")
      .eq("step_id", stepId);
    const ids = (data ?? []).map((v: any) => v.character_id);
    setVotedIds(ids);
    if (characterIdRef.current && ids.includes(characterIdRef.current)) {
      setMyVote(prev => prev ?? "voté");
    }
    return ids;
  }, []);

  // Charge la dernière étape
  const fetchStep = useCallback(async () => {
    const { data } = await supabase
      .from("expedition_steps")
      .select("id, step_number, event_type, risk_level, loot_min, loot_max, vote_deadline, resolved, deaths_count, description")
      .eq("expedition_id", expeditionId)
      .order("step_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setStep(prev => {
        if (prev?.id !== data.id) setMyVote(null);
        return data;
      });
      await fetchVotes(data.id);
    }
    return data;
  }, [expeditionId, fetchVotes]);

  // Poll toutes les 5 secondes — simple et fiable
  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      // Vérifier d'abord si ce joueur est toujours vivant
      if (characterIdRef.current) {
        const { data: charData } = await supabase
          .from("characters").select("is_alive").eq("id", characterIdRef.current).maybeSingle();
        if (charData && !charData.is_alive) {
          clearInterval(pollRef.current!);
          setResult({ deaths: -1, loot: 0, ended: true });
          return;
        }
      }
      void fetchStep();
    }, 5000);
  }, [fetchStep]);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate({ to: "/" }); return; }

      const { data: char } = await supabase
        .from("characters").select("id, name")
        .eq("profile_id", session.user.id).eq("is_alive", true).maybeSingle();
      if (!char) { navigate({ to: "/" }); return; }
      setCharacter(char);
      characterIdRef.current = char.id;

      const { data: parts } = await supabase
        .from("expedition_participants")
        .select("character_id, character:characters(name)")
        .eq("expedition_id", expeditionId);
      const partList = (parts as any) ?? [];
      setParticipants(partList);
      if (!partList.some((p: any) => p.character_id === char.id)) {
        navigate({ to: "/" }); return;
      }

      await fetchStep();
      setReady(true);
      startPoll();
    })();

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [expeditionId, navigate, fetchStep, startPoll]);

  // Minuteur
  useEffect(() => {
    if (!step?.vote_deadline || step.resolved) { setTimeLeft(null); return; }
    const deadline = new Date(step.vote_deadline).getTime();
    const tick = () => setTimeLeft(Math.max(0, Math.floor((deadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [step?.id, step?.vote_deadline, step?.resolved]);

  async function castVote(vote: "continuer" | "rentrer") {
    if (!step || !character || myVote) return;
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("cast_vote", {
      p_step_id: step.id, p_character_id: character.id, p_vote: vote,
    });
    if (rpcError) { setError(rpcError.message); }
    else {
      setMyVote(vote);
      setVotedIds(prev => prev.includes(character.id) ? prev : [...prev, character.id]);
    }
    setBusy(false);
  }

  async function resolveStep() {
    if (!step) return;
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc("resolve_step", { p_step_id: step.id });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }

    const { data: resolvedStep } = await supabase
      .from("expedition_steps").select("deaths_count").eq("id", step.id).maybeSingle();
    const { data: exp } = await supabase
      .from("expeditions").select("status, total_loot_kept").eq("id", expeditionId).maybeSingle();

    // Vérifier si CE joueur est mort pendant cette étape
    if (character) {
      const { data: charData } = await supabase
        .from("characters").select("is_alive").eq("id", character.id).maybeSingle();
      if (charData && !charData.is_alive) {
        if (pollRef.current) clearInterval(pollRef.current);
        setResult({ deaths: -1, loot: 0, ended: true }); // -1 = signal "je suis mort"
        setBusy(false);
        return;
      }
    }

    if (exp?.status === "completed") {
      if (pollRef.current) clearInterval(pollRef.current);
      setResult({ deaths: resolvedStep?.deaths_count ?? 0, loot: Math.round(exp.total_loot_kept ?? 0), ended: true });
    } else {
      setResult({ deaths: resolvedStep?.deaths_count ?? 0, loot: 0, ended: false });
    }
    setBusy(false);
  }

  const allVoted = participants.length > 0 && votedIds.length >= participants.length;
  const deadlineExpired = timeLeft !== null && timeLeft <= 0;
  const canResolve = (allVoted || deadlineExpired) && step && !step.resolved && !busy;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Chargement…</p></LedgerPage>;

  if (result) {
    // Écran spécial : CE joueur est mort
    if (result.deaths === -1) {
      return (
        <LedgerPage>
          <LedgerCard title="Tu es mort." subtitle="Ton personnage ne reviendra pas.">
            <div className="mb-6 px-3 py-4 border border-red-400/30 bg-red-400/5">
              <p className="text-sm text-red-400/80 leading-relaxed">
                Le sort t'a désigné. Ton histoire s'arrête ici, dans l'obscurité de cette expédition.
                Ton nom restera dans l'historique de la guilde.
              </p>
            </div>
            <button onClick={() => navigate({ to: "/" })}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-red-400/40 text-red-400/70 hover:bg-red-400/10">
              Quitter l'expédition
            </button>
          </LedgerCard>
        </LedgerPage>
      );
    }

    const title = result.ended ? "Expédition terminée"
      : result.deaths > 0 ? `${result.deaths} mort${result.deaths > 1 ? "s" : ""}` : "Étape franchie";
    const subtitle = result.ended ? `Butin rapporté à la guilde : ${result.loot} or`
      : result.deaths > 0 ? `${result.deaths} membre${result.deaths > 1 ? "s ont" : " a"} péri.`
      : "Le groupe avance.";
    return (
      <LedgerPage>
        <LedgerCard title={title} subtitle={subtitle}>
          {result.ended ? (
            <button onClick={() => navigate({ to: "/" })}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10">
              Retour à la guilde
            </button>
          ) : (
            <button onClick={() => { setResult(null); void fetchStep(); }}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10">
              Étape suivante
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
        subtitle={step ? `Risque : ${RISK_LABEL[step.risk_level] ?? step.risk_level} · Butin : ${step.loot_min}–${step.loot_max} or` : ""}
      >
        {step && !step.resolved && (
          <>
            {step.description && (
              <p className="text-sm text-muted-foreground italic mb-4 px-1 leading-relaxed">{step.description}</p>
            )}
            <div className="flex items-center justify-between mb-4 px-3 py-2 border border-border/40">
              <span className="text-xs tracking-[0.14em] uppercase text-muted-foreground">Temps restant</span>
              <span className={`font-mono text-lg ${timeLeft !== null && timeLeft < 30 ? "text-red-400" : "text-primary"}`}>
                {timeLeft !== null ? fmt(timeLeft) : "—"}
              </span>
            </div>
            <p className={`text-sm font-semibold mb-4 ${RISK_COLOR[step.risk_level]}`}>
              ⚠ Risque {RISK_LABEL[step.risk_level]}
            </p>
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
                Vote enregistré — en attente des autres…
              </div>
            )}
            <div className="mb-4">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">
                Votes reçus : {votedIds.length} / {participants.length}
              </p>
              <div className="flex gap-1">
                {participants.map((p) => (
                  <div key={p.character_id}
                    className={`h-2 flex-1 rounded-sm transition-colors duration-300 ${votedIds.includes(p.character_id) ? "bg-primary/70" : "bg-border/30"}`} />
                ))}
              </div>
            </div>
            <LedgerError message={error} />
            {canResolve && (
              <button onClick={resolveStep} disabled={busy}
                className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-30">
                {busy ? "Résolution…" : "Révéler le résultat"}
              </button>
            )}
            <div className="mt-4 border-t border-border/20 pt-4">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Groupe</p>
              <ul className="space-y-1">
                {participants.map((p) => (
                  <li key={p.character_id}
                    className={`flex justify-between px-3 py-1.5 text-xs border ${p.character_id === character?.id ? "border-primary/40 text-primary" : "border-border/20 text-muted-foreground"}`}>
                    <span>{(p.character as any)?.name}{p.character_id === character?.id ? " (toi)" : ""}</span>
                    <span className={votedIds.includes(p.character_id) ? "text-primary" : ""}>
                      {votedIds.includes(p.character_id) ? "✓" : "…"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <ChatBox expeditionId={expeditionId} character={character} />
          </>
        )}
      </LedgerCard>
    </LedgerPage>
  );
}

type ChatMessage = { id: string; character_id: string; message: string; created_at: string; character: { name: string } };

function ChatBox({ expeditionId, character }: { expeditionId: string; character: Character | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("expedition_chat_messages")
      .select("id, character_id, message, created_at, character:characters(name)")
      .eq("expedition_id", expeditionId)
      .order("created_at", { ascending: true })
      .limit(50);
    setMessages((data as any) ?? []);
  }, [expeditionId]);

  useEffect(() => {
    void fetchMessages();
    pollRef.current = setInterval(fetchMessages, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !character || busy) return;
    setBusy(true);
    await supabase.from("expedition_chat_messages").insert({
      expedition_id: expeditionId, character_id: character.id, message: text.trim(),
    });
    setText("");
    await fetchMessages();
    setBusy(false);
  }

  return (
    <div className="mt-4 border-t border-border/20 pt-4">
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Chat</p>
      <div className="h-32 overflow-y-auto space-y-1 mb-2 pr-1">
        {messages.length === 0
          ? <p className="text-xs text-muted-foreground/40 italic">Silence.</p>
          : messages.map((m) => (
            <div key={m.id} className={`text-xs ${m.character_id === character?.id ? "text-primary" : "text-muted-foreground"}`}>
              <span className="font-semibold">{(m.character as any)?.name ?? "?"}</span>
              <span className="mx-1 opacity-40">·</span>
              <span>{m.message}</span>
            </div>
          ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} maxLength={200}
          placeholder="Écris quelque chose…"
          className="flex-1 bg-transparent border border-border/40 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40" />
        <button type="submit" disabled={busy || !text.trim()}
          className="px-3 py-1.5 text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-30">
          Envoyer
        </button>
      </form>
    </div>
  );
}
