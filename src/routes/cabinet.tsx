import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerPage, LedgerCard, LedgerError } from "@/components/ledger";
import { ImmersiveButton } from "@/components/immersive";

export const Route = createFileRoute("/cabinet")({
  ssr: false,
  component: CabinetPage,
});

type Character = { id: string; name: string };

type InventoryItem = {
  instance_id: string;
  curiosity_id: string;
  name: string;
  flavor_text: string;
  image_path: string;
};

type CombineResult = { tier: "banal" | "inhabituel" | "incroyable"; result_label: string; result_text: string };

// Positions approximatives, calées sur le repérage visuel des étagères du
// fond cabinetcuriosite.webp. À ajuster à l'oeil une fois vu en vrai (même
// méthode que les coordonnées % de la Boutique).
const SHELF_SLOTS: { left: string; top: string; width: string; height: string }[] = [
  // Étagère du haut (5)
  { left: "27.0%", top: "16.5%", width: "7.3%", height: "10.6%" },
  { left: "37.1%", top: "18.1%", width: "7.0%", height: "9.0%" },
  { left: "46.8%", top: "17.5%", width: "5.0%", height: "7.4%" },
  { left: "56.8%", top: "17.5%", width: "5.0%", height: "7.4%" },
  { left: "63.5%", top: "18.1%", width: "5.0%", height: "7.4%" },
  // Étagère du milieu (3)
  { left: "29.7%", top: "30.3%", width: "7.3%", height: "8.0%" },
  { left: "44.1%", top: "30.8%", width: "5.0%", height: "6.9%" },
  { left: "53.4%", top: "31.4%", width: "7.3%", height: "6.9%" },
  // Étagère du bas (3)
  { left: "30.1%", top: "41.4%", width: "6.3%", height: "8.0%" },
  { left: "41.4%", top: "42.0%", width: "4.7%", height: "6.9%" },
  { left: "51.4%", top: "42.5%", width: "5.0%", height: "5.8%" },
];

const CAULDRON_ZONE = { left: "8.7%", top: "60%", width: "30%", height: "36.7%" };
const MAILBOX_ZONE = { left: "72.1%", top: "62.2%", width: "16.7%", height: "21.8%" };

const TIER_EFFECTS: Record<CombineResult["tier"], string[]> = {
  banal: ["/effets_revelation/banal_1.png", "/effets_revelation/banal_2.png", "/effets_revelation/banal_3.png"],
  inhabituel: ["/effets_revelation/inhabituel_1.png", "/effets_revelation/inhabituel_2.png", "/effets_revelation/inhabituel_3.png"],
  incroyable: ["/effets_revelation/incroyable_1.png", "/effets_revelation/incroyable_2.png", "/effets_revelation/incroyable_3.png"],
};

function pickEffectImage(tier: CombineResult["tier"]) {
  const pool = TIER_EFFECTS[tier];
  return pool[Math.floor(Math.random() * pool.length)];
}

function useCabinetState() {
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [claimedToday, setClaimedToday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (characterId: string) => {
    const { data: inv } = await supabase
      .from("character_curiosities")
      .select("id, curiosity_id, curiosity:curiosity_catalog(name, flavor_text, image_path)")
      .eq("character_id", characterId)
      .order("created_at", { ascending: true });
    setInventory(
      ((inv as any) ?? []).map((r: any) => ({
        instance_id: r.id,
        curiosity_id: r.curiosity_id,
        name: r.curiosity?.name ?? "?",
        flavor_text: r.curiosity?.flavor_text ?? "",
        image_path: r.curiosity?.image_path ?? "",
      }))
    );
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
    const { data: claim } = await supabase
      .from("character_mailbox_claims")
      .select("claim_date")
      .eq("character_id", characterId)
      .eq("claim_date", today)
      .maybeSingle();
    setClaimedToday(!!claim);
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
        .eq("is_bot", false)
        .maybeSingle();
      if (!char) { navigate({ to: "/" }); return; }
      setCharacter(char);
      await load(char.id);
    })();
  }, [navigate, load]);

  return { character, inventory, claimedToday, error, setError, busy, setBusy, load, navigate };
}

