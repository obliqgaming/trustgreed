import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMaxHp } from "@/lib/titles";
import { Heart } from "lucide-react";
import { LedgerCard, LedgerError, LedgerPage, TextLink } from "@/components/ledger";
import { PortraitDisplay } from "@/components/portraits";
import { unlockAudio, soundVoteContinuer, soundVoteRentrer, soundVoteEnregistre, soundAllVoted, soundRevealClick, soundSurvived, soundMortMembre, soundMaMort, soundRetourVictoire, soundRetourWipe, soundTensionPulse, soundTap } from "@/lib/sounds";
import { VocationBadge, vocationLabel, type VocationId } from "@/components/vocations";
import { Frame, DecorativeBorder } from "@/components/frame";
import { ImmersiveButton, FramedBox } from "@/components/immersive";

export const Route = createFileRoute("/vote")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    expedition: String(search.expedition ?? ""),
  }),
  component: VotePage,
});

type Character = { id: string; name: string; guild_id?: string | null; hp?: number; level?: number };
type Step = {
  id: string; step_number: number; event_type: string; risk_level: string;
  loot_min: number; loot_max: number; vote_deadline: string;
  resolved: boolean; deaths_count: number; description: string | null; risk_revealed: boolean;
  resolving: boolean; resolution_deadline: string | null; was_retreat: boolean;
  resolved_at: string | null;
  third_option_kind: string | null; third_option_label: string | null;
  third_option_loot_min: number | null; third_option_loot_max: number | null; third_option_cost: number | null;
  resolution_type: string | null; required_vocation: string | null;
  required_flag_sentiment: string | null; required_flag: string | null;
  situation_success_text: string | null; situation_failure_text: string | null;
  death_percentage: number; third_option_death_pct: number | null;
};
type Participant = { character_id: string; is_alive: boolean; character: { name: string; portrait: string; declared_vocation: string | null; is_bot?: boolean; hp?: number; level?: number } };
type Result = { deaths: number; loot: number; ended: boolean; deadNames: string[]; cinematic: string; iDied: boolean; stepLoot: number; totalSoFar: number; xpAwarded: number; survivorNames: string[]; resolutionType: string | null; damageLog: { name: string; damage: number }[]; frontlineNarrative: string | null; eventType: string };

