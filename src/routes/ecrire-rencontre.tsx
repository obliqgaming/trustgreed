import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerPage, LedgerCard, LedgerError, TextLink } from "@/components/ledger";
import { ImmersiveButton } from "@/components/immersive";

export const Route = createFileRoute("/ecrire-rencontre")({
  ssr: false,
  component: EcrireRencontrePage,
});

type Character = { id: string; name: string; guild_id: string };
type Draft = {
  id: string;
  event_type: string;
  risk_level: "faible" | "moyen" | "eleve";
  status: string;
  situation_text: string | null;
  success_text: string | null;
  failure_text: string | null;
  cost_paid: number;
};
type MyEvent = { id: string; event_type: string; risk_level: string; status: string; situation_text: string | null; created_at: string };

// Icônes déjà utilisées en jeu pour chaque type — les réutiliser ici évite
// d'avoir besoin d'un nouvel asset pour que la révélation soit lisible.
const EVENT_TYPE_ICON: Record<string, string> = {
  coffre: "/icons/chest.webp",
  gardien: "/icons/shield_swords.webp",
  rencontre: "/icons/hooded_group.webp",
  decouverte: "/icons/gem.webp",
  porte: "/icons/door.webp",
  passage: "/icons/door.webp",
  traces: "/icons/magnifier.webp",
};
const EVENT_TYPE_LABEL: Record<string, string> = {
  coffre: "Coffre", porte: "Porte", gardien: "Adversaire", passage: "Passage",
  rencontre: "Rencontre", traces: "Traces", decouverte: "Découverte",
};
// À interpréter au sens large, pas littéralement — affiché juste après le
// tirage pour lancer l'imagination plutôt que d'enfermer dans un cliché.
const EVENT_TYPE_GUIDE: Record<string, string> = {
  coffre: "N'importe quel contenant, cache ou dépôt de valeur : un coffre, mais aussi un autel, un reliquaire, une réserve abandonnée, une salle au trésor, un mécanisme de récompense…",
  porte: "Tout passage qui bloque ou filtre : une porte, mais aussi un seuil, une barrière, une frontière, un rituel d'entrée, un obstacle à franchir…",
  gardien: "Tout ce qui s'oppose activement : un monstre, un groupe hostile, une créature, une entité, un piège vivant, ou tout autre obstacle vivant…",
  passage: "Tout trajet risqué à traverser : un pont ou un couloir, mais aussi un gouffre, une zone instable, un lieu qu'il faut simplement réussir à franchir…",
  rencontre: "Tout être qu'on croise : un voyageur, mais aussi un prisonnier, une faction, un étrange personnage, une créature intelligente…",
  traces: "Tout indice d'un événement passé : un cadavre, mais aussi des marques, des objets abandonnés, des signes qu'on interprète…",
  decouverte: "Tout objet ou lieu à examiner : une statue, mais aussi un livre, un bibelot, un mécanisme, une ruine, quelque chose qu'on trouve et qu'on regarde de plus près…",
};
const RISK_LABEL: Record<string, string> = { faible: "Faible", moyen: "Moyen", eleve: "Élevé" };
const RISK_COLOR: Record<string, string> = { faible: "text-emerald-400", moyen: "text-amber-400", eleve: "text-red-400" };
const RISK_BORDER: Record<string, string> = { faible: "border-emerald-400/50", moyen: "border-amber-400/50", eleve: "border-red-400/50" };
const STATUS_LABEL: Record<string, string> = {
  drafting: "En écriture", pending_review: "En attente de modération", approved: "Validée — en jeu", rejected: "Refusée",
};

// Où en est la mise en scène du tirage : sealed = vient de payer, rien
// révélé ; type_revealed = premier temps fait ; risk_revealed = les deux
// contraintes connues, place à l'écriture.
type RevealStage = "sealed" | "type_revealed" | "risk_revealed";

