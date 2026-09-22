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
// Affichage seulement — la valeur interne event_type reste "gardien" en
// base (colonnes, comparaisons SQL, mapping d'icônes ci-dessus) : renommer
// la valeur elle-même toucherait event_templates, expedition_steps et
// plusieurs fonctions SQL (ex. finalize_resolution compare littéralement
// event_type = 'gardien'). Seul ce que le joueur lit change.
const EVENT_TYPE_LABEL: Record<string, string> = {
  coffre: "Coffre", gardien: "Adversaire", marchand: "Marchand", rencontre: "Rencontre",
  decouverte: "Découverte", porte: "Porte", passage: "Passage", traces: "Traces",
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
  rencontre: [
    "/event_rencontre.webp", "/event_rencontre_bis.webp",
    "/event_r_feu.webp", "/event_r_barricade.webp",
    "/event_r_procession.webp", "/event_r_table.webp",
  ],
  decouverte: [
    "/event_decouverte.webp",
    "/event_d_masque.webp", "/event_d_cloche.webp",
    "/event_d_livre.webp", "/event_d_bottes.webp",
    "/event_d_main.webp",
  ],
  traces: [
    "/event_traces.webp",
    "/event_t_fleches1.webp", "/event_t_fleches2.webp",
    "/event_t_cle1.webp", "/event_t_cle2.webp",
    "/event_t_pendu.webp", "/event_t_mains.webp",
  ],
  marchand: ["/event_marchand.webp", "/event_marchand_bis.webp"],
};
// Variantes supplémentaires selon le palier de risque — s'ajoutent au pool
// ci-dessus, ne le remplacent jamais.
const EVENT_IMAGES_BY_RISK: Partial<Record<string, Partial<Record<string, string | string[]>>>> = {
  coffre: {
    faible: ["/event_coffre_faible.webp", "/event_c_cassette.webp", "/event_c_couverture.webp"],
    moyen: ["/event_coffre_moyen.webp", "/event_c_chaines.webp", "/event_c_trois.webp", "/event_c_cire.webp"],
    eleve: ["/event_coffre_eleve.webp", "/event_c_cage.webp", "/event_c_cendres.webp", "/event_c_squelettes.webp"],
  },
  gardien: {
    faible: ["/event_gardien_faible.webp", "/event_g_priere.webp"],
    moyen: ["/event_gardien_moyen.webp", "/event_g_chaines_porte.webp", "/event_g_immobile.webp"],
    eleve: ["/event_gardien_eleve.webp", "/event_g_geant.webp", "/event_g_pierre.webp"],
  },
  porte: { faible: "/event_porte_faible.webp", moyen: "/event_porte_moyen.webp", eleve: "/event_porte_eleve.webp" },
  passage: {
    faible: ["/event_passage_faible.webp", "/event_pa_racines.webp"],
    moyen: "/event_passage_moyen.webp",
    eleve: ["/event_passage_eleve.webp", "/event_pa_epees.webp"],
  },
  // Découverte n'avait encore aucune variante de risque (toutes les
  // étapes, quel que soit le palier, partageaient la même image
  // générique) — celle-ci ne sert que pour le palier élevé, les
  // paliers faible/moyen retombent toujours sur le pool générique.
  decouverte: { eleve: "/event_decouverte_eleve.webp" },
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
  if (riskVariant) {
    if (Array.isArray(riskVariant)) {
      const idx = step.id.charCodeAt(0) % riskVariant.length;
      return riskVariant[idx] ?? riskVariant[0] ?? "";
    }
    return riskVariant;
  }
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
const CINEMATIC_DEATH_IMGS = ["/step_fail.webp", "/cinematic_death.webp", "/cinematic_death_bis.webp"]; // fallback générique quand le event_type n'a pas d'image d'échec dédiée
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
    die: ["L'adversaire était plus rapide qu'il n'en avait l'air.", "La formation s'effondre. L'un d'eux ne se relève pas.", "Il n'a fallu qu'une ouverture. Une seule."],
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
  // Étape venant d'un événement communautaire : image dédiée (fournie par
  // la modération, pas passée par le fondu parchemin — à préparer par
  // Lils si elle veut le même traitement) + provenance affichée
  // discrètement. Reste tout à null pour une étape normale (pas de
  // template lié, ou template pas communautaire) : rien ne change alors
  // dans l'affichage.
  const [communityInfo, setCommunityInfo] = useState<{ isCommunity: boolean; imagePath: string | null; authorName: string | null; guildName: string | null } | null>(null);
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
  const [discordNotifsEnabled, setDiscordNotifsEnabled] = useState(true);
  const [discordNotifsBusy, setDiscordNotifsBusy] = useState(false);
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
  const [outcomeFlash, setOutcomeFlash] = useState<"success" | "failure" | null>(null);
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
  const [myMartyrTarget, setMyMartyrTarget] = useState<string | null>(null);
  const [myInquisiteurInvestigation, setMyInquisiteurInvestigation] = useState<{ stepId: string; targetId: string } | null>(null);
  const [inquisiteurFindings, setInquisiteurFindings] = useState<{ target_name: string; real_vote: string | null; pushed_frontline_target: string | null; attempted_larceny: boolean; used_secret_ability: boolean } | null>(null);
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

      // Bug réel corrigé ici : en asynchrone, vote_deadline est fixé à
      // +100 ans (voir finalize_resolution), donc la vérification du délai
      // juste en dessous ne se déclenche jamais. Sans ce check d'unanimité
      // — couvert à la fois par ce sondage toutes les 5s et par chaque
      // vote individuel — même un vote unanime ne finalisait jamais le
      // bouclier : il restait pendant jusqu'à ce que l'expédition se
      // termine, et mourait avec elle (broken_reason: expedition_terminee)
      // sans avoir jamais été porté par personne.
      const { data: freshVotes } = await supabase
        .from("step_shield_votes")
        .select("target_character_id")
        .eq("shield_id", row.id);
      const tallyNow: Record<string, number> = {};
      for (const v of (freshVotes as any[]) ?? []) tallyNow[v.target_character_id] = (tallyNow[v.target_character_id] ?? 0) + 1;
      const aliveNow = aliveParticipants.length;
      const unanimousTarget = aliveNow > 0 ? Object.entries(tallyNow).find(([, count]) => count >= aliveNow) : null;

      const deadlinePassed = new Date(row.vote_deadline) <= new Date();
      if (deadlinePassed || unanimousTarget) {
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
  }, [expeditionId, fetchShieldVotes, aliveParticipants]);

  async function voteShield(targetId: string) {
    if (!shield || !character) return;
    const next = myShieldTarget === targetId ? null : targetId;
    setMyShieldTarget(next); // optimiste
    setShieldBusy(true);
    const { error: rpcError } = await supabase.rpc("vote_shield" as any, {
      p_shield_id: shield.id, p_voter_character_id: character.id, p_target_character_id: next,
    });
    if (rpcError) setError(rpcError.message);
    // fetchShield() (pas juste fetchShieldVotes) : elle vérifie aussi si ce
    // vote vient d'atteindre l'unanimité et finalise le bouclier si c'est
    // le cas — voir le commentaire dans fetchShield.
    await fetchShield();
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
    const stepSelect = "id, step_number, event_type, risk_level, loot_min, loot_max, vote_deadline, resolved, deaths_count, description, risk_revealed, resolving, resolution_deadline, was_retreat, resolved_at, third_option_kind, third_option_label, third_option_loot_min, third_option_loot_max, third_option_cost, resolution_type, required_vocation, required_flag_sentiment, required_flag, death_percentage, third_option_death_pct, situation_success_text, situation_failure_text";

    // IMPORTANT : le joueur doit voir personnellement le récapitulatif de
    // chaque étape résolue tant qu'il ne l'a pas validé lui-même.
    //
    // Le serveur peut générer l'étape suivante après son délai de secours de
    // 90 s afin de ne pas bloquer le reste du groupe. Cela ne doit PAS être
    // interprété comme une validation au nom du joueur absent.
    //
    // On cherche donc d'abord la plus ancienne étape résolue de l'expédition
    // qui n'a pas encore d'acknowledgment pour CE personnage. S'il n'y en a
    // aucune, seulement alors on affiche l'étape la plus récente/active.
    let data: any = null;
    let isPendingRecap = false;

    if (characterIdRef.current) {
      const { data: resolvedSteps } = await supabase
        .from("expedition_steps")
        .select(stepSelect)
        .eq("expedition_id", expeditionId)
        .eq("resolved", true)
        .order("step_number", { ascending: true });

      const resolvedIds = (resolvedSteps ?? []).map((s: any) => s.id);
      if (resolvedIds.length > 0) {
        const { data: myAcks } = await supabase
          .from("step_acknowledgments")
          .select("step_id")
          .eq("character_id", characterIdRef.current)
          .in("step_id", resolvedIds);

        const ackedIds = new Set((myAcks ?? []).map((a: any) => a.step_id));
        const pending = (resolvedSteps ?? []).find((s: any) => !ackedIds.has(s.id));
        if (pending) {
          data = pending;
          isPendingRecap = true;
        }
      }
    }

    if (!data) {
      const { data: latestStep } = await supabase
        .from("expedition_steps")
        .select(stepSelect)
        .eq("expedition_id", expeditionId)
        .order("step_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      data = latestStep;
    }

    if (data) {
      const isNewStep = stepIdRef.current !== null && stepIdRef.current !== data.id;
      if (isNewStep) {
        stepIdRef.current = data.id;
        setMyVote(null);
        setVotedIds([]);
        setFrontlineTally({});
        setMyFrontlineTarget(null);
        setMyMartyrTarget(null);
        setInquisiteurFindings(null);
        setResult(null);
        // Éclaireur : voit désormais le risque en permanence, sans action
        // à faire — plus besoin d'un bouton "révéler" consommé une fois.
        setMyPrivateRisk(myVocation === "Eclaireur" ? data.death_percentage : null);
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

      // Dès que le serveur a résolu l'étape, on enchaîne automatiquement :
      // la jauge bascule brièvement vers Échec ou Réussite, puis l'écran de
      // résolution apparaît. Il n'existe plus de phase "verdict" à cliquer.
      // Un retour volontaire ("rentrer") reste instantané et ne passe pas par
      // cette animation.
      if (data.resolved && !resultShownRef.current) {
        resultShownRef.current = true;

        // Si le joueur revient après coup sur un résultat qu'il n'a jamais
        // validé, on lui montre directement le récapitulatif. On ne rejoue
        // pas l'animation de verdict : elle est réservée au moment où le
        // résultat tombe en direct.
        if (isPendingRecap) {
          await showStepResult(data.id, data.event_type, data.deaths_count, !!data.was_retreat);
          return;
        }

        if (data.was_retreat) {
          await showStepResult(data.id, data.event_type, data.deaths_count, true);
          return;
        }

        // La notion visuelle de réussite suit la même logique que le récit :
        // s'il y a eu des dégâts, on fait basculer la jauge côté Échec, même
        // si personne n'est mort.
        const { count: damageCount } = await supabase
          .from("step_damage_log")
          .select("id", { count: "exact", head: true })
          .eq("step_id", data.id)
          .gt("damage", 0);
        const goodOutcome = data.deaths_count === 0 && (damageCount ?? 0) === 0;

        setRevealingOutcome(true);
        setOutcomeFlash(null);
        soundRevealClick();

        const startPct = Math.max(5, Math.min(95, Math.round((1 - (data.death_percentage ?? 0.5)) * 100)));
        const targetPct = goodOutcome ? 96 : 4;
        setGaugeWobble(startPct);

        const startedAt = Date.now();
        const duration = 1250;
        const animInterval = setInterval(() => {
          const t = Math.min(1, (Date.now() - startedAt) / duration);
          // Ease-out : rapide au départ, ralentit en arrivant sur le verdict.
          const eased = 1 - Math.pow(1 - t, 3);
          setGaugeWobble(startPct + (targetPct - startPct) * eased);
        }, 40);

        await new Promise(r => setTimeout(r, duration));
        clearInterval(animInterval);
        setGaugeWobble(targetPct);
        setOutcomeFlash(goodOutcome ? "success" : "failure");

        // Petit temps pour lire le verdict lumineux avant l'écran de résultat.
        await new Promise(r => setTimeout(r, 550));
        setRevealingOutcome(false);
        setOutcomeFlash(null);
        await showStepResult(data.id, data.event_type, data.deaths_count);
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

      // Ne jamais valider automatiquement le résultat au nom du joueur.
      // Le délai de secours de 90 s est géré côté serveur uniquement pour
      // permettre au groupe de progresser. L'acknowledgment personnel reste
      // volontaire : le joueur doit cliquer "Continuer" sur son récapitulatif.
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
      const asyncMode = ((expData as any)?.vote_window_seconds ?? 180) !== 180;
      setIsAsync(asyncMode);
      if (asyncMode && char?.id) {
        const { data: notifPref } = await supabase
          .from("expedition_participants")
          .select("discord_notifications_enabled")
          .eq("expedition_id", expeditionId)
          .eq("character_id", char.id)
          .maybeSingle();
        setDiscordNotifsEnabled((notifPref as any)?.discord_notifications_enabled ?? true);
      }
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


  async function useMartyrProvocation() {
    if (!step || !character) return;
    setVocationError(null); setVocationBusy("martyr_provocation");
    const { error: rpcError } = await supabase.rpc("trigger_martyr_provocation" as any, { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setVocationError(rpcError.message);
    else { setUsedAbilities(prev => new Set(prev).add("martyr_provocation")); await fetchStep(); }
    setVocationBusy(null);
  }

  async function useMiracleBet() {
    if (!step || !character) return;
    setVocationError(null); setVocationBusy("miracle_bet");
    const { error: rpcError } = await supabase.rpc("use_miracle_bet" as any, { p_step_id: step.id, p_character_id: character.id });
    if (rpcError) setVocationError(rpcError.message);
    else setUsedAbilities(prev => new Set(prev).add("miracle_bet"));
    setVocationBusy(null);
  }

  async function useTresorierSecure() {
    if (!character) return;
    setVocationError(null); setVocationBusy("tresorier_secure");
    const { error: rpcError } = await supabase.rpc("use_tresorier_secure" as any, { p_character_id: character.id, p_expedition_id: expeditionId });
    if (rpcError) setVocationError(rpcError.message);
    else setUsedAbilities(prev => new Set(prev).add("tresorier_secure"));
    setVocationBusy(null);
  }

  async function designateMartyrTarget(targetId: string) {
    if (!step || !character) return;
    const next = myMartyrTarget === targetId ? null : targetId;
    setVocationError(null); setVocationBusy("martyr_target");
    if (next) {
      const { error: rpcError } = await supabase.rpc("designate_martyr_target" as any, {
        p_step_id: step.id, p_character_id: character.id, p_target_character_id: next,
      });
      if (rpcError) { setVocationError(rpcError.message); setVocationBusy(null); return; }
    }
    setMyMartyrTarget(next);
    setVocationBusy(null);
  }

  async function designateInquisiteurTarget(targetId: string) {
    if (!step || !character) return;
    setVocationError(null); setVocationBusy("inquisiteur_target");
    const { error: rpcError } = await supabase.rpc("designate_inquisiteur_target" as any, {
      p_step_id: step.id, p_character_id: character.id, p_target_character_id: targetId,
    });
    if (rpcError) setVocationError(rpcError.message);
    else { setMyInquisiteurInvestigation({ stepId: step.id, targetId }); setUsedAbilities(prev => new Set(prev).add("inquisiteur_target")); }
    setVocationBusy(null);
  }

  async function revealInquisiteurFindings() {
    if (!character || !myInquisiteurInvestigation) return;
    setVocationError(null); setVocationBusy("inquisiteur_reveal");
    const { data, error: rpcError } = await supabase.rpc("get_inquisiteur_findings" as any, {
      p_step_id: myInquisiteurInvestigation.stepId, p_character_id: character.id,
    });
    if (rpcError) setVocationError(rpcError.message);
    else setInquisiteurFindings((data as any)?.[0] ?? null);
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

  async function toggleAsyncDiscordNotifications() {
    if (!character || !isAsync || discordNotifsBusy) return;
    const nextEnabled = !discordNotifsEnabled;
    setDiscordNotifsBusy(true);
    const { error: rpcError } = await supabase.rpc("set_async_discord_notifications" as any, {
      p_expedition_id: expeditionId,
      p_character_id: character.id,
      p_enabled: nextEnabled,
    });
    if (rpcError) setError(rpcError.message);
    else setDiscordNotifsEnabled(nextEnabled);
    setDiscordNotifsBusy(false);
  }

  async function copyDebugReport() {
    const { data, error: rpcError } = await supabase.rpc("admin_debug_expedition", { p_expedition_id: expeditionId });
    if (rpcError) { setError(rpcError.message); return; }
    void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setDebugCopied(true);
    setTimeout(() => setDebugCopied(false), 2000);
  }

  async function showStepResult(stepId: string, eventType: string, deathsCountHint: number, isRetreat: boolean = false) {
    try {
      await showStepResultInner(stepId, eventType, deathsCountHint, isRetreat);
    } catch (err) {
      // Si une des requêtes de ce récapitulatif échoue (ex. la mort vient de
      // se produire et une requête annexe — comme l'or hérité — bute sur un
      // souci passager), on ne doit surtout pas rester bloqué indéfiniment :
      // resultShownRef avait déjà été mis à true avant cet appel, donc sans
      // ce filet, plus aucune tentative automatique ne se relance et seul un
      // F5 (qui réinitialise l'état React) permet de revoir l'écran.
      console.error("[showStepResult] échec, nouvelle tentative au prochain sondage", err);
      resultShownRef.current = false;
    }
  }

  async function showStepResultInner(stepId: string, eventType: string, deathsCountHint: number, isRetreat: boolean = false) {
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
        ? "Un seul d'entre vous s'est avancé pour réveiller l'adversaire. Le reste du groupe n'a rien risqué, mais ce silence a un prix."
        : "Un seul d'entre vous s'est avancé pour réveiller l'adversaire, et l'a emporté. Le reste du groupe passe sans une égratignure.";
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
        ? "L'adversaire remue dans son sommeil, trop tard pour reculer. La discrétion ne suffit plus."
        : "Vous passez presque sans un bruit, laissant l'adversaire à son sommeil. Prudent, mais les mains vides.";
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
    setBusy(true); setError(null);

    // 3/3 votes (ou fin du délai en synchrone) => résolution serveur immédiate.
    // Intervenir/Fouiller/Potion/Larcin sont disponibles pendant toute la phase
    // de vote : il n'y a plus de fenêtre d'intervention après la fermeture.
    const { data: beganStep, error: beginError } = await supabase.rpc("begin_resolution", { p_step_id: step.id });
    if (beginError) { setError(beginError.message); setBusy(false); return; }

    // begin_resolution finalise désormais lui-même les issues probabilistes
    // côté serveur. Le client ne lance plus une seconde RPC et ne connaît plus
    // de phase intermédiaire intervenir/fouiller/passer.
    await fetchStep();
    setBusy(false);
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
  // Une étape peut venir d'un template communautaire : image dédiée (si
  // Lils en a attribué une en modération) et provenance à afficher
  // discrètement. Un seul appel par étape.
  useEffect(() => {
    if (!step?.id) { setCommunityInfo(null); return; }
    void (async () => {
      const { data } = await supabase.rpc("get_step_community_info" as any, { p_step_id: step.id });
      const row = (data as any)?.[0];
      if (row?.is_community) {
        setCommunityInfo({ isCommunity: true, imagePath: row.image_path ?? null, authorName: row.author_name ?? null, guildName: row.guild_name ?? null });
      } else {
        setCommunityInfo(null);
      }
    })();
  }, [step?.id]);
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
    } else if (result.deaths > 0 || result.damageLog.length > 0) {
      // Dégâts sans mort = échec côté image aussi, comme pour le texte
      // (wentWrong) — avant, seule une mort faisait basculer l'image côté
      // échec ; une étape avec dégâts mais sans mort tombait dans le pool
      // de réussite, en contradiction avec le texte affiché juste à côté.
      // Image liée au type de l'événement qui vient de faire des dégâts,
      // quand elle existe ; repli sur le pool générique sinon.
      const echecPool = EVENT_ECHEC_IMAGES[result.eventType] ?? CINEMATIC_DEATH_IMGS;
      resultBg = echecPool[Math.floor(resultImageVariant * echecPool.length)] ?? echecPool[0]!;
    } else {
      // L'image de réussite dédiée au type (coffre ouvert, découverte
      // révélée...) passe en priorité quand elle existe. L'image de base
      // (eventBg, celle du coffre encore fermé pendant le vote) ne sert de
      // repli que s'il n'existe AUCUNE image de réussite dédiée pour ce
      // type — avant, les deux étaient mélangées dans le même tirage
      // aléatoire, donc une réussite pouvait montrer, par pur hasard, le
      // coffre encore fermé.
      const reussitePool = EVENT_REUSSITE_IMAGES[result.eventType] ?? [];
      const successPool = reussitePool.length > 0
        ? [...reussitePool, STEP_RESULT_SUCCESS, ...CINEMATIC_SURVIVE_IMGS]
        : [...(eventBg ? [eventBg] : []), STEP_RESULT_SUCCESS, ...CINEMATIC_SURVIVE_IMGS];
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
    <div className="h-[100dvh] w-full overflow-hidden relative bg-black" style={{
      backgroundImage: "url(/game_frame.webp)",
      backgroundSize: "100% 100%",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    }}>
      {/* ================================================================
          LAYOUT VOTE — le frame est uniquement un décor. Les 3 colonnes et
          les 3 étages du centre sont positionnés indépendamment afin que la
          logique reste stable même si le contenu change.
          ================================================================ */}

      {/* GAUCHE — groupe. Scroll local uniquement si le groupe est grand. */}
      <aside
        className="absolute z-10 overflow-y-auto [scrollbar-width:thin]"
        style={{ left: "1.65%", top: "3.1%", bottom: "3.4%", width: "16.85%", padding: "0.55rem 0.65rem" }}
      >
        <p className="text-sm tracking-[0.18em] uppercase text-muted-foreground mb-3 text-center">Groupe</p>
        <div className="space-y-1.5">
          {participants.map((p) => {
            const maxHp = getMaxHp((p.character as any)?.level ?? 1);
            const hp = (p.character as any)?.hp ?? maxHp;
            const hpRatio = maxHp > 0 ? hp / maxHp : 1;
            const hpColor = hpRatio <= 0.3 ? "#ef4444" : hpRatio <= 0.6 ? "#f59e0b" : "#22c55e";
            const votes = frontlineTally[p.character_id] ?? 0;
            const isMe = p.character_id === character?.id;
            return (
              <FramedBox key={p.character_id} frame={5} className={`px-2 py-1.5 ${!p.is_alive ? "opacity-30" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <PortraitDisplay portraitId={(p.character as any)?.portrait ?? "ombre"} size={62} bordered={false} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className={`text-[13px] truncate ${!p.is_alive ? "line-through text-red-400/50" : isMe ? "text-primary" : "text-muted-foreground"}`}>
                        {(p.character as any)?.name}{!p.is_alive ? " ✝" : ""}
                      </p>
                      <div className="ml-auto shrink-0"><VocationBadge vocationId={(p.character as any)?.declared_vocation} /></div>
                    </div>
                    {p.is_alive && (
                      <>
                        <div className="h-2 mt-1.5 rounded-sm bg-black/55 border border-black/60 overflow-hidden">
                          <div className="h-full transition-all duration-500" style={{ width: `${Math.round(hpRatio * 100)}%`, backgroundColor: hpColor }} />
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-[11px] font-mono flex items-center gap-1" style={{ color: hpColor }}>
                            {hp}/{maxHp}<Heart size={10} className="fill-current" />
                          </p>
                          <span className={votedIds.includes(p.character_id) ? "text-primary text-[12px]" : "text-muted-foreground/35 text-[12px]"}>
                            {votedIds.includes(p.character_id) ? "✓" : "…"}
                          </span>
                        </div>
                      </>
                    )}
                    {shield && shield.resolved && !shield.broken_reason && shield.holder_character_id === p.character_id && shield.steps_remaining !== null && shield.steps_remaining > 0 && (
                      <p className="text-[9px] font-mono flex items-center gap-1 text-sky-400" title={`Bouclier ${shield.rarity} : -${shield.reduction} dégâts`}>
                        <img src={SHIELD_ICON[shield.rarity]} alt="" className="w-4 h-4 object-contain" /> {shield.steps_remaining}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {p.is_alive && step && !step.resolving && !step.resolved && myVocation === "Martyr" && p.character_id !== character?.id && !usedAbilities.has("martyr_triggered") && (
                    <button
                      onClick={() => designateMartyrTarget(p.character_id)}
                      title="Prendre le coup mortel à sa place s'il devait en recevoir un cette étape"
                      className={`text-[10px] uppercase tracking-[0.05em] border px-1.5 py-0.5 whitespace-nowrap ${myMartyrTarget === p.character_id ? "border-red-400 text-red-300 bg-red-500/10" : "border-border/25 text-muted-foreground/55 hover:border-red-400/40 hover:text-red-300"}`}
                    >
                      {vocationBusy === "martyr_target" ? "…" : "Protéger"}
                    </button>
                  )}
                  {p.is_alive && step && !step.resolving && !step.resolved && myVocation === "Inquisiteur" && p.character_id !== character?.id && !usedAbilities.has("inquisiteur_target") && (
                    <button
                      onClick={() => designateInquisiteurTarget(p.character_id)}
                      title="Enquêter sur cette personne pour cette étape (une fois par expédition)"
                      className="text-[10px] uppercase tracking-[0.05em] border px-1.5 py-0.5 whitespace-nowrap border-border/25 text-muted-foreground/55 hover:border-purple-400/40 hover:text-purple-300"
                    >
                      {vocationBusy === "inquisiteur_target" ? "…" : "Enquêter"}
                    </button>
                  )}
                  {p.is_alive && step && !step.resolving && !step.resolved && (
                    <button
                      onClick={() => voteFrontline(p.character_id)}
                      title="Pousser cette personne devant pour la prochaine étape"
                      className={`text-[10px] uppercase tracking-[0.05em] border px-1.5 py-0.5 whitespace-nowrap ${myFrontlineTarget === p.character_id ? "border-amber-400 text-amber-300 bg-amber-500/10" : "border-border/25 text-muted-foreground/55 hover:border-amber-400/40 hover:text-amber-300"}`}
                    >
                      {/* Le compte de votes reste caché à la personne visée
                          elle-même — sinon voir "on veut te pousser" en
                          boucle décourage de continuer à jouer. Les autres
                          le voient normalement. */}
                      Pousser devant{votes > 0 && !isMe ? ` (${votes})` : ""}
                    </button>
                  )}
                  {myVocation === "Inquisiteur" && p.is_alive && p.character_id !== character?.id && (
                    inspectResult?.id === p.character_id ? (
                      <span className={`text-[9px] ${inspectResult.honest ? "text-emerald-400" : "text-red-400"}`}>{inspectResult.honest ? "Honnête" : "Traître"}</span>
                    ) : usedAbilities.has("inquisiteur_inspect") ? null : (
                      <button onClick={() => useInspect(p.character_id)} disabled={vocationBusy === `inspect-${p.character_id}`}
                        className="text-[10px] uppercase tracking-[0.05em] border border-border/30 text-muted-foreground px-1.5 py-0.5 hover:border-primary/40 hover:text-primary disabled:opacity-30">
                        {vocationBusy === `inspect-${p.character_id}` ? "…" : "Enquêter"}
                      </button>
                    )
                  )}
                  {/* Contrôles bots conservés pour l'admin, volontairement discrets. */}
                  {isAdmin && p.character.is_bot && p.is_alive && step && !votedIds.includes(p.character_id) && (
                    <div className="ml-auto flex gap-1 opacity-60 hover:opacity-100">
                      <button onClick={() => botVote(p.character_id, "continuer")} disabled={botBusy === p.character_id} className="text-[9px] uppercase border border-amber-500/30 text-amber-300 px-1.5 py-0.5">Continuer</button>
                      <button onClick={() => botVote(p.character_id, "rentrer")} disabled={botBusy === p.character_id} className="text-[9px] uppercase border border-amber-500/30 text-amber-300 px-1.5 py-0.5">Rentrer</button>
                    </div>
                  )}
                  {isAdmin && p.character.is_bot && !p.is_alive && (
                    <button onClick={() => botRevive(p.character_id)} disabled={botBusy === p.character_id} className="text-[9px] uppercase border border-amber-500/30 text-amber-300 px-1.5 py-0.5">
                      {botBusy === p.character_id ? "…" : "Ressusciter"}
                    </button>
                  )}
                </div>
              </FramedBox>
            );
          })}
        </div>
      </aside>

      {/* CENTRE — positions calées sur game_frame.webp : bandeau / scène / actions. */}
      <main className="absolute z-10" style={{ left: "20.15%", right: "20.15%", top: 0, bottom: 0 }}>
        {step && (!step.resolved || revealingOutcome) && (
          <>
            {/* 1 — BANDEAU : plus ample, presque sur toute la largeur utile du panneau central. */}
            <section className="absolute flex items-center justify-center text-center" style={{ left: 0, right: 0, top: "2.1%", height: "13.2%" }}>
              <div className="w-full max-w-[92%] flex flex-col items-center">
                <div className="flex items-center justify-center gap-2 min-w-0 max-w-full">
                  {EVENT_TYPE_ICON[step.event_type] && <img src={EVENT_TYPE_ICON[step.event_type]} alt="" className="h-7 w-7 object-contain shrink-0" />}
                  <h1 className="font-serif text-[clamp(1.7rem,2.8vw,2.7rem)] tracking-[0.08em] uppercase text-primary truncate">
                    Étape {step.step_number} — {EVENT_TYPE_LABEL[step.event_type] ?? step.event_type}
                  </h1>
                </div>
                <div className="mt-1.5 w-full flex items-center justify-center flex-wrap gap-x-5 gap-y-1 text-[14px]">
                  <span className={`font-semibold ${RISK_COLOR[step.risk_level]}`}>⚠ Risque {RISK_LABEL[step.risk_level]}</span>
                  <span className="text-amber-400 font-mono">Butin : {step.loot_min}–{step.loot_max} or</span>
                  {visibleRisk !== null && <span className="font-mono text-muted-foreground/70">({Math.round(visibleRisk * 100)}% connu de tous)</span>}
                  {myPrivateRisk !== null && <span className="font-mono text-primary/80">({Math.round(myPrivateRisk * 100)}% connu de toi seul)</span>}
                </div>
                {(() => {
                  const knownRisk = resolvingRisk ?? visibleRisk ?? myPrivateRisk;
                  if (knownRisk == null) return null;
                  const fillPct = revealingOutcome ? gaugeWobble : Math.round((1 - knownRisk) * 100);
                  return (
                    <div className="mt-2 w-[min(84%,780px)] max-w-[84%]">
                      <div className="h-2.5 border border-border/50 relative overflow-hidden">
                        <div className={`absolute inset-y-0 left-0 bg-gradient-to-r from-red-500/70 via-amber-400/70 to-emerald-500/70 ${revealingOutcome ? "transition-all duration-200" : "transition-all duration-700"}`} style={{ width: `${fillPct}%` }} />
                      </div>
                      <div className="flex justify-between text-[11px] uppercase tracking-[0.08em] mt-0.5 px-[1px]">
                      <span
                        className={`transition-all duration-300 ${
                          outcomeFlash === "failure"
                            ? "text-red-300 scale-110 animate-pulse [text-shadow:0_0_8px_rgba(248,113,113,.95),0_0_18px_rgba(220,38,38,.8)]"
                            : "text-muted-foreground/85"
                        }`}
                      >
                        Échec
                      </span>
                      <span
                        className={`transition-all duration-300 ${
                          outcomeFlash === "success"
                            ? "text-emerald-200 scale-110 animate-pulse [text-shadow:0_0_8px_rgba(110,231,183,.95),0_0_18px_rgba(16,185,129,.8)]"
                            : "text-muted-foreground/85"
                        }`}
                      >
                        Réussite
                      </span>
                    </div>
                    </div>
                  );
                })()}
              </div>
            </section>

            {/* 2 — SCÈNE : l'illustration seule, strictement 16:9, centrée dans le parchemin. */}
            <section className="absolute flex items-center justify-center overflow-hidden" style={{ left: "1.5%", right: "1.5%", top: "15.2%", height: "53.6%" }}>
              {step.description && (() => {
                // Image dédiée d'un événement communautaire en priorité —
                // pas encore passée par le fondu parchemin (Lils fournit
                // le chemin tel quel en modération) ; sinon, le pool
                // générique type+risque comme avant.
                const parchmentBg = communityInfo?.imagePath || pickParchmentBg(step);
                return (
                  <div className="relative overflow-hidden" style={{ height: "86%", aspectRatio: "16 / 9", maxWidth: "92%" }}>
                    {parchmentBg && <img src={parchmentBg} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none" />}
                    <div className="absolute inset-0 bg-black/5 pointer-events-none" />
                    <div className="absolute inset-0 flex items-center justify-center px-[9%] py-[7%] text-center">
                      <div className="max-w-[90%]">
                        {step.required_flag_sentiment && (
                          <p className={`text-[10px] tracking-[0.12em] uppercase mb-2 font-bold ${step.required_flag_sentiment === "positif" ? "text-emerald-200" : "text-red-200"}`} style={{ textShadow: "0 2px 4px #000" }}>
                            Conséquence d'un choix passé
                          </p>
                        )}
                        <p className="text-base xl:text-lg font-sans italic leading-snug text-white" style={{ textShadow: "0 2px 6px rgba(0,0,0,.98), 0 1px 2px #000" }}>
                          {step.description}
                        </p>
                      </div>
                    </div>
                    {communityInfo?.isCommunity && (
                      <p className="absolute bottom-1 right-1.5 text-[9px] text-white/70 italic" style={{ textShadow: "0 1px 3px #000" }}>
                        Événement imaginé par {communityInfo.authorName ?? "un joueur"}
                        {communityInfo.guildName && <> — {communityInfo.guildName}</>}
                      </p>
                    )}
                  </div>
                );
              })()}
            </section>

            {/* 3 — ACTIONS : trois familles stables. Aucun scroll global. */}
            <section className="absolute flex flex-col px-[4.5%] pt-1.5 pb-2" style={{ left: 0, right: 0, top: "69.8%", bottom: "2.1%" }}>
              <div className="shrink-0 flex flex-col items-center justify-center gap-1.5 mb-2 min-h-[34px] text-center">
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground/78 max-w-[94%]">
                  <span>{isAsync ? "En attente que chacun agisse" : `Temps restant : ${timeLeft !== null ? fmt(timeLeft) : "—"}`}</span>
                  <span className="opacity-40">•</span>
                  <span>Votes reçus : {votedIds.filter(id => aliveParticipants.some(p => p.character_id === id)).length} / {aliveParticipants.length}</span>
                </div>
                {runningTotals && (
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground/72 max-w-[94%]">
                    <span>
                      Or de guilde accumulé cette expédition : <span className="text-amber-400 font-mono">{runningTotals.guildGold}</span>
                    </span>
                    <span className="opacity-40">•</span>
                    <span>
                      XP gagnée : <span className="text-primary font-mono">{runningTotals.xp}</span>
                    </span>
                    <span className="opacity-40">•</span>
                    <span>
                      Si le groupe rentre maintenant, ta part personnelle serait d'environ {Math.max(Math.round(runningTotals.guildGold * 0.01) + myGoldAdjustment, 0)} or
                      {myGoldAdjustment !== 0 && (
                        <span className={myGoldAdjustment > 0 ? "text-amber-400" : "text-red-400"}>
                          {" "}({myGoldAdjustment > 0 ? "+" : ""}{myGoldAdjustment})
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {revealingOutcome ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground/65 italic">
                  Le verdict tombe…
                </div>
              ) : (
                <div className="flex-1 min-h-0 grid grid-cols-[1.08fr_.78fr_1.34fr] gap-3">
                  {/* BLOC 1 — VOTE : choix principaux + éventuelle troisième option. */}
                  <div className="min-w-0 flex flex-col border-r border-border/20 pr-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/65 mb-1.5">Vote</p>
                    {!step.resolving && !myVote ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <ImmersiveButton variant="clair" onClick={() => castVote("continuer")} disabled={busy || deadlineExpired} className="!py-2.5 text-[12px]">
                          <span className="flex items-center justify-center gap-1.5"><img src="/icons/arrow_up.webp" alt="" className="h-4 w-4" />Continuer</span>
                        </ImmersiveButton>
                        <ImmersiveButton variant="sombre" onClick={() => castVote("rentrer")} disabled={busy || deadlineExpired} className="!py-2.5 text-[12px]">
                          <span className="flex items-center justify-center gap-1.5"><img src="/icons/door.webp" alt="" className="h-4 w-4" />Rentrer</span>
                        </ImmersiveButton>
                      </div>
                    ) : (
                      <div className="border border-primary/20 bg-primary/5 px-2 py-2 text-center text-[10px] text-muted-foreground">
                        {step.resolving ? "Vote clos — résolution du serveur…" : "Vote enregistré, en attente des autres…"}
                      </div>
                    )}

                    {!step.resolving && !myVote && step.third_option_kind && step.third_option_label && (
                      step.required_vocation && myVocation !== step.required_vocation ? (
                        <p className="mt-1.5 px-2 py-1.5 text-center text-[10px] text-muted-foreground/55 italic border border-border/20">
                          {step.third_option_label}, réservé à un personnage {vocationLabel(step.required_vocation)}
                        </p>
                      ) : (() => {
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
                        const lootComparedToBase = hasLoot
                          ? (step.third_option_loot_min! >= step.loot_max
                              ? "butin plus élevé que Continuer"
                              : step.third_option_loot_max! <= step.loot_min
                                ? "butin plus faible que Continuer"
                                : null)
                          : null;
                        return (
                          <button onClick={() => castVote("troisieme")} disabled={busy || deadlineExpired}
                            className="mt-1.5 w-full min-h-[42px] px-2.5 py-2 border border-amber-500/45 text-amber-300 hover:bg-amber-500/10 disabled:opacity-30 text-[10px] leading-tight uppercase tracking-[0.05em]">
                            <span className="inline-flex items-center justify-center gap-1.5">
                              <img src="/icons/scroll.webp" alt="" className="h-4 w-4 shrink-0" />
                              <span>
                                {step.third_option_label}
                                {step.required_vocation && ` (vous avez un·e ${vocationLabel(step.required_vocation)} dans le groupe)`}
                                {step.third_option_cost != null && ` (${step.third_option_cost} or de guilde dépensé)`}
                                {hasLoot && `, ${step.third_option_loot_min}–${step.third_option_loot_max} or à gagner`}
                              </span>
                            </span>
                            {(riskTag || lootComparedToBase) && (
                              <span className={`block mt-1 text-[9px] normal-case tracking-normal font-sans ${riskTag?.color ?? "text-muted-foreground"}`}>
                                {riskTag && <>⚠ {riskTag.text} par rapport à Continuer</>}
                                {riskTag && lootComparedToBase && " · "}
                                {lootComparedToBase && lootComparedToBase}
                              </span>
                            )}
                          </button>
                        );
                      })()
                    )}
                    <div className="mt-auto pt-1.5">
                      <div className="flex gap-1">
                        {aliveParticipants.map((p) => <div key={p.character_id} className={`h-1 flex-1 ${votedIds.includes(p.character_id) ? "bg-primary/70" : "bg-border/25"}`} />)}
                      </div>
                    </div>
                  </div>

                  {/* BLOC 2 — RÉSERVE PERSONNELLE : actions récurrentes, iconographiques. */}
                  <div className="min-w-0 flex flex-col border-r border-border/20 pr-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/65 mb-1.5">Réserve personnelle</p>
                    <div className="grid grid-cols-2 gap-1.5 content-start">
                      {!!interventionsRemaining && (
                        <>
                          <button onClick={useIntervention} disabled={step.resolving || interventionBusy || myIntervened || mySearched || !interventionsRemaining}
                            title={`Intervenir (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`} className="relative min-h-[48px] flex flex-col items-center justify-center border border-primary/30 bg-black/10 text-primary hover:bg-primary/10 disabled:opacity-25">
                            <img src="/icons/gauntlet.webp" alt="" className="h-6 w-6 object-contain" /><span className="text-[8px] uppercase">Intervenir</span>
                            <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-primary/50 text-[8px] flex items-center justify-center">{interventionsRemaining}</span>
                          </button>
                          <button onClick={searchForCuriosity} disabled={step.resolving || searchBusy || myIntervened || mySearched || !interventionsRemaining}
                            title={`Fouiller (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`} className="relative min-h-[48px] flex flex-col items-center justify-center border border-primary/30 bg-black/10 text-primary hover:bg-primary/10 disabled:opacity-25">
                            <img src="/icons/magnifier.webp" alt="" className="h-6 w-6 object-contain" /><span className="text-[8px] uppercase">Fouiller</span>
                            <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-primary/50 text-[8px] flex items-center justify-center">{interventionsRemaining}</span>
                          </button>
                          {hasPotion ? (
                            <button onClick={drinkPotion} disabled={step.resolving || drinkBusy || myIntervened || mySearched || !interventionsRemaining}
                              title={`Boire une potion (${interventionsRemaining} restante${interventionsRemaining > 1 ? "s" : ""})`} className="relative min-h-[48px] flex flex-col items-center justify-center border border-emerald-400/30 bg-black/10 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-25">
                              <img src="/icons/potion.webp" alt="" className="h-6 w-6 object-contain" /><span className="text-[8px] uppercase leading-tight">Boire une potion</span>
                              <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-emerald-400/50 text-[8px] flex items-center justify-center">{interventionsRemaining}</span>
                            </button>
                          ) : <div className="min-h-[48px] border border-border/10 opacity-20" />}
                          <LarcenyButton compact expeditionId={expeditionId} step={step} character={character} aliveParticipants={aliveParticipants} />
                        </>
                      )}
                    </div>
                    {(myIntervened || mySearched || myDrunk) && (
                      <p className="mt-1 text-[8px] leading-tight text-muted-foreground/60 text-center">
                        {myIntervened && "Intervention utilisée sur cette étape."}{mySearched && searchResult && (searchResult.found ? ` Fouille : trouvé ${searchResult.name}.` : " Fouille infructueuse.")}{myDrunk && drinkResult !== null && ` Potion bue, ${drinkResult} PV.`}
                      </p>
                    )}
                  </div>

                  {/* BLOC 3 — CAPACITÉS CONTEXTUELLES : texte variable et marchand. */}
                  <div className="min-w-0 min-h-0 flex flex-col">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/65 mb-1.5">Capacités & situation</p>
                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5 [scrollbar-width:thin]">
                      {!step.resolving && myVocation && !myVote && (
                        <>
                          {hasRiskReserveEffect && (
                            <button onClick={useReveal} disabled={vocationBusy === "reveal"} className="w-full text-[10px] leading-tight border border-primary/35 text-primary px-2 py-1.5 hover:bg-primary/10 disabled:opacity-30">
                              {vocationBusy === "reveal" ? "…" : "Révéler le risque (à toi seul)"}
                            </button>
                          )}
                          {myMartyrTarget && <p className="text-[10px] text-red-300/65 italic px-1">Si un coup mortel devait tomber sur cette personne cette étape, tu le prends à sa place.</p>}
                          {myVocation === "Martyr" && step.event_type === "gardien" && !usedAbilities.has("martyr_provocation") && (
                            <div>
                              <p className="text-[9px] text-muted-foreground/60 mb-1">Disponible car tu es Martyr</p>
                              <button onClick={useMartyrProvocation} disabled={vocationBusy === "martyr_provocation"} className="w-full text-[10px] leading-tight border border-red-400/35 text-red-300 px-2 py-1.5 hover:bg-red-400/10 disabled:opacity-30">
                                {vocationBusy === "martyr_provocation" ? "…" : "Provoquer seul l'adversaire (risque seul, le groupe garde tout)"}
                              </button>
                            </div>
                          )}
                          {usedAbilities.has("martyr_provocation") && (
                            <p className="text-[10px] text-red-300/65 italic px-1">L'étape est déjà réglée, le résultat arrive.</p>
                          )}
                          {myInquisiteurInvestigation && myInquisiteurInvestigation.stepId === step.id && step.resolved && !inquisiteurFindings && (
                            <button onClick={revealInquisiteurFindings} disabled={vocationBusy === "inquisiteur_reveal"} className="w-full text-[10px] leading-tight border border-purple-400/35 text-purple-300 px-2 py-1.5 hover:bg-purple-400/10 disabled:opacity-30">
                              {vocationBusy === "inquisiteur_reveal" ? "…" : "Voir les résultats de l'enquête"}
                            </button>
                          )}
                          {inquisiteurFindings && (
                            <div className="text-[10px] text-purple-300/80 px-1 space-y-0.5">
                              <p className="text-purple-300">Enquête sur {inquisiteurFindings.target_name}</p>
                              <p>Vote réel : {inquisiteurFindings.real_vote ?? "n'a pas voté"}</p>
                              <p>A tenté de pousser devant : {inquisiteurFindings.pushed_frontline_target ?? "personne"}</p>
                              <p>Tentative de larcin : {inquisiteurFindings.attempted_larceny ? "oui" : "non"}</p>
                              <p>Capacité secrète utilisée : {inquisiteurFindings.used_secret_ability ? "oui" : "non"}</p>
                            </div>
                          )}
                          {myVocation === "Miracule" && !usedAbilities.has("miracle_bet") && (
                            <button onClick={useMiracleBet} disabled={vocationBusy === "miracle_bet"} className="w-full text-[10px] leading-tight border border-sky-400/35 text-sky-300 px-2 py-1.5 hover:bg-sky-400/10 disabled:opacity-30">
                              {vocationBusy === "miracle_bet" ? "…" : "Miser mon miracle sur cette étape (une fois par expédition)"}
                            </button>
                          )}
                          {usedAbilities.has("miracle_bet") && <p className="text-[10px] text-sky-300/65 italic px-1">Si tu devais mourir à cette résolution, tu survis à 1 PV.</p>}
                          {myVocation === "Tresorier" && !usedAbilities.has("tresorier_secure") && (
                            <button onClick={useTresorierSecure} disabled={vocationBusy === "tresorier_secure"} className="w-full text-[10px] leading-tight border border-amber-400/35 text-amber-300 px-2 py-1.5 hover:bg-amber-400/10 disabled:opacity-30">
                              {vocationBusy === "tresorier_secure" ? "…" : "Mettre 30% du butin à l'abri (une fois par expédition)"}
                            </button>
                          )}
                          {usedAbilities.has("tresorier_secure") && <p className="text-[10px] text-amber-300/65 italic px-1">Cette part est acquise même si l'expédition tourne mal.</p>}
                        </>
                      )}
                      {step.event_type === "marchand" && !step.resolving && !step.resolved && <PotionShop step={step} character={character} expeditionId={expeditionId} />}
                      {allInterventionUsers.length > 0 && <p className="text-[9px] text-amber-300/65 px-1">Déjà agi sur cette étape : {allInterventionUsers.map(u => `${u.name} (${u.action === "aide" ? "intervention" : u.action === "fouille" ? "fouille" : "potion"})`).join(", ")}</p>}
                      <LedgerError message={vocationError} />
                      <LedgerError message={error} />
                      {canResolve && error && (
                        <button onClick={resolveStep} disabled={busy} className="w-full text-[9px] border border-primary/40 text-primary px-2 py-1.5">{busy ? "Résolution…" : "Réessayer"}</button>
                      )}
                      {availableBotsForIntervention.length > 0 && isAdmin && (
                        <div className="flex flex-wrap gap-1 pt-1 border-t border-border/15">
                          {availableBotsForIntervention.map(p => <button key={p.character_id} onClick={() => useInterventionAsBot(p.character_id)} disabled={interventionBusy} className="text-[8px] border border-amber-500/30 text-amber-300 px-1.5 py-1">Intervenir ({p.character.name})</button>)}
                        </div>
                      )}
                    </div>
                    {isAdmin && (
                      <button onClick={copyDebugReport} className="shrink-0 mt-1 text-[8px] uppercase tracking-[0.08em] text-muted-foreground/45 hover:text-amber-300">
                        {debugCopied ? "Rapport de debug copié ✓" : "Copier le rapport de debug (partage-le-moi)"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* DROITE — chat pleine hauteur, saisie ancrée en bas. */}
      <aside className="absolute z-10 flex flex-col" style={{ right: "1.55%", top: "3.1%", bottom: "3.4%", width: "18.05%", padding: "0.55rem 0.65rem 0.55rem 0.35rem" }}>
        {isAsync && character && (
          <div className="shrink-0 flex items-center justify-end mb-1 pr-0.5">
            <button
              type="button"
              onClick={toggleAsyncDiscordNotifications}
              disabled={discordNotifsBusy}
              title="Activer ou désactiver tes notifications Discord pour cette expédition asynchrone"
              className={`text-[9px] uppercase tracking-[0.08em] border px-2 py-1 ${
                discordNotifsEnabled
                  ? "border-emerald-400/35 text-emerald-300/80"
                  : "border-border/30 text-muted-foreground/55"
              } disabled:opacity-40`}
            >
              {discordNotifsBusy ? "Discord…" : `Discord : ${discordNotifsEnabled ? "activé" : "désactivé"}`}
            </button>
          </div>
        )}
        <ChatBox expeditionId={expeditionId} character={character} />
        <NotificationsPanel character={character} />
      </aside>
    {step && (!step.resolved || revealingOutcome) && (
      <>
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
    </div>
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
    <div className="shrink-0 mt-4 pt-3 border-t border-dashed border-amber-500/25 space-y-1.5">
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

function LarcenyButton({ expeditionId, step, character, aliveParticipants, compact = false }: {
  expeditionId: string; step: Step; character: Character | null;
  aliveParticipants: { character_id: string; character: { name: string } }[];
  compact?: boolean;
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

  if (!confirm) return compact ? (
    <button onClick={() => setConfirm(true)} title="Tenter un larcin"
      className="relative min-h-[48px] flex flex-col items-center justify-center border border-amber-500/30 bg-black/10 text-amber-300 hover:bg-amber-500/10 transition-colors">
      <img src="/icons/pouch_hand.webp" alt="" className="h-6 w-6 object-contain" />
      <span className="text-[8px] uppercase leading-tight text-center">Larcin</span>
      <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-[#1d3a4a] border border-amber-400/50 text-[8px] flex items-center justify-center">{remaining}</span>
    </button>
  ) : (
    <button onClick={() => setConfirm(true)}
      className="w-full mt-2 text-xs uppercase tracking-[0.1em] border border-border/30 text-muted-foreground/70 px-3 py-2 hover:border-amber-500/40 hover:text-amber-400 transition-colors">
      <span className="inline-flex items-center gap-2">
        <img src="/icons/pouch_hand.webp" alt="" className="h-5 w-5 object-contain" />
        Tenter un larcin ({remaining} restante{remaining > 1 ? "s" : ""})
      </span>
    </button>
  );

  const confirmPanel = (
    <div className="border border-amber-500/30 bg-[#12110f]/95 px-3 py-2 text-center shadow-2xl">
      <p className="text-xs text-amber-300/80 mb-2">60% de réussite.</p>
      <label className="block text-[10px] uppercase tracking-[0.1em] text-muted-foreground mb-1 text-left">Voler…</label>
      <select value={target} onChange={e => setTarget(e.target.value)}
        className="w-full mb-2 bg-transparent border border-amber-500/40 text-amber-200 text-xs px-2 py-1.5 focus:outline-none">
        <option value="guilde" className="bg-background text-foreground">Le pot commun de la guilde (2% du butin — échec révélé à toute la guilde)</option>
        {others.map(p => (
          <option key={p.character_id} value={p.character_id} className="bg-background text-foreground">
            {p.character.name} (20% de sa part estimée — succès anonyme, mais en cas d'échec elle apprendra ton nom)
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

  if (!compact) return confirmPanel;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 px-4" onClick={() => !busy && setConfirm(false)}>
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>{confirmPanel}</div>
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
  // c'est nous qui venons d'écrire) — sauf au tout premier chargement, où
  // il n'y a pas de "position de lecture" à respecter : on doit atterrir
  // en bas d'office, comme n'importe quel chat. Avant, arriver sur une
  // conversation déjà longue ouvrait en haut plutôt qu'en bas.
  const prevMsgCount = useRef(0);
  const sentByMeRef = useRef(false);
  const initialScrollDone = useRef(false);
  useEffect(() => {
    const grew = messages.length > prevMsgCount.current;
    const isInitialLoad = !initialScrollDone.current && messages.length > 0;
    prevMsgCount.current = messages.length;
    if (!grew && !isInitialLoad) return;
    if (isInitialLoad) {
      initialScrollDone.current = true;
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
      return;
    }
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
    <div className="flex-1 min-h-0 flex flex-col">
      <p className="text-sm tracking-[0.14em] uppercase text-muted-foreground mb-3 text-center">Chat</p>
      <div ref={scrollBoxRef} className="flex-1 min-h-0 overflow-y-auto space-y-1.5 mb-2 pr-0.5">
        {messages.length === 0
          ? <p className="text-xs text-muted-foreground/40 italic">Silence.</p>
          : messages.map((m) => (
            <div key={m.id} className="flex items-start gap-1.5">
              <PortraitDisplay portraitId={(m.character as any)?.portrait ?? "ombre"} size={24} bordered={false} />
              <p className={`text-[13px] leading-snug ${m.character_id === character?.id ? "text-primary" : "text-muted-foreground"}`}>
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
          className="flex-1 bg-transparent border border-border/40 px-2.5 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40" />
        <button type="submit" disabled={busy || !text.trim()}
          className="px-3.5 py-2 text-[12px] uppercase tracking-[0.1em] border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-30">
          Envoyer
        </button>
      </form>
    </div>
  );
}
