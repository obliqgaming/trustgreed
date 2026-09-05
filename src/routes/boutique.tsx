import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerCard, LedgerPage, TextLink, LedgerError } from "@/components/ledger";
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

  if (!character) return <LedgerPage><LedgerCard title="Boutique">Chargement…</LedgerCard></LedgerPage>;

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

  const lockedPortraits = PORTRAITS.filter(p => p.premium && !character.unlocked_portraits.includes(p.id));

  return (
    <LedgerPage maxWidthClass="max-w-2xl">
      <LedgerCard title="Boutique" subtitle={`Or personnel : ${Math.round(character.personal_gold)}`}>
        <LedgerError message={error} />

        {/* Rayon Destin */}
        <p className="font-serif text-sm tracking-[0.16em] uppercase text-primary mt-4 mb-2">Destin</p>

        <div className="border border-border/30 px-3 py-3 mb-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm">Pierre d'âme</p>
            <span className="text-xs text-amber-300 font-mono">{Math.round(soulStoneCost)} or</span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Charges en réserve : {character.soul_stone_charges}. Consommée automatiquement si tu es désigné·e pour mourir.
            {soulStoneLocked && <span className="block text-amber-400/80 mt-1">Verrouillée : ta vocation Miraculé doit d'abord épuiser son propre sauvetage gratuit.</span>}
          </p>
          <button disabled={soulStoneLocked || busy === "soul" || character.personal_gold < soulStoneCost}
            onClick={() => run("soul", () => supabase.rpc("buy_soul_stone" as any, { p_character_id: character.id }))}
            className="text-xs uppercase border border-amber-500/40 text-amber-300 px-3 py-1.5 hover:bg-amber-500/10 disabled:opacity-30">
            {busy === "soul" ? "…" : "Acheter une charge"}
          </button>
        </div>

        <div className="border border-border/30 px-3 py-3 mb-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm">Sceau d'héritage</p>
            {!legacyMaxed && <span className="text-xs text-amber-300 font-mono">{Math.round(legacyCost)} or</span>}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Actuellement : {legacyCurrentPct}% de ton or personnel transmis à ton prochain personnage si tu meurs.
            {legacyMaxed ? " Palier maximum atteint." : ` Prochain palier : ${legacyCurrentPct + 10}%.`}
          </p>
          {!legacyMaxed && (
            <button disabled={busy === "legacy" || character.personal_gold < legacyCost}
              onClick={() => run("legacy", () => supabase.rpc("buy_legacy_tier" as any, { p_character_id: character.id }))}
              className="text-xs uppercase border border-amber-500/40 text-amber-300 px-3 py-1.5 hover:bg-amber-500/10 disabled:opacity-30">
              {busy === "legacy" ? "…" : "Augmenter le palier"}
            </button>
          )}
        </div>

        {/* Rayon Apparence */}
        <p className="font-serif text-sm tracking-[0.16em] uppercase text-primary mb-2">Apparence</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {PORTRAITS.filter(p => p.premium).map((p) => {
            const owned = character.unlocked_portraits.includes(p.id);
            const active = character.portrait === p.id;
            return (
              <div key={p.id} className="border border-border/30 p-2 text-center">
                <div className={`mb-1.5 ${owned ? "" : "opacity-40 grayscale"}`}>
                  <PortraitDisplay portraitId={p.id} size={72} />
                </div>
                <p className="text-[10px] text-muted-foreground mb-1.5 truncate">{p.label}</p>
                {owned ? (
                  <button disabled={active || busy === p.id}
                    onClick={() => run(p.id, () => supabase.from("characters" as any).update({ portrait: p.id }).eq("id", character.id))}
                    className="w-full text-[10px] uppercase border border-primary/40 text-primary px-1 py-1 hover:bg-primary/10 disabled:opacity-30">
                    {active ? "Actif" : busy === p.id ? "…" : "Utiliser"}
                  </button>
                ) : (
                  <button disabled={busy === p.id || character.personal_gold < PORTRAIT_COST}
                    onClick={() => run(p.id, () => supabase.rpc("buy_portrait" as any, { p_character_id: character.id, p_portrait_id: p.id, p_cost: PORTRAIT_COST }))}
                    className="w-full text-[10px] uppercase border border-amber-500/40 text-amber-300 px-1 py-1 hover:bg-amber-500/10 disabled:opacity-30">
                    {busy === p.id ? "…" : `${PORTRAIT_COST} or`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {lockedPortraits.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic mb-4">Tous les portraits premium sont débloqués sur ce personnage.</p>
        )}

        {/* Rayon Pouvoir */}
        <p className="font-serif text-sm tracking-[0.16em] uppercase text-primary mb-2">Pouvoir</p>
        <div className="border border-border/30 px-3 py-3 mb-2">
          <p className="text-sm mb-1">Multiclassage</p>
          <p className="text-xs text-muted-foreground mb-2">
            Apprend, à vie, une capacité d'une autre vocation. Prochain coût : {Math.round(multiclassCost)} or.
          </p>
          {character.multiclass_vocations.length > 0 && (
            <p className="text-xs text-primary/80 mb-2">Déjà appris : {character.multiclass_vocations.join(", ")}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {availableMulticlass.map((v) => (
              <button key={v.id} disabled={busy === `mc-${v.id}` || character.personal_gold < multiclassCost}
                onClick={() => run(`mc-${v.id}`, () => supabase.rpc("buy_multiclass" as any, { p_character_id: character.id, p_vocation: v.id }))}
                className="text-[10px] uppercase border border-amber-500/40 text-amber-300 px-2 py-1 hover:bg-amber-500/10 disabled:opacity-30">
                {busy === `mc-${v.id}` ? "…" : v.label}
              </button>
            ))}
            {availableMulticlass.length === 0 && <p className="text-xs text-muted-foreground/60 italic">Toutes les vocations sont déjà apprises.</p>}
          </div>
        </div>

        <TextLink onClick={() => navigate({ to: "/" })}>Retour</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}
