import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerCard, LedgerError, LedgerPage } from "@/components/ledger";
import { PortraitDisplay } from "@/components/portraits";
import { unlockAudio, soundVoteContinuer, soundVoteRentrer, soundVoteEnregistre, soundAllVoted, soundRevealClick, soundSurvived, soundMortMembre, soundMaMort, soundRetourVictoire, soundRetourWipe, soundTensionPulse } from "@/lib/sounds";

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
type Participant = { character_id: string; is_alive: boolean; character: { name: string; portrait: string } };
type Result = { deaths: number; loot: number; ended: boolean; deadNames: string[] };

const RISK_LABEL: Record<string, string> = { faible: "Faible", moyen: "Moyen", eleve: "Élevé" };
const RISK_COLOR: Record<string, string> = { faible: "text-emerald-400", moyen: "text-amber-400", eleve: "text-red-400" };

const CINEMATICS: Record<string, { survive: string[]; die: string[] }> = {
  coffre: {
    survive: ["Le couvercle cède dans un grincement sourd. Ce qui brille à l'intérieur vaut le risque pris.", "Vos mains tremblent en fouillant le contenu. Vous repartez plus riches.", "Le coffre s'ouvre. Personne ne parle. On compte, on prend, on avance."],
    die: ["Le piège se déclenche avant que quiconque ait pu réagir.", "Le coffre était piégé. Quelqu'un l'a appris trop tard.", "Un mécanisme invisible. Une fraction de seconde. Trop tard."],
  },
  gardien: {
    survive: ["Le combat est court. Brutal. Le groupe continue, essoufflé.", "Il tombe. Vous passez. On ne regarde pas en arrière.", "Il n'était pas seul. Mais vous, si. Vous repartez quand même."],
    die: ["Le gardien était plus rapide qu'il n'en avait l'air.", "La formation s'effondre. L'un d'eux ne se relève pas.", "Il n'a fallu qu'une ouverture. Une seule."],
  },
  passage: {
    survive: ["Le passage est étroit, instable. Vous traversez. Tous.", "Le vide en dessous. Les mains qui s'agrippent. Ça tient.", "De l'autre côté, enfin. Le groupe reprend son souffle."],
    die: ["Une planche cède. Un cri. Puis le silence.", "Le passage ne tenait qu'à un fil. Ce fil a rompu.", "On n'entend rien après la chute. On continue."],
  },
  porte: {
    survive: ["La porte s'ouvre. Ce qu'il y a derrière valait le détour.", "Le verrou saute. La pièce est vide, sauf pour ce qu'on cherchait.", "On passe. La porte se referme derrière. On ne reviendra pas."],
    die: ["Ce qui était derrière la porte n'attendait que ça.", "La porte s'est ouverte. Elle n'aurait pas dû.", "On pensait savoir. On avait tort."],
  },
};