function useCombine(state: ReturnType<typeof useCabinetState>) {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<CombineResult | null>(null);
  const [effectImg, setEffectImg] = useState<string | null>(null);

  function toggleSelect(instanceId: string) {
    setSelected((prev) => {
      if (prev.includes(instanceId)) return prev.filter((id) => id !== instanceId);
      if (prev.length >= 3) return prev;
      return [...prev, instanceId];
    });
  }

  async function claim() {
    if (!state.character) return;
    state.setError(null); state.setBusy(true);
    const { error: rpcError } = await supabase.rpc("claim_daily_curiosity" as any, { p_character_id: state.character.id });
    if (rpcError) state.setError(rpcError.message);
    else await state.load(state.character.id);
    state.setBusy(false);
  }

  async function combine() {
    if (!state.character || selected.length !== 3) return;
    state.setError(null); state.setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("combine_curiosities" as any, {
      p_character_id: state.character.id,
      p_curiosity_instance_ids: selected,
    });
    if (rpcError) { state.setError(rpcError.message); state.setBusy(false); return; }
    const row = (data as any)?.[0] as CombineResult | undefined;
    if (row) {
      setResult(row);
      setEffectImg(pickEffectImage(row.tier));
    }
    setSelected([]);
    await state.load(state.character.id);
    state.setBusy(false);
  }

  function closeResult() { setResult(null); setEffectImg(null); }

  return { selected, toggleSelect, claim, combine, result, effectImg, closeResult };
}

function ResultOverlay({ result, effectImg, onClose }: { result: CombineResult; effectImg: string | null; onClose: () => void }) {
  const tierColor = result.tier === "incroyable" ? "#f2c14e" : result.tier === "inhabituel" ? "#a8c6e8" : "#8a8378";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" onClick={onClose}>
      <div className="relative max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
        {effectImg && <img src={effectImg} alt="" className="mx-auto mb-2 w-48 h-auto pointer-events-none select-none" />}
        <p className="text-[10px] uppercase tracking-[0.2em] mb-1" style={{ color: tierColor }}>{result.tier}</p>
        <h2 className="font-serif text-xl uppercase tracking-[0.1em] mb-2" style={{ color: tierColor }}>{result.result_label}</h2>
        <p className="text-sm text-muted-foreground mb-5">{result.result_text}</p>
        <button onClick={onClose} className="text-xs uppercase tracking-[0.14em] border border-primary/40 text-primary px-5 py-2 hover:bg-primary/10">
          Fermer
        </button>
      </div>
    </div>
  );
}

