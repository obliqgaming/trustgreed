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
type EventTemplate = {
  id: string; event_type: string; risk_level: string;
  loot_base_min: number; loot_base_max: number; death_percentage: number; flavor_texts: string[];
};
type ProfileRow = { id: string; username: string; last_seen_at: string | null };

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

  // Recherche joueur
  const [playerSearch, setPlayerSearch] = useState("");
  const [foundProfile, setFoundProfile] = useState<ProfileRow | null>(null);
  const [profileCharacters, setProfileCharacters] = useState<CharacterRow[]>([]);

  // Maintenance
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");

  async function loadAll() {
    const { data: guildData } = await supabase.from("guilds").select("id, name, gold");
    const enrichedGuilds: GuildRow[] = [];
    for (const g of guildData ?? []) {
      const { count: memberCount } = await supabase.from("characters").select("id", { count: "exact", head: true }).eq("guild_id", g.id).eq("is_alive", true);
      const { count: historyCount } = await supabase.from("guild_history_events").select("id", { count: "exact", head: true }).eq("guild_id", g.id);
      enrichedGuilds.push({ id: g.id, name: g.name, gold: Math.round(g.gold), member_count: memberCount ?? 0, history_count: historyCount ?? 0 });
    }
    setGuilds(enrichedGuilds);

    const { data: expData } = await supabase
      .from("expeditions").select("id, status, guild_id, guild:guilds(name)").in("status", ["waiting", "active"]);
    const enrichedExp: ExpeditionRow[] = [];
    for (const e of (expData as any[]) ?? []) {
      const { count } = await supabase.from("expedition_participants").select("character_id", { count: "exact", head: true }).eq("expedition_id", e.id);
      enrichedExp.push({ id: e.id, status: e.status, guild_id: e.guild_id, guild_name: e.guild?.name ?? "?", participant_count: count ?? 0 });
    }
    setExpeditions(enrichedExp);

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: activeCount } = await supabase.from("profiles").select("id", { count: "exact", head: true }).gte("last_seen_at", dayAgo);
    setActivePlayers24h(activeCount ?? 0);

    const { data: feedData } = await supabase
      .from("guild_history_events").select("id, description, created_at, guild:guilds(name)")
      .order("created_at", { ascending: false }).limit(50);
    setFeed((feedData as any[] ?? []).map(e => ({ id: e.id, description: e.description, created_at: e.created_at, guild_name: e.guild?.name ?? "?" })));

    const { data: templateData } = await supabase.rpc("admin_list_event_templates" as any);
    setTemplates((templateData as any) ?? []);

    const { data: settingsData } = await supabase.from("app_settings" as any).select("value").eq("key", "maintenance").maybeSingle();
    const maint = (settingsData as any)?.value;
    setMaintenanceActive(!!maint?.active);
    setMaintenanceMessage(maint?.message ?? "");
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
            {templates.map((t) => (
              <li key={t.id} className="text-xs border border-border/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span>{t.event_type} — {t.risk_level} · {t.loot_base_min}-{t.loot_base_max} or · {Math.round(t.death_percentage * 100)}% mort</span>
                  <button onClick={() => setEditingTemplate(editingTemplate?.id === t.id ? null : { ...t })}
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
                      <p className="text-[10px] text-muted-foreground mb-1">Textes narratifs (un par ligne)</p>
                      <textarea value={editingTemplate.flavor_texts.join("\n")}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, flavor_texts: e.target.value.split("\n") })}
                        rows={4} className="w-full bg-transparent border border-border/40 px-2 py-1.5 text-xs" />
                    </div>
                    <button disabled={busy === `tpl-${t.id}`}
                      onClick={() => runAction(`tpl-${t.id}`, () => supabase.rpc("admin_update_event_template" as any, {
                        p_id: t.id, p_risk_level: editingTemplate.risk_level,
                        p_loot_base_min: editingTemplate.loot_base_min, p_loot_base_max: editingTemplate.loot_base_max,
                        p_death_percentage: editingTemplate.death_percentage,
                        p_flavor_texts: editingTemplate.flavor_texts.map(s => s.trim()).filter(Boolean),
                      }).then((res) => { if (!res.error) setEditingTemplate(null); return res; }))}
                      className="text-[10px] uppercase border border-primary/40 text-primary px-2 py-1 hover:bg-primary/10 disabled:opacity-30">
                      {busy === `tpl-${t.id}` ? "…" : "Enregistrer"}
                    </button>
                  </div>
                )}
              </li>
            ))}
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
