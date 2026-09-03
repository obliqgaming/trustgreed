import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Field, LedgerCard, LedgerError, LedgerPage, SealButton, TextLink } from "@/components/ledger";
import { OnlinePlayersPanel } from "@/components/onlinePlayers";
import { VocationPicker, VocationBadge, VOCATIONS, vocationLabel, type VocationId } from "@/components/vocations";
import { GuildBanner, BannerPicker } from "@/components/banners";
import { Frame, MemberFrame, DecorativeBorder } from "@/components/frame";
import { PortraitDisplay, PortraitPicker } from "@/components/portraits";
import { GuildChatBox } from "@/components/guildChat";
import { getTitleForLevel, getNextTitleThreshold } from "@/lib/titles";
import { isOnline, usePresenceHeartbeat } from "@/hooks/usePresence";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Index,
});

type Character = { id: string; name: string; level: number; xp: number; guild_id: string | null };
type Guild = { id: string; name: string; gold: number; founder_profile_id?: string; banner_symbol?: string | null; banner_color?: string | null; banner_bg?: string | null };
type Member = { id: string; name: string; level: number; portrait?: string | null; last_seen_at?: string | null; declared_vocation?: string | null };
type HistoryEvent = { id: string; event_type: string; description: string; created_at: string };
type ActiveExpedition = { id: string; status: string; participant_count: number } | null;