// Icônes de type d'étape à côté du titre — un sous-ensemble a une icône
// dédiée (fournie), les autres réutilisent l'icône la plus proche
// thématiquement (porte/passage → porte, traces → loupe) plutôt que de
// rester sans repère visuel.
const EVENT_TYPE_ICON: Record<string, string> = {
  coffre: "/icons/chest.webp",
  gardien: "/icons/shield_swords.webp",
  marchand: "/icons/market_stall.webp",
  rencontre: "/icons/hooded_group.webp",
  decouverte: "/icons/gem.webp",
  porte: "/icons/door.webp",
  passage: "/icons/door.webp",
  traces: "/icons/magnifier.webp",
};
const RISK_LABEL: Record<string, string> = { faible: "Faible", moyen: "Moyen", eleve: "Élevé" };

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}min` : `${hours}h`;
}
const EVENT_IMAGES: Record<string, string[]> = {
  coffre: ["/event_coffre.webp"],
  porte: ["/event_porte.webp"],
  gardien: ["/event_gardien.webp"],
  passage: ["/event_passage.webp"],
  rencontre: ["/event_rencontre.webp", "/event_rencontre_bis.webp"],
  decouverte: ["/event_decouverte.webp"],
  traces: ["/event_traces.webp"],
  marchand: ["/event_marchand.webp", "/event_marchand_bis.webp"],
};
// Variantes supplémentaires selon le palier de risque — s'ajoutent au pool
// ci-dessus, ne le remplacent jamais.
const EVENT_IMAGES_BY_RISK: Partial<Record<string, Partial<Record<string, string>>>> = {
  coffre: { faible: "/event_coffre_faible.webp", moyen: "/event_coffre_moyen.webp", eleve: "/event_coffre_eleve.webp" },
  gardien: { faible: "/event_gardien_faible.webp", moyen: "/event_gardien_moyen.webp", eleve: "/event_gardien_eleve.webp" },
  porte: { faible: "/event_porte_faible.webp", moyen: "/event_porte_moyen.webp", eleve: "/event_porte_eleve.webp" },
  passage: { faible: "/event_passage_faible.webp", moyen: "/event_passage_moyen.webp", eleve: "/event_passage_eleve.webp" },
};
// Callbacks avec une image dédiée plutôt que le pool générique de leur type.
const CALLBACK_IMAGES: Record<string, string> = {
  objet_maudit: "/callback_objet_maudit.webp",
  chest_undisturbed: "/callback_chest_undisturbed.webp",
  pillaged_npc: "/callback_pillaged_npc.webp",
  equipement_perdu: "/callback_equipement_perdu.webp",
  martyr_legende: "/callback_martyr_legende.webp",
  traitre_vendu: "/callback_traitre_vendu.webp",
};
function pickEventBg(step: { id: string; event_type: string; risk_level: string; required_flag?: string | null }): string {
  const callbackImg = step.required_flag ? CALLBACK_IMAGES[step.required_flag] : undefined;
  if (callbackImg) return callbackImg;
  // L'image spécifique au palier de risque, quand elle existe, doit
  // toujours s'afficher — jamais mélangée dans le même pool que les images
  // génériques du type. Avant ce correctif, elle n'était qu'une candidate
  // parmi d'autres dans un tirage par hash sur l'id de l'étape : pour les
  // types avec un seul visuel générique + un visuel de risque (coffre,
  // gardien, porte, passage), c'était un vrai tirage à pile ou face,
  // indépendant du risque réellement affiché au joueur ("Risque Élevé" à
  // l'écran, mais l'image neutre affichée une fois sur deux, ou l'inverse).
  const riskVariant = EVENT_IMAGES_BY_RISK[step.event_type]?.[step.risk_level];
  if (riskVariant) return riskVariant;
  // Sinon (type sans variante de risque dédiée), tirage par hash dans le
  // pool générique du type, comme avant — là, la variété n'a pas besoin
  // d'être ancrée sur quoi que ce soit.
  const pool = EVENT_IMAGES[step.event_type] ?? [];
  if (pool.length === 0) return "";
  const idx = step.id.charCodeAt(0) % pool.length;
  return pool[idx] ?? pool[0] ?? "";
}
// Version de eventBg déjà fondue dans la texture du parchemin (traitement
// fait une fois pour toutes en amont : éclaircie, désaturée, teintée sépia,
// fusionnée en multiply à 62%, bords adoucis) — jamais un mix-blend-mode
// live, qui ne peut pas reproduire ce résultat. Même nom de fichier avec le
// préfixe "parchment_", un seul point à maintenir si de nouvelles
// illustrations sont ajoutées : relancer le même traitement sur le nouveau
// fichier et le déposer sous ce même nom préfixé.
function pickParchmentBg(step: { id: string; event_type: string; risk_level: string; required_flag?: string | null }): string | null {
  const bg = pickEventBg(step);
  if (!bg) return null;
  const slash = bg.lastIndexOf("/");
  return bg.slice(0, slash + 1) + "parchment_" + bg.slice(slash + 1);
}
const STEP_RESULT_SUCCESS = "/step_success.png.webp";
const STEP_RESULT_FAIL = "/step_fail.webp";
const DEATH_SCREEN = "/death_screen.webp";
const RETURN_SUCCESS_IMGS = ["/return_success.webp", "/rentrer_safe.webp"];
const RETURN_WIPE = "/return_wipe.webp";
const CINEMATIC_TPK_IMG = "/cinematic_wipe.webp";
const CINEMATIC_DEATH_IMGS = ["/step_fail.webp", "/cinematic_death_bis.webp"]; // fallback générique quand le event_type n'a pas d'image d'échec dédiée
// Image d'échec spécifique par type d'événement — un mort après un coffre
// piégé n'a plus le même visuel qu'un mort après un gardien. S'ajoute au
// pool générique ci-dessus plutôt que de le remplacer, pour les types qui
// n'ont pas encore d'image dédiée.
const EVENT_ECHEC_IMAGES: Partial<Record<string, string[]>> = {
  coffre: ["/coffre_echec.webp"],
  gardien: ["/gardien_echec.webp"],
  porte: ["/porte_echec.webp"],
  passage: ["/passage_echec.webp"],
  rencontre: ["/rencontre_echec.webp"],
  traces: ["/traces_echec_v1.webp", "/traces_echec_v2.webp"],
  marchand: ["/marchand_echec_v1.webp"],
  decouverte: ["/decouverte_echec.webp"],
};
const CINEMATIC_SURVIVE_IMGS = ["/cinematic_survive.webp", "/cinematic_survive_bis.webp"];
// Symétrique de EVENT_ECHEC_IMAGES côté réussite — une réussite de coffre
// (couvercle ouvert, or qui déborde) n'a rien à voir avec une réussite de
// passage (l'autre bord atteint). S'ajoute au pool générique existant
// (eventBg + STEP_RESULT_SUCCESS + CINEMATIC_SURVIVE_IMGS), ne le remplace
// pas, pour ne rien retirer de la variété déjà en place.
const EVENT_REUSSITE_IMAGES: Partial<Record<string, string[]>> = {
  coffre: ["/coffre_reussite_v1.webp", "/coffre_reussite_v2.webp"],
  decouverte: ["/decouverte_reussite_v1.webp", "/decouverte_reussite_v2.webp"],
  gardien: ["/gardien_reussite.webp"],
  marchand: ["/marchand_reussite.webp"],
  passage: ["/passage_reussite.webp"],
  porte: ["/porte_reussite.webp"],
  rencontre: ["/rencontre_reussite.webp"],
  traces: ["/traces_reussite.webp"],
};
const PILLAGE_SUCCESS_IMG = "/pillage_reussi.webp";
const PILLAGE_FAIL_IMG = "/pillage_echoue.webp";
const MARCHAND_ACHETE_IMGS = ["/marchand_protection_achetee.webp", "/marchand_protection_achetee_bis.webp"];
const MARCHAND_REFUSE_IMG = "/marchand_protection_refusee.webp";
// Bouclier de groupe : une icône par rareté (bois fissuré/léger, blason
// métal-tissu/moyen, plaque cloutée/lourd), utilisée dans le pop-up de
// vote et l'indicateur du porteur.
const SHIELD_ICON: Record<"leger" | "moyen" | "lourd", string> = {
  leger: "/shield_leger.webp",
  moyen: "/shield_moyen.webp",
  lourd: "/shield_lourd.webp",
};
const RISK_COLOR: Record<string, string> = { faible: "text-emerald-400", moyen: "text-amber-400", eleve: "text-red-400" };

const CINEMATICS: Record<string, { survive: string[]; die: string[] }> = {
  coffre: {
    survive: ["Le couvercle cède dans un grincement sourd. Ce qui brille à l'intérieur vaut le risque pris.", "Vos mains tremblent en fouillant le contenu. Vous repartez plus riches.", "Le coffre s'ouvre. Personne ne parle. On compte, on prend, on avance."],
    die: ["Le piège se déclenche avant que quiconque ait pu réagir.", "Le coffre était piégé. Quelqu'un l'a appris trop tard.", "Un mécanisme invisible. Une fraction de seconde. Trop tard."],
  },
  gardien: {
    survive: ["Le combat est court. Brutal. Le groupe continue, essoufflé.", "Il tombe. Vous passez. On ne regarde pas en arrière.", "Il n'était pas seul : ses gardes tombent aussi. Vous repartez quand même."],
    die: ["Le gardien était plus rapide qu'il n'en avait l'air.", "La formation s'effondre. L'un d'eux ne se relève pas.", "Il n'a fallu qu'une ouverture. Une seule."],
  },
  passage: {
    survive: ["Le passage est étroit, instable. Vous traversez. Tous.", "Le vide en dessous. Les mains qui s'agrippent. Ça tient.", "De l'autre côté, enfin. Le groupe reprend son souffle.", "Un pas après l'autre, sans un mot. Personne ne regarde en bas.", "Le sol tient bon, contre toute attente. Vous êtes déjà loin quand vous osez y repenser."],
    die: ["Une planche cède. Un cri. Puis le silence.", "Le passage ne tenait qu'à un fil. Ce fil a rompu.", "On n'entend rien après la chute. On continue.", "Le sol s'est dérobé sans prévenir. Trop tard pour rattraper qui que ce soit."],
  },
  porte: {
    survive: ["La porte s'ouvre. Ce qu'il y a derrière valait le détour.", "Le verrou cède après une lutte. Derrière, rien qui ne bouge plus.", "On passe. La porte se referme derrière. On ne reviendra pas."],
    die: ["Ce qui était derrière la porte n'attendait que ça.", "La porte s'est ouverte. Elle n'aurait pas dû.", "On pensait savoir. On avait tort."],
  },
  marchand: {
    survive: ["Le marchand plie boutique aussi vite qu'il l'avait montée. L'échange s'est fait sans encombre.", "Quelques mots, un prix juste. Le marchand disparaît déjà dans l'ombre du couloir.", "Rien à redire sur cette rencontre. Le groupe reprend sa route, un peu plus léger en bourse."],
    die: ["Le marchand n'en était pas un : des brigands l'utilisaient comme appât. Le groupe l'apprend à ses dépens.", "L'échange tourne mal. Des lames sortent de l'ombre avant que quiconque comprenne pourquoi.", "Le marchand recule d'un pas et siffle. Ses complices n'attendaient que ça."],
  },
  rencontre: {
    survive: ["L'inconnu s'efface, vous laisse passer. Personne ne baisse sa garde pour autant.", "On échange peu de mots. Ça suffit. Chacun repart de son côté.", "La rencontre se termine sans heurt. Un soulagement qu'on n'ose pas montrer."],
    die: ["La main tendue cachait autre chose. On ne l'a vu qu'une fois trop tard.", "Ce qui semblait amical ne l'était pas. Le groupe l'apprend à ses dépens.", "La confiance, ici, était le vrai piège."],
  },
  decouverte: {
    survive: ["L'objet rejoint le sac. Rien ne s'est réveillé en le prenant.", "On l'examine, on l'empoche. Le silence retombe, intact.", "Ce qui a été trouvé valait la halte."],
    die: ["L'objet n'était pas aussi inerte qu'il en avait l'air.", "Une dernière protection veillait encore sur la trouvaille.", "Ce qu'on a dérangé en le touchant ne l'était plus."],
  },
  traces: {
    survive: ["Le groupe ne comprend pas ce qui s'est passé ici, et avance quand même.", "On ne s'attarde pas sur ce qu'on devine. On continue.", "Les traces racontent une histoire. Ce n'est pas la vôtre. Pas encore."],
    die: ["Ce qui a laissé ces traces n'était pas parti bien loin.", "L'histoire que racontaient les traces vient de rattraper le groupe.", "Ceux qui étaient passés avant n'avaient pas eu de chance non plus. Vous non plus."],
  },
};

const lastCinematicIndex: Record<string, number> = {};
function getCinematic(eventType: string, hasDeath: boolean): string {
  const options = CINEMATICS[eventType] ?? CINEMATICS.passage;
  const pool = hasDeath ? options.die : options.survive;
  const key = `${eventType}:${hasDeath}`;
  let idx = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && idx === lastCinematicIndex[key]) {
    idx = (idx + 1) % pool.length;
  }
  lastCinematicIndex[key] = idx;
  return pool[idx];
}

function VotePage() {
  const navigate = useNavigate();
  const { expedition: expeditionId } = useSearch({ from: "/vote" });

  const [character, setCharacter] = useState<Character | null>(null);
  const [myDeathScreen, setMyDeathScreen] = useState(false);
  const [myDeathInheritance, setMyDeathInheritance] = useState<number>(0);
  const [myDeathDetails, setMyDeathDetails] = useState<{ level: number; goldLost: number; highestStep: number | null; damageTaken: number } | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [runningTotals, setRunningTotals] = useState<{ guildGold: number; xp: number } | null>(null);
  const [myGoldAdjustment, setMyGoldAdjustment] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const aliveParticipants = participants.filter(p => p.is_alive);
  const [votedIds, setVotedIds] = useState<string[]>([]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  // Mode de l'expédition — récupéré une fois au chargement (voir plus bas)
  // pour savoir si on affiche un compte à rebours (synchrone) ou un simple
  // décompte de qui a agi (asynchrone, aucune limite de temps).
  const [isAsync, setIsAsync] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [acked, setAcked] = useState(false);
  const [ackCount, setAckCount] = useState<{ done: number; total: number } | null>(null);
  const [interventionsRemaining, setInterventionsRemaining] = useState<number | null>(null);
  const [myIntervened, setMyIntervened] = useState(false);
  const [mySearched, setMySearched] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResult, setSearchResult] = useState<{ found: boolean; name?: string; flavor_text?: string } | null>(null);
  const [intervenerNames, setIntervenerNames] = useState<string[]>([]);
  const [allInterventionUsers, setAllInterventionUsers] = useState<{ name: string; action: string }[]>([]);
  const [interventionBusy, setInterventionBusy] = useState(false);
  const [gaugeWobble, setGaugeWobble] = useState(50);
  const [revealingOutcome, setRevealingOutcome] = useState(false);
  const [verdictPending, setVerdictPending] = useState(false);
  // Déterministe à partir de l'id de l'étape (pas Math.random()) : tout le
  // groupe doit voir exactement la même image de résultat, pas une par client.
  const finalizeAttemptedRef = useRef(false);
  const [myVocation, setMyVocation] = useState<VocationId | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [botBusy, setBotBusy] = useState<string | null>(null);
  const [debugCopied, setDebugCopied] = useState(false);
  const [usedAbilities, setUsedAbilities] = useState<Set<string>>(new Set());
  const [visibleRisk, setVisibleRisk] = useState<number | null>(null);
  const [myPrivateRisk, setMyPrivateRisk] = useState<number | null>(null);
  const [hasRiskReserveEffect, setHasRiskReserveEffect] = useState(false);
  const [hasPotion, setHasPotion] = useState(false);
  const [skipTally, setSkipTally] = useState<{ mine: boolean; count: number; total: number } | null>(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [myDrunk, setMyDrunk] = useState(false);
  const [drinkBusy, setDrinkBusy] = useState(false);
  const [drinkResult, setDrinkResult] = useState<number | null>(null);
  const [frontlineTally, setFrontlineTally] = useState<Record<string, number>>({});
  const [myFrontlineTarget, setMyFrontlineTarget] = useState<string | null>(null);
  // Bouclier de groupe : loot rare, attribué par vote séparé (voir
  // fetchShield / vote_shield / resolve_shield_vote).
  const [shield, setShield] = useState<{
    id: string; rarity: "leger" | "moyen" | "lourd"; reduction: number; duration_steps: number;
    vote_deadline: string; resolved: boolean; holder_character_id: string | null;
    steps_remaining: number | null; broken_reason: string | null;
  } | null>(null);
  const [shieldTally, setShieldTally] = useState<Record<string, number>>({});
  const [myShieldTarget, setMyShieldTarget] = useState<string | null>(null);
  const [shieldBusy, setShieldBusy] = useState(false);
  const dismissedShieldIdRef = useRef<string | null>(null);
  const [shieldNotice, setShieldNotice] = useState<string | null>(null);
  const [vocationBusy, setVocationBusy] = useState<string | null>(null);
  const [vocationError, setVocationError] = useState<string | null>(null);
  const [inspectTarget, setInspectTarget] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<{ id: string; honest: boolean } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tensionRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { unlockAudio(); return () => { if (tensionRef.current) clearInterval(tensionRef.current); }; }, []);
  const characterIdRef = useRef<string | null>(null);
  const stepIdRef = useRef<string | null>(null);
  const resultShownRef = useRef(false);

  // Bouclier de groupe : détecte la transition vers un état final (gagné,
  // cassé par égalité, expiré, ou perdu avec son porteur) et affiche un
  // texte narratif court une seule fois par bouclier, puis se dissipe seul.
  useEffect(() => {
    if (!shield || dismissedShieldIdRef.current === shield.id) return;
    let text: string | null = null;
    if (shield.resolved && shield.holder_character_id && shield.steps_remaining === shield.duration_steps) {
      const name = participants.find(p => p.character_id === shield.holder_character_id)?.character?.name ?? "Quelqu'un";
      text = `${name} remporte le bouclier ${shield.rarity}.`;
    } else if (shield.broken_reason === "egalite") {
      text = "Le vote était trop partagé : le bouclier se brise, personne ne le porte.";
    } else if (shield.broken_reason === "porteur_mort") {
      text = "Le porteur du bouclier est tombé : il se brise avec lui.";
    } else if (shield.broken_reason === "expire") {
      text = shield.rarity === "leger" ? "Le bouclier léger se désagrège."
        : shield.rarity === "moyen" ? "Le bouclier moyen se casse."
        : "Le bouclier lourd, trop encombrant, épuise son porteur qui finit par le laisser tomber.";
    }
    if (text) {
      dismissedShieldIdRef.current = shield.id;
      setShieldNotice(text);
      const t = setTimeout(() => setShieldNotice(null), 6000);
      return () => clearTimeout(t);
    }
  }, [shield, participants]);

  // Déterministe à partir de l'id de l'étape (pas Math.random()) : tout le
  // groupe doit voir exactement la même image de résultat, pas une par client.
  function hashToUnit(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return (h >>> 0) / 4294967295;
  }
  const resultImageVariant = useMemo(() => hashToUnit(stepIdRef.current ?? ""), [result]);


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
      .select("id, name, portrait, is_alive, declared_vocation, is_bot, hp, level")
      .in("id", ids);

    const enriched = (chars ?? []).map((c: any) => ({
      character_id: c.id,
      is_alive: c.is_alive,
      character: { name: c.name, portrait: c.portrait ?? "ombre", declared_vocation: c.declared_vocation ?? null, is_bot: c.is_bot ?? false, hp: c.hp, level: c.level },
    }));
    setParticipants(enriched);
    return enriched;
  }, [expeditionId]);

  const fetchDeathDetails = useCallback(async (charId: string) => {
    const { data: charRow } = await supabase
      .from("characters")
      .select("level, gold_lost_at_death, died_in_step_id, died_in_step:expedition_steps(step_number)")
      .eq("id", charId).maybeSingle();
    if (!charRow) return;
    const highestStep = (charRow as any).died_in_step?.step_number ?? null;
    let damageTaken = 0;
    if ((charRow as any).died_in_step_id) {
      const { data: dmgRow } = await supabase
        .from("step_damage_log").select("damage").eq("step_id", (charRow as any).died_in_step_id).eq("character_id", charId).maybeSingle();
      damageTaken = (dmgRow as any)?.damage ?? 0;
    }
    setMyDeathDetails({
      level: (charRow as any).level ?? 1,
      goldLost: Math.round((charRow as any).gold_lost_at_death ?? 0),
      highestStep,
      damageTaken,
    });
  }, []);

  const fetchFrontlineVotes = useCallback(async (stepId: string) => {
    const { data } = await supabase.from("step_frontline_votes").select("voter_character_id, target_character_id").eq("step_id", stepId);
    const tally: Record<string, number> = {};
    let mine: string | null = null;
    for (const row of (data as any[]) ?? []) {
      tally[row.target_character_id] = (tally[row.target_character_id] ?? 0) + 1;
      if (characterIdRef.current && row.voter_character_id === characterIdRef.current) mine = row.target_character_id;
    }
    setFrontlineTally(tally);
    setMyFrontlineTarget(mine);
  }, []);

  async function voteFrontline(targetId: string) {
    if (!step || !character) return;
    const next = myFrontlineTarget === targetId ? null : targetId;
    setMyFrontlineTarget(next); // optimiste
    const { error: rpcError } = await supabase.rpc("vote_frontline" as any, {
      p_step_id: step.id, p_voter_character_id: character.id, p_target_character_id: next,
    });
    if (rpcError) setError(rpcError.message);
    await fetchFrontlineVotes(step.id);
  }

  // Bouclier de groupe : récupère le bouclier actif de l'expédition (en
  // vote ou porté), son décompte de votes, et déclenche resolve_shield_vote
  // si la fenêtre est écoulée — même pattern best-effort que fetchStep
  // pour la résolution des étapes (course normale entre clients, un seul
  // réussit vraiment).
  const fetchShieldVotes = useCallback(async (shieldId: string) => {
    const { data } = await supabase.from("step_shield_votes").select("voter_character_id, target_character_id").eq("shield_id", shieldId);
    const tally: Record<string, number> = {};
    let mine: string | null = null;
    for (const row of (data as any[]) ?? []) {
      tally[row.target_character_id] = (tally[row.target_character_id] ?? 0) + 1;
      if (characterIdRef.current && row.voter_character_id === characterIdRef.current) mine = row.target_character_id;
    }
    setShieldTally(tally);
    setMyShieldTarget(mine);
  }, []);

  const fetchShield = useCallback(async () => {
    const { data } = await supabase
      .from("expedition_shields")
      .select("id, rarity, reduction, duration_steps, vote_deadline, resolved, holder_character_id, steps_remaining, broken_reason")
      .eq("expedition_id", expeditionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = data as any;
    setShield(row ?? null);
    if (!row) return;

    if (!row.resolved) {
      await fetchShieldVotes(row.id);
      const deadlinePassed = new Date(row.vote_deadline) <= new Date();
      if (deadlinePassed) {
        await supabase.rpc("resolve_shield_vote" as any, { p_shield_id: row.id });
        // Pas de garde ici : même principe que finalize_resolution plus haut
        // (course normale entre clients, la fonction est idempotente côté
        // serveur — elle renvoie sans effet si déjà résolue).
        const { data: fresh } = await supabase
          .from("expedition_shields")
          .select("id, rarity, reduction, duration_steps, vote_deadline, resolved, holder_character_id, steps_remaining, broken_reason")
          .eq("id", row.id)
          .maybeSingle();
        if (fresh) setShield(fresh as any);
      }
    }
  }, [expeditionId, fetchShieldVotes]);

  async function voteShield(targetId: string) {
    if (!shield || !character) return;
    const next = myShieldTarget === targetId ? null : targetId;
    setMyShieldTarget(next); // optimiste
    setShieldBusy(true);
    const { error: rpcError } = await supabase.rpc("vote_shield" as any, {
      p_shield_id: shield.id, p_voter_character_id: character.id, p_target_character_id: next,
    });
    if (rpcError) setError(rpcError.message);
    await fetchShieldVotes(shield.id);
    setShieldBusy(false);
  }

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
      .select("id, step_number, event_type, risk_level, loot_min, loot_max, vote_deadline, resolved, deaths_count, description, risk_revealed, resolving, resolution_deadline, was_retreat, resolved_at, third_option_kind, third_option_label, third_option_loot_min, third_option_loot_max, third_option_cost, resolution_type, required_vocation, required_flag_sentiment, required_flag, death_percentage, third_option_death_pct, situation_success_text, situation_failure_text")
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
        setFrontlineTally({});
        setMyFrontlineTarget(null);
        setResult(null);
        setMyPrivateRisk(null);
        setAcked(false);
        setAckCount(null);
        resultShownRef.current = false;
        setInterventionsRemaining(null);
        setMyIntervened(false);
        setMySearched(false);
        setSearchResult(null);
        setMyDrunk(false);
        setDrinkResult(null);
        setSkipTally(null);
        setGaugeWobble(50);
      } else {
        stepIdRef.current = data.id;
      }
      setStep(data);

      // Priorité absolue : si l'étape vient d'être résolue, basculer vers l'animation
      // de révélation IMMÉDIATEMENT, avant tout autre appel réseau qui laisserait
      // passer un rendu intermédiaire (flash visible entre les deux écrans).
      // Un retour volontaire ("rentrer") ne passe jamais par la jauge.
      if (data.resolved && !resultShownRef.current) {
        resultShownRef.current = true;
        if (data.was_retreat) {
          await showStepResult(data.id, data.event_type, data.deaths_count, true);
          return;
        }
        // Le sort est déjà joué côté serveur (finalize_resolution a tourné),
        // mais on ne l'affiche pas tout de suite : on pose juste un drapeau
        // et le joueur déclenche lui-même la révélation d'un clic — plus
        // épique qu'une jauge qui s'anime toute seule dès que le calcul est
        // prêt, et ça laisse le temps de lire le chat avant le verdict.
        setVerdictPending(true);
        return;
      }

      await fetchVotes(data.id);
      await fetchFrontlineVotes(data.id);

      if (data.risk_revealed) {
        const { data: risk } = await supabase.rpc("get_visible_risk", { p_step_id: data.id });
        setVisibleRisk(risk as number | null);
      } else {
        setVisibleRisk(null);
      }

      // Filet de sécurité : si le groupe reste bloqué sans que tout le monde
      // ait cliqué "Continuer", force le passage à la suite après 90s.
      // Ce check tourne à chaque poll (même après le premier affichage du
      // résultat), tant qu'il reste au moins un client avec l'onglet ouvert.
      // Utilise characterIdRef (pas character) pour éviter toute fermeture figée.
      if (data.resolved && data.resolved_at && characterIdRef.current) {
        const elapsedMs = Date.now() - new Date(data.resolved_at).getTime();
        if (elapsedMs >= 90000) {
          await supabase.rpc("acknowledge_step_result", { p_step_id: data.id, p_character_id: characterIdRef.current });
        }
      }

      // Si la fenêtre d'intervention est écoulée, quelqu'un doit déclencher le vrai jet.
      // Ou si tout le monde vivant a voté "Passer" : on accélère avant le délai.
      // Best-effort : en cas de course entre plusieurs clients, un seul réussit vraiment,
      // les autres échouent silencieusement et récupèrent le résultat au prochain poll.
      if (data.resolving && !data.resolved && data.resolution_deadline) {
        const deadlinePassed = new Date(data.resolution_deadline) <= new Date();
        let shouldFinalize = deadlinePassed;
        if (!shouldFinalize) {
          const { data: aliveRows } = await supabase
            .from("expedition_participants")
            .select("character_id, characters!inner(is_alive)")
            .eq("expedition_id", expeditionId);
          const aliveIds = ((aliveRows as any[]) ?? []).filter((r) => r.characters?.is_alive).map((r) => r.character_id);
          if (aliveIds.length > 0) {
            const { data: skipRows } = await supabase.from("step_skip_votes").select("character_id").eq("step_id", data.id);
            const skipIds = ((skipRows as any[]) ?? []).map((r) => r.character_id);
            shouldFinalize = aliveIds.every((id) => skipIds.includes(id));
          }
        }
        if (shouldFinalize) {
          await supabase.rpc("finalize_resolution", { p_step_id: data.id });
          // Pas de .catch() ici : supabase-js ne lève pas d'exception sur une RPC
          // en échec, elle renvoie juste { error } — qu'on ignore volontairement
          // (course normale entre plusieurs clients, un seul réussit vraiment).
        }
      }
    }
    return data;
  }, [expeditionId, fetchVotes]);

  // Poll central — vérifie mort + participants + votes + étape
  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      // Participants (avec statut vivant/mort)
      await fetchParticipants();
      // Étape + votes (la détection de mort personnelle est gérée dans showStepResult,
      // déclenché naturellement quand l'étape se résout)
      void fetchStep();
      // Bouclier de groupe (apparition, vote en cours, ou déjà porté)
      void fetchShield();
    }, 5000);
  }, [fetchStep, fetchParticipants, fetchShield]);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate({ to: "/" }); return; }

      const { data: char } = await supabase
        .from("characters").select("id, name, guild_id, is_alive, died_in_expedition_id, hp, level")
        .eq("profile_id", session.user.id).eq("is_bot", false)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!char) { navigate({ to: "/" }); return; }
      if (!char.is_alive) {
        setMyDeathScreen(char.died_in_expedition_id === expeditionId);
        if (char.died_in_expedition_id !== expeditionId) { navigate({ to: "/" }); return; }
        const { data: profileRow } = await supabase.from("profiles").select("banked_gold").eq("id", session.user.id).maybeSingle();
        setMyDeathInheritance(Math.round((profileRow as any)?.banked_gold ?? 0));
        void fetchDeathDetails(char.id);
        return;
      }
      setCharacter(char);
      characterIdRef.current = char.id;

      const { data: vocData } = await supabase.rpc("get_my_vocation", { p_character_id: char.id });
      setMyVocation((vocData as VocationId | null) ?? null);

      const { data: profileRow } = await supabase.from("profiles").select("is_admin").eq("id", session.user.id).maybeSingle();
      setIsAdmin(!!profileRow?.is_admin);

      const { data: usedData } = await supabase
        .from("vocation_triggers").select("ability")
        .eq("expedition_id", expeditionId).eq("character_id", char.id);
      setUsedAbilities(new Set((usedData ?? []).map((u: any) => u.ability)));

      // Vérifier participation
      const { data: partCheck } = await supabase
        .from("expedition_participants")
        .select("character_id").eq("expedition_id", expeditionId).eq("character_id", char.id).maybeSingle();
      if (!partCheck) { navigate({ to: "/" }); return; }

      await fetchParticipants();
      const { data: expData } = await supabase
        .from("expeditions").select("vote_window_seconds").eq("id", expeditionId).maybeSingle();
      setIsAsync(((expData as any)?.vote_window_seconds ?? 180) !== 180);
      let currentStep = await fetchStep();
      // Course possible : la page peut se monter une fraction de seconde
      // avant que generate_next_step (déclenché par "Lancer") n'ait fini
      // d'écrire l'étape 1. Deux relances rapprochées avant de retomber sur
      // le poll normal de 5s, plutôt que de laisser l'écran bloqué.
      if (!currentStep) {
        for (const delay of [800, 1600]) {
          await new Promise(r => setTimeout(r, delay));
          currentStep = await fetchStep();
          if (currentStep) break;
        }
      }
      if (currentStep) stepIdRef.current = currentStep.id;
      void fetchShield();
      setReady(true);
      startPoll();
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [expeditionId, navigate, fetchStep, fetchParticipants, fetchShield, startPoll]);

  // Minuteur — n'a de sens qu'en mode synchrone : en asynchrone, il n'y a
  // délibérément aucune échéance forcée (le serveur attend que tout le
  // monde ait voté, quel que soit le temps que ça prend — voir les
  // commentaires de begin_resolution/finalize_resolution). Avant, ce
  // minuteur tournait quand même en asynchrone, et si jamais vote_deadline
  // n'est pas une vraie sentinelle lointaine côté serveur pour ce mode, ça
  // désactivait aussitôt "Continuer"/"Rentrer" et déclenchait des tentatives
  // de résolution vouées à échouer ("la fenêtre de vote n'est pas encore
  // écoulée", en boucle sur "Réessayer").
  useEffect(() => {
    if (isAsync || !step?.vote_deadline || step.resolved) { setTimeLeft(null); return; }
    const deadline = new Date(step.vote_deadline).getTime();
    const tick = () => setTimeLeft(Math.max(0, Math.floor((deadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [step?.id, step?.vote_deadline, step?.resolved, isAsync]);

  async function castVote(vote: "continuer" | "rentrer" | "troisieme") {
    if (!step || !character || myVote) return;
    setError(null); setBusy(true);
    if (vote === "continuer") soundVoteContinuer(); else if (vote === "rentrer") soundVoteRentrer(); else soundVoteEnregistre();
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

  async function drinkPotion() {
    if (!step || !character) return;
    setError(null); setDrinkBusy(true);
    const { data, error: rpcError } = await supabase.rpc("drink_potion" as any, { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setError(rpcError.message);
    else {
      setMyDrunk(true);
      setDrinkResult(data as number);
      await refreshInterventionState();
    }
    setDrinkBusy(false);
  }

  async function useReveal() {
    if (!step || !character) return;
    setVocationError(null); setVocationBusy("reveal");
    const { data, error: rpcError } = await supabase.rpc("reveal_risk", { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setVocationError(rpcError.message);
    else {
      if (myVocation === "Eclaireur") setUsedAbilities(prev => new Set(prev).add("eclaireur_reveal"));
      setMyPrivateRisk(data as number);
      void refreshRiskReserveEffect();
    }
    setVocationBusy(null);
  }

  const refreshRiskReserveEffect = useCallback(async () => {
    if (!character) return;
    const { data } = await supabase
      .from("character_reserve_effects")
      .select("id")
      .eq("character_id", character.id)
      .in("effect_type", ["oeil_ouvert", "oeil_trouble"])
      .is("consumed_at", null)
      .limit(1);
    setHasRiskReserveEffect((data ?? []).length > 0);
  }, [character]);

  useEffect(() => { void refreshRiskReserveEffect(); }, [refreshRiskReserveEffect]);

  async function useMartyr() {
    if (!step || !character) return;
    setVocationError(null); setVocationBusy("martyr");
    const { error: rpcError } = await supabase.rpc("trigger_martyr", { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setVocationError(rpcError.message);
    else setUsedAbilities(prev => new Set(prev).add("martyr"));
    setVocationBusy(null);
  }

  async function useGambit() {
    if (!step || !character) return;
    setVocationError(null); setVocationBusy("gambit");
    const { error: rpcError } = await supabase.rpc("trigger_traitre_gambit", { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setVocationError(rpcError.message);
    else setUsedAbilities(prev => new Set(prev).add("traitre_gambit"));
    setVocationBusy(null);
  }

  async function useMartyrProvocation() {
    if (!step || !character) return;
    setVocationError(null); setVocationBusy("martyr_provocation");
    const { error: rpcError } = await supabase.rpc("trigger_martyr_provocation" as any, { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setVocationError(rpcError.message);
    else { setUsedAbilities(prev => new Set(prev).add("martyr_provocation")); await fetchStep(); }
    setVocationBusy(null);
  }

  async function useTraitreVente() {
    if (!step || !character) return;
    setVocationError(null); setVocationBusy("traitre_vente");
    const { error: rpcError } = await supabase.rpc("trigger_traitre_vente" as any, { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setVocationError(rpcError.message);
    else setUsedAbilities(prev => new Set(prev).add("traitre_vente"));
    setVocationBusy(null);
  }

  async function useInspect(targetId: string) {
    if (!character) return;
    setVocationError(null); setVocationBusy(`inspect-${targetId}`); setInspectResult(null);
    const { data, error: rpcError } = await supabase.rpc("inspect_vocation", {
      p_caller_character_id: character.id, p_target_character_id: targetId,
    });
    if (rpcError) setVocationError(rpcError.message);
    else { setInspectResult({ id: targetId, honest: !!data }); setUsedAbilities(prev => new Set(prev).add("inquisiteur_inspect")); }
    setVocationBusy(null);
  }

  async function botVote(botCharacterId: string, vote: "continuer" | "rentrer") {
    if (!step) return;
    setBotBusy(botCharacterId); setError(null);
    const { error: rpcError } = await supabase.rpc("admin_bot_vote", { p_step_id: step.id, p_bot_character_id: botCharacterId, p_vote: vote });
    if (rpcError) setError(rpcError.message); else await fetchVotes(step.id);
    setBotBusy(null);
  }

  async function botRevive(botCharacterId: string) {
    setBotBusy(botCharacterId); setError(null);
    const { error: rpcError } = await supabase.rpc("admin_revive_bot", { p_bot_character_id: botCharacterId });
    if (rpcError) setError(rpcError.message); else await fetchParticipants();
    setBotBusy(null);
  }

  async function copyDebugReport() {
    const { data, error: rpcError } = await supabase.rpc("admin_debug_expedition", { p_expedition_id: expeditionId });
    if (rpcError) { setError(rpcError.message); return; }
    void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setDebugCopied(true);
    setTimeout(() => setDebugCopied(false), 2000);
  }

  async function showStepResult(stepId: string, eventType: string, deathsCountHint: number, isRetreat: boolean = false) {
    const { data: resolvedStep } = await supabase
      .from("expedition_steps").select("deaths_count, loot_earned, xp_awarded, resolution_type, situation_success_text, situation_failure_text").eq("id", stepId).maybeSingle();
    const deaths = resolvedStep?.deaths_count ?? deathsCountHint ?? 0;
    const resolutionType = resolvedStep?.resolution_type ?? null;

    const { data: deadChars } = await supabase
      .from("characters").select("name")
      .eq("died_in_expedition_id", expeditionId).eq("is_alive", false);
    const deadNames = (deadChars ?? []).map((c: any) => c.name);

    const { data: survivorChars } = await supabase
      .from("expedition_participants").select("character:characters(name, is_alive)")
      .eq("expedition_id", expeditionId);
    const survivorNames = (survivorChars ?? [])
      .map((p: any) => p.character)
      .filter((c: any) => c?.is_alive)
      .map((c: any) => c.name);

    let myDied = false;
    if (character) {
      const { data: charData } = await supabase
        .from("characters").select("is_alive").eq("id", character.id).maybeSingle();
      myDied = !!charData && !charData.is_alive;
      if (myDied) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: profileRow } = await supabase.from("profiles").select("banked_gold").eq("id", session.user.id).maybeSingle();
          setMyDeathInheritance(Math.round((profileRow as any)?.banked_gold ?? 0));
        }
        void fetchDeathDetails(character.id);
      }
    }

    const { data: exp } = await supabase
      .from("expeditions").select("status, total_loot_kept, total_loot_earned").eq("id", expeditionId).maybeSingle();
    const ended = exp?.status === "completed";

    const { data: dmgRows } = await supabase
      .from("step_damage_log").select("damage, character_id, character:characters(name)").eq("step_id", stepId).order("damage", { ascending: false });
    const damageLog = ((dmgRows as any[]) ?? []).map((r) => ({ name: r.character?.name ?? "?", characterId: r.character_id, damage: r.damage })).filter((r) => r.damage > 0);
    const wentWrong = deaths > 0 || myDied || damageLog.length > 0;

    let cinematicText: string;
    if (isRetreat) {
      cinematicText = "Pris d'un élan de sagesse, vous décidez de rentrer à la guilde.";
    } else if (resolutionType === "ignorer") {
      cinematicText = "Vous laissez le coffre fermé, tel que vous l'avez trouvé. Ce qu'il contenait reste un mystère.";
    } else if (resolutionType === "interpreter") {
      // "Comprendre pourquoi" doit révéler la vraie histoire de l'étape —
      // avant, cette branche affichait toujours la même phrase générique,
      // quel que soit le contenu réel de l'étape (le texte spécifique
      // existe pourtant côté serveur, jamais lu ici).
      cinematicText = (wentWrong ? resolvedStep?.situation_failure_text : resolvedStep?.situation_success_text)
        ?? "Votre Éclaireur lit les traces avec soin, mais elles ne livrent rien de plus que ce que vous saviez déjà.";
    } else if (resolutionType === "martyr_provocation") {
      cinematicText = wentWrong
        ? "Un seul d'entre vous s'est avancé pour réveiller le gardien. Le reste du groupe n'a rien risqué, mais ce silence a un prix."
        : "Un seul d'entre vous s'est avancé pour réveiller le gardien, et l'a emporté. Le reste du groupe passe sans une égratignure.";
    } else if (resolutionType === "payer_passage") {
      cinematicText = "La guilde paie sans discuter. Le passage s'ouvre, tranquille, et le butin reste entier.";
    } else if (resolutionType === "marchand_achete") {
      cinematicText = "Le marchand empoche son dû et vous glisse une amulette froide. « Ça tiendra deux étapes. Pas une de plus. »";
    } else if (resolutionType === "marchand_refuse") {
      cinematicText = "La guilde n'a pas les moyens. Le marchand hausse les épaules et vous regarde partir sans un mot.";
    } else if (resolutionType === "pillage") {
      cinematicText = wentWrong
        ? "La tentative tourne mal : ça se débat, ça crie, et le prix à payer n'est pas seulement en or."
        : "L'affaire est vite faite. Vous repartez plus riches, et un peu plus lourds sur la conscience.";
    } else if (resolutionType === "discretion") {
      cinematicText = wentWrong
        ? "Le gardien remue dans son sommeil, trop tard pour reculer. La discrétion ne suffit plus."
        : "Vous passez presque sans un bruit, laissant le gardien à son sommeil. Prudent, mais les mains vides.";
    } else if (resolutionType === "couper_terrain") {
      cinematicText = wentWrong
        ? "Le raccourci se referme mal sur vous. Le terrain ne pardonne pas l'impatience."
        : "Le détour paie : vous coupez à travers l'accidenté et ressortez plus loin, plus vite, plus riches.";
    } else if (resolutionType === "etudier") {
      cinematicText = wentWrong
        ? "Vous auriez dû laisser ça tranquille. Ce que vous avez réveillé en l'étudiant ne se rendort pas si facilement."
        : "L'examen minutieux paie : ce que vous avez trouvé valait plus que ce qu'un simple coup d'œil aurait laissé croire.";
    } else {
      cinematicText = (wentWrong ? resolvedStep?.situation_failure_text : resolvedStep?.situation_success_text)
        ?? getCinematic(eventType, wentWrong);
      const { data: interventionRows } = await supabase
        .from("step_interventions").select("character:characters(name)").eq("step_id", stepId).eq("action", "aide");
      const intervenerNames = (interventionRows as any[] ?? []).map(r => r.character?.name).filter(Boolean);
      if (intervenerNames.length > 0) {
        const names = intervenerNames.join(", ");
        cinematicText += deaths > 0 || myDied
          ? ` Une intervention désespérée de ${names} n'aura pas suffi à conjurer le sort.`
          : ` Une intervention de dernière minute de ${names} a fait pencher la balance en votre faveur.`;
      }
    }

    if (myDied) soundMaMort();
    else if (isRetreat) { /* pas de son dramatique pour un retour volontaire */ }
    else if (ended && (exp?.total_loot_kept ?? 0) > 0) soundRetourVictoire();
    else if (ended) soundRetourWipe();
    else if (deaths > 0) soundMortMembre();
    else soundSurvived();

    if (ended && pollRef.current) clearInterval(pollRef.current);

    // Narration de la désignation "pousser devant" : qui a poussé qui, et ce que ça a donné.
    // Va chercher une correspondance id → nom fraîche plutôt que de se fier à
    // l'état `participants` du composant : si cet écran s'affiche avant que
    // ce state ait fini de se charger (course possible au premier rendu),
    // la map était vide et tous les noms tombaient à "?" dans le récit.
    const { data: rosterRows } = await supabase
      .from("expedition_participants").select("character_id, character:characters(name)")
      .eq("expedition_id", expeditionId);
    const nameById = new Map(
      ((rosterRows as any[]) ?? []).map((p) => [p.character_id, p.character?.name ?? "?"])
    );
    const joinNames = (names: string[]) => names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
    let frontlineNarrative: string | null = null;
    const { data: flResultRow } = await supabase
      .from("step_frontline_result").select("target_character_id").eq("step_id", stepId).maybeSingle();
    const majorityTargetId = (flResultRow as any)?.target_character_id ?? null;
    const { data: flVoteRows } = await supabase
      .from("step_frontline_votes").select("voter_character_id, target_character_id").eq("step_id", stepId);
    const votesByTarget = new Map<string, string[]>();
    for (const row of (flVoteRows as any[]) ?? []) {
      const list = votesByTarget.get(row.target_character_id) ?? [];
      list.push(nameById.get(row.voter_character_id) ?? "?");
      votesByTarget.set(row.target_character_id, list);
    }
    if (majorityTargetId) {
      const voters = votesByTarget.get(majorityTargetId) ?? [];
      const votersText = voters.length > 0 ? joinNames(voters) : "Le groupe";
      const targetName = nameById.get(majorityTargetId) ?? "?";
      const targetHit = damageLog.some((d) => d.characterId === majorityTargetId);
      if (damageLog.length > 0) {
        frontlineNarrative = targetHit
          ? `${votersText} ont poussé ${targetName} devant, c'est pourquoi il a pris des dégâts.`
          : `${votersText} ont poussé ${targetName} devant, mais il a réussi à esquiver.`;
      } else {
        frontlineNarrative = `${votersText} avaient poussé ${targetName} devant.`;
      }
    } else if (votesByTarget.size > 0) {
      let bestTargetId: string | null = null; let bestVoters: string[] = [];
      for (const [tid, voters] of votesByTarget) {
        if (voters.length > bestVoters.length) { bestTargetId = tid; bestVoters = voters; }
      }
      if (bestTargetId) {
        const targetName = nameById.get(bestTargetId) ?? "?";
        frontlineNarrative = bestVoters.length > 1
          ? `${joinNames(bestVoters)} ont essayé de pousser ${targetName} devant, mais ça n'a pas suffi.`
          : `${bestVoters[0]} a poussé ${targetName} devant, mais seul, il n'a pas réussi.`;
      }
    }

    setResult({
      deaths, loot: Math.round(exp?.total_loot_kept ?? 0), ended,
      deadNames, cinematic: cinematicText, iDied: myDied,
      stepLoot: Math.round(resolvedStep?.loot_earned ?? 0),
      totalSoFar: Math.round(exp?.total_loot_earned ?? 0),
      xpAwarded: resolvedStep?.xp_awarded ?? 0,
      survivorNames,
      resolutionType,
      damageLog,
      frontlineNarrative,
      eventType,
    });
  }

  async function acknowledgeAndAdvance() {
    if (!step || !character) return;
    setAcked(true);
    await supabase.rpc("acknowledge_step_result", { p_step_id: step.id, p_character_id: character.id });
    // Le poll existant détectera l'étape suivante dès qu'elle sera générée
    // (par ce joueur si c'est le dernier, ou par un autre sinon).
  }

  async function acknowledgeForBot(botId: string) {
    if (!step) return;
    setBotBusy(botId);
    await supabase.rpc("acknowledge_step_result", { p_step_id: step.id, p_character_id: botId });
    await refreshAckCount();
    setBotBusy(null);
  }

  async function resolveStep() {
    if (!step) return;
    soundRevealClick();
    setBusy(true); setError(null);
    const { data: beganStep, error: rpcError } = await supabase.rpc("begin_resolution", { p_step_id: step.id });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }

    const bs = beganStep as any;
    if (bs) {
      setStep(bs); // évite d'attendre le prochain sondage : la jauge démarre avec sa fenêtre pleine
      if (bs.resolved) {
        // Résolu instantanément côté serveur (rentrer, ignorer, interpreter,
        // marchand_ward...), aucune jauge. was_retreat distingue le vrai
        // retour des autres issues instantanées — ne jamais le déduire du
        // simple fait que resolved soit déjà true.
        resultShownRef.current = true;
        await showStepResult(bs.id, bs.event_type, bs.deaths_count, !!bs.was_retreat);
      }
    }
    setBusy(false);
  }

  async function revealVerdict() {
    if (!step) return;
    soundRevealClick();
    setVerdictPending(false);
    setRevealingOutcome(true);
    const goodOutcome = step.deaths_count === 0;
    const start = Date.now();
    const animInterval = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / 2200);
      setGaugeWobble(goodOutcome ? 50 + t * 42 : 50 - t * 42);
    }, 100);
    await new Promise(r => setTimeout(r, 2400));
    clearInterval(animInterval);
    setRevealingOutcome(false);
    await showStepResult(step.id, step.event_type, step.deaths_count);
  }

  async function useIntervention() {
    if (!step || !character || interventionBusy) return;
    setInterventionBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc("use_intervention", { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setError(rpcError.message);
    else { setMyIntervened(true); await refreshInterventionState(); soundRevealClick(); }
    setInterventionBusy(false);
  }

  async function useInterventionAsBot(botId: string) {
    if (!step) return;
    setInterventionBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc("use_intervention", { p_step_id: step.id, p_character_id: botId });
    if (rpcError) setError(rpcError.message); else await refreshInterventionState();
    setInterventionBusy(false);
  }

  async function searchForCuriosity() {
    if (!step || !character || searchBusy) return;
    setSearchBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc("use_search" as any, { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setError(rpcError.message);
    else {
      setMySearched(true);
      const row = (data as any)?.[0];
      setSearchResult(row ?? { found: false });
      await refreshInterventionState();
      soundRevealClick();
    }
    setSearchBusy(false);
  }

  const refreshInterventionState = useCallback(async () => {
    if (!step) return;
    // Réserve désormais personnelle (par personnage, par expédition) —
    // avant elle venait de expeditions.interventions_remaining (le pool
    // commun du groupe), maintenant de la ligne du joueur dans
    // expedition_participants.
    if (character) {
      const { data: myPart } = await supabase
        .from("expedition_participants").select("interventions_remaining")
        .eq("expedition_id", expeditionId).eq("character_id", character.id).maybeSingle();
      setInterventionsRemaining((myPart as any)?.interventions_remaining ?? null);

      const { data: mine } = await supabase.from("step_interventions")
        .select("character_id, action").eq("step_id", step.id).eq("character_id", character.id).maybeSingle();
      setMyIntervened(!!mine && (mine as any).action === "aide");
      setMySearched(!!mine && (mine as any).action === "fouille");
      setMyDrunk(!!mine && (mine as any).action === "potion");
      const { data: potions } = await supabase
        .from("character_potions").select("id").eq("character_id", character.id).eq("expedition_id", expeditionId).is("consumed_at", null).limit(1);
      setHasPotion((potions ?? []).length > 0);
    }
    const { data: rows } = await supabase
      .from("step_interventions").select("character:characters(name)").eq("step_id", step.id).eq("action", "aide");
    setIntervenerNames((rows as any[] ?? []).map(r => r.character?.name).filter(Boolean));

    // Qui a agi sur cette étape, toutes actions confondues (aide/fouille/
    // potion) — chacun pioche dans sa propre réserve désormais, cette liste
    // reste utile pour voir qui a déjà agi sur l'étape en cours.
    const { data: allRows } = await supabase
      .from("step_interventions").select("action, character:characters(name)").eq("step_id", step.id);
    setAllInterventionUsers(
      ((allRows as any[]) ?? [])
        .map(r => ({ name: r.character?.name as string | undefined, action: r.action as string }))
        .filter(r => !!r.name) as { name: string; action: string }[]
    );

    const { data: skipRows } = await supabase.from("step_skip_votes").select("character_id").eq("step_id", step.id);
    const skipIds = (skipRows as any[] ?? []).map(r => r.character_id);
    setSkipTally({
      mine: !!character && skipIds.includes(character.id),
      count: skipIds.length,
      total: aliveParticipants.length,
    });
  }, [step, expeditionId, character, aliveParticipants.length]);

  async function voteSkip() {
    if (!step || !character) return;
    setSkipBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc("vote_skip_resolution" as any, { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setError(rpcError.message);
    await refreshInterventionState();
    setSkipBusy(false);
  }

  // Réserve personnelle (Intervenir/Fouiller/Potion/Larcin) : suivie dès le
  // vote, pas seulement pendant la fenêtre de résolution — ces actions sont
  // désormais utilisables dès le début, plus seulement une fois que tout le
  // monde a voté.
  useEffect(() => {
    if (!step || step.resolved) return;
    void refreshInterventionState();
    const t = setInterval(() => {
      void refreshInterventionState();
      if (step.resolving) setGaugeWobble(w => Math.min(85, Math.max(15, w + (Math.random() - 0.5) * 18)));
    }, 1500);
    return () => clearInterval(t);
  }, [step?.id, step?.resolving, step?.resolved, refreshInterventionState]);

  // Participants vivants = ceux qui comptent pour le vote
  const allVoted = aliveParticipants.length > 0 && aliveParticipants.every(p => votedIds.includes(p.character_id));

  // Totaux affichés avant de voter : or de guilde déjà engrangé cette
  // expédition, et XP déjà gagnée. Pas d'or personnel affiché ici — sous le
  // système actuel, il n'est versé qu'en une fois au retour, donc on montre
  // plutôt une projection ("si tu rentres maintenant"), qui inclut désormais
  // l'ajustement personnel (larcins réussis/subis) — sans ça, un voleur qui
  // vient de réussir ne verrait rien bouger avant la fin réelle de l'expédition.
  useEffect(() => {
    if (!step || step.resolving || step.resolved) return;
    void (async () => {
      const [{ data: exp }, { data: steps }, { data: myPart }] = await Promise.all([
        supabase.from("expeditions").select("total_loot_earned").eq("id", expeditionId).maybeSingle(),
        supabase.from("expedition_steps").select("xp_awarded").eq("expedition_id", expeditionId),
        character
          ? supabase.from("expedition_participants").select("personal_gold_adjustment")
              .eq("expedition_id", expeditionId).eq("character_id", character.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const xp = (steps ?? []).reduce((sum: number, s: any) => sum + (s.xp_awarded ?? 0), 0);
      setRunningTotals({ guildGold: Math.round(exp?.total_loot_earned ?? 0), xp });
      setMyGoldAdjustment((myPart as any)?.personal_gold_adjustment ?? 0);
    })();
  }, [step?.id, step?.resolving, step?.resolved, expeditionId, character]);
  const deadlineExpired = !isAsync && timeLeft !== null && timeLeft <= 0;
  const canResolve = (allVoted || deadlineExpired) && step && !step.resolved && !step.resolving && !busy;
  const prevAllVoted = useRef(false);
  const autoResolveAttempted = useRef<string | null>(null);

  // Dès que tout le monde a voté (ou le délai passé), on résout tout seul —
  // plus besoin qu'un joueur clique "Révéler le résultat" pour faire avancer
  // les autres. Un seul appel par étape (peu importe qui a le focus quand ça
  // se déclenche, begin_resolution est sans danger si appelée en double).
  // Petit délai de sécurité quand c'est le décompte qui expire (pas un vote
  // complet) : l'horloge du client peut arriver à 0 une fraction de seconde
  // avant celle du serveur, ce qui fait échouer la première tentative avec
  // "la fenêtre de vote n'est pas encore écoulée".
  useEffect(() => {
    if (!canResolve || !step) return;
    if (autoResolveAttempted.current === step.id) return;
    autoResolveAttempted.current = step.id;
    if (allVoted) {
      void resolveStep();
    } else {
      setTimeout(() => void resolveStep(), 1500);
    }
  }, [canResolve, step, allVoted]);

  // Pendant l'écran de résultat (hors fin d'expédition / mort perso), affiche
  // en direct combien de joueurs ont déjà validé pour passer à la suite.
  const refreshAckCount = useCallback(async () => {
    if (!step) return;
    const { count: alive } = await supabase.from("expedition_participants")
      .select("character_id, characters!inner(is_alive)", { count: "exact", head: true })
      .eq("expedition_id", expeditionId).eq("characters.is_alive", true);
    const { count: done } = await supabase.from("step_acknowledgments")
      .select("character_id, characters!inner(is_alive)", { count: "exact", head: true })
      .eq("step_id", step.id).eq("characters.is_alive", true);
    setAckCount({ done: done ?? 0, total: alive ?? 0 });
  }, [step, expeditionId]);

  useEffect(() => {
    if (!result || result.ended || result.iDied || !step) { setAckCount(null); return; }
    let cancelled = false;
    const poll = async () => { if (!cancelled) await refreshAckCount(); };
    void poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [result, step, expeditionId, refreshAckCount]);
  useEffect(() => { if (allVoted && !prevAllVoted.current) soundAllVoted(); prevAllVoted.current = allVoted; }, [allVoted]);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (myDeathScreen) {
    return (
      <LedgerPage>
        <div style={{ position: "fixed", inset: 0, zIndex: 0, backgroundImage: `url(${DEATH_SCREEN})`, backgroundSize: "cover", backgroundPosition: "center", filter: "brightness(0.3)" }} />
        <LedgerCard title="Tu es mort">
          <p className="text-sm text-muted-foreground mb-4">
            Ton personnage n'a pas survécu à cette expédition. Le reste du groupe continue sans toi.
          </p>
          {myDeathDetails && (
            <div className="mb-4 px-3 py-3 border border-border/30 text-xs text-muted-foreground space-y-1">
              <p>Niveau atteint : <span className="font-mono text-foreground">{myDeathDetails.level}</span></p>
              {myDeathDetails.highestStep !== null && (
                <p>Étape la plus haute atteinte : <span className="font-mono text-foreground">{myDeathDetails.highestStep}</span></p>
              )}
              {myDeathDetails.damageTaken > 0 && (
                <p>Dégâts fatals : <span className="font-mono text-red-400">{myDeathDetails.damageTaken}</span></p>
              )}
              {myDeathDetails.goldLost > 0 && (
                <p>Or personnel perdu : <span className="font-mono text-amber-400">{myDeathDetails.goldLost}</span></p>
              )}
            </div>
          )}
          {myDeathInheritance > 0 && (
            <p className="text-sm text-primary mb-4">
              Il laisse un héritage : ton prochain personnage commencera avec <span className="font-mono">{myDeathInheritance} or</span> personnel.
            </p>
          )}
          <TextLink onClick={() => navigate({ to: "/" })}>Retour à ta guilde</TextLink>
        </LedgerCard>
      </LedgerPage>
    );
  }
  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Chargement…</p></LedgerPage>;

  const eventBg = step ? pickEventBg(step) || null : null;
  const bgFilter = step?.risk_level === "eleve"
    ? "brightness(0.30) sepia(0.35)"
    : step?.risk_level === "moyen"
    ? "brightness(0.34) sepia(0.12)"
    : "brightness(0.38)";
  const resolvingRisk = step?.resolution_type && step.resolution_type !== "continuer"
    ? step.third_option_death_pct ?? step.death_percentage
    : step?.death_percentage;
  const secondsLeft = step?.resolution_deadline
    ? Math.max(0, Math.ceil((new Date(step.resolution_deadline).getTime() - Date.now()) / 1000))
    : 0;
  const availableBotsForIntervention = isAdmin
    ? participants.filter(p => p.character.is_bot && p.is_alive)
    : [];


  if (result) {
    const isWipe = result.ended && result.loot === 0 && result.deadNames.length > 0;
    let resultBg: string;
    if (result.iDied) {
      resultBg = DEATH_SCREEN;
    } else if (result.resolutionType === "marchand_achete") {
      resultBg = (resultImageVariant < 0.5 ? MARCHAND_ACHETE_IMGS[0] : MARCHAND_ACHETE_IMGS[1]) ?? MARCHAND_ACHETE_IMGS[0]!;
    } else if (result.resolutionType === "marchand_refuse") {
      resultBg = MARCHAND_REFUSE_IMG;
    } else if (result.resolutionType === "pillage") {
      resultBg = result.deaths > 0 ? PILLAGE_FAIL_IMG : PILLAGE_SUCCESS_IMG;
    } else if (result.ended) {
      resultBg = isWipe ? CINEMATIC_TPK_IMG : result.deadNames.length > 0 ? RETURN_WIPE
        : ((resultImageVariant < 0.5 ? RETURN_SUCCESS_IMGS[0] : RETURN_SUCCESS_IMGS[1]) ?? RETURN_SUCCESS_IMGS[0]!);
    } else if (result.deaths > 0) {
      // Image liée au type de l'événement qui vient de faire des dégâts,
      // quand elle existe ; repli sur le pool générique sinon.
      const echecPool = EVENT_ECHEC_IMAGES[result.eventType] ?? CINEMATIC_DEATH_IMGS;
      resultBg = echecPool[Math.floor(resultImageVariant * echecPool.length)] ?? echecPool[0]!;
    } else {
      // L'image de l'étape elle-même rejoint le pool générique, tout comme
      // l'image de réussite dédiée au type (coffre ouvert, découverte
      // révélée...) quand elle existe, pour que "étape franchie" garde un
      // vrai lien visuel avec ce qui vient de se passer plutôt que d'être
      // toujours déconnecté de l'événement.
      const reussitePool = EVENT_REUSSITE_IMAGES[result.eventType] ?? [];
      const successPool = [
        ...(eventBg ? [eventBg] : []),
        ...reussitePool,
        STEP_RESULT_SUCCESS,
        ...CINEMATIC_SURVIVE_IMGS,
      ];
      resultBg = successPool[Math.floor(resultImageVariant * successPool.length)] ?? successPool[0]!;
    }
    // "Étape franchie" ne doit jamais s'afficher au-dessus d'un récit
    // d'échec accompagné de dégâts réels — avant, le titre ne regardait que
    // le nombre de morts, alors que le texte narratif juste en dessous
    // bascule sur la version "ça a mal tourné" dès qu'il y a eu des dégâts
    // (voir wentWrong plus haut), même sans aucune mort. Résultat : un
    // titre "Étape franchie" au-dessus d'un texte d'échec et d'un encart
    // de dégâts, qui se contredisaient l'un l'autre.
    const hurtNoDeath = result.deaths === 0 && result.damageLog.length > 0;
    const title = result.iDied ? "Tu es mort."
      : isWipe ? "Expédition anéantie"
      : result.ended ? "Expédition terminée"
      : result.deaths > 0 ? `${result.deaths} mort${result.deaths > 1 ? "s" : ""}`
      : hurtNoDeath ? "Étape franchie de justesse" : "Étape franchie";
    const subtitle = result.iDied ? "Ton personnage ne reviendra pas."
      : isWipe ? "Aucun survivant. Rien n'est rapporté à la guilde."
      : result.ended ? `Butin rapporté à la guilde : ${result.loot} or`
      : result.deaths > 0 ? `${result.deaths} membre${result.deaths > 1 ? "s ont" : " a"} péri.`
      : hurtNoDeath ? "Personne n'est mort, mais ça s'est fait sentir."
      : "Le groupe avance.";
    return (
      <LedgerPage maxWidthClass="max-w-2xl">
        <div style={{position:"fixed",inset:0,zIndex:0,backgroundImage:`url(${resultBg})`,backgroundSize:"cover",backgroundPosition:"center",filter:"brightness(0.25)"}} />
        <LedgerCard title={title} subtitle={subtitle}>
          <p className="text-lg md:text-xl text-muted-foreground italic mb-4 leading-relaxed text-center">{result.cinematic}</p>

          {result.frontlineNarrative && (
            <p className="text-sm text-amber-300/90 text-center mb-3 italic">{result.frontlineNarrative}</p>
          )}

          {result.damageLog.length > 0 && (
            <div className="mb-5 px-3 py-3 border border-red-400/30 bg-red-400/5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-red-400/70 mb-1.5 text-center">Dégâts encaissés</p>
              {result.damageLog.map((d, i) => (
                <p key={i} className="text-sm text-red-300 text-center">
                  {d.name} a pris <span className="font-mono">{d.damage}</span> point{d.damage > 1 ? "s" : ""} de dégâts.
                </p>
              ))}
            </div>
          )}

          {!result.iDied && !result.ended && result.stepLoot > 0 && (
            <div className="flex justify-center mb-5">
              <div className="text-center">
                <p className="text-2xl font-serif font-bold text-amber-400">+{result.stepLoot} or</p>
                <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Butin de l'étape</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Butin accumulé de l'expédition : {result.totalSoFar} or</p>
              </div>
            </div>
          )}

          {!result.iDied && !result.ended && result.survivorNames.length > 0 && result.xpAwarded > 0 && (
            <div className="mb-4 px-3 py-2 border border-border/20">
              {result.survivorNames.map(n => (
                <p key={n} className="text-xs text-muted-foreground">
                  {n}, <span className="text-purple-300">+{result.xpAwarded} XP</span>
                </p>
              ))}
            </div>
          )}

          {result.deadNames.length > 0 && (
            <div className="mb-4 px-3 py-2 border border-red-400/20">
              {result.deadNames.map(n => <p key={n} className="text-xs text-red-400/70">✝ {n}</p>)}
            </div>
          )}

          {result.iDied && (
            <div className="mb-6 px-3 py-4 border border-red-400/30 bg-red-400/5">
              <p className="text-sm text-red-400/80 leading-relaxed">
                Le sort t'a désigné. Ton histoire s'arrête ici. Ton nom restera dans l'historique de la guilde.
              </p>
              {myDeathDetails && (
                <div className="mt-3 pt-3 border-t border-red-400/20 text-xs text-muted-foreground space-y-1">
                  <p>Niveau atteint : <span className="font-mono text-foreground">{myDeathDetails.level}</span></p>
                  {myDeathDetails.highestStep !== null && (
                    <p>Étape la plus haute atteinte : <span className="font-mono text-foreground">{myDeathDetails.highestStep}</span></p>
                  )}
                  {myDeathDetails.damageTaken > 0 && (
                    <p>Dégâts fatals : <span className="font-mono text-red-400">{myDeathDetails.damageTaken}</span></p>
                  )}
                  {myDeathDetails.goldLost > 0 && (
                    <p>Or personnel perdu : <span className="font-mono text-amber-400">{myDeathDetails.goldLost}</span></p>
                  )}
                </div>
              )}
              {myDeathInheritance > 0 && (
                <p className="text-sm text-primary mt-2">
                  Il laisse un héritage : ton prochain personnage commencera avec <span className="font-mono">{myDeathInheritance} or</span> personnel.
                </p>
              )}
            </div>
          )}

          {result.iDied ? (
            <button onClick={() => navigate({ to: "/" })}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-red-400/40 text-red-400/70 hover:bg-red-400/10">
              Quitter l'expédition
            </button>
          ) : result.ended ? (
            <button onClick={() => navigate({ to: "/" })}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10">
              Retour à la guilde
            </button>
          ) : (
            <>
              <button onClick={acknowledgeAndAdvance} disabled={acked}
                className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-40">
                {acked ? "En attente des autres…" : "Continuer"}
              </button>
              {ackCount && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {ackCount.done} / {ackCount.total} ont validé
                </p>
              )}
              {isAdmin && participants.filter(p => p.character.is_bot && p.is_alive).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/20 flex flex-wrap gap-2 justify-center">
                  {participants.filter(p => p.character.is_bot && p.is_alive).map((p) => (
                    <button key={p.character_id} onClick={() => acknowledgeForBot(p.character_id)} disabled={botBusy === p.character_id}
                      className="text-[10px] uppercase tracking-[0.08em] border border-amber-500/50 text-amber-300 px-2 py-1 hover:bg-amber-500/10 disabled:opacity-30">
                      {botBusy === p.character_id ? "…" : `Continuer (${p.character.name})`}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </LedgerCard>
      </LedgerPage>
    );
  }

  return (
    <LedgerPage>
      {eventBg && (
        <div style={{
          position:"fixed", inset:0, zIndex:0,
          backgroundImage:`url(${eventBg})`,
          backgroundSize:"cover", backgroundPosition:"center",
          filter: bgFilter,
          transition:"filter 1s ease"
        }} />
      )}
      <LedgerCard>
        {step && (!step.resolved || verdictPending || revealingOutcome) && (
          <>
            <Frame variant="bar" className="mb-2">
              <span className="text-base tracking-[0.12em] uppercase font-serif font-semibold inline-flex items-center gap-2 justify-center w-full">
                {EVENT_TYPE_ICON[step.event_type] && (
                  <img src={EVENT_TYPE_ICON[step.event_type]} alt="" className="h-6 w-6 object-contain" />
                )}
                Étape {step.step_number}, {step.event_type}
              </span>
            </Frame>

            <p className={`text-sm font-semibold mb-4 text-center ${RISK_COLOR[step.risk_level]}`}>
              ⚠ Risque {RISK_LABEL[step.risk_level]}
              <span className="ml-2 text-amber-400 font-mono">· Butin : {step.loot_min}–{step.loot_max} or</span>
              {visibleRisk !== null && <span className="ml-2 font-mono text-xs opacity-80">({Math.round(visibleRisk * 100)}% de mort exact, connu de tout le groupe)</span>}
              {myPrivateRisk !== null && <span className="ml-2 font-mono text-xs text-primary">({Math.round(myPrivateRisk * 100)}% de mort, connu de toi seul)</span>}
            </p>

            {step.description && (() => {
              const parchmentBg = pickParchmentBg(step);
              const showVoteInPanel = !step.resolving && !verdictPending && !revealingOutcome;
              return (
                <div className="relative w-full mb-4" style={{ aspectRatio: "1191 / 1228" }}>
                  <img src="/panel_vote.webp" alt="" aria-hidden
                    className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none" />
                  <div className="absolute overflow-hidden rounded-sm" style={{ top: "1.5%", right: "2%", bottom: "46.3%", left: "2%" }}>
                    {parchmentBg && (
                      <img src={parchmentBg} alt="" aria-hidden
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center px-[8%] py-[6%] text-center">
                      <div>
                        {step.required_flag_sentiment && (
                          <p className={`text-xs uppercase tracking-[0.14em] mb-2 font-sans font-bold ${step.required_flag_sentiment === "positif" ? "text-emerald-700" : "text-red-800"}`}>
                            Conséquence d'un choix passé
                          </p>
                        )}
                        {/* Texte "encre sur parchemin" — sombre avec un halo clair, plus
                            gros qu'avant, plutôt que blanc à ombre noire : ça ne
                            fonctionnait qu'avec un fond sombre, plus avec l'illustration
                            claire fusionnée dans le parchemin en dessous. */}
                        <p
                          className="text-2xl md:text-3xl font-serif italic leading-snug font-semibold"
                          style={{
                            color: step.required_flag_sentiment === "positif" ? "#1a3d1a"
                              : step.required_flag_sentiment === "negatif" ? "#4a1414" : "#2a1a0a",
                            textShadow: "-1px -1px 0 rgba(235,220,190,0.8), 1px -1px 0 rgba(235,220,190,0.8), -1px 1px 0 rgba(235,220,190,0.8), 1px 1px 0 rgba(235,220,190,0.8), 0 0 10px rgba(235,220,190,0.55)",
                          }}
                        >
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* Zone sombre : uniquement le minuteur + Continuer/Rentrer (ou
                      "vote enregistré") — les seuls éléments dont la hauteur ne
                      varie jamais. La troisième option, les capacités de vocation
                      et le décompte des votes restent en dessous, hors du panneau :
                      leur hauteur varie trop pour un cadre à ratio fixe. Pendant la
                      résolution/le verdict, cette zone reste simplement vide — ce
                      contenu-là est encore affiché plus bas, dans son habillage
                      d'origine. */}
                  {showVoteInPanel && (
                    <div className="absolute flex flex-col justify-center gap-2.5 px-[2%]" style={{ top: "58%", right: "3%", bottom: "2.5%", left: "3%" }}>
                      {isAsync ? (
                        <p className="text-[11px] tracking-[0.1em] uppercase text-[#cfc2a0] text-center">
                          Aucune limite de temps — en attente que chacun agisse
                        </p>
                      ) : (
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[11px] tracking-[0.14em] uppercase text-[#cfc2a0]">Temps restant</span>
                          <span className={`font-mono text-base ${timeLeft !== null && timeLeft < 30 ? "text-red-400" : "text-amber-300"}`}>
                            {timeLeft !== null ? fmt(timeLeft) : "—"}
                          </span>
                        </div>
                      )}
                      {!myVote ? (
                        <div className="grid grid-cols-2 gap-2.5">
                          <ImmersiveButton variant="clair" onClick={() => castVote("continuer")} disabled={busy || deadlineExpired}>
                            <span className="flex items-center justify-center gap-2">
                              <img src="/icons/arrow_up.webp" alt="" className="h-5 w-5 object-contain" />
                              Continuer
                            </span>
                          </ImmersiveButton>
                          <ImmersiveButton variant="sombre" onClick={() => castVote("rentrer")} disabled={busy || deadlineExpired}>
                            <span className="flex items-center justify-center gap-2">
                              <img src="/icons/door.webp" alt="" className="h-5 w-5 object-contain" />
                              Rentrer
                            </span>
                          </ImmersiveButton>
                        </div>
                      ) : (
                        <p className="text-xs text-[#cfc2a0] text-center">Vote enregistré, en attente des autres…</p>
                      )}
                      {/* Réserve personnelle — disponible dès le vote, pas seulement
                          une fois que tout le monde a voté : Intervenir/Fouiller/
                          Potion utilisent la même réserve que le Larcin (affiché
                          plus bas), donc pas de raison de les réserver à une
                          phase différente. */}
                      {!!interventionsRemaining && (
                        <div className="grid grid-cols-3 gap-1.5 mt-1">
                          <button onClick={useIntervention} disabled={interventionBusy || myIntervened || mySearched || !interventionsRemaining}
                            title={`Intervenir (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`}
                            className="relative flex flex-col items-center gap-0.5 py-1.5 border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 disabled:opacity-30 rounded-sm">
                            <img src="/icons/gauntlet.webp" alt="" className="h-5 w-5 object-contain" />
                            <span className="text-[8px] uppercase tracking-[0.04em]">Intervenir</span>
                            <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-primary/60 text-[9px] flex items-center justify-center text-primary">{interventionsRemaining}</span>
                          </button>
                          <button onClick={searchForCuriosity} disabled={searchBusy || myIntervened || mySearched || !interventionsRemaining}
                            title={`Fouiller (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`}
                            className="relative flex flex-col items-center gap-0.5 py-1.5 border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 disabled:opacity-30 rounded-sm">
                            <img src="/icons/magnifier.webp" alt="" className="h-5 w-5 object-contain" />
                            <span className="text-[8px] uppercase tracking-[0.04em]">Fouiller</span>
                            <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-primary/60 text-[9px] flex items-center justify-center text-primary">{interventionsRemaining}</span>
                          </button>
                          {hasPotion ? (
                            <button onClick={drinkPotion} disabled={drinkBusy || myIntervened || mySearched || !interventionsRemaining}
                              title={`Boire une potion (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`}
                              className="relative flex flex-col items-center gap-0.5 py-1.5 border border-emerald-400/40 text-emerald-300 bg-emerald-500/5 hover:bg-emerald-500/10 disabled:opacity-30 rounded-sm">
                              <img src="/icons/potion.webp" alt="" className="h-5 w-5 object-contain" />
                              <span className="text-[8px] uppercase tracking-[0.04em]">Potion</span>
                              <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-emerald-400/60 text-[9px] flex items-center justify-center text-emerald-300">{interventionsRemaining}</span>
                            </button>
                          ) : <div />}
                        </div>
                      )}
                      {(myIntervened || mySearched || myDrunk) && (
                        <p className="text-[10px] text-center text-muted-foreground/70">
                          {myIntervened && "Intervention utilisée sur cette étape."}
                          {mySearched && searchResult && (searchResult.found ? `Fouille : trouvé ${searchResult.name}.` : "Fouille infructueuse.")}
                          {myDrunk && drinkResult !== null && `Potion bue, ${drinkResult} PV.`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {!step.resolving && !verdictPending && !revealingOutcome && !myVote && runningTotals && (
              <div className="mb-3 text-xs text-muted-foreground text-center space-y-0.5">
                <p>Or de guilde accumulé cette expédition : <span className="text-amber-400 font-mono">{runningTotals.guildGold}</span> · XP gagnée : <span className="text-primary font-mono">{runningTotals.xp}</span></p>
                <p className="text-[10px] opacity-70">
                  Si le groupe rentre maintenant, ta part personnelle serait d'environ {Math.max(Math.round(runningTotals.guildGold * 0.01) + myGoldAdjustment, 0)} or
                  {myGoldAdjustment !== 0 && (
                    <span className={myGoldAdjustment > 0 ? "text-amber-400" : "text-red-400"}>
                      {" "}({myGoldAdjustment > 0 ? "+" : ""}{myGoldAdjustment} suite à un larcin)
                    </span>
                  )}.
                </p>
              </div>
            )}
            {!step.resolving && !verdictPending && !revealingOutcome && !myVote && step.third_option_kind && step.third_option_label && (
              step.required_vocation && myVocation !== step.required_vocation ? (
                <p className="w-full mt-2 mb-4 py-2 text-center text-xs text-muted-foreground/50 italic border border-border/20">
                  {step.third_option_label}, réservé à un personnage {vocationLabel(step.required_vocation)}
                </p>
              ) : (() => {
                // Indicateur qualitatif du risque de la troisième option par
                // rapport au risque de base — jamais de pourcentage exact
                // affiché (comme pour Risque Faible/Moyen/Élevé plus haut),
                // mais sans indicateur du tout le joueur ne voit qu'un loot
                // plus élevé et aucune contrepartie visible, ce qui rend le
                // choix illisible (ex. "pillage" : +15 points de risque de
                // mort contre ×1,6 de butin, entièrement invisible avant).
                const delta = step.third_option_death_pct != null
                  ? step.third_option_death_pct - step.death_percentage
                  : null;
                const riskTag = delta === null ? null
                  : delta > 0.08 ? { text: "risque nettement accru", color: "text-red-400" }
                  : delta > 0 ? { text: "risque accru", color: "text-amber-400" }
                  : delta < -0.08 ? { text: "risque nettement réduit", color: "text-emerald-400" }
                  : delta < 0 ? { text: "risque réduit", color: "text-emerald-400" }
                  : null;
                const hasLoot = step.third_option_loot_min != null && step.third_option_loot_max != null;
                // Le chiffre seul ("138–321 or") ne dit pas si c'est de
                // l'or gagné ou dépensé, ni comment il se compare au
                // butin de Continuer juste au-dessus — d'où la confusion
                // sur des options pourtant cohérentes (plus de risque
                // pour plus de butin). On explicite les deux : "or à
                // gagner" et la comparaison directe au butin de base.
                const lootComparedToBase = hasLoot
                  ? (step.third_option_loot_min! >= step.loot_max
                      ? "butin plus élevé que Continuer"
                      : step.third_option_loot_max! <= step.loot_min
                        ? "butin plus faible que Continuer"
                        : "butin comparable à Continuer")
                  : null;
                return (
                  <button onClick={() => castVote("troisieme")} disabled={busy || deadlineExpired}
                    className="w-full mt-2 mb-4 py-3 border border-amber-500/50 text-amber-300 font-serif tracking-[0.1em] uppercase rounded-sm hover:bg-amber-500/10 disabled:opacity-30 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <img src="/icons/scroll.webp" alt="" className="h-5 w-5 object-contain shrink-0" />
                      <span>
                        {step.third_option_label}
                        {step.required_vocation && ` (vous avez un·e ${vocationLabel(step.required_vocation)} dans le groupe)`}
                        {step.third_option_cost != null && ` (${step.third_option_cost} or de guilde dépensé)`}
                        {hasLoot && `, ${step.third_option_loot_min}–${step.third_option_loot_max} or à gagner`}
                      </span>
                    </span>
                    {(riskTag || lootComparedToBase) && (
                      <span className={`block mt-1 text-[11px] normal-case tracking-normal font-sans ${riskTag?.color ?? "text-muted-foreground"}`}>
                        {riskTag && <>⚠ {riskTag.text} par rapport à Continuer</>}
                        {riskTag && lootComparedToBase && " · "}
                        {lootComparedToBase && lootComparedToBase}
                      </span>
                    )}
                  </button>
                );
              })()
            )}

            {!step.resolving && !verdictPending && !revealingOutcome && (
              <>
                {/* ================= Actions individuelles — optionnelles, indépendantes du vote ================= */}
                {(() => {
              const isMarchandStep = step.event_type === "marchand" && !step.resolving && !step.resolved;
              const hasVocationAction = !!myVocation && !myVote && (
                (myVocation === "Eclaireur" && !usedAbilities.has("eclaireur_reveal")) ||
                hasRiskReserveEffect ||
                (myVocation === "Martyr" && !usedAbilities.has("martyr")) ||
                usedAbilities.has("martyr") ||
                (myVocation === "Martyr" && step.event_type === "gardien" && !usedAbilities.has("martyr_provocation")) ||
                usedAbilities.has("martyr_provocation") ||
                (myVocation === "Traitre" && !usedAbilities.has("traitre_gambit")) ||
                usedAbilities.has("traitre_gambit") ||
                (myVocation === "Traitre" && step.event_type === "marchand" && !usedAbilities.has("traitre_vente")) ||
                usedAbilities.has("traitre_vente")
              );
              return hasVocationAction || isMarchandStep;
            })() && (
              <div className="mb-4 px-3 py-3 border border-dashed border-border/40 bg-border/5">
                <p className="text-[10px] tracking-[0.14em] uppercase text-muted-foreground/70 mb-2 text-center flex items-center justify-center gap-1.5">
                  <img src="/icons/scroll.webp" alt="" className="h-4 w-4 object-contain" />
                  Actions individuelles, optionnelles
                </p>
                {myVocation && !myVote && (
                  <div className="space-y-2">
                    {(myVocation === "Eclaireur" && !usedAbilities.has("eclaireur_reveal") || hasRiskReserveEffect) && (
                      <button onClick={useReveal} disabled={vocationBusy === "reveal"}
                        className="w-full text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary px-3 py-2 hover:bg-primary/10 disabled:opacity-30">
                        {vocationBusy === "reveal" ? "…" : "Révéler le risque (à toi seul)"}
                      </button>
                    )}
                    {myVocation === "Martyr" && !usedAbilities.has("martyr") && (
                      <button onClick={useMartyr} disabled={vocationBusy === "martyr"}
                        className="w-full text-xs uppercase tracking-[0.1em] border border-red-400/40 text-red-400 px-3 py-2 hover:bg-red-400/10 disabled:opacity-30">
                        {vocationBusy === "martyr" ? "…" : "M'armer pour intercepter le plus gros coup (une fois par expédition)"}
                      </button>
                    )}
                    {usedAbilities.has("martyr") && (
                      <p className="text-xs text-red-400/70 italic">Si un coup mortel devait tomber sur quelqu'un d'autre cette étape, tu le prends à sa place.</p>
                    )}
                    {myVocation === "Martyr" && step.event_type === "gardien" && !usedAbilities.has("martyr_provocation") && (
                      <div>
                        <p className="text-[10px] text-muted-foreground/60 mb-1">Disponible car tu es Martyr</p>
                        <button onClick={useMartyrProvocation} disabled={vocationBusy === "martyr_provocation"}
                          className="w-full text-xs uppercase tracking-[0.1em] border border-red-400/40 text-red-400 px-3 py-2 hover:bg-red-400/10 disabled:opacity-30">
                          {vocationBusy === "martyr_provocation" ? "…" : "Provoquer seul le gardien (risque seul, le groupe garde tout)"}
                        </button>
                      </div>
                    )}
                    {usedAbilities.has("martyr_provocation") && (
                      <p className="text-xs text-red-400/70 italic">L'étape est déjà réglée, le résultat arrive.</p>
                    )}
                    {myVocation === "Traitre" && !usedAbilities.has("traitre_gambit") && (
                      <button onClick={useGambit} disabled={vocationBusy === "gambit"}
                        className="w-full text-xs uppercase tracking-[0.1em] border border-amber-400/40 text-amber-400 px-3 py-2 hover:bg-amber-400/10 disabled:opacity-30">
                        {vocationBusy === "gambit" ? "…" : "Manigancer une mise trafiquée (+ butin, + risque du groupe)"}
                      </button>
                    )}
                    {usedAbilities.has("traitre_gambit") && (
                      <p className="text-xs text-amber-400/70 italic">La mise est lancée pour cette étape.</p>
                    )}
                    {myVocation === "Traitre" && step.event_type === "marchand" && !usedAbilities.has("traitre_vente") && (
                      <div>
                        <p className="text-[10px] text-muted-foreground/60 mb-1">Disponible car tu es Traître</p>
                        <button onClick={useTraitreVente} disabled={vocationBusy === "traitre_vente"}
                          className="w-full text-xs uppercase tracking-[0.1em] border border-amber-400/40 text-amber-400 px-3 py-2 hover:bg-amber-400/10 disabled:opacity-30">
                          {vocationBusy === "traitre_vente" ? "…" : "Vendre la position du groupe (or personnel, en secret)"}
                        </button>
                      </div>
                    )}
                    {usedAbilities.has("traitre_vente") && (
                      <p className="text-xs text-amber-400/70 italic">Personne ne sait ce que tu as fait. Pour l'instant.</p>
                    )}
                    <LedgerError message={vocationError} />
                  </div>
                )}
                {step.event_type === "marchand" && step.resolving === false && step.resolved === false && (
                  <PotionShop step={step} character={character} expeditionId={expeditionId} />
                )}
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
              </>
            )}
            {verdictPending && (
              /* Le calcul est déjà fait côté serveur, mais on ne le montre pas
                 tout de suite : le joueur déclenche lui-même la révélation,
                 plutôt qu'une jauge qui s'anime automatiquement dès que le
                 résultat est prêt. */
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground italic mb-4">Le sort du groupe est scellé…</p>
                <ImmersiveButton variant="clair" onClick={revealVerdict}>
                  <span className="flex items-center justify-center gap-2">
                    <img src="/icons/scroll.webp" alt="" className="h-5 w-5 object-contain" />
                    Révéler le verdict
                  </span>
                </ImmersiveButton>
              </div>
            )}
            {!verdictPending && (step.resolving || revealingOutcome) && (
              <>
                {resolvingRisk != null && (
                  <p className="text-center text-sm text-red-400 mb-3">Risque de cette étape : {Math.round(resolvingRisk * 100)}%</p>
                )}
                <div className="mb-6">
                  <div className="h-4 border border-border/60 relative overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 bg-gradient-to-r from-red-500/60 via-amber-400/60 to-emerald-500/60 ${revealingOutcome ? "transition-all duration-200 ease-out" : "transition-all duration-1000 ease-in-out"}`}
                      style={{ width: `${gaugeWobble}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] uppercase tracking-[0.1em] text-muted-foreground mt-1">
                    <span>Échec</span>
                    <span>Réussite</span>
                  </div>
                </div>

                {revealingOutcome ? (
                  <p className="text-center text-sm text-muted-foreground mb-4 italic">…</p>
                ) : (
                  <>
                    <p className="text-center text-sm text-muted-foreground mb-4">
                      {secondsLeft > 0 ? `${formatCountdown(secondsLeft)} avant le verdict` : "Verdict imminent…"}
                    </p>

                    {secondsLeft > 0 && (
                      <button onClick={voteSkip} disabled={skipBusy || skipTally?.mine}
                        className="w-full mb-4 text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-3 py-2 hover:border-primary/40 hover:text-primary disabled:opacity-50">
                        {skipBusy ? "…" : `Accélérer${skipTally ? ` ${skipTally.count}/${skipTally.total}` : ""}`}
                      </button>
                    )}

                    {/* Le bloc Intervenir/Fouiller/Potion vit aussi dans le panneau
                        ci-dessus pendant le vote — ici, en résolution, il reste
                        nécessaire puisque le panneau n'affiche cette rangée que
                        pendant la phase de vote. */}
                    {!!interventionsRemaining && (
                      <div className="grid grid-cols-3 gap-1.5 mb-2">
                        <button onClick={useIntervention} disabled={interventionBusy || myIntervened || mySearched || !interventionsRemaining}
                          title={`Intervenir (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`}
                          className="relative flex flex-col items-center gap-0.5 py-1.5 border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 disabled:opacity-30 rounded-sm">
                          <img src="/icons/gauntlet.webp" alt="" className="h-5 w-5 object-contain" />
                          <span className="text-[8px] uppercase tracking-[0.04em]">Intervenir</span>
                          <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-primary/60 text-[9px] flex items-center justify-center text-primary">{interventionsRemaining}</span>
                        </button>
                        <button onClick={searchForCuriosity} disabled={searchBusy || myIntervened || mySearched || !interventionsRemaining}
                          title={`Fouiller (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`}
                          className="relative flex flex-col items-center gap-0.5 py-1.5 border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 disabled:opacity-30 rounded-sm">
                          <img src="/icons/magnifier.webp" alt="" className="h-5 w-5 object-contain" />
                          <span className="text-[8px] uppercase tracking-[0.04em]">Fouiller</span>
                          <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-primary/60 text-[9px] flex items-center justify-center text-primary">{interventionsRemaining}</span>
                        </button>
                        {hasPotion ? (
                          <button onClick={drinkPotion} disabled={drinkBusy || myIntervened || mySearched || !interventionsRemaining}
                            title={`Boire une potion (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`}
                            className="relative flex flex-col items-center gap-0.5 py-1.5 border border-emerald-400/40 text-emerald-300 bg-emerald-500/5 hover:bg-emerald-500/10 disabled:opacity-30 rounded-sm">
                            <img src="/icons/potion.webp" alt="" className="h-5 w-5 object-contain" />
                            <span className="text-[8px] uppercase tracking-[0.04em]">Potion</span>
                            <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-emerald-400/60 text-[9px] flex items-center justify-center text-emerald-300">{interventionsRemaining}</span>
                          </button>
                        ) : <div />}
                      </div>
                    )}
                    {(myIntervened || mySearched || myDrunk) && (
                      <p className="text-[10px] text-center text-muted-foreground/70 mb-2">
                        {myIntervened && "Intervention utilisée sur cette étape."}
                        {mySearched && searchResult && (searchResult.found ? `Fouille : trouvé ${searchResult.name}.` : "Fouille infructueuse.")}
                        {myDrunk && drinkResult !== null && `Potion bue, ${drinkResult} PV.`}
                      </p>
                    )}

                    {allInterventionUsers.length > 0 && (
                      <p className="text-xs text-amber-400/90 text-center mt-2">
                        Déjà agi sur cette étape : {allInterventionUsers.map(u =>
                          `${u.name} (${u.action === "aide" ? "intervention" : u.action === "fouille" ? "fouille" : "potion"})`
                        ).join(", ")}
                      </p>
                    )}

                    {availableBotsForIntervention.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/20 flex flex-wrap gap-2 justify-center">
                        {availableBotsForIntervention.map((p) => (
                          <button key={p.character_id} onClick={() => useInterventionAsBot(p.character_id)} disabled={interventionBusy}
                            className="text-[10px] uppercase tracking-[0.08em] border border-amber-500/50 text-amber-300 px-2 py-1 hover:bg-amber-500/10 disabled:opacity-30">
                            Intervenir ({p.character.name})
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <LedgerError message={error} />
            {canResolve && error && (
              <button onClick={resolveStep} disabled={busy}
                className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-30">
                {busy ? "Résolution…" : "Réessayer"}
              </button>
            )}
            {step && <LarcenyButton expeditionId={expeditionId} step={step} character={character} aliveParticipants={aliveParticipants} />}
            {isAdmin && (
              <button onClick={copyDebugReport}
                className="w-full mb-2 text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-3 py-1.5 hover:border-amber-500/40 hover:text-amber-300">
                {debugCopied ? "Copié ✓" : "Copier le rapport de debug (partage-le-moi)"}
              </button>
            )}
          </>
        )}
      </LedgerCard>
      {step && (!step.resolved || verdictPending || revealingOutcome) && (
        <>
          <div className="mt-4 border border-border/30 rounded-sm bg-card/60 p-3 xl:mt-0 xl:fixed xl:top-24 xl:right-6 xl:z-10 xl:w-72 xl:border-0 xl:bg-card/40 xl:backdrop-blur-sm xl:rounded-sm">
            <ChatBox expeditionId={expeditionId} character={character} />
            <NotificationsPanel character={character} />
          </div>
          <div className="relative mt-4 pt-8 px-6 pb-6 xl:fixed xl:top-24 xl:left-6 xl:z-10 xl:w-64 xl:mt-0 xl:pt-3 xl:px-3 xl:pb-3 xl:bg-card/40 xl:backdrop-blur-sm xl:rounded-sm">
                <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Groupe</p>
                <div className="space-y-1.5">
                  {participants.map((p, idx) => {
                    const maxHp = getMaxHp((p.character as any)?.level ?? 1);
                    const hp = (p.character as any)?.hp ?? maxHp;
                    const hpRatio = maxHp > 0 ? hp / maxHp : 1;
                    const hpColor = hpRatio <= 0.3 ? "#ef4444" : hpRatio <= 0.6 ? "#f59e0b" : "#22c55e";
                    const votes = frontlineTally[p.character_id] ?? 0;
                    const isMe = p.character_id === character?.id;
                    return (
                    <FramedBox key={p.character_id} frame={5}
                      className={`px-2 py-1.5 ${!p.is_alive ? "opacity-30" : ""}`}>
                      <div className="flex items-center gap-2">
                        <PortraitDisplay portraitId={(p.character as any)?.portrait ?? "ombre"} size={68} bordered={false} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs ${!p.is_alive ? "line-through text-red-400/50" : isMe ? "text-primary" : "text-muted-foreground"}`}>
                            {(p.character as any)?.name}{!p.is_alive ? " ✝" : ""}
                          </p>
                          {p.is_alive && (
                            <>
                              <div className="h-1.5 mt-1 mb-0.5 rounded-sm bg-black/50 border border-black/60 overflow-hidden">
                                <div className="h-full rounded-sm transition-all duration-500"
                                  style={{ width: `${Math.round(hpRatio * 100)}%`, backgroundColor: hpColor }} />
                              </div>
                              <p className="text-[10px] font-mono flex items-center gap-0.5" style={{ color: hpColor }}>
                                {hp}/{maxHp} <Heart size={9} className="fill-current" />
                              </p>
                            </>
                          )}
                          {shield && shield.resolved && !shield.broken_reason && shield.holder_character_id === p.character_id && shield.steps_remaining !== null && shield.steps_remaining > 0 && (
                            <p className="text-[10px] font-mono flex items-center gap-1 text-sky-400" title={`Bouclier ${shield.rarity} : -${shield.reduction} dégâts`}>
                              <img src={SHIELD_ICON[shield.rarity]} alt="" className="w-3.5 h-3.5 object-contain" /> {shield.steps_remaining}
                            </p>
                          )}
                        </div>
                        <VocationBadge vocationId={(p.character as any)?.declared_vocation} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {p.is_alive && step && !step.resolving && !step.resolved && (
                        <button
                          onClick={() => voteFrontline(p.character_id)}
                          title="Pousser cette personne devant pour la prochaine étape"
                          className={`text-[9px] uppercase tracking-[0.06em] border px-1.5 py-0.5 whitespace-nowrap ${myFrontlineTarget === p.character_id ? "border-amber-400 text-amber-300 bg-amber-500/10" : "border-border/30 text-muted-foreground/60 hover:border-amber-400/40 hover:text-amber-300"}`}
                        >
                          Pousser devant{votes > 0 ? ` (${votes})` : ""}
                        </button>
                      )}
                      {isAdmin && p.character.is_bot && p.is_alive && step && !votedIds.includes(p.character_id) && (
                        <div className="flex gap-1">
                          <button onClick={() => botVote(p.character_id, "continuer")} disabled={botBusy === p.character_id}
                            className="text-[10px] uppercase border border-amber-500/40 text-amber-300 px-1.5 py-0.5 hover:bg-amber-500/10 disabled:opacity-30">
                            Continuer
                          </button>
                          <button onClick={() => botVote(p.character_id, "rentrer")} disabled={botBusy === p.character_id}
                            className="text-[10px] uppercase border border-amber-500/40 text-amber-300 px-1.5 py-0.5 hover:bg-amber-500/10 disabled:opacity-30">
                            Rentrer
                          </button>
                        </div>
                      )}
                      {isAdmin && p.character.is_bot && !p.is_alive && (
                        <button onClick={() => botRevive(p.character_id)} disabled={botBusy === p.character_id}
                          className="text-[10px] uppercase border border-amber-500/40 text-amber-300 px-1.5 py-0.5 hover:bg-amber-500/10 disabled:opacity-30">
                          {botBusy === p.character_id ? "…" : "Ressusciter"}
                        </button>
                      )}
                      {myVocation === "Inquisiteur" && p.is_alive && p.character_id !== character?.id && (
                        inspectResult?.id === p.character_id ? (
                          <span className={`text-xs ${inspectResult.honest ? "text-emerald-400" : "text-red-400"}`}>
                            {inspectResult.honest ? "Honnête" : "Traître"}
                          </span>
                        ) : usedAbilities.has("inquisiteur_inspect") ? null : (
                          <button onClick={() => useInspect(p.character_id)} disabled={vocationBusy === `inspect-${p.character_id}`}
                            className="text-[10px] uppercase tracking-[0.08em] border border-border/40 text-muted-foreground px-1.5 py-0.5 hover:border-primary/40 hover:text-primary disabled:opacity-30">
                            {vocationBusy === `inspect-${p.character_id}` ? "…" : "Enquêter"}
                          </button>
                        )
                      )}
                      {p.is_alive && (
                        <span className={votedIds.includes(p.character_id) ? "text-primary text-xs" : "text-muted-foreground/40 text-xs"}>
                          {votedIds.includes(p.character_id) ? "✓" : "…"}
                        </span>
                      )}
                      </div>
                    </FramedBox>
                    );
                  })}
                </div>
              </div>

              {/* Bouclier de groupe — texte narratif court à l'issue du
                  vote (gagné, cassé, expiré), une fois par bouclier. */}
              {shieldNotice && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm px-4 py-2.5 bg-card/95 border border-sky-400/40 backdrop-blur-sm rounded-sm text-xs text-center text-sky-100">
                  {shieldNotice}
                </div>
              )}

              {/* Bouclier de groupe — pop-up de vote tant qu'il n'est pas
                  résolu (gagnant désigné ou cassé par égalité). */}
              {shield && !shield.resolved && (() => {
                const rarityLabel = shield.rarity === "leger" ? "léger" : shield.rarity === "moyen" ? "moyen" : "lourd";
                const alive = participants.filter(p => p.is_alive);
                const totalVotes = Object.values(shieldTally).reduce((a, b) => a + b, 0);
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
                    <div className="w-full max-w-sm border border-primary/30 bg-card/95 backdrop-blur-sm rounded-sm p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <img src={SHIELD_ICON[shield.rarity]} alt="" className="w-12 h-12 object-contain flex-shrink-0" />
                        <div>
                          <p className="text-xs tracking-[0.14em] uppercase text-primary">Bouclier {rarityLabel} trouvé</p>
                          <p className="text-[11px] text-muted-foreground">
                            -{shield.reduction} dégâts pendant {shield.duration_steps} tour{shield.duration_steps > 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-4">
                        Le vote doit désigner un gagnant net, sinon il se brise pour tout le monde.
                      </p>
                      <div className="space-y-1.5 mb-4">
                        {alive.map(p => {
                          const name = (p.character as any)?.name ?? "?";
                          const votes = shieldTally[p.character_id] ?? 0;
                          const isMine = myShieldTarget === p.character_id;
                          return (
                            <button key={p.character_id} disabled={shieldBusy}
                              onClick={() => voteShield(p.character_id)}
                              className={`w-full flex items-center justify-between px-3 py-2 text-xs border ${isMine ? "border-primary text-primary" : "border-border/40 text-muted-foreground"} hover:border-primary/60 disabled:opacity-50`}>
                              <span>{name}{p.character_id === character?.id ? " (toi)" : ""}</span>
                              <span className="font-mono">{votes > 0 ? `${votes} vote${votes > 1 ? "s" : ""}` : ""}</span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-muted-foreground text-center">
                        {totalVotes}/{alive.length} vote{alive.length > 1 ? "s" : ""}
                        {isAsync ? " — clôture dès que tout le monde a voté" : " — clôture automatique à la fin du délai"}
                      </p>
                    </div>
                  </div>
                );
              })()}
        </>
      )}
    </LedgerPage>
  );
}

type ChatMessage = { id: string; character_id: string; message: string; created_at: string; character: { name: string } };

function NotificationsPanel({ character }: { character: Character | null }) {
  const [notifs, setNotifs] = useState<{ id: string; message: string }[]>([]);

  const fetchNotifs = useCallback(async () => {
    if (!character) return;
    const { data } = await supabase
      .from("character_notifications" as any)
      .select("id, message")
      .eq("character_id", character.id)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    setNotifs((data as any) ?? []);
  }, [character]);

  useEffect(() => {
    if (!character) return;
    void fetchNotifs();
    const channel = supabase
      .channel(`character_notifications_${character.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "character_notifications",
        filter: `character_id=eq.${character.id}`,
      }, () => { void fetchNotifs(); soundTap(); })
      .subscribe();
    const poll = setInterval(fetchNotifs, 10000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [character, fetchNotifs]);

  async function dismiss(id: string) {
    setNotifs(prev => prev.filter(n => n.id !== id));
    await supabase.from("character_notifications" as any).update({ read_at: new Date().toISOString() }).eq("id", id);
  }

  if (!character || notifs.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-dashed border-amber-500/25 space-y-1.5">
      <p className="text-[10px] tracking-[0.14em] uppercase text-amber-400/70 mb-1.5">Notifications</p>
      {notifs.map(n => (
        <div key={n.id} className="border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 flex items-start gap-2">
          <p className="text-[11px] text-amber-200 flex-1 leading-snug">{n.message}</p>
          <button onClick={() => dismiss(n.id)} className="text-amber-400/60 hover:text-amber-300 text-xs leading-none">✕</button>
        </div>
      ))}
    </div>
  );
}

function LarcenyButton({ expeditionId, step, character, aliveParticipants }: {
  expeditionId: string; step: Step; character: Character | null;
  aliveParticipants: { character_id: string; character: { name: string } }[];
}) {
  const [confirm, setConfirm] = useState(false);
  const [target, setTarget] = useState<string>("guilde");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ success: boolean; amount: number } | null>(null);
  const [alreadyTried, setAlreadyTried] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const others = aliveParticipants.filter(p => p.character_id !== character?.id);

  useEffect(() => {
    if (!character) return;
    void (async () => {
      const [{ data: attempt }, { data: part }] = await Promise.all([
        supabase.from("larceny_attempts" as any)
          .select("succeeded, amount").eq("step_id", step.id).eq("character_id", character.id).maybeSingle(),
        supabase.from("expedition_participants")
          .select("interventions_remaining").eq("expedition_id", expeditionId).eq("character_id", character.id).maybeSingle(),
      ]);
      if (attempt) { setAlreadyTried(true); setResult(attempt as any); }
      setRemaining((part as any)?.interventions_remaining ?? null);
    })();
  }, [expeditionId, step.id, character]);

  if (!character) return null;
  if (result) {
    return (
      <p className={`text-xs text-center mt-2 ${result.success ? "text-amber-400" : "text-red-400"}`}>
        {result.success ? `Larcin réussi, +${Math.round(result.amount)} or, en silence.` : "Larcin raté sur cette étape."}
      </p>
    );
  }
  if (alreadyTried) return null;

  async function attempt() {
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc("attempt_larceny" as any, {
      p_step_id: step.id,
      p_character_id: character!.id,
      p_target_type: target === "guilde" ? "guilde" : "joueur",
      p_target_character_id: target === "guilde" ? null : target,
    });
    if (rpcError) setError(rpcError.message);
    else { setResult(data as any); setRemaining(r => (r ?? 1) - 1); }
    setBusy(false); setConfirm(false);
  }

  if (!remaining) {
    // Pas de charge dans la réserve (partagée avec Intervenir/Fouiller/
    // Potion) : rien à afficher, comme les autres actions de la réserve
    // une fois épuisée.
    return null;
  }

  if (!confirm) return (
    <button onClick={() => setConfirm(true)}
      className="w-full mt-2 text-xs uppercase tracking-[0.1em] border border-border/30 text-muted-foreground/70 px-3 py-2 hover:border-amber-500/40 hover:text-amber-400 transition-colors">
      <span className="inline-flex items-center gap-2">
        <img src="/icons/pouch_hand.webp" alt="" className="h-5 w-5 object-contain" />
        Tenter un larcin ({remaining} restante{remaining > 1 ? "s" : ""})
      </span>
    </button>
  );

  return (
    <div className="mt-2 border border-amber-500/30 px-3 py-2 text-center">
      <p className="text-xs text-amber-300/80 mb-2">60% de réussite.</p>
      <label className="block text-[10px] uppercase tracking-[0.1em] text-muted-foreground mb-1 text-left">Voler…</label>
      <select value={target} onChange={e => setTarget(e.target.value)}
        className="w-full mb-2 bg-transparent border border-amber-500/40 text-amber-200 text-xs px-2 py-1.5 focus:outline-none">
        <option value="guilde" className="bg-background text-foreground">Le pot commun de la guilde (2% du butin — échec révélé à toute la guilde)</option>
        {others.map(p => (
          <option key={p.character_id} value={p.character_id} className="bg-background text-foreground">
            {p.character.name} (20% de sa part estimée — reste secret quoi qu'il arrive)
          </option>
        ))}
      </select>
      <LedgerError message={error} />
      <div className="flex gap-2">
        <button onClick={attempt} disabled={busy}
          className="flex-1 text-xs uppercase border border-amber-500/40 text-amber-300 py-1.5 hover:bg-amber-500/10 disabled:opacity-30">
          {busy ? "…" : "Tenter"}
        </button>
        <button onClick={() => setConfirm(false)} disabled={busy}
          className="flex-1 text-xs uppercase border border-border/40 text-muted-foreground py-1.5 hover:bg-border/10">
          Renoncer
        </button>
      </div>
    </div>
  );
}

function PotionShop({ step, character, expeditionId }: { step: Step; character: Character | null; expeditionId: string }) {
  const [totalBought, setTotalBought] = useState(0);
  const [owned, setOwned] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!character) return;
    const { data } = await supabase
      .from("character_potions")
      .select("id, consumed_at")
      .eq("character_id", character.id)
      .eq("expedition_id", expeditionId);
    const rows = (data as any[]) ?? [];
    setTotalBought(rows.length);
    setOwned(rows.filter((r) => !r.consumed_at).length);
  }, [character, expeditionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!character) return null;

  const nextPrice = Math.round(80 * Math.pow(6, totalBought) * (1 + 0.05 * (step.step_number - 1)));

  async function buy() {
    if (!character) return;
    setBusy(true); setMsg(null);
    const { data, error: rpcError } = await supabase.rpc("buy_potion" as any, { p_character_id: character.id, p_step_id: step.id });
    if (rpcError) setMsg(rpcError.message);
    else { setMsg(`Potion achetée pour ${(data as any)?.price ?? nextPrice} or.`); await refresh(); }
    setBusy(false);
  }

  return (
    <div className="mb-4 px-3 py-2 border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Le marchand vend des potions de soin (+8 <Heart size={11} className="inline -mt-0.5 fill-current text-emerald-300" />).{owned > 0 && <span className="text-primary"> Tu en portes {owned}.</span>}
        </p>
        <button onClick={buy} disabled={busy}
          className="text-xs uppercase tracking-[0.1em] border border-amber-400/50 text-amber-300 px-3 py-1.5 hover:bg-amber-500/10 disabled:opacity-30 whitespace-nowrap">
          {busy ? "…" : `Acheter (${nextPrice} or)`}
        </button>
      </div>
      {msg && <p className="text-[10px] text-muted-foreground mt-1.5">{msg}</p>}
    </div>
  );
}

function ChatBox({ expeditionId, character }: { expeditionId: string; character: Character | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tensionRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { unlockAudio(); return () => { if (tensionRef.current) clearInterval(tensionRef.current); }; }, []);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("expedition_chat_messages")
      .select("id, character_id, message, created_at, character:characters(name, portrait)")
      .eq("expedition_id", expeditionId)
      .order("created_at", { ascending: true })
      .limit(50);
    setMessages((data as any) ?? []);
  }, [expeditionId]);

  useEffect(() => {
    void fetchMessages();
    // Même correctif que le chat de guilde : le temps réel fait le gros du
    // travail, le sondage de 5s ne reste qu'un filet de sécurité — avant,
    // c'était le sondage seul qui portait tout, avec les mêmes symptômes de
    // "chat qui se fige".
    const channel = supabase
      .channel(`expedition_chat_${expeditionId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "expedition_chat_messages",
        filter: `expedition_id=eq.${expeditionId}`,
      }, () => { void fetchMessages(); })
      .subscribe();
    pollRef.current = setInterval(fetchMessages, 5000);
    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchMessages, expeditionId]);

  // Ne fait défiler vers le bas que si on était déjà proche du bas (ou si
  // c'est nous qui venons d'écrire) — avant, ça sautait tout en bas à
  // chaque message reçu, y compris en train de relire plus haut.
  const prevMsgCount = useRef(0);
  const sentByMeRef = useRef(false);
  useEffect(() => {
    const grew = messages.length > prevMsgCount.current;
    prevMsgCount.current = messages.length;
    if (!grew) return;
    const box = scrollBoxRef.current;
    const wasNearBottom = box
      ? box.scrollHeight - box.scrollTop - box.clientHeight < 60
      : true;
    if (wasNearBottom || sentByMeRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    sentByMeRef.current = false;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !character || busy) return;
    setBusy(true);
    sentByMeRef.current = true;
    const { error } = await supabase.from("expedition_chat_messages").insert({
      expedition_id: expeditionId, character_id: character.id, message: text.trim(),
    });
    if (error) sentByMeRef.current = false;
    setText("");
    await fetchMessages();
    setBusy(false);
  }

  return (
    <div className="relative mt-4 pt-6 px-4 pb-4">
      <DecorativeBorder variant="square" />
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Chat</p>
      <div ref={scrollBoxRef} className="h-40 overflow-y-auto space-y-1.5 mb-2 pr-1">
        {messages.length === 0
          ? <p className="text-xs text-muted-foreground/40 italic">Silence.</p>
          : messages.map((m) => (
            <div key={m.id} className="flex items-start gap-1.5">
              <PortraitDisplay portraitId={(m.character as any)?.portrait ?? "ombre"} size={20} bordered={false} />
              <p className={`text-xs leading-snug ${m.character_id === character?.id ? "text-primary" : "text-muted-foreground"}`}>
                <span className="font-semibold">{(m.character as any)?.name ?? "?"}</span>
                <span className="mx-1 opacity-40">·</span>
                <span>{m.message}</span>
              </p>
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