function CabinetPage() {
  const state = useCabinetState();
  const combineState = useCombine(state);
  const { character, inventory, claimedToday, error, busy } = state;
  const { selected, toggleSelect, claim, combine, result, effectImg, closeResult } = combineState;

  if (!character) return <LedgerPage><LedgerCard title="Cabinet de curiosités">Chargement…</LedgerCard></LedgerPage>;

  const displayedSlots = SHELF_SLOTS.slice(0, Math.max(inventory.length, SHELF_SLOTS.length));

  return (
    <>
      {result && <ResultOverlay result={result} effectImg={effectImg} onClose={closeResult} />}

      {/* Bureau */}
      <div
        className="hidden md:block w-full px-4 py-8"
        style={{
          backgroundImage: `linear-gradient(rgba(13,12,10,0.55), rgba(13,12,10,0.7)), url(/fondcabinet.webp)`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      >
        <div className="mx-auto w-full" style={{ maxWidth: 1800 }}>
          <div className="flex justify-between gap-3 mb-3">
            <ImmersiveButton variant="sombre" onClick={() => state.navigate({ to: "/" })} className="px-6 !py-3 shrink-0 inline-flex items-center justify-center whitespace-nowrap text-sm">
              ← Ma guilde
            </ImmersiveButton>
          </div>

          <div
            style={{
              position: "relative",
              width: "min(100%, calc((100vh - 160px) * 1536 / 1024))",
              aspectRatio: "1536 / 1024",
              margin: "0 auto",
            }}
          >
            <img src="/cabinetcuriosite.webp" alt="" className="absolute inset-0 w-full h-full pointer-events-none select-none" style={{ objectFit: "fill" }} />

            {/* Objets sur les étagères */}
            {inventory.slice(0, SHELF_SLOTS.length).map((item, i) => {
              const slot = SHELF_SLOTS[i];
              const isSelected = selected.includes(item.instance_id);
              return (
                <button
                  key={item.instance_id}
                  onClick={() => toggleSelect(item.instance_id)}
                  title={`${item.name} — ${item.flavor_text}`}
                  className="absolute group"
                  style={{
                    left: slot.left, top: slot.top, width: slot.width, height: slot.height,
                    filter: isSelected ? "drop-shadow(0 0 8px rgba(242,193,78,0.9))" : "none",
                  }}
                >
                  <img src={item.image_path} alt={item.name} className="w-full h-full object-contain transition-transform group-hover:scale-110" />
                  {isSelected && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-[9px] flex items-center justify-center text-black font-bold">
                      {selected.indexOf(item.instance_id) + 1}
                    </span>
                  )}
                </button>
              );
            })}
            {inventory.length > SHELF_SLOTS.length && (
              <div className="absolute text-[10px] text-muted-foreground/70" style={{ left: "27%", top: "52%" }}>
                +{inventory.length - SHELF_SLOTS.length} autres curiosités (combine pour faire de la place)
              </div>
            )}

            {/* Le creuset */}
            <div className="absolute flex flex-col items-center justify-end pb-2" style={CAULDRON_ZONE}>
              <p className="text-[10px] uppercase tracking-[0.14em] text-primary/90 mb-1 bg-black/50 px-2 py-0.5 rounded-sm">
                {selected.length}/3 sélectionnés
              </p>
              <ImmersiveButton
                variant="clair"
                onClick={combine}
                disabled={selected.length !== 3 || busy}
                className="px-5 !py-2 text-xs"
              >
                {busy ? "…" : "Tenter le procédé"}
              </ImmersiveButton>
            </div>

            {/* La boîte aux lettres */}
            <div className="absolute flex flex-col items-center justify-end pb-2" style={MAILBOX_ZONE}>
              <ImmersiveButton
                variant="clair"
                onClick={claim}
                disabled={claimedToday || busy}
                className="px-5 !py-2 text-xs"
              >
                {claimedToday ? "Déjà réclamé" : busy ? "…" : "Réclamer"}
              </ImmersiveButton>
            </div>
          </div>

          <LedgerError message={error} />
        </div>
      </div>

      {/* Mobile : positions immersives illisibles en dessous d'une certaine
          largeur — repli sur une liste standard. */}
      <div className="block md:hidden">
        <LedgerPage maxWidthClass="max-w-2xl">
          <LedgerCard title="Cabinet de curiosités" subtitle={`${inventory.length} curiosité${inventory.length > 1 ? "s" : ""} en réserve`}>
            <img src="/cabinetcuriosite.webp" alt="" className="w-full rounded-sm mb-4 object-cover" style={{ maxHeight: 160 }} />
            <ImmersiveButton variant="clair" onClick={claim} disabled={claimedToday || busy} className="w-full mb-4 !py-2.5 text-xs">
              {claimedToday ? "Déjà réclamé aujourd'hui" : busy ? "…" : "Réclamer la curiosité du jour"}
            </ImmersiveButton>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {inventory.map((item) => {
                const isSelected = selected.includes(item.instance_id);
                return (
                  <button
                    key={item.instance_id}
                    onClick={() => toggleSelect(item.instance_id)}
                    className="border p-1.5"
                    style={{ borderColor: isSelected ? "#f2c14e" : "rgba(255,255,255,0.15)" }}
                  >
                    <img src={item.image_path} alt={item.name} className="w-full h-auto object-contain" />
                  </button>
                );
              })}
              {inventory.length === 0 && (
                <p className="col-span-4 text-xs italic text-muted-foreground">Rien pour l'instant — réclame ta première curiosité.</p>
              )}
            </div>

            <ImmersiveButton variant="clair" onClick={combine} disabled={selected.length !== 3 || busy} className="w-full !py-2.5 text-xs">
              {busy ? "…" : `Tenter le procédé (${selected.length}/3)`}
            </ImmersiveButton>

            <LedgerError message={error} />
          </LedgerCard>
        </LedgerPage>
      </div>
    </>
  );
}