function EcrireRencontrePage() {
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [guildGold, setGuildGold] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [revealStage, setRevealStage] = useState<RevealStage>("sealed");
  const [situation, setSituation] = useState("");
  const [success, setSuccess] = useState("");
  const [failure, setFailure] = useState("");

  const [myEvents, setMyEvents] = useState<MyEvent[]>([]);

  const loadMyEvents = useCallback(async (characterId: string) => {
    const { data } = await supabase
      .from("community_events" as any)
      .select("id, event_type, risk_level, status, situation_text, created_at")
      .eq("character_id", characterId)
      .order("created_at", { ascending: false })
      .limit(20);
    setMyEvents((data as any) ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate({ to: "/" }); return; }
      const { data: char } = await supabase
        .from("characters")
        .select("id, name, guild_id")
        .eq("profile_id", session.user.id)
        .eq("is_alive", true)
        .eq("is_bot", false)
        .maybeSingle();
      if (!char?.guild_id) { navigate({ to: "/" }); return; }
      setCharacter(char as any);
      const { data: guild } = await supabase.from("guilds").select("gold").eq("id", char.guild_id).maybeSingle();
      setGuildGold(guild?.gold ?? 0);
      const { data: prices } = await supabase.from("app_settings" as any).select("value").eq("key", "prices").maybeSingle();
      setCost((prices as any)?.value?.community_event_cost ?? 300);
      await loadMyEvents(char.id);
      setLoading(false);
    })();
  }, [navigate, loadMyEvents]);

  async function payAndRoll() {
    if (!character) return;
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc("start_community_event" as any, {
      p_character_id: character.id, p_guild_id: character.guild_id,
    });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    setDraft(data as any);
    setRevealStage("sealed");
    setGuildGold(g => (g ?? 0) - (cost ?? 0));
    setBusy(false);
  }

  async function submitText() {
    if (!draft) return;
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc("submit_community_event_text" as any, {
      p_event_id: draft.id, p_situation: situation, p_success: success, p_failure: failure,
    });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    setDraft(data as any);
    setSituation(""); setSuccess(""); setFailure("");
    if (character) await loadMyEvents(character.id);
    setBusy(false);
  }

  if (loading) return <LedgerPage><LedgerCard title="Chroniqueur">Un instant…</LedgerCard></LedgerPage>;

  return (
    <LedgerPage bg="/register_book.webp">
      <style>{`
        @keyframes ce-pop { 0% { opacity: 0; transform: scale(0.7); } 100% { opacity: 1; transform: scale(1); } }
        .ce-pop { animation: ce-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3); }
      `}</style>
      <LedgerCard title="Investir une page de Donjon" subtitle="Paie, découvre ce que le sort t'impose, puis écris avec.">
        <LedgerError message={error} />

        <p className="text-xs text-muted-foreground mb-4">
          Trésor de guilde : <span className="text-amber-400 font-mono">{Math.round(guildGold ?? 0)} or</span>
          {cost !== null && <> · coût du tirage : <span className="text-amber-400 font-mono">{cost} or</span></>}
        </p>

        {!draft || draft.status === "rejected" ? (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              Une fois validée, ta page rejoint le donjon commun. Toi et ta guilde touchez un peu d'or à chaque fois qu'un
              groupe tombe dessus — et davantage encore si c'est une guilde différente de la tienne qui la traverse.
            </p>
            <ImmersiveButton variant="clair" onClick={payAndRoll} disabled={busy || (cost !== null && (guildGold ?? 0) < cost)}>
              {busy ? "…" : `Payer ${cost ?? "…"} or et tenter le tirage`}
            </ImmersiveButton>
            {cost !== null && (guildGold ?? 0) < cost && (
              <p className="text-xs text-red-400 mt-2">La guilde n'a pas assez d'or pour ça pour l'instant.</p>
            )}
          </>
        ) : draft.status === "drafting" ? (
          <>
            {/* ============ Mise en scène du tirage, en deux temps, sur le
                registre de la guilde. ============ */}
            <div
              className="relative overflow-hidden px-6 py-8 mb-5 text-center rounded-sm"
              style={{ backgroundImage: "url(/panel_narrative.webp)", backgroundSize: "cover", backgroundPosition: "center" }}
            >
              <div className="absolute inset-0 bg-black/25" />
              <div className="relative">
                {revealStage === "sealed" && (
                  <div className="ce-pop">
                    <p className="text-sm text-[#2a1a0a] mb-5 font-semibold" style={{ textShadow: "0 1px 2px rgba(255,255,255,0.5)" }}>
                      Le registre attend d'être ouvert.
                    </p>
                    <ImmersiveButton variant="clair" onClick={() => setRevealStage("type_revealed")}>
                      Tourner la page
                    </ImmersiveButton>
                  </div>
                )}
                {revealStage === "type_revealed" && (
                  <div className="ce-pop">
                    <img src={EVENT_TYPE_ICON[draft.event_type]} alt="" className="h-14 w-14 object-contain mx-auto mb-2" />
                    <p className="text-xl font-serif text-[#2a1a0a] mb-3 font-semibold" style={{ textShadow: "0 1px 2px rgba(255,255,255,0.5)" }}>{EVENT_TYPE_LABEL[draft.event_type]}</p>
                    <p className="text-xs text-[#3a2a18] max-w-md mx-auto mb-4">{EVENT_TYPE_GUIDE[draft.event_type]}</p>
                    <ImmersiveButton variant="clair" onClick={() => setRevealStage("risk_revealed")}>
                      Révéler le niveau de risque
                    </ImmersiveButton>
                  </div>
                )}
                {revealStage === "risk_revealed" && (
                  <div className="ce-pop">
                    <img src={EVENT_TYPE_ICON[draft.event_type]} alt="" className="h-10 w-10 object-contain mx-auto mb-2 opacity-90" />
                    <p className="text-sm text-[#3a2a18] mb-1">{EVENT_TYPE_LABEL[draft.event_type]}</p>
                    <p className={`inline-block border ${RISK_BORDER[draft.risk_level]} px-3 py-1 text-lg font-serif mb-4 ${RISK_COLOR[draft.risk_level]}`}>
                      ⚠ Risque {RISK_LABEL[draft.risk_level]}
                    </p>
                    <p className="text-sm text-[#3a2a18] max-w-md mx-auto">
                      Tu viens de tirer les contraintes de ton événement. À toi maintenant d'imaginer une situation originale
                      qui respecte ce type et ce niveau de danger. Ton événement sera envoyé en modération avant d'intégrer le jeu.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {revealStage === "risk_revealed" && (
              <>
                <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Écris ta scène</p>
                <label className="block text-[10px] text-muted-foreground mb-1">Situation — ce que le groupe découvre</label>
                <textarea value={situation} onChange={e => setSituation(e.target.value)} rows={3} maxLength={400}
                  placeholder="Ex : Un coffre couvert de chaînes repose au centre d'un cercle de cendres fraîches."
                  className="w-full bg-transparent border border-border/40 px-2 py-1.5 text-sm mb-3 focus:outline-none focus:border-primary/40" />
                <label className="block text-[10px] text-emerald-400/80 mb-1">Réussite — ce qui se passe si ça se passe bien</label>
                <textarea value={success} onChange={e => setSuccess(e.target.value)} rows={3} maxLength={400}
                  className="w-full bg-transparent border border-emerald-400/30 px-2 py-1.5 text-sm mb-3 focus:outline-none focus:border-emerald-400/60" />
                <label className="block text-[10px] text-red-400/80 mb-1">Échec — ce qui se passe si ça tourne mal</label>
                <textarea value={failure} onChange={e => setFailure(e.target.value)} rows={3} maxLength={400}
                  className="w-full bg-transparent border border-red-400/30 px-2 py-1.5 text-sm mb-4 focus:outline-none focus:border-red-400/60" />
                <ImmersiveButton variant="clair" onClick={submitText} disabled={busy || !situation.trim() || !success.trim() || !failure.trim()}>
                  {busy ? "…" : "Envoyer en modération"}
                </ImmersiveButton>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground mb-4">
            Ta rencontre est <span className="text-primary">{STATUS_LABEL[draft.status]}</span>. Tu peux en proposer une nouvelle ci-dessous.
          </p>
        )}

        {myEvents.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border/20">
            <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Mes rencontres</p>
            <ul className="space-y-1.5">
              {myEvents.map(e => (
                <li key={e.id} className="text-xs border border-border/30 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="truncate">
                    {EVENT_TYPE_LABEL[e.event_type] ?? e.event_type} · {RISK_LABEL[e.risk_level]}
                    {e.situation_text && <span className="text-muted-foreground/60"> — {e.situation_text.slice(0, 40)}…</span>}
                  </span>
                  <span className={`flex-shrink-0 ${e.status === "approved" ? "text-emerald-400" : e.status === "rejected" ? "text-red-400" : "text-muted-foreground"}`}>
                    {STATUS_LABEL[e.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <TextLink onClick={() => navigate({ to: "/" })}>Retour à la guilde</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}
