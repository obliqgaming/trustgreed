import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerCard, LedgerPage, TextLink, LedgerError } from "@/components/ledger";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: AdminPage,
});

type GuildRow = { id: string; name: string; gold: number; member_count: number; history_count: number };
type CharacterRow = { id: string; name: string; is_alive: boolean; level: number; guild_id: string | null; guild_name?: string; is_bot: boolean };
type ExpeditionRow = { id: string; status: string; guild_id: string; guild_name: string; participant_count: number };
type EventSituation = { situation: string; success: string | null; failure: string | null };
type EventTemplate = {
  id: string; event_type: string; risk_level: string;
  loot_base_min: number; loot_base_max: number; death_percentage: number; flavor_texts: EventSituation[];
};
type TemplateProvenance = { id: string; is_community: boolean; author_name: string | null; guild_name: string | null; image_path: string | null };
type ProfileRow = { id: string; username: string; last_seen_at: string | null };
type CommunityEvent = {
  id: string; character_name: string; guild_name: string; event_type: string; risk_level: string;
  status: string; situation_text: string; success_text: string; failure_text: string;
  cost_paid: number; created_at: string; submitted_at: string | null;
};
type Prices = { potion_base: number; potion_growth: number; potion_step_scale: number; community_event_cost: number };

const RISK_LEVELS = ["faible", "moyen", "eleve"] as const;

function ScrollBox({ children, maxHeight = "16rem" }: { children: React.ReactNode; maxHeight?: string }) {
  return <div className="overflow-y-auto pr-1" style={{ maxHeight }}>{children}</div>;
}

function AdminPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Tableau de bord
  const [activePlayers24h, setActivePlayers24h] = useState<number | null>(null);

  // Guildes
  const [guilds, setGuilds] = useState<GuildRow[]>([]);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetGold, setResetGold] = useState("1000");
  const [resetLevel, setResetLevel] = useState("2");
  const [resetPurge, setResetPurge] = useState(true);

  // Expéditions
  const [expeditions, setExpeditions] = useState<ExpeditionRow[]>([]);

  // Flux d'activité
  const [feed, setFeed] = useState<{ id: string; description: string; created_at: string; guild_name: string }[]>([]);

  // Templates d'événements
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<EventTemplate | null>(null);
  const [templateProvenance, setTemplateProvenance] = useState<Record<string, TemplateProvenance>>({});
  const [templateImageDraft, setTemplateImageDraft] = useState<string>("");

  // Recherche joueur
  const [playerSearch, setPlayerSearch] = useState("");
  const [foundProfile, setFoundProfile] = useState<ProfileRow | null>(null);
  const [profileCharacters, setProfileCharacters] = useState<CharacterRow[]>([]);

  // Maintenance
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");

  // Prix ajustables
  const [prices, setPrices] = useState<Prices | null>(null);

  // Rencontres communautaires — modération
  const [pendingEvents, setPendingEvents] = useState<CommunityEvent[]>([]);
  const [imageDraft, setImageDraft] = useState<Record<string, string>>({});
  const [rejectDraft, setRejectDraft] = useState<Record<string, string>>({});
  const [textDraft, setTextDraft] = useState<Record<string, { situation: string; success: string; failure: string }>>({});

  async function loadAll() {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [guildsRes, expRes, activeRes, feedRes, templatesRes, settingsRes, pricesRes, pendingRes, provenanceRes] = await Promise.all([
      supabase.from("guilds").select("id, name, gold"),
      supabase.from("expeditions").select("id, status, guild_id, guild:guilds(name)").in("status", ["waiting", "active"]),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("last_seen_at", dayAgo),
      supabase.from("guild_history_events").select("id, description, created_at, guild:guilds(name)").order("created_at", { ascending: false }).limit(50),
      supabase.rpc("admin_list_event_templates" as any),
      supabase.from("app_settings" as any).select("value").eq("key", "maintenance").maybeSingle(),
      supabase.from("app_settings" as any).select("value").eq("key", "prices").maybeSingle(),
      supabase.rpc("admin_list_community_events" as any, { p_status: "pending_review" }),
      supabase.rpc("admin_list_event_template_provenance" as any),
    ]);

    const enrichedGuilds: GuildRow[] = await Promise.all((guildsRes.data ?? []).map(async (g) => {
      const [memberRes, historyRes] = await Promise.all([
        supabase.from("characters").select("id", { count: "exact", head: true }).eq("guild_id", g.id).eq("is_alive", true),
        supabase.from("guild_history_events").select("id", { count: "exact", head: true }).eq("guild_id", g.id),
      ]);
      return { id: g.id, name: g.name, gold: Math.round(g.gold), member_count: memberRes.count ?? 0, history_count: historyRes.count ?? 0 };
    }));
    setGuilds(enrichedGuilds);

    const enrichedExp: ExpeditionRow[] = await Promise.all(((expRes.data as any[]) ?? []).map(async (e) => {
      const { count } = await supabase.from("expedition_participants").select("character_id", { count: "exact", head: true }).eq("expedition_id", e.id);
      return { id: e.id, status: e.status, guild_id: e.guild_id, guild_name: e.guild?.name ?? "?", participant_count: count ?? 0 };
    }));
    setExpeditions(enrichedExp);

    setActivePlayers24h(activeRes.count ?? 0);
    setFeed((feedRes.data as any[] ?? []).map(e => ({ id: e.id, description: e.description, created_at: e.created_at, guild_name: e.guild?.name ?? "?" })));
    setTemplates((templatesRes.data as any) ?? []);
    const maint = (settingsRes.data as any)?.value;
    setMaintenanceActive(!!maint?.active);
    setMaintenanceMessage(maint?.message ?? "");
    setPrices((pricesRes.data as any)?.value ?? null);
    setPendingEvents((pendingRes.data as any) ?? []);
    const provenanceMap: Record<string, TemplateProvenance> = {};
    for (const row of (provenanceRes.data as any[]) ?? []) provenanceMap[row.id] = row;
    setTemplateProvenance(provenanceMap);
  }

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate({ to: "/" }); return; }
      const { data: profileRow } = await supabase.from("profiles").select("is_admin").eq("id", session.user.id).maybeSingle();
      if (!profileRow?.is_admin) { navigate({ to: "/" }); return; }
      setIsAdmin(true);
      await loadAll();
      setChecking(false);
    })();
  }, [navigate]);

  async function runAction(id: string, fn: () => PromiseLike<{ error: any }>) {
    setBusy(id); setError(null);
    const { error: rpcError } = await fn();
    if (rpcError) setError(rpcError.message);
    else await loadAll();
    setBusy(null);
  }

  async function searchPlayer() {
    const query = playerSearch.trim();
    if (query.length < 2) return;
    setError(null);
    setFoundProfile(null); setProfileCharacters([]);

    // On cherche d'abord par pseudo de compte, sinon par nom de personnage —
    // "Destructeur" est un nom de perso, pas forcément le pseudo du compte
    // qui l'a créé.
    const { data: profile } = await supabase.from("profiles").select("id, username, last_seen_at").ilike("username", `%${query}%`).limit(1).maybeSingle();
    if (profile) {
      setFoundProfile(profile);
      const { data: chars } = await supabase.from("characters").select("id, name, is_alive, level, guild_id, is_bot, guild:guilds(name)").eq("profile_id", profile.id);
      setProfileCharacters((chars as any[] ?? []).map(c => ({ ...c, guild_name: c.guild?.name })));
      return;
    }

    const { data: charMatch } = await supabase.from("characters").select("profile_id").ilike("name", `%${query}%`).limit(1).maybeSingle();
    if (charMatch?.profile_id) {
      const { data: byChar } = await supabase.from("profiles").select("id, username, last_seen_at").eq("id", charMatch.profile_id).maybeSingle();
      if (byChar) {
        setFoundProfile(byChar);
        const { data: chars } = await supabase.from("characters").select("id, name, is_alive, level, guild_id, is_bot, guild:guilds(name)").eq("profile_id", byChar.id);
        setProfileCharacters((chars as any[] ?? []).map(c => ({ ...c, guild_name: c.guild?.name })));
        return;
      }
    }

    setError("Aucun joueur ni personnage trouvé avec ce nom.");
  }

  async function renameCharacter(id: string, currentName: string) {
    const newName = prompt("Nouveau nom :", currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;
    setBusy(id); setError(null);
    const { error: rpcError } = await supabase.rpc("admin_rename_character" as any, { p_character_id: id, p_new_name: newName.trim() });
    if (rpcError) setError(rpcError.message);
    else await searchPlayer();
    setBusy(null);
  }

  async function moderateEvent(id: string, action: "approve" | "reject") {
    setBusy(`mod-${id}`); setError(null);
    const edited = textDraft[id];
    const { error: rpcError } = await supabase.rpc("admin_moderate_community_event" as any, {
      p_event_id: id, p_action: action,
      p_image_path: action === "approve" ? (imageDraft[id]?.trim() || null) : null,
      p_rejection_reason: action === "reject" ? (rejectDraft[id]?.trim() || null) : null,
      p_situation: action === "approve" ? (edited?.situation?.trim() || null) : null,
      p_success: action === "approve" ? (edited?.success?.trim() || null) : null,
      p_failure: action === "approve" ? (edited?.failure?.trim() || null) : null,
    });
    if (rpcError) setError(rpcError.message);
    else await loadAll();
    setBusy(null);
  }

  async function savePrices() {
    if (!prices) return;
    setBusy("prices"); setError(null);
    const { error: rpcError } = await supabase.rpc("admin_set_prices" as any, { p_prices: prices });
    if (rpcError) setError(rpcError.message);
    setBusy(null);
  }

  const abandonedCount = guilds.filter(g => g.member_count === 0 && g.history_count === 0).length;

  if (checking) return <LedgerPage><LedgerCard title="Admin">Vérification…</LedgerCard></LedgerPage>;
  if (!isAdmin) return null;

  return (
    <LedgerPage maxWidthClass="max-w-3xl">
      <LedgerCard title="Monitoring admin" subtitle="Visible uniquement par les comptes administrateurs.">
        <LedgerError message={error} />

        {/* Tableau de bord */}
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mt-4 mb-2">Activité</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="border border-border/30 px-3 py-2 text-center">
            <p className="font-mono text-lg text-primary">{activePlayers24h ?? "…"}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Joueurs vus (24h)</p>
          </div>
          <div className="border border-border/30 px-3 py-2 text-center">
            <p className="font-mono text-lg text-primary">{expeditions.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Expéditions en cours</p>
          </div>
          <div className="border border-border/30 px-3 py-2 text-center">
            <p className={`font-mono text-lg ${abandonedCount > 0 ? "text-amber-400" : "text-primary"}`}>{abandonedCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Guildes abandonnées</p>
          </div>
        </div>
        {abandonedCount > 0 && (
          <button disabled={busy === "cleanup"}
            onClick={() => { if (confirm(`Supprimer les ${abandonedCount} guilde(s) sans membre ni historique ?`)) void runAction("cleanup", () => supabase.rpc("admin_cleanup_abandoned_guilds" as any)); }}
            className="w-full mb-4 text-xs uppercase border border-amber-500/40 text-amber-300 px-3 py-1.5 hover:bg-amber-500/10 disabled:opacity-30">
            {busy === "cleanup" ? "…" : `Nettoyer les ${abandonedCount} guilde(s) abandonnée(s)`}
          </button>
        )}

        {/* Maintenance */}
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Bannière de maintenance</p>
        <p className="text-[10px] text-muted-foreground/60 mb-2">
          Affiche un message à tous les joueurs. N'empêche rien côté serveur — c'est une information, pas un verrou.
        </p>
        <div className="border border-border/30 px-3 py-2 mb-4">
          <label className="flex items-center gap-2 text-xs mb-2">
            <input type="checkbox" checked={maintenanceActive} onChange={(e) => setMaintenanceActive(e.target.checked)} />
            Bannière active
          </label>
          <input value={maintenanceMessage} onChange={(e) => setMaintenanceMessage(e.target.value)}
            placeholder="Ex : Maintenance en cours, évite de lancer une expédition pour l'instant."
            className="w-full bg-transparent border border-border/40 px-2 py-1.5 text-xs mb-2 focus:outline-none focus:border-primary/40" />
          <button disabled={busy === "maintenance"}
            onClick={() => runAction("maintenance", () => supabase.rpc("admin_set_maintenance" as any, { p_active: maintenanceActive, p_message: maintenanceMessage }))}
            className="text-xs uppercase border border-primary/40 text-primary px-3 py-1.5 hover:bg-primary/10 disabled:opacity-30">
            {busy === "maintenance" ? "…" : "Enregistrer"}
          </button>
        </div>

        {/* Prix ajustables */}
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Prix</p>
        {prices && (
          <div className="border border-border/30 px-3 py-2 mb-4">
            <div className="grid grid-cols-2 gap-3 mb-2">
              <label className="text-[10px] text-muted-foreground">
                Potion — prix de base<br />
                <input value={prices.potion_base} onChange={(e) => setPrices({ ...prices, potion_base: Number(e.target.value) })}
                  className="w-full bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
              </label>
              <label className="text-[10px] text-muted-foreground">
                Potion — multiplicateur par achat<br />
                <input value={prices.potion_growth} onChange={(e) => setPrices({ ...prices, potion_growth: Number(e.target.value) })}
                  className="w-full bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
              </label>
              <label className="text-[10px] text-muted-foreground">
                Potion — hausse par étape (0-1)<br />
                <input value={prices.potion_step_scale} onChange={(e) => setPrices({ ...prices, potion_step_scale: Number(e.target.value) })}
                  className="w-full bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
              </label>
              <label className="text-[10px] text-muted-foreground">
                Écrire une rencontre (or de guilde)<br />
                <input value={prices.community_event_cost} onChange={(e) => setPrices({ ...prices, community_event_cost: Number(e.target.value) })}
                  className="w-full bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
              </label>
            </div>
            <button disabled={busy === "prices"} onClick={savePrices}
              className="text-[10px] uppercase border border-primary/40 text-primary px-2 py-1 hover:bg-primary/10 disabled:opacity-30">
              {busy === "prices" ? "…" : "Enregistrer les prix"}
            </button>
          </div>
        )}

        {/* Rencontres communautaires — modération */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground">Rencontres en attente de modération ({pendingEvents.length})</p>
          <button onClick={() => void loadAll()} className="text-[10px] uppercase border border-border/40 text-muted-foreground px-2 py-1 hover:border-primary/40 hover:text-primary">
            Actualiser
          </button>
        </div>
        {pendingEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic mb-4">Aucune.</p>
        ) : (
          <ScrollBox maxHeight="28rem">
            <ul className="space-y-2 mb-4">
              {pendingEvents.map((e) => (
                <li key={e.id} className="text-xs border border-amber-500/30 px-3 py-2">
                  <p className="mb-1.5">
                    <span className="text-primary">{e.character_name}</span> ({e.guild_name}) — {e.event_type} · risque {e.risk_level} · {e.cost_paid} or payé
                  </p>
                  <label className="block text-[10px] text-muted-foreground mb-0.5">Situation (corrigeable avant validation)</label>
                  <textarea value={textDraft[e.id]?.situation ?? e.situation_text} rows={2}
                    onChange={(ev) => setTextDraft({ ...textDraft, [e.id]: { situation: ev.target.value, success: textDraft[e.id]?.success ?? e.success_text, failure: textDraft[e.id]?.failure ?? e.failure_text } })}
                    className="w-full bg-transparent border border-border/40 px-1.5 py-1 text-xs mb-1.5" />
                  <label className="block text-[10px] text-emerald-400/80 mb-0.5">Réussite</label>
                  <textarea value={textDraft[e.id]?.success ?? e.success_text} rows={2}
                    onChange={(ev) => setTextDraft({ ...textDraft, [e.id]: { situation: textDraft[e.id]?.situation ?? e.situation_text, success: ev.target.value, failure: textDraft[e.id]?.failure ?? e.failure_text } })}
                    className="w-full bg-transparent border border-emerald-400/30 px-1.5 py-1 text-xs mb-1.5" />
                  <label className="block text-[10px] text-red-400/80 mb-0.5">Échec</label>
                  <textarea value={textDraft[e.id]?.failure ?? e.failure_text} rows={2}
                    onChange={(ev) => setTextDraft({ ...textDraft, [e.id]: { situation: textDraft[e.id]?.situation ?? e.situation_text, success: textDraft[e.id]?.success ?? e.success_text, failure: ev.target.value } })}
                    className="w-full bg-transparent border border-red-400/30 px-1.5 py-1 text-xs mb-2" />
                  <label className="block text-[10px] text-muted-foreground mb-2">
                    Image (même format que les autres — chemin dans public/, ex. /event_ma_scene.webp). Laisser vide = parchemin nu en attendant.<br />
                    <input value={imageDraft[e.id] ?? ""} onChange={(ev) => setImageDraft({ ...imageDraft, [e.id]: ev.target.value })}
                      placeholder="/event_xxx.webp"
                      className="w-full bg-transparent border border-border/40 px-1.5 py-1 text-xs mt-1" />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button disabled={busy === `mod-${e.id}`} onClick={() => moderateEvent(e.id, "approve")}
                      className="text-[10px] uppercase border border-emerald-400/40 text-emerald-400 px-2 py-1 hover:bg-emerald-400/10 disabled:opacity-30">
                      {busy === `mod-${e.id}` ? "…" : "Approuver"}
                    </button>
                    <input value={rejectDraft[e.id] ?? ""} onChange={(ev) => setRejectDraft({ ...rejectDraft, [e.id]: ev.target.value })}
                      placeholder="Motif de refus (optionnel, pour toi)"
                      className="flex-1 min-w-[140px] bg-transparent border border-border/40 px-1.5 py-1 text-[10px]" />
                    <button disabled={busy === `mod-${e.id}`} onClick={() => moderateEvent(e.id, "reject")}
                      className="text-[10px] uppercase border border-red-400/40 text-red-400 px-2 py-1 hover:bg-red-400/10 disabled:opacity-30">
                      {busy === `mod-${e.id}` ? "…" : "Refuser"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollBox>
        )}

        {/* Expéditions bloquées */}
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Expéditions en cours ({expeditions.length})</p>
        {expeditions.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic mb-4">Aucune.</p>
        ) : (
          <ScrollBox>
            <ul className="space-y-1.5 mb-4">
              {expeditions.map((e) => (
                <li key={e.id} className="text-xs border border-border/30 px-3 py-2 flex items-center justify-between gap-2">
                  <span>{e.guild_name} — {e.status} · {e.participant_count} participant{e.participant_count > 1 ? "s" : ""}</span>
                  <button disabled={busy === e.id}
                    onClick={() => runAction(e.id, () => supabase.rpc("admin_cancel_any_expedition" as any, { p_expedition_id: e.id }))}
                    className="text-[10px] uppercase border border-red-400/40 text-red-400 px-2 py-1 hover:bg-red-400/10 disabled:opacity-30 flex-shrink-0">
                    {busy === e.id ? "…" : "Forcer l'annulation"}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollBox>
        )}

        {/* Guildes — reset + dissolution au même endroit */}
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Guildes ({guilds.length})</p>
        <ScrollBox maxHeight="20rem">
          <ul className="space-y-1.5 mb-4">
            {guilds.map((g) => (
              <li key={g.id} className="text-xs border border-border/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span>{g.name} — {g.gold} or · {g.member_count} membre{g.member_count > 1 ? "s" : ""} · {g.history_count} événement{g.history_count > 1 ? "s" : ""}</span>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => setResetTarget(resetTarget === g.id ? null : g.id)}
                      className="text-[10px] uppercase border border-amber-500/40 text-amber-300 px-2 py-1 hover:bg-amber-500/10">
                      Réinitialiser
                    </button>
                    <button disabled={busy === g.id}
                      onClick={() => { if (confirm(`Dissoudre définitivement "${g.name}" ? Les membres redeviendront sans guilde.`)) void runAction(g.id, () => supabase.rpc("admin_delete_guild" as any, { p_guild_id: g.id })); }}
                      className="text-[10px] uppercase border border-red-400/40 text-red-400 px-2 py-1 hover:bg-red-400/10 disabled:opacity-30">
                      {busy === g.id ? "…" : "Dissoudre"}
                    </button>
                  </div>
                </div>
                {resetTarget === g.id && (
                  <div className="mt-2 pt-2 border-t border-border/20 flex flex-wrap items-end gap-2">
                    <label className="text-[10px] text-muted-foreground">
                      Or cible<br />
                      <input value={resetGold} onChange={(e) => setResetGold(e.target.value)} className="w-20 bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
                    </label>
                    <label className="text-[10px] text-muted-foreground">
                      Niveau cible<br />
                      <input value={resetLevel} onChange={(e) => setResetLevel(e.target.value)} className="w-14 bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <input type="checkbox" checked={resetPurge} onChange={(e) => setResetPurge(e.target.checked)} />
                      Purger l'historique
                    </label>
                    <button disabled={busy === `reset-${g.id}`}
                      onClick={() => runAction(`reset-${g.id}`, () => supabase.rpc("admin_reset_guild" as any, {
                        p_guild_id: g.id, p_target_gold: Number(resetGold), p_target_level: Number(resetLevel), p_purge_history: resetPurge,
                      }))}
                      className="text-[10px] uppercase border border-amber-500/40 text-amber-300 px-2 py-1 hover:bg-amber-500/10 disabled:opacity-30">
                      {busy === `reset-${g.id}` ? "…" : "Confirmer"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </ScrollBox>

        {/* Flux d'activité */}
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Flux d'activité (50 derniers événements)</p>
        <ScrollBox>
          <ul className="space-y-1 mb-4">
            {feed.map((e) => (
              <li key={e.id} className="text-[11px] border-b border-border/10 pb-1">
                <span className="text-primary/70">{e.guild_name}</span> — {e.description}
                <span className="text-muted-foreground/50"> · {new Date(e.created_at).toLocaleString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        </ScrollBox>

        {/* Templates d'événements */}
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Templates d'événements ({templates.length})</p>
        <ScrollBox maxHeight="20rem">
          <ul className="space-y-1.5 mb-4">
            {templates.map((t) => {
              const prov = templateProvenance[t.id];
              return (
              <li key={t.id} className="text-xs border border-border/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {t.event_type} — {t.risk_level} · {t.loot_base_min}-{t.loot_base_max} or · {Math.round(t.death_percentage * 100)}% mort
                    {prov?.is_community && (
                      <span className="ml-2 text-[9px] uppercase border border-amber-500/40 text-amber-400 px-1.5 py-0.5 rounded-sm">
                        Communautaire{prov.author_name ? ` — ${prov.author_name}` : ""}{prov.guild_name ? ` (${prov.guild_name})` : ""}
                      </span>
                    )}
                  </span>
                  <button onClick={() => { const opening = editingTemplate?.id !== t.id; setEditingTemplate(opening ? { ...t } : null); setTemplateImageDraft(opening ? (prov?.image_path ?? "") : ""); }}
                    className="text-[10px] uppercase border border-border/40 text-muted-foreground px-2 py-1 hover:border-primary/40 hover:text-primary flex-shrink-0">
                    {editingTemplate?.id === t.id ? "Fermer" : "Éditer"}
                  </button>
                </div>
                {editingTemplate?.id === t.id && (
                  <div className="mt-2 pt-2 border-t border-border/20 space-y-2">
                    <div className="flex flex-wrap gap-2 items-end">
                      <label className="text-[10px] text-muted-foreground">
                        Risque<br />
                        <select value={editingTemplate.risk_level} onChange={(e) => setEditingTemplate({ ...editingTemplate, risk_level: e.target.value })}
                          className="bg-transparent border border-border/40 px-1.5 py-1 text-xs">
                          {RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        Butin min<br />
                        <input value={editingTemplate.loot_base_min} onChange={(e) => setEditingTemplate({ ...editingTemplate, loot_base_min: Number(e.target.value) })}
                          className="w-20 bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        Butin max<br />
                        <input value={editingTemplate.loot_base_max} onChange={(e) => setEditingTemplate({ ...editingTemplate, loot_base_max: Number(e.target.value) })}
                          className="w-20 bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        % mort (0-1)<br />
                        <input value={editingTemplate.death_percentage} onChange={(e) => setEditingTemplate({ ...editingTemplate, death_percentage: Number(e.target.value) })}
                          className="w-16 bg-transparent border border-border/40 px-1.5 py-1 text-xs" />
                      </label>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">Situations (chacune avec sa réussite et son échec, laisser vide pour retomber sur le texte générique)</p>
                      <div className="space-y-3">
                        {editingTemplate.flavor_texts.map((sit, i) => (
                          <div key={i} className="border border-border/30 p-2 space-y-1">
                            <div className="flex items-start gap-1">
                              <textarea value={sit.situation} placeholder="Situation"
                                onChange={(e) => {
                                  const next = [...editingTemplate.flavor_texts];
                                  next[i] = { ...next[i], situation: e.target.value };
                                  setEditingTemplate({ ...editingTemplate, flavor_texts: next });
                                }}
                                rows={2} className="flex-1 bg-transparent border border-border/40 px-2 py-1.5 text-xs" />
                              <button onClick={() => {
                                const next = editingTemplate.flavor_texts.filter((_, j) => j !== i);
                                setEditingTemplate({ ...editingTemplate, flavor_texts: next });
                              }} className="text-[10px] text-red-400/70 border border-red-400/30 px-1.5 py-1 hover:bg-red-400/10">✕</button>
                            </div>
                            <textarea value={sit.success ?? ""} placeholder="Réussite (optionnel)"
                              onChange={(e) => {
                                const next = [...editingTemplate.flavor_texts];
                                next[i] = { ...next[i], success: e.target.value || null };
                                setEditingTemplate({ ...editingTemplate, flavor_texts: next });
                              }}
                              rows={2} className="w-full bg-transparent border border-emerald-400/20 px-2 py-1.5 text-xs" />
                            <textarea value={sit.failure ?? ""} placeholder="Échec (optionnel)"
                              onChange={(e) => {
                                const next = [...editingTemplate.flavor_texts];
                                next[i] = { ...next[i], failure: e.target.value || null };
                                setEditingTemplate({ ...editingTemplate, flavor_texts: next });
                              }}
                              rows={2} className="w-full bg-transparent border border-red-400/20 px-2 py-1.5 text-xs" />
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setEditingTemplate({
                        ...editingTemplate,
                        flavor_texts: [...editingTemplate.flavor_texts, { situation: "", success: null, failure: null }],
                      })} className="mt-2 text-[10px] uppercase border border-border/40 text-muted-foreground px-2 py-1 hover:border-primary/40 hover:text-primary">
                        + Ajouter une situation
                      </button>
                    </div>
                    <label className="block text-[10px] text-muted-foreground">
                      Image dédiée (même format que les autres — chemin dans public/, ex. /event_ma_scene.webp). Vide = pool générique type+risque.<br />
                      <input value={templateImageDraft} onChange={(e) => setTemplateImageDraft(e.target.value)}
                        placeholder="/event_xxx.webp"
                        className="w-full bg-transparent border border-border/40 px-1.5 py-1 text-xs mt-1" />
                    </label>
                    <button disabled={busy === `tpl-${t.id}`}
                      onClick={() => runAction(`tpl-${t.id}`, () => supabase.rpc("admin_update_event_template" as any, {
                        p_id: t.id, p_risk_level: editingTemplate.risk_level,
                        p_loot_base_min: editingTemplate.loot_base_min, p_loot_base_max: editingTemplate.loot_base_max,
                        p_death_percentage: editingTemplate.death_percentage,
                        p_flavor_texts: editingTemplate.flavor_texts.filter(s => s.situation.trim()),
                        p_image_path: templateImageDraft.trim() || null,
                      }).then((res) => { if (!res.error) setEditingTemplate(null); return res; }))}
                      className="text-[10px] uppercase border border-primary/40 text-primary px-2 py-1 hover:bg-primary/10 disabled:opacity-30">
                      {busy === `tpl-${t.id}` ? "…" : "Enregistrer"}
                    </button>
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        </ScrollBox>

        {/* Recherche joueur */}
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Rechercher un joueur</p>
        <div className="flex gap-2 mb-2">
          <input value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchPlayer()}
            placeholder="Nom d'utilisateur…"
            className="flex-1 bg-transparent border border-border/40 px-2 py-1.5 text-xs focus:outline-none focus:border-primary/40" />
          <button onClick={searchPlayer} className="text-xs uppercase border border-border/40 px-3 py-1.5 hover:border-primary/40 hover:text-primary">
            Chercher
          </button>
        </div>
        {foundProfile && (
          <div className="border border-border/30 px-3 py-2 mb-4 text-xs">
            <p className="mb-1">{foundProfile.username} — vu {foundProfile.last_seen_at ? new Date(foundProfile.last_seen_at).toLocaleString("fr-FR") : "jamais"}</p>
            <ScrollBox maxHeight="10rem">
              <ul className="space-y-1">
                {profileCharacters.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span className={c.is_alive ? "" : "line-through opacity-60"}>
                      {c.name} — niv. {c.level} · {c.guild_name ?? "sans guilde"} {c.is_bot ? "🤖 " : ""}{c.is_alive ? "" : "(mort)"}
                    </span>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button disabled={busy === c.id} onClick={() => renameCharacter(c.id, c.name)}
                        className="text-[10px] uppercase border border-border/40 text-muted-foreground px-1.5 py-0.5 hover:border-primary/40 hover:text-primary disabled:opacity-30">
                        {busy === c.id ? "…" : "Renommer"}
                      </button>
                      {!c.is_alive && (
                        <button disabled={busy === c.id}
                          onClick={() => runAction(c.id, () => supabase.rpc("admin_revive_character" as any, { p_character_id: c.id }).then((res) => { if (!res.error) void searchPlayer(); return res; }))}
                          className="text-[10px] uppercase border border-emerald-400/40 text-emerald-400 px-1.5 py-0.5 hover:bg-emerald-400/10 disabled:opacity-30">
                          {busy === c.id ? "…" : "Ressusciter"}
                        </button>
                      )}
                      {c.is_bot && (
                        <button disabled={busy === c.id}
                          onClick={() => { if (confirm(`Supprimer définitivement le bot "${c.name}" ?`)) void runAction(c.id, () => supabase.rpc("admin_delete_bot_character" as any, { p_character_id: c.id }).then((res) => { if (!res.error) void searchPlayer(); return res; })); }}
                          className="text-[10px] uppercase border border-red-400/40 text-red-400 px-1.5 py-0.5 hover:bg-red-400/10 disabled:opacity-30">
                          {busy === c.id ? "…" : "Supprimer"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollBox>
          </div>
        )}

        <TextLink onClick={() => navigate({ to: "/" })}>Retour</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}
