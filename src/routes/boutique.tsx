import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerPage, LedgerCard, LedgerError, TextLink } from "@/components/ledger";
import { PORTRAITS, PortraitDisplay } from "@/components/portraits";
import { VOCATIONS } from "@/components/vocations";
import { ImmersiveButton } from "@/components/immersive";

export const Route = createFileRoute("/boutique")({
  ssr: false,
  component: BoutiquePage,
});

type CharacterRow = {
  id: string; name: string; portrait: string; vocation: string | null;
  personal_gold: number; soul_stone_charges: number; death_reroll_uses: number;
  legacy_tier: number; multiclass_vocations: string[]; unlocked_portraits: string[]; miracle_used: boolean;
};

const SOUL_STONE_BASE = 500;
const SOUL_STONE_MULT = 3;
const LEGACY_BASE = 300;
const LEGACY_MULT = 2.5;
const MULTICLASS_BASE = 800;
const MULTICLASS_MULT = 3;
const PORTRAIT_COST = 250;

const INK = "#f2e4c8";
const INK_MUTED = "#c9b896";
const PRICE = "#f0c14b";
const PANEL_BG = "rgba(18, 13, 6, 0.72)"; // panneau sombre posé sur le parchemin, texte clair par-dessus — même principe que le reste de l'app

function useShopState() {
  const navigate = useNavigate();
  const [character, setCharacter] = useState<CharacterRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate({ to: "/" }); return; }
    const { data: char } = await supabase
      .from("characters" as any)
      .select("id, name, portrait, vocation, personal_gold, soul_stone_charges, death_reroll_uses, legacy_tier, multiclass_vocations, unlocked_portraits, miracle_used")
      .eq("profile_id", session.user.id).eq("is_alive", true).eq("is_bot", false).maybeSingle();
    if (!char) { navigate({ to: "/" }); return; }
    setCharacter(char as any);
  }

  useEffect(() => { void load(); }, []);

  async function run(id: string, fn: () => PromiseLike<{ error: any; data?: any }>) {
    setBusy(id); setError(null);
    const { error: rpcError, data } = await fn();
    if (rpcError) setError(rpcError.message);
    else if (Array.isArray(data) && data.length === 0) {
      // La requête n'a levé aucune erreur mais n'a modifié aucune ligne —
      // signe classique d'une policy RLS qui filtre la ligne en silence.
      setError("Aucune ligne modifiée (policy RLS ?) — id " + id);
    } else await load();
    setBusy(null);
  }

  return { character, error, busy, run, navigate };
}

