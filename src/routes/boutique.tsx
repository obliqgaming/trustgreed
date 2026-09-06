import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerPage, LedgerError } from "@/components/ledger";
import { Frame } from "@/components/frame";
import { PORTRAITS, PortraitDisplay } from "@/components/portraits";
import { VOCATIONS } from "@/components/vocations";

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

// Palette pensée pour du texte lisible sur le parchemin clair du cadre
// (contrairement au reste de l'app, pensé pour du texte clair sur fond sombre).
const INK = "text-[#2b1d0e]";
const INK_MUTED = "text-[#5c4022]";
const INK_BORDER = "border-[#5c4022]/35";
const PRICE = "text-amber-800";

function BoutiquePage() {
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

  async function run(id: string, fn: () => PromiseLike<{ error: any }>) {
    setBusy(id); setError(null);
    const { error: rpcError } = await fn();
    if (rpcError) setError(rpcError.message);
    else await load();
    setBusy(null);
  }

  if (!character) {
    return (
      <LedgerPage maxWidthClass="max-w-6xl">
        <Frame variant="boutique" contentClassName="!flex-col !items-center !justify-center">
          <p className={INK}>Chargement…</p>
        </Frame>
      </LedgerPage>
    );
  }

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

  return (
    <LedgerPage maxWidthClass="max-w-6xl">
      <Frame variant="boutique" contentClassName="!flex-col !items-stretch !justify-start text-left [text-shadow:none] w-full min-w-0">
        <div className="flex items-baseline justify-between mb-3 min-w-0">
          <h1 className={`font-serif text-lg tracking-[0.12em] uppercase ${INK} truncate`}>Boutique</h1>
          <span className={`text-sm font-mono ${PRICE} flex-shrink-0 ml-2`}>{Math.round(character.personal_gold)} or personnel</span>
        </div>

        <LedgerError message={error} />

        {/* Rayon Destin */}
        <p className={`font-serif text-sm tracking-[0.16em] uppercase ${INK} mt-2 mb-2`}>Destin</p>

        <div className={`border ${INK_BORDER} px-3 py-3 mb-3 min-w-0`}>
          <div className="flex items-center justify-between gap-2 mb-1 min-w-0">
            <p className={`text-sm ${INK} truncate`}>Pierre d'âme</p>
            <span className={`text-xs font-mono ${PRICE} flex-shrink-0`}>{Math.round(soulStoneCost)} or</span>
          </div>
          <p className={`text-xs ${INK_MUTED} mb-2`}>
            Charges en réserve : {character.soul_stone_charges}. Consommée automatiquement si tu es désigné·e pour mourir.
            {soulStoneLocked && <span className="block text-red-800/80 mt-1">Verrouillée : ta vocation Miraculé doit d'abord épuiser son propre sauvetage gratuit.</span>}
          </p>
          <button disabled={soulStoneLocked || busy === "soul" || character.personal_gold < soulStoneCost}
            onClick={() => run("soul", () => supabase.rpc("buy_soul_stone" as any, { p_character_id: character.id }))}
            className={`text-xs uppercase border border-amber-800/50 ${PRICE} px-3 py-1.5 hover:bg-amber-800/10 disabled:opacity-30`}>
            {busy === "soul" ? "…" : "Acheter une charge"}
          </button>
        </div>

        <div className={`border ${INK_BORDER} px-3 py-3 mb-4 min-w-0`}>
          <div className="flex items-center justify-between gap-2 mb-1 min-w-0">
            <p className={`text-sm ${INK} truncate`}>Sceau d'héritage</p>
            {!legacyMaxed && <span className={`text-xs font-mono ${PRICE} flex-shrink-0`}>{Math.round(legacyCost)} or</span>}
          </div>
          <p className={`text-xs ${INK_MUTED} mb-2`}>
            Actuellement : {legacyCurrentPct}% de ton or personnel transmis à ton prochain personnage si tu meurs.
            {legacyMaxed ? " Palier maximum atteint." : ` Prochain palier : ${legacyCurrentPct + 10}%.`}
          </p>
          {!legacyMaxed && (
            <button disabled={busy === "legacy" || character.personal_gold < legacyCost}
              onClick={() => run("legacy", () => supabase.rpc("buy_legacy_tier" as any, { p_character_id: character.id }))}
              className={`text-xs uppercase border border-amber-800/50 ${PRICE} px-3 py-1.5 hover:bg-amber-800/10 disabled:opacity-30`}>
              {busy === "legacy" ? "…" : "Augmenter le palier"}
            </button>
          )}
        </div>

        {/* Rayon Apparence — 3 colonnes fixes : le cadre est plus étroit qu'une
            page normale, 6 colonnes y déborderaient horizontalement. */}
        <p className={`font-serif text-sm tracking-[0.16em] uppercase ${INK} mb-2`}>Apparence</p>
        <div className="grid grid-cols-3 gap-2 mb-4 min-w-0">
          {PORTRAITS.filter(p => p.premium).map((p) => {
            const owned = character.unlocked_portraits.includes(p.id);
            const active = character.portrait === p.id;
            return (
              <div key={p.id} className={`border ${INK_BORDER} p-1.5 text-center min-w-0`}>
                <div className={`mb-1 ${owned ? "" : "opacity-40 grayscale"}`}>
                  <PortraitDisplay portraitId={p.id} size={56} />
                </div>
                <p className={`text-[9px] ${INK_MUTED} mb-1 truncate`}>{p.label}</p>
                {owned ? (
                  <button disabled={active || busy === p.id}
                    onClick={() => run(p.id, () => supabase.from("characters" as any).update({ portrait: p.id }).eq("id", character.id))}
                    className={`w-full text-[9px] uppercase border ${active ? "border-emerald-800/50 text-emerald-800" : `${INK_BORDER} ${INK}`} px-1 py-1 hover:bg-black/5 disabled:opacity-60`}>
                    {active ? "Actif" : busy === p.id ? "…" : "Utiliser"}
                  </button>
                ) : (
                  <button disabled={busy === p.id || character.personal_gold < PORTRAIT_COST}
                    onClick={() => run(p.id, () => supabase.rpc("buy_portrait" as any, { p_character_id: character.id, p_portrait_id: p.id, p_cost: PORTRAIT_COST }))}
                    className={`w-full text-[9px] uppercase border border-amber-800/50 ${PRICE} px-1 py-1 hover:bg-amber-800/10 disabled:opacity-30`}>
                    {busy === p.id ? "…" : `${PORTRAIT_COST} or`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Rayon Pouvoir */}
        <p className={`font-serif text-sm tracking-[0.16em] uppercase ${INK} mb-2`}>Pouvoir</p>
        <div className={`border ${INK_BORDER} px-3 py-3 mb-2 min-w-0`}>
          <p className={`text-sm ${INK} mb-1`}>Multiclassage</p>
          <p className={`text-xs ${INK_MUTED} mb-2`}>
            Apprend, à vie, une capacité d'une autre vocation. Prochain coût : {Math.round(multiclassCost)} or.
          </p>
          {character.multiclass_vocations.length > 0 && (
            <p className={`text-xs ${PRICE} mb-2`}>Déjà appris : {character.multiclass_vocations.join(", ")}</p>
          )}
          <div className="flex flex-wrap gap-1.5 min-w-0">
            {availableMulticlass.map((v) => (
              <button key={v.id} disabled={busy === `mc-${v.id}` || character.personal_gold < multiclassCost}
                onClick={() => run(`mc-${v.id}`, () => supabase.rpc("buy_multiclass" as any, { p_character_id: character.id, p_vocation: v.id }))}
                className={`text-[10px] uppercase border border-amber-800/50 ${PRICE} px-2 py-1 hover:bg-amber-800/10 disabled:opacity-30`}>
                {busy === `mc-${v.id}` ? "…" : v.label}
              </button>
            ))}
            {availableMulticlass.length === 0 && <p className={`text-xs ${INK_MUTED} italic`}>Toutes les vocations sont déjà apprises.</p>}
          </div>
        </div>

        <button onClick={() => navigate({ to: "/" })} className={`mt-2 text-xs underline ${INK_MUTED}`}>
          Retour
        </button>
      </Frame>
    </LedgerPage>
  );
}