function getCinematic(eventType: string, hasDeath: boolean): string {
  const options = CINEMATICS[eventType] ?? CINEMATICS.passage;
  const pool = hasDeath ? options.die : options.survive;
  return pool[Math.floor(Math.random() * pool.length)];
}

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
  const [cinematic, setCinematic] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [iDied, setIDied] = useState(false);
  const [pendingReveal, setPendingReveal] = useState(false); // étape résolue, pas encore vue

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tensionRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { unlockAudio(); return () => { if (tensionRef.current) clearInterval(tensionRef.current); }; }, []);
  const characterIdRef = useRef<string | null>(null);
  const stepIdRef = useRef<string | null>(null);

  // Charge participants avec leur statut vivant/mort en temps réel
  const fetchParticipants = useCallback(async () => {
    const { data: parts } = await supabase
      .from("expedition_participants")
      .select("character_id")
      .eq("expedition_id", expeditionId);
    if (!parts) return [];

    const ids = parts.map((p: any) => p.character_id);
    const { data: chars } = await supabase
      .from("characters")
      .select("id, name, portrait, is_alive")
      .in("id", ids);

    const enriched = (chars ?? []).map((c: any) => ({
      character_id: c.id,
      is_alive: c.is_alive,
      character: { name: c.name, portrait: c.portrait ?? "ombre" },
    }));
    setParticipants(enriched);
    return enriched;
  }, [expeditionId]);

  const fetchVotes = useCallback(async (stepId: string) => {
    const { data } = await supabase.from("step_votes").select("character_id").eq("step_id", stepId);
    const ids = (data ?? []).map((v: any) => v.character_id);
    // Protéger myVote : si data est null (erreur RLS), ne pas écraser votedIds
    if (data !== null) setVotedIds(ids);
    if (characterIdRef.current && ids.includes(characterIdRef.current)) {
      setMyVote(prev => prev ?? "voté");
    }
    return ids;
  }, []);

  const fetchStep = useCallback(async () => {
    const { data } = await supabase
      .from("expedition_steps")
      .select("id, step_number, event_type, risk_level, loot_min, loot_max, vote_deadline, resolved, deaths_count, description")
      .eq("expedition_id", expeditionId)
      .order("step_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const isNewStep = stepIdRef.current !== null && stepIdRef.current !== data.id;
      if (isNewStep) {
        stepIdRef.current = data.id;
        setMyVote(null);
        setVotedIds([]);
        setCinematic(null);
        setResult(null);
        setPendingReveal(false);
        setIDied(false);
      } else {
        stepIdRef.current = data.id;
      }
      setStep(data);
      await fetchVotes(data.id);

      // Si l'étape est résolue et qu'on n'a pas encore vu le résultat, signaler
      if (data.resolved && !result && !cinematic) {
        setPendingReveal(true);
      }

      // Vérifier si expédition terminée
      if (data.resolved) {
        const { data: exp } = await supabase
          .from("expeditions").select("status, total_loot_kept").eq("id", expeditionId).maybeSingle();
        if (exp?.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setResult({ deaths: data.deaths_count, loot: Math.round(exp.total_loot_kept ?? 0), ended: true, deadNames: [] });
        }
      }
    }
    return data;
  }, [expeditionId, fetchVotes]);

  // Poll central — vérifie mort + participants + votes + étape
  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      // 1. Suis-je encore vivant ?
      if (characterIdRef.current) {
        const { data: charData } = await supabase
          .from("characters").select("is_alive").eq("id", characterIdRef.current).maybeSingle();
        if (charData && !charData.is_alive) {
          clearInterval(pollRef.current!);
          setIDied(true);
          setResult({ deaths: -1, loot: 0, ended: true, deadNames: [] });
          return;
        }
      }
      // 2. Participants (avec statut vivant/mort)
      await fetchParticipants();
      // 3. Étape + votes
      void fetchStep();
    }, 5000);
  }, [fetchStep, fetchParticipants]);

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

      // Vérifier participation
      const { data: partCheck } = await supabase
        .from("expedition_participants")
        .select("character_id").eq("expedition_id", expeditionId).eq("character_id", char.id).maybeSingle();
      if (!partCheck) { navigate({ to: "/" }); return; }

      await fetchParticipants();
      const currentStep = await fetchStep();
      if (currentStep) stepIdRef.current = currentStep.id;
      setReady(true);
      startPoll();
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [expeditionId, navigate, fetchStep, fetchParticipants, startPoll]);

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
    if (vote === "continuer") soundVoteContinuer(); else soundVoteRentrer();
    const { error: rpcError } = await supabase.rpc("cast_vote", {
      p_step_id: step.id, p_character_id: character.id, p_vote: vote,
    });
    if (rpcError) { setError(rpcError.message); }
    else {
      soundVoteEnregistre();
      setMyVote(vote);
      setVotedIds(prev => prev.includes(character.id) ? prev : [...prev, character.id]);
    }
    setBusy(false);
  }

  async function resolveStep() {
    if (!step) return;
    soundRevealClick();
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc("resolve_step", { p_step_id: step.id });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }

    const { data: resolvedStep } = await supabase
      .from("expedition_steps").select("deaths_count").eq("id", step.id).maybeSingle();
    const deaths = resolvedStep?.deaths_count ?? 0;

    const { data: deadChars } = await supabase
      .from("characters").select("name")
      .eq("died_in_expedition_id", expeditionId).eq("is_alive", false);
    const deadNames = (deadChars ?? []).map((c: any) => c.name);

    const cinematicText = getCinematic(step.event_type, deaths > 0);
    setCinematic(cinematicText);

    // Suis-je mort ?
    if (character) {
      const { data: charData } = await supabase
        .from("characters").select("is_alive").eq("id", character.id).maybeSingle();
      if (charData && !charData.is_alive) {
        if (pollRef.current) clearInterval(pollRef.current);
        soundMaMort();
        setBusy(false);
        setTimeout(() => { setIDied(true); setResult({ deaths: -1, loot: 0, ended: true, deadNames }); }, 2500);
        return;
      }
    }

    const { data: exp } = await supabase
      .from("expeditions").select("status, total_loot_kept").eq("id", expeditionId).maybeSingle();

    if (exp?.status === "completed" && (exp.total_loot_kept ?? 0) > 0) soundRetourVictoire();
    else if (exp?.status === "completed") soundRetourWipe();
    else if (deaths > 0) soundMortMembre();
    else soundSurvived();

    setTimeout(() => {
      setCinematic(null);
      setPendingReveal(true);
    }, 2500);

    if (exp?.status === "completed") {
      if (pollRef.current) clearInterval(pollRef.current);
      setResult({ deaths, loot: Math.round(exp?.total_loot_kept ?? 0), ended: true, deadNames });
    } else {
      setResult({ deaths, loot: 0, ended: false, deadNames });
    }

    setBusy(false);
  }

  // Participants vivants = ceux qui comptent pour le vote
  const aliveParticipants = participants.filter(p => p.is_alive);
  const allVoted = aliveParticipants.length > 0 && aliveParticipants.every(p => votedIds.includes(p.character_id));
  const deadlineExpired = timeLeft !== null && timeLeft <= 0;
  const canResolve = (allVoted || deadlineExpired) && step && !step.resolved && !busy && !cinematic;
  const prevAllVoted = useRef(false);
  useEffect(() => { if (allVoted && !prevAllVoted.current) soundAllVoted(); prevAllVoted.current = allVoted; }, [allVoted]);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Chargement…</p></LedgerPage>;

  // Cinématique
  // Écran intermédiaire : l'étape est résolue, chaque joueur confirme individuellement
  if (pendingReveal && !cinematic) {
    return (
      <LedgerPage>
        <LedgerCard title="Résultat disponible" subtitle="L'étape a été résolue.">
          <p className="text-sm text-muted-foreground mb-6 text-center">
            Prêt à voir ce qui s'est passé ?
          </p>
          <button
            onClick={() => {
              setPendingReveal(false);
              // Si pas encore de cinématique, en générer une maintenant
              if (step && !cinematic) {
                const hasDeath = (result?.deaths ?? 0) > 0 || iDied;
                setCinematic(getCinematic(step.event_type, hasDeath));
              }
            }}
            className="w-full rounded-sm border px-4 py-3 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10">
            Révéler
          </button>
        </LedgerCard>
      </LedgerPage>
    );
  }

  if (cinematic && !result) {
    return (
      <LedgerPage>
        <LedgerCard title="" subtitle="">
          <p className="text-base text-foreground leading-relaxed text-center py-8 italic px-4">{cinematic}</p>
        </LedgerCard>
      </LedgerPage>
    );
  }

  // Mort personnelle
  if (result && iDied) {
    return (
      <LedgerPage>
        <LedgerCard title="Tu es mort." subtitle="Ton personnage ne reviendra pas.">
          {cinematic && <p className="text-sm text-muted-foreground italic mb-4 leading-relaxed">{cinematic}</p>}
          <div className="mb-6 px-3 py-4 border border-red-400/30 bg-red-400/5">
            <p className="text-sm text-red-400/80 leading-relaxed">
              Le sort t'a désigné. Ton histoire s'arrête ici. Ton nom restera dans l'historique de la guilde.
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

  // Résultat normal
  if (result) {
    const title = result.ended ? "Expédition terminée"
      : result.deaths > 0 ? `${result.deaths} mort${result.deaths > 1 ? "s" : ""}` : "Étape franchie";
    const subtitle = result.ended ? `Butin rapporté à la guilde : ${result.loot} or`
      : result.deaths > 0 ? `${result.deaths} membre${result.deaths > 1 ? "s ont" : " a"} péri.`
      : "Le groupe avance.";
    return (
      <LedgerPage>
        <LedgerCard title={title} subtitle={subtitle}>
          {result.deadNames.length > 0 && (
            <div className="mb-4 px-3 py-2 border border-red-400/20">
              {result.deadNames.map(n => <p key={n} className="text-xs text-red-400/70">✝ {n}</p>)}
            </div>
          )}
          {result.ended ? (
            <button onClick={() => navigate({ to: "/" })}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10">
              Retour à la guilde
            </button>
          ) : (
            <button onClick={() => { setResult(null); setCinematic(null); void fetchStep(); }}
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
            <p className={`text-sm font-semibold mb-4 ${RISK_COLOR[step.risk_level]}`}>⚠ Risque {RISK_LABEL[step.risk_level]}</p>
            {!myVote ? (
              <div className="grid grid-cols-2 gap-3 mb-2">
                <button onClick={() => castVote("continuer")} disabled={busy}
                  className="py-4 border border-primary/60 text-primary font-serif tracking-[0.14em] uppercase rounded-sm hover:bg-primary/10 disabled:opacity-30">
                  Continuer
                </button>
                <button onClick={() => castVote("rentrer")} disabled={busy}
                  className="py-4 border border-border/60 text-muted-foreground font-serif tracking-[0.14em] uppercase rounded-sm hover:bg-border/10 disabled:opacity-30">
                  Rentrer
                </button>
              </div>
              <p className="text-xs text-muted-foreground/50 text-center mb-4">
                Vote secret — personne ne saura ce que tu as choisi. Un seul "Continuer" suffit à entraîner tout le groupe.
              </p>
            ) : (
              <div className="mb-4 px-3 py-3 border border-border/40 text-sm text-muted-foreground text-center">
                Vote enregistré — en attente des autres…
              </div>
            )}
            <div className="mb-4">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">
                Votes reçus : {votedIds.filter(id => aliveParticipants.some(p => p.character_id === id)).length} / {aliveParticipants.length}
              </p>
              <div className="flex gap-1">
                {aliveParticipants.map((p) => (
                  <div key={p.character_id}
                    className={`h-2 flex-1 rounded-sm transition-colors duration-300 ${votedIds.includes(p.character_id) ? "bg-primary/70" : "bg-border/30"}`} />
                ))}
              </div>
            </div>
            <LedgerError message={error} />
            {canResolve && (
              <button onClick={resolveStep} disabled={busy}
                className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-30">
                {busy ? "Résolution…" : "Révéler le résultat — tout le monde verra ce qui s'est passé"}
              </button>
            )}
            <div className="mt-4 border-t border-border/20 pt-4">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Groupe</p>
              <ul className="space-y-1.5">
                {participants.map((p) => (
                  <li key={p.character_id}
                    className={`flex items-center gap-2 px-2 py-1.5 border ${!p.is_alive ? "opacity-30 border-red-400/20" : p.character_id === character?.id ? "border-primary/40" : "border-border/20"}`}>
                    <PortraitDisplay portraitId={(p.character as any)?.portrait ?? "ombre"} size={28} />
                    <span className={`text-xs flex-1 ${!p.is_alive ? "line-through text-red-400/50" : p.character_id === character?.id ? "text-primary" : "text-muted-foreground"}`}>
                      {(p.character as any)?.name}{p.character_id === character?.id ? " (toi)" : ""}
                      {!p.is_alive ? " ✝" : ""}
                    </span>
                    {p.is_alive && (
                      <span className={votedIds.includes(p.character_id) ? "text-primary text-xs" : "text-muted-foreground/40 text-xs"}>
                        {votedIds.includes(p.character_id) ? "✓" : "…"}
                      </span>
                    )}
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
  const tensionRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { unlockAudio(); return () => { if (tensionRef.current) clearInterval(tensionRef.current); }; }, []);

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

  const prevMsgCount = useRef(0);
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCount.current = messages.length;
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