function ShopContent({ character, error, busy, run, ink }: {
  character: CharacterRow; error: string | null; busy: string | null;
  run: (id: string, fn: () => PromiseLike<{ error: any }>) => void;
  ink?: boolean;
}) {
  const soulStoneEffectiveUses = character.vocation === "Miracule" && character.miracle_used && character.death_reroll_uses === 0
    ? 1 : character.death_reroll_uses;
  const soulStoneCost = SOUL_STONE_BASE * Math.pow(SOUL_STONE_MULT, soulStoneEffectiveUses);
  const soulStoneLocked = character.vocation === "Miracule" && !character.miracle_used;

  const legacyMaxed = character.legacy_tier >= 4;
  const legacyCost = LEGACY_BASE * Math.pow(LEGACY_MULT, character.legacy_tier);
  const legacyCurrentPct = 10 + character.legacy_tier * 10;

  const availableMulticlass = VOCATIONS.filter(v =>
    v.id !== character.vocation && !character.multiclass_vocations.includes(v.id)
  );
  const multiclassCost = MULTICLASS_BASE * Math.pow(MULTICLASS_MULT, character.multiclass_vocations.length);

  const shadowStyle = ink ? { textShadow: "0 1px 3px rgba(0,0,0,0.9)" } : {};
  const textStyle = ink ? { color: INK, fontWeight: 600, ...shadowStyle } : undefined;
  const mutedStyle = ink ? { color: INK_MUTED, ...shadowStyle } : undefined;
  const priceStyle = ink ? { color: PRICE, fontWeight: 700, ...shadowStyle } : undefined;
  const borderCls = ink ? "" : "border-border/30";
  const headingCls = ink ? "" : "text-primary";
  const panelStyle = ink ? { background: PANEL_BG, border: "1px solid rgba(242,228,200,0.2)" } : undefined;

  return (
    <>
      <LedgerError message={error} />

      <p className={`font-serif text-sm tracking-[0.16em] uppercase font-bold mt-2 mb-2 ${headingCls}`} style={textStyle}>Destin</p>

      <div className={`border ${borderCls} px-3 py-3 mb-3`} style={panelStyle}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm" style={textStyle}>Pierre d'âme</p>
          <span className="text-xs font-mono flex-shrink-0" style={priceStyle}>{Math.round(soulStoneCost)} or</span>
        </div>
        <p className="text-xs mb-2" style={mutedStyle}>
          Charges en réserve : {character.soul_stone_charges}. Consommée automatiquement si tu es désigné·e pour mourir.
          {soulStoneLocked && <span className="block mt-1" style={{ color: "#8a2020" }}>Verrouillée : ta vocation Miraculé doit d'abord épuiser son propre sauvetage gratuit.</span>}
        </p>
        <button disabled={soulStoneLocked || busy === "soul" || character.personal_gold < soulStoneCost}
          onClick={() => run("soul", () => supabase.rpc("buy_soul_stone" as any, { p_character_id: character.id }))}
          className="text-xs uppercase px-3 py-1.5 disabled:opacity-30"
          style={{ border: `1px solid ${PRICE}80`, color: PRICE }}>
          {busy === "soul" ? "…" : "Acheter une charge"}
        </button>
      </div>

      <div className={`border ${borderCls} px-3 py-3 mb-4`} style={panelStyle}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm" style={textStyle}>Sceau d'héritage</p>
          {!legacyMaxed && <span className="text-xs font-mono flex-shrink-0" style={priceStyle}>{Math.round(legacyCost)} or</span>}
        </div>
        <p className="text-xs mb-2" style={mutedStyle}>
          Actuellement : {legacyCurrentPct}% de ton or personnel transmis à ton prochain personnage si tu meurs.
          {legacyMaxed ? " Palier maximum atteint." : ` Prochain palier : ${legacyCurrentPct + 10}%.`}
        </p>
        {!legacyMaxed && (
          <button disabled={busy === "legacy" || character.personal_gold < legacyCost}
            onClick={() => run("legacy", () => supabase.rpc("buy_legacy_tier" as any, { p_character_id: character.id }))}
            className="text-xs uppercase px-3 py-1.5 disabled:opacity-30"
            style={{ border: `1px solid ${PRICE}80`, color: PRICE }}>
            {busy === "legacy" ? "…" : "Augmenter le palier"}
          </button>
        )}
      </div>

      <p className={`font-serif text-sm tracking-[0.16em] uppercase font-bold mb-2 ${headingCls}`} style={textStyle}>Apparence</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {PORTRAITS.filter(p => p.premium).map((p) => {
          const owned = character.unlocked_portraits.includes(p.id);
          const active = character.portrait === p.id;
          return (
            <div key={p.id} className={`border ${borderCls} p-1.5 text-center`} style={panelStyle}>
              <div className={`mb-1 ${owned ? "" : "opacity-40 grayscale"}`}>
                <PortraitDisplay portraitId={p.id} size={64} />
              </div>
              <p className="text-[9px] mb-1 truncate" style={mutedStyle}>{p.label}</p>
              {owned ? (
                <button disabled={active || busy === p.id}
                  onClick={() => run(p.id, () => supabase.rpc("use_portrait" as any, { p_character_id: character.id, p_portrait_id: p.id }))}
                  className="w-full text-[9px] uppercase px-1 py-1 disabled:opacity-60"
                  style={active ? { border: "1px solid #2f7d4f80", color: "#2f7d4f" } : { border: `1px solid ${ink ? "#00000030" : "rgba(255,255,255,0.2)"}`, color: ink ? INK : undefined }}>
                  {active ? "Actif" : busy === p.id ? "…" : "Utiliser"}
                </button>
              ) : (
                <button disabled={busy === p.id || character.personal_gold < PORTRAIT_COST}
                  onClick={() => run(p.id, () => supabase.rpc("buy_portrait" as any, { p_character_id: character.id, p_portrait_id: p.id, p_cost: PORTRAIT_COST }))}
                  className="w-full text-[9px] uppercase px-1 py-1 disabled:opacity-30"
                  style={{ border: `1px solid ${PRICE}80`, color: PRICE }}>
                  {busy === p.id ? "…" : `${PORTRAIT_COST} or`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className={`font-serif text-sm tracking-[0.16em] uppercase font-bold mb-2 ${headingCls}`} style={textStyle}>Pouvoir</p>
      <div className={`border ${borderCls} px-3 py-3 mb-2`} style={panelStyle}>
        <p className="text-sm mb-1" style={textStyle}>Multiclassage</p>
        <p className="text-xs mb-2" style={mutedStyle}>
          Apprend, à vie, une capacité d'une autre vocation. Prochain coût : {Math.round(multiclassCost)} or.
        </p>
        {character.multiclass_vocations.length > 0 && (
          <p className="text-xs mb-2" style={priceStyle}>Déjà appris : {character.multiclass_vocations.join(", ")}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {availableMulticlass.map((v) => (
            <button key={v.id} disabled={busy === `mc-${v.id}` || character.personal_gold < multiclassCost}
              onClick={() => run(`mc-${v.id}`, () => supabase.rpc("buy_multiclass" as any, { p_character_id: character.id, p_vocation: v.id }))}
              className="text-[10px] uppercase px-2 py-1 disabled:opacity-30"
              style={{ border: `1px solid ${PRICE}80`, color: PRICE }}>
              {busy === `mc-${v.id}` ? "…" : v.label}
            </button>
          ))}
          {availableMulticlass.length === 0 && <p className="text-xs italic" style={mutedStyle}>Toutes les vocations sont déjà apprises.</p>}
        </div>
      </div>
    </>
  );
}

function BoutiquePage() {
  const { character, error, busy, run, navigate } = useShopState();

  if (!character) return <LedgerPage><LedgerCard title="Boutique">Chargement…</LedgerCard></LedgerPage>;

  return (
    <>
      {/* Bureau : cadre décoratif quasi plein écran — positionnement en style
          inline direct, aucune classe Tailwind empilée avec !important qui
          pourrait échouer silencieusement (c'est ce qui faisait sortir le
          texte du cadre précédemment). */}
      <div
        className="hidden md:block w-full px-4 py-8"
        style={{
          backgroundImage: `linear-gradient(rgba(13,12,10,0.55), rgba(13,12,10,0.7)), url(/fondboutique.webp)`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      >
        <div className="relative mx-auto w-full px-6 py-8" style={{ maxWidth: 1800 }}>
          <div className="flex justify-between gap-3 mb-3">
            <ImmersiveButton variant="sombre" onClick={() => navigate({ to: "/" })} className="px-6 !py-3 text-sm">
              ← Ma guilde
            </ImmersiveButton>
            <ImmersiveButton variant="clair" onClick={() => navigate({ to: "/carte" })} className="pl-9 pr-6 !py-3 text-sm">
              Carte
            </ImmersiveButton>
          </div>
          <div
            style={{
              position: "relative",
              // Largeur bornée par la place horizontale ET par ce qui tient
              // en hauteur — comme un object-fit: contain appliqué à tout
              // le bloc (nav + cadre), pas juste à l'image. Évite le scroll
              // vertical quel que soit le format de la fenêtre.
              width: "min(100%, calc((100vh - 160px) * 1536 / 1024))",
              aspectRatio: "1536 / 1024",
              margin: "0 auto",
            }}
          >
            <img src="/boutique_frame.webp" alt="" className="absolute inset-0 w-full h-full pointer-events-none select-none" style={{ objectFit: "fill" }} />
            <div
              className="absolute [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              style={{
                top: "29%", right: "22%", bottom: "19%", left: "34%",
                overflowY: "auto", overflowX: "hidden", padding: "12px",
              }}
            >
              <div className="flex items-baseline justify-between mb-2">
                <h1 className="font-serif text-lg tracking-[0.12em] uppercase font-bold" style={{ color: INK }}>Boutique</h1>
                <span className="text-sm font-mono flex-shrink-0 ml-2" style={{ color: PRICE }}>{Math.round(character.personal_gold)} or</span>
              </div>
              <ShopContent character={character} error={error} busy={busy} run={run} ink />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile : le cadre décoratif devient illisible en dessous d'une
          certaine largeur — repli sur la mise en page standard de l'app. */}
      <div className="block md:hidden">
        <LedgerPage maxWidthClass="max-w-2xl">
          <LedgerCard title="Boutique" subtitle={`Or personnel : ${Math.round(character.personal_gold)}`}>
            <img src="/boutique_frame.webp" alt="" className="w-full rounded-sm mb-4 object-cover" style={{ maxHeight: 160 }} />
            <ShopContent character={character} error={error} busy={busy} run={run} />
            <div className="flex gap-2 mt-2">
              <TextLink onClick={() => navigate({ to: "/" })} className="!mt-0">Ma guilde</TextLink>
              <TextLink onClick={() => navigate({ to: "/carte" })} className="!mt-0">Carte</TextLink>
            </div>
          </LedgerCard>
        </LedgerPage>
      </div>
    </>
  );
}