function Index() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"landing" | "signin" | "signup">("landing");
  const [profileMissing, setProfileMissing] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);
  const [guild, setGuild] = useState<Guild | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [myVocation, setMyVocation] = useState<VocationId | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [activeExpedition, setActiveExpedition] = useState<ActiveExpedition>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setCharacter(null); setProfileMissing(false); setGuild(null);
      setMembers([]); setHistory([]); setActiveExpedition(null);
      setReady(true);
      return;
    }

    const { data: profile } = await supabase.from("profiles").select("id").eq("id", session.user.id).maybeSingle();
    setProfileMissing(!profile);

    const { data: char } = await supabase.from("characters").select("id, name, level, xp, guild_id").eq("profile_id", session.user.id).eq("is_alive", true).eq("is_bot", false).maybeSingle();
    setCharacter(char ?? null);

    const { data: profileRow } = await supabase.from("profiles").select("is_admin").eq("id", session.user.id).maybeSingle();
    setIsAdmin(!!profileRow?.is_admin);

    if (char) {
      const { data: vocData } = await supabase.rpc("get_my_vocation", { p_character_id: char.id });
      setMyVocation((vocData as VocationId | null) ?? null);
    }

    if (char?.guild_id) {
      const { data: g } = await supabase.from("guilds").select("id, name, gold, founder_profile_id, banner_symbol, banner_color, banner_bg").eq("id", char.guild_id).maybeSingle();
      setGuild(g ?? null);

      const { data: m } = await supabase.from("characters").select("id, name, level, portrait, declared_vocation, profiles(last_seen_at)").eq("guild_id", char.guild_id).eq("is_alive", true).order("level", { ascending: false });
      setMembers((m ?? []).map((row: any) => ({ id: row.id, name: row.name, level: row.level, portrait: row.portrait, declared_vocation: row.declared_vocation, last_seen_at: row.profiles?.last_seen_at ?? null })));

      const { data: h } = await supabase.from("guild_history_events").select("id, event_type, description, created_at").eq("guild_id", char.guild_id).order("created_at", { ascending: false }).limit(10);
      setHistory(h ?? []);

      const { data: exp } = await supabase.from("expeditions").select("id, status").eq("guild_id", char.guild_id).in("status", ["waiting", "active"]).maybeSingle();
      if (exp) {
        const { count } = await supabase.from("expedition_participants").select("character_id", { count: "exact", head: true }).eq("expedition_id", exp.id);
        setActiveExpedition({ id: exp.id, status: exp.status, participant_count: count ?? 0 });

        // Si participant à une expédition active, rediriger directement
        if (exp.status === "active") {
          const isParticipant = await supabase
            .from("expedition_participants")
            .select("character_id")
            .eq("expedition_id", exp.id)
            .eq("character_id", char.id)
            .maybeSingle();
          if (isParticipant.data) {
            // Laisser le composant se monter avant de rediriger
            setTimeout(() => navigate({ to: "/vote", search: { expedition: exp.id } }), 500);
          }
        }
      } else {
        setActiveExpedition(null);
      }
    } else {
      setGuild(null); setMembers([]); setHistory([]); setActiveExpedition(null);
    }
    setReady(true);
  }, [session]);

  // Realtime : mise à jour auto si une expédition démarre ou si l'or change
  useEffect(() => {
    if (!guild?.id) return;
    const channel = supabase.channel(`guild_${guild.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "expeditions", filter: `guild_id=eq.${guild.id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "guild_history_events", filter: `guild_id=eq.${guild.id}` }, () => void refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "guilds", filter: `id=eq.${guild.id}` }, () => void refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [guild?.id, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll léger : garde le statut en ligne des membres à jour sans re-fetcher toute la page
  useEffect(() => {
    if (!character?.guild_id) return;
    const t = setInterval(async () => {
      const { data: m } = await supabase.from("characters").select("id, name, level, portrait, declared_vocation, profiles(last_seen_at)").eq("guild_id", character.guild_id).eq("is_alive", true).order("level", { ascending: false });
      setMembers((m ?? []).map((row: any) => ({ id: row.id, name: row.name, level: row.level, portrait: row.portrait, declared_vocation: row.declared_vocation, last_seen_at: row.profiles?.last_seen_at ?? null })));
    }, 20000);
    return () => clearInterval(t);
  }, [character?.guild_id]);

  usePresenceHeartbeat(!!session);

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Ouverture du registre…</p></LedgerPage>;
  if (!session) return (
    <LedgerPage wide={mode === "landing"}>
      {mode === "landing" ? (
        <div className="fixed inset-0 z-0 flex items-end justify-center pb-16" style={{
          backgroundImage: "url(/landing_hero.webp)", backgroundSize: "cover", backgroundPosition: "center",
        }}>
          <div className="max-w-sm w-full mx-4 space-y-2 bg-background/40 backdrop-blur-sm p-4 rounded-sm">
            <button onClick={() => setMode("signup")}
              className="w-full rounded-sm border px-4 py-3 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10">
              Créer un compte
            </button>
            <button onClick={() => setMode("signin")}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.14em] uppercase border-border/40 text-muted-foreground hover:bg-border/10">
              J'ai déjà un compte
            </button>
          </div>
        </div>
      ) : mode === "signup" ? (
        <SignUpScreen onSwitch={() => setMode("signin")} onNotice={setNotice} notice={notice} />
      ) : (
        <SignInScreen onSwitch={() => setMode("signup")} />
      )}
    </LedgerPage>
  );
  if (profileMissing) return <LedgerPage bg="/register_book.png"><CreateProfileScreen onDone={refresh} /></LedgerPage>;
  if (!character) return <LedgerPage bg="/register_book.png"><CreateOrReviveScreen onDone={refresh} /></LedgerPage>;
  if (!character.guild_id) return <LedgerPage bg="/guild_hall_bg.webp"><GuildScreen character={character} onDone={refresh} /></LedgerPage>;

  const isInExpedition = activeExpedition && members.some(m => m.id === character.id);

  return (
    <LedgerPage bg="/guild_hall_bg.webp" wide>
      <LedgerCard>

        {/* En-tête : bannière inline + nom + sous-titre + accès carte (mis en avant) */}
        <div className="flex items-start gap-3 mb-4">
          <GuildBanner symbol={guild?.banner_symbol} color={guild?.banner_color} size={40} />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl tracking-[0.12em] text-primary uppercase truncate">{guild?.name ?? "Guilde"}</h1>
            <p className="text-sm text-muted-foreground">
              Trésor : {Math.round(guild?.gold ?? 0)} or · {members.length} membre{members.length > 1 ? "s" : ""} · il faut 3 membres pour partir en expédition
            </p>
            {guild && session?.user?.id === guild.founder_profile_id && (
              <GuildBannerEditor guildId={guild.id} characterId={character.id} currentSymbol={guild.banner_symbol ?? null} currentColor={guild.banner_color ?? null} onDone={refresh} />
            )}
          </div>
          <button onClick={() => navigate({ to: "/carte" })}
            className="flex-shrink-0 font-serif tracking-[0.12em] uppercase border-2 border-primary/60 text-primary px-4 py-2.5 hover:bg-primary/10 hover:border-primary transition-colors rounded-sm text-sm shadow-[0_0_12px_rgba(201,162,75,0.15)]">
            Carte des guildes →
          </button>
        </div>

        {/* Vocation à choisir en priorité (surtout pour les persos créés avant ce système) */}
        {myVocation === null && (
          <RetroVocationPicker characterId={character.id} onDone={refresh} />
        )}

        {/* Barre d'actions : remontée, visible, pas enterrée sous le chat */}
        <div className="flex flex-wrap gap-2 mb-5 pb-4 border-b border-border/20">
          <button onClick={() => navigate({ to: "/profil" })}
            className="text-xs tracking-[0.1em] uppercase border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors px-3 py-1.5">
            Mon profil
          </button>
          <button onClick={() => navigate({ to: "/inviter" })}
            className="text-xs tracking-[0.1em] uppercase border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors px-3 py-1.5">
            Inviter quelqu'un
          </button>
          <LeaveGuildButton character={character} onDone={refresh} />
          <button onClick={() => supabase.auth.signOut()}
            className="text-xs tracking-[0.1em] uppercase border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors px-3 py-1.5 ml-auto">
            Se déconnecter
          </button>
        </div>

        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6 lg:items-start">
          {/* Colonne principale */}
          <div className="min-w-0">
            {/* Bandeau expédition en cours */}
            {activeExpedition && (
              <div className="mb-4 border border-primary/40 bg-primary/5 px-3 py-3">
                <p className="text-xs tracking-[0.14em] uppercase text-primary mb-1">
                  {activeExpedition.status === "waiting" ? "Salle d'attente ouverte" : "Expédition en cours"}
                </p>
                <p className="text-sm text-muted-foreground mb-2">
                  {activeExpedition.participant_count} participant{activeExpedition.participant_count > 1 ? "s" : ""}
                  {activeExpedition.status === "waiting" ? " — en attente du lancement" : " — en route"}
                </p>
                <button
                  onClick={() => {
                    if (activeExpedition.status === "active") {
                      navigate({ to: "/vote", search: { expedition: activeExpedition.id } });
                    } else {
                      navigate({ to: "/expedition" });
                    }
                  }}
                  className="w-full text-xs tracking-[0.12em] uppercase border border-primary/40 text-primary py-1.5 hover:bg-primary/10"
                >
                  {activeExpedition.status === "active" ? "Rejoindre l'expédition →" : "Voir la salle d'attente →"}
                </button>
              </div>
            )}

            {/* Stats perso */}
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div className="border border-border/60 p-3">
                <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">Niveau</dt>
                <dd className="mt-1 font-mono text-xl text-primary">{character.level}</dd>
              </div>
              <div className="border border-border/60 p-3">
                <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">XP</dt>
                <dd className="mt-1 font-mono text-xl text-primary">{character.xp}</dd>
              </div>
            </div>
            <div className="mb-4 text-xs text-muted-foreground">
              Titre : <span className="text-primary uppercase tracking-[0.06em]">{getTitleForLevel(character.level)}</span>
              {getNextTitleThreshold(character.level) !== null && (
                <span> · prochain palier au niveau {getNextTitleThreshold(character.level)}</span>
              )}
            </div>

            {/* Vocation (petite carte compacte) */}
            {myVocation && (
              <VocationPanel vocationId={myVocation} characterId={character.id} />
            )}

            {/* Panneau admin : compagnons de test */}
            {isAdmin && guild && (
              <AdminTestPanel guildId={guild.id} characterId={character.id} memberCount={members.length} history={history} onDone={refresh} />
            )}

            {/* Bouton expédition */}
            {!activeExpedition && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground text-center mb-1.5">
                  {members.length} membre{members.length > 1 ? "s" : ""} vivant{members.length > 1 ? "s" : ""} dans la guilde
                </p>
                <button onClick={() => navigate({ to: "/expedition" })}
                  className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10">
                  Partir en expédition
                </button>
              </div>
            )}

            {/* Historique — dans le grand cadre, c'est ce qui grandit le plus */}
            <Frame variant="journal" contentClassName="!flex-col !items-stretch !justify-start text-left !inset-[14%_16%_15%_18%]">
              <p className="text-xs tracking-[0.14em] uppercase opacity-90 mb-3">Historique</p>
              {history.length === 0 ? (
                <p className="text-xs opacity-50 italic">Rien à raconter pour l'instant.</p>
              ) : (
                <ul className="space-y-2.5">
                  {history.map((e) => {
                    const isWipe = e.event_type === "expedition_completed" && e.description.includes("anéantie");
                    return (
                      <li key={e.id} className="text-xs">
                        <span className={`inline-block mr-2 ${isWipe ? "text-red-500 font-bold" : e.event_type === "member_died" ? "text-red-700" : e.event_type === "expedition_completed" ? "text-primary" : "opacity-60"}`}>
                          {isWipe ? "☠" : e.event_type === "member_died" ? "✝" : e.event_type === "expedition_completed" ? "⚔" : "·"}
                        </span>
                        <span className={isWipe ? "text-red-400" : ""}>{e.description}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Frame>
          </div>

          {/* Colonne latérale : membres (repliable), demandes, chat, joueurs en ligne */}
          <div className="min-w-0 mt-6 lg:mt-0">
            {/* Membres — accordéon replié par défaut pour gagner de la place */}
            <div className="mb-5">
              <button onClick={() => setMembersOpen(o => !o)} className="w-full">
                <Frame variant="bar" className="mb-3 max-w-xs mx-auto lg:mx-0 lg:max-w-none">
                  <span className="text-lg tracking-[0.16em] uppercase font-serif font-semibold">
                    Membres ({members.length}) {membersOpen ? "▾" : "▸"}
                  </span>
                </Frame>
              </button>
              {membersOpen && (
                <div className="space-y-2">
                  {members.map((m) => (
                    <MemberFrame
                      key={m.id}
                      portrait={<PortraitDisplay portraitId={m.portrait ?? "ombre"} size={64} />}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${isOnline(m.last_seen_at) ? "bg-green-600" : "bg-black/20"}`} aria-hidden />
                        <span className={`text-sm font-serif truncate ${m.id === character.id ? "text-primary font-semibold" : ""}`}>
                          {m.name}{m.id === character.id ? " (toi)" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] font-mono opacity-90">niv. {m.level}</span>
                        <span className="text-[11px] uppercase tracking-[0.06em] text-primary/70">{getTitleForLevel(m.level)}</span>
                        <VocationBadge vocationId={m.declared_vocation} className="!border-[#f2e4c8]/40 !text-[#f2e4c8]" />
                      </div>
                    </MemberFrame>
                  ))}
                </div>
              )}
            </div>

            {guild && (
              <>
                <JoinRequestsPanel guildId={guild.id} character={character} onResolved={refresh} />
                <GuildChatBox guildId={guild.id} characterId={character.id} />
              </>
            )}

            <OnlinePlayersPanel guildName={guild?.name} guildId={guild?.id} />

            {guild && <GuildMemorial guildId={guild.id} />}
          </div>
        </div>
      </LedgerCard>
    </LedgerPage>
  );
}

function GuildMemorial({ guildId }: { guildId: string }) {
  const [dead, setDead] = useState<{ id: string; name: string; died_at: string | null; level: number }[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("characters")
        .select("id, name, died_at, level")
        .eq("guild_id", guildId)
        .eq("is_alive", false)
        .order("died_at", { ascending: false })
        .limit(10);
      setDead(data ?? []);
    })();
  }, [guildId]);

  if (dead.length === 0) return null;

  return (
    <div className="mt-5">
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">
        Mémorial de la guilde — {dead.length} mort{dead.length > 1 ? "s" : ""}
      </p>
      <ul className="space-y-1">
        {dead.map((c) => (
          <li key={c.id} className="text-xs text-muted-foreground/70 border border-border/20 px-3 py-1.5 flex justify-between">
            <span className="line-through">{c.name} <span className="opacity-60">— {getTitleForLevel(c.level)} (niv. {c.level})</span></span>
            {c.died_at && (
              <span>{new Date(c.died_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LeaveGuildButton({ character, onDone }: { character: Character; onDone: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc("leave_guild", { p_character_id: character.id });
    if (rpcError) { setError(rpcError.message); setBusy(false); setConfirm(false); return; }
    await onDone();
    setBusy(false);
  }

  if (!confirm) return (
    <button onClick={() => setConfirm(true)}
      className="text-xs tracking-[0.1em] uppercase border border-red-400/30 text-red-400/70 hover:text-red-400 hover:border-red-400/50 transition-colors px-3 py-1.5">
      Quitter la guilde
    </button>
  );

  return (
    <div className="border border-red-400/30 px-3 py-2 mt-1">
      <p className="text-xs text-red-400/70 mb-2">
        Tu partiras avec ta part de l'or. Cette action est irréversible.
      </p>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={leave} disabled={busy}
          className="flex-1 text-xs uppercase tracking-[0.1em] border border-red-400/40 text-red-400 py-1.5 hover:bg-red-400/10 disabled:opacity-30">
          {busy ? "Départ…" : "Confirmer"}
        </button>
        <button onClick={() => setConfirm(false)}
          className="flex-1 text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground py-1.5 hover:bg-border/10">
          Annuler
        </button>
      </div>
    </div>
  );
}

function GuildScreen({ character, onDone }: { character: Character; onDone: () => Promise<void> }) {
  const navigate = useNavigate();
  const [guilds, setGuilds] = useState<(Guild & { member_count: number })[]>([]);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [guildName, setGuildName] = useState("");
  const [buildingStyle, setBuildingStyle] = useState<"chaos" | "arcane" | "noble" | "sylvan">("chaos");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingGuildId, setPendingGuildId] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("guilds").select("id, name, gold, banner_symbol, banner_color").order("gold", { ascending: false }).limit(10);
      if (data) {
        const withCounts = await Promise.all(data.map(async (g) => {
          const { count } = await supabase.from("characters").select("id", { count: "exact", head: true }).eq("guild_id", g.id).eq("is_alive", true);
          return { ...g, member_count: count ?? 0 };
        }));
        setGuilds(withCounts.filter((g) => g.member_count > 0));
      }
    })();

    void (async () => {
      const { data } = await supabase.from("guild_join_requests").select("id, guild_id").eq("character_id", character.id).eq("status", "pending").order("created_at", { ascending: true }).limit(1);
      const pending = data?.[0];
      setPendingGuildId(pending?.guild_id ?? null);
      setPendingRequestId(pending?.id ?? null);
    })();
  }, [character.id]);

  // Poll léger : si une demande est acceptée ailleurs, on quitte cet écran automatiquement.
  useEffect(() => {
    const t = setInterval(() => void onDone(), 5000);
    return () => clearInterval(t);
  }, [onDone]);

  async function requestToJoin(guildId: string) {
    if (pendingGuildId) return;
    setError(null); setRequestBusy(guildId);
    const { data, error: rpcError } = await supabase.rpc("create_join_request", { p_guild_id: guildId, p_character_id: character.id });
    if (rpcError) setError(rpcError.message);
    else { setPendingGuildId(guildId); setPendingRequestId((data as { id: string } | null)?.id ?? null); }
    setRequestBusy(null);
  }

  async function cancelRequest() {
    if (!pendingRequestId) return;
    setError(null); setCancelBusy(true);
    const { error: rpcError } = await supabase.rpc("cancel_join_request", { p_request_id: pendingRequestId, p_character_id: character.id });
    if (rpcError) setError(rpcError.message);
    else { setPendingGuildId(null); setPendingRequestId(null); }
    setCancelBusy(false);
  }

  async function createGuild(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const { data: newGuild, error: rpcError } = await supabase.rpc("create_guild", { p_guild_name: guildName, p_character_id: character.id });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    const guildId = (newGuild as any)?.id;
    if (guildId) {
      await supabase.rpc("set_guild_building_style", { p_guild_id: guildId, p_character_id: character.id, p_style: buildingStyle });
    }
    await onDone();
    setBusy(false);
  }

  async function joinGuild(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("join_guild_with_code", { p_code: inviteCode, p_character_id: character.id });
    if (rpcError) setError(rpcError.message); else await onDone();
    setBusy(false);
  }

  return (
    <LedgerCard title={character.name} subtitle="Pour rejoindre une guilde, tu as besoin d'un code d'invitation donné par un membre existant.">
      <InvitationInbox onUseCode={setInviteCode} onGoJoinTab={() => setTab("join")} />
      <OnlinePlayersPanel />
      <div className="flex gap-2 mb-6">
        {(["create", "join"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs tracking-[0.14em] uppercase border rounded-sm ${tab === t ? "border-primary text-primary" : "border-border/40 text-muted-foreground"}`}>
            {t === "create" ? "Fonder" : "Rejoindre"}
          </button>
        ))}
      </div>
      {tab === "create" ? (
        <form onSubmit={createGuild} noValidate>
          <div className="mb-3 border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200/90">
            ⚠ Une expédition demande au moins 3 membres. En fondant seul, il te faudra convaincre 2 autres aventuriers de te rejoindre avant de pouvoir partir. Si une guilde existe déjà (voir "Guildes actives" plus bas), envisage plutôt de la rejoindre.
          </div>
          <Field label="Nom de la guilde" required value={guildName} onChange={(e) => setGuildName(e.target.value)} />

          <div className="mb-4">
            <p className="text-xs tracking-[0.12em] uppercase text-muted-foreground mb-2">Style de bâtiment de guilde</p>
            <div className="grid grid-cols-4 gap-2">
              {(["chaos", "arcane", "noble", "sylvan"] as const).map((style) => (
                <button key={style} type="button" onClick={() => setBuildingStyle(style)}
                  className={`border p-1.5 transition-colors ${buildingStyle === style ? "border-primary bg-primary/10" : "border-border/40 hover:border-border"}`}>
                  <img src={`/guildbuildings/${style}_tier1.webp`} alt={style} className="w-full h-auto" />
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Ton bâtiment grandira avec la richesse et le classement de ta guilde sur la carte du monde.
            </p>
          </div>

          <LedgerError message={error} />
          <SealButton type="submit" disabled={busy}>{busy ? "Fondation…" : "Fonder la guilde"}</SealButton>
        </form>
      ) : (
        <form onSubmit={joinGuild} noValidate>
          <Field label="Code d'invitation" required value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          <LedgerError message={error} />
          <SealButton type="submit" disabled={busy}>{busy ? "Entrée…" : "Rejoindre"}</SealButton>
          {guilds.length > 0 && (
            <div className="mt-6">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-3">Guildes actives</p>
              {pendingGuildId && (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground/70 italic">Demande en attente — un seul dossier à la fois.</p>
                  <button
                    type="button"
                    onClick={cancelRequest}
                    disabled={cancelBusy}
                    className="shrink-0 text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-2.5 py-1 hover:bg-border/10 disabled:opacity-40"
                  >
                    {cancelBusy ? "…" : "Annuler"}
                  </button>
                </div>
              )}
              <ul className="space-y-2">
                {guilds.map((g) => (
                  <li key={g.id} className="border border-border/40 px-3 py-2 text-sm">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-2">
                        <GuildBanner symbol={g.banner_symbol} color={g.banner_color} size={20} />
                        {g.name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{g.member_count} membre{g.member_count > 1 ? "s" : ""} · {Math.round(g.gold)} or</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => requestToJoin(g.id)}
                      disabled={!!pendingGuildId || requestBusy === g.id}
                      className="mt-2 text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary px-2.5 py-1 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {pendingGuildId === g.id ? "Demande envoyée ✓" : requestBusy === g.id ? "…" : "Demander à rejoindre"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      )}
      <TextLink onClick={() => navigate({ to: "/joueurs" })}>Voir tous les joueurs →</TextLink>
      <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
    </LedgerCard>
  );
}

function SignUpScreen({ onSwitch, onNotice, notice }: { onSwitch: () => void; onNotice: (v: string | null) => void; notice: string | null }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); onNotice(null); setBusy(true);
    const { error: signUpError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (signUpError) { setError(signUpError.message); setBusy(false); return; }
    onNotice("Compte créé. Connecte-toi pour continuer.");
    setBusy(false);
  }
  return (
    <LedgerCard title="Inscription" subtitle="Gratuit. Ton compte est actif immédiatement.">
      <form onSubmit={submit} noValidate>
        <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Mot de passe" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        <LedgerError message={error} />
        {notice ? <p className="mt-4 text-sm text-muted-foreground">{notice}</p> : null}
        <SealButton type="submit" disabled={busy}>{busy ? "Scellement…" : "Sceller l'inscription"}</SealButton>
      </form>
      <TextLink onClick={onSwitch}>J'ai déjà un compte</TextLink>
    </LedgerCard>
  );
}

function SignInScreen({ onSwitch }: { onSwitch: () => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    setBusy(false);
  }
  return (
    <LedgerCard title="Connexion">
      <form onSubmit={submit} noValidate>
        <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Mot de passe" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <LedgerError message={error} />
        <SealButton type="submit" disabled={busy}>{busy ? "Vérification…" : "Entrer"}</SealButton>
      </form>
      <TextLink onClick={onSwitch}>Créer un compte</TextLink>
    </LedgerCard>
  );
}

function CreateProfileScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("create_profile", { p_username: username });
    if (rpcError) {
      if (rpcError.message.includes("déjà existant") || rpcError.message.includes("already exists")) {
        await onDone(); // profil déjà là, on avance
      } else {
        setError(rpcError.message);
      }
    } else {
      await onDone();
    }
    setBusy(false);
  }
  return (
    <LedgerCard title="Choisis ton pseudo" subtitle="Ton compte n'est pas encore inscrit au registre.">
      <form onSubmit={submit} noValidate>
        <Field label="Pseudo" required value={username} onChange={(e) => setUsername(e.target.value)} />
        <LedgerError message={error} />
        <SealButton type="submit" disabled={busy}>{busy ? "Scellement…" : "Rejoindre le registre"}</SealButton>
      </form>
      <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
    </LedgerCard>
  );
}

function CreateOrReviveScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [hasDied, setHasDied] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [portrait, setPortrait] = useState("ombre");
  const [vocation, setVocation] = useState<VocationId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPortraitPicker, setShowPortraitPicker] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from("characters")
        .select("id")
        .eq("profile_id", session.user.id)
        .eq("is_alive", false)
        .eq("is_bot", false)
        .limit(1)
        .maybeSingle();
      setHasDied(!!data);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vocation) { setError("Choisis une vocation."); return; }
    setError(null); setBusy(true);
    const { data: char, error: rpcError } = await supabase.rpc("create_character", { p_name: name });
    if (rpcError) { setError(rpcError.message); setBusy(false); return; }
    if (char) {
      await supabase.from("characters").update({ portrait }).eq("id", (char as any).id);
      const { error: vocError } = await supabase.rpc("choose_vocation", { p_character_id: (char as any).id, p_vocation: vocation });
      if (vocError) { setError(vocError.message); setBusy(false); return; }
    }
    await onDone();
    setBusy(false);
  }

  if (hasDied === null) return null;

  return (
    <LedgerCard
      title={hasDied ? "Ton personnage est mort" : "Créer un personnage"}
      subtitle={hasDied ? "La mort est définitive. Une nouvelle histoire peut commencer." : "Ce nom sera visible de toute la guilde. Choisis bien."}
    >
      {hasDied && (
        <div className="mb-4 px-3 py-3 border border-red-400/30 text-xs text-red-400/70">
          Ton personnage ne reviendra pas. Tu peux en créer un nouveau et rejoindre ou fonder une nouvelle guilde.
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <Field label="Nom du personnage" required value={name} onChange={(e) => setName(e.target.value)} />

        {/* Aperçu portrait + bouton sélection */}
        <div className="mt-4">
          <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Portrait</p>
          <div className="flex items-center gap-3">
            <PortraitDisplay portraitId={portrait} size={56} />
            <button type="button" onClick={() => setShowPortraitPicker(!showPortraitPicker)}
              className="text-xs tracking-[0.12em] uppercase border border-border/40 text-muted-foreground px-3 py-1.5 hover:border-primary/40 hover:text-primary transition-colors">
              {showPortraitPicker ? "Fermer" : "Choisir"}
            </button>
          </div>
          {showPortraitPicker && (
            <div className="mt-3">
              <PortraitPicker value={portrait} onChange={(id) => { setPortrait(id); setShowPortraitPicker(false); }} />
            </div>
          )}
        </div>

        <div className="mt-4">
          <VocationPicker value={vocation} onChange={setVocation} />
        </div>

        <LedgerError message={error} />
        <SealButton type="submit" disabled={busy}>{busy ? "Inscription…" : "Inscrire au registre"}</SealButton>
      </form>
      <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
    </LedgerCard>
  );
}


type InboxMessage = { id: string; body: string; invitation_code: string | null; created_at: string; sender: { username: string } };

function InvitationInbox({ onUseCode, onGoJoinTab }: { onUseCode: (code: string) => void; onGoJoinTab: () => void }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);

  const fetchInbox = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("direct_messages")
      .select("id, body, invitation_code, created_at, sender:profiles!direct_messages_sender_profile_id_fkey(username)")
      .eq("recipient_profile_id", session.user.id)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    setMessages((data as any) ?? []);
  }, []);

  useEffect(() => { void fetchInbox(); const t = setInterval(() => void fetchInbox(), 15000); return () => clearInterval(t); }, [fetchInbox]);

  async function dismiss(id: string) {
    await supabase.from("direct_messages").update({ read_at: new Date().toISOString() }).eq("id", id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  if (messages.length === 0) return null;

  return (
    <div className="mb-6 space-y-2">
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground">Messages reçus</p>
      {messages.map((m) => (
        <div key={m.id} className="border border-primary/40 bg-primary/5 px-3 py-2.5 text-sm">
          <p className="text-xs text-muted-foreground mb-1">
            <span className="font-semibold text-foreground">{m.sender?.username ?? "?"}</span> · {m.body}
          </p>
          {m.invitation_code && (
            <p className="font-mono text-primary tracking-[0.15em] mb-2">{m.invitation_code}</p>
          )}
          <div className="flex gap-2">
            {m.invitation_code && (
              <button
                onClick={() => { onUseCode(m.invitation_code!); onGoJoinTab(); void dismiss(m.id); }}
                className="text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary px-2.5 py-1 hover:bg-primary/10"
              >
                Utiliser ce code
              </button>
            )}
            <button
              onClick={() => dismiss(m.id)}
              className="text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-2.5 py-1 hover:bg-border/10"
            >
              Ignorer
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
type JoinRequest = { id: string; character_id: string; created_at: string; character: { name: string; level: number } };

function JoinRequestsPanel({ guildId, character, onResolved }: { guildId: string; character: Character; onResolved: () => Promise<void> }) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("guild_join_requests")
      .select("id, character_id, created_at, character:characters!guild_join_requests_character_id_fkey(name, level)")
      .eq("guild_id", guildId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (fetchError) { setError(fetchError.message); return; }
    setError(null);
    setRequests((data as any) ?? []);
  }, [guildId]);

  useEffect(() => {
    void fetchRequests();
    const t = setInterval(fetchRequests, 8000);
    return () => clearInterval(t);
  }, [fetchRequests]);

  async function respond(requestId: string, accept: boolean) {
    setError(null); setBusyId(requestId);
    const { error: rpcError } = await supabase.rpc("respond_to_join_request", {
      p_request_id: requestId, p_accept: accept, p_responder_character_id: character.id,
    });
    if (rpcError) setError(rpcError.message);
    else { await fetchRequests(); await onResolved(); }
    setBusyId(null);
  }

  if (requests.length === 0) return null;

  return (
    <div className="relative mb-4 bg-primary/5 px-8 pt-10 pb-8">
      <DecorativeBorder variant="wide" />
      <p className="text-sm tracking-[0.14em] uppercase text-primary mb-3">Demandes pour rejoindre la guilde</p>
      <LedgerError message={error} />
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center justify-between text-sm border border-border/30 px-3 py-2">
            <span>{r.character?.name ?? "?"} <span className="text-xs text-muted-foreground font-mono">niv. {r.character?.level ?? "?"}</span></span>
            <div className="flex gap-2">
              <button onClick={() => respond(r.id, true)} disabled={busyId === r.id}
                className="text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary px-2.5 py-1 hover:bg-primary/10 disabled:opacity-30">
                Accepter
              </button>
              <button onClick={() => respond(r.id, false)} disabled={busyId === r.id}
                className="text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-2.5 py-1 hover:bg-border/10 disabled:opacity-30">
                Refuser
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
function RetroVocationPicker({ characterId, onDone }: { characterId: string; onDone: () => Promise<void> }) {
  const [vocation, setVocation] = useState<VocationId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function confirm() {
    if (!vocation) return;
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("choose_vocation", { p_character_id: characterId, p_vocation: vocation });
    if (rpcError) setError(rpcError.message); else await onDone();
    setBusy(false);
  }

  return (
    <div className="mb-4 border border-primary/40 bg-primary/5 px-3 py-3">
      <p className="text-xs tracking-[0.14em] uppercase text-primary mb-2">⚔ Nouveau : les vocations sont arrivées</p>
      <p className="text-xs text-muted-foreground mb-3">Chaque personnage a désormais un vrai rôle en expédition — pas juste un titre. Choix définitif, à faire une seule fois dans sa vie.</p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary px-3 py-1.5 hover:bg-primary/10">
          Choisir maintenant
        </button>
      ) : (
        <>
          <VocationPicker value={vocation} onChange={setVocation} />
          <LedgerError message={error} />
          <button onClick={confirm} disabled={!vocation || busy}
            className="mt-3 w-full text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary px-3 py-1.5 hover:bg-primary/10 disabled:opacity-30">
            {busy ? "…" : "Confirmer (définitif)"}
          </button>
        </>
      )}
    </div>
  );
}

function VocationPanel({ vocationId, characterId }: { vocationId: VocationId; characterId: string }) {
  const [declaring, setDeclaring] = useState(false);
  const [lie, setLie] = useState<VocationId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submitLie() {
    if (!lie) return;
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("declare_vocation", { p_character_id: characterId, p_declared_vocation: lie });
    if (rpcError) setError(rpcError.message); else { setNotice("Vocation déclarée mise à jour."); setDeclaring(false); }
    setBusy(false);
  }

  return (
    <div className="mb-4 border border-border/40 bg-card/40 px-4 py-3">
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-1">Ta vocation</p>
      <p className="text-sm font-serif text-primary">{vocationLabel(vocationId)}</p>
      <p className="text-xs text-muted-foreground mt-1">{VOCATIONS.find(v => v.id === vocationId)?.description}</p>

      {vocationId === "Traitre" && (
        <div className="mt-3 pt-3 border-t border-border/20">
          {!declaring ? (
            <button onClick={() => setDeclaring(true)} className="text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-2.5 py-1 hover:bg-white/5">
              Mentir sur ma vocation déclarée
            </button>
          ) : (
            <>
              <VocationPicker value={lie} onChange={setLie} title="Vocation à déclarer publiquement (modifiable à volonté)" />
              <LedgerError message={error} />
              {notice && <p className="text-xs text-emerald-400 mt-2">{notice}</p>}
              <button onClick={submitLie} disabled={!lie || busy}
                className="mt-3 w-full text-xs uppercase tracking-[0.1em] border border-primary/50 text-primary px-3 py-1.5 hover:bg-primary/10 disabled:opacity-30">
                {busy ? "…" : "Valider ce mensonge"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function GuildBannerEditor({ guildId, characterId, currentSymbol, currentColor, onDone }: {
  guildId: string; characterId: string; currentSymbol: string | null; currentColor: string | null; onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState<string | null>(currentSymbol);
  const [color, setColor] = useState<string | null>(currentColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("set_guild_banner", {
      p_guild_id: guildId, p_character_id: characterId, p_symbol: symbol, p_color: color,
    });
    if (rpcError) setError(rpcError.message); else { await onDone(); setOpen(false); }
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs uppercase tracking-[0.1em] text-muted-foreground hover:text-primary underline underline-offset-4">
        {currentSymbol ? "Modifier la bannière" : "Choisir une bannière"}
      </button>
    );
  }

  return (
    <div className="border border-border/30 px-3 py-3 flex-1">
      <BannerPicker symbol={symbol} color={color} onChangeSymbol={setSymbol} onChangeColor={setColor} />
      <LedgerError message={error} />
      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={busy || !symbol || !color}
          className="text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary px-3 py-1.5 hover:bg-primary/10 disabled:opacity-30">
          {busy ? "…" : "Enregistrer"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-3 py-1.5 hover:bg-border/10">
          Annuler
        </button>
      </div>
    </div>
  );
}

function AdminTestPanel({ guildId, characterId, memberCount, history, onDone }: {
  guildId: string; characterId: string; memberCount: number; history: HistoryEvent[]; onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function spawnBots() {
    setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("admin_spawn_bots", { p_guild_id: guildId });
    if (rpcError) setError(rpcError.message); else await onDone();
    setBusy(false);
  }

  function copyLogs() {
    const text = history.map(e => `[${e.created_at}] ${e.event_type} — ${e.description}`).join("\n");
    void navigator.clipboard.writeText(text || "(historique vide)");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-4 border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-3">
      <p className="text-xs tracking-[0.14em] uppercase text-amber-300 mb-2">Mode admin — compagnons de test</p>
      <LedgerError message={error} />
      <div className="flex flex-wrap gap-2">
        <button onClick={spawnBots} disabled={busy}
          className="text-xs uppercase tracking-[0.1em] border border-amber-500/50 text-amber-300 px-3 py-1.5 hover:bg-amber-500/10 disabled:opacity-30">
          {busy ? "…" : "Ajouter 2 compagnons de test"}
        </button>
        <button onClick={copyLogs}
          className="text-xs uppercase tracking-[0.1em] border border-border/40 text-muted-foreground px-3 py-1.5 hover:border-amber-500/40 hover:text-amber-300">
          {copied ? "Copié ✓" : "Copier l'historique de guilde"}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground/60 mt-2">
        Une fois créés, ajoute-les à ta prochaine expédition depuis la salle d'attente ("Compagnons de test disponibles"). Pour un rapport de bug complet (étapes, votes, morts), utilise "Copier le rapport de debug" sur la page d'expédition ou de vote. Utilise une guilde de test dédiée, pas ta guilde principale.
      </p>
    </div>
  );
}
