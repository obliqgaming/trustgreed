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

    const { data: char } = await supabase.from("characters").select("id, name, level, xp, guild_id").eq("profile_id", session.user.id).eq("is_alive", true).maybeSingle();
    setCharacter(char ?? null);

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
    <LedgerPage>
      {mode === "landing" ? (
        <>
          <div className="flex justify-center mb-4">
            <img src="/logo_web.webp" alt="Trust & Greed" className="w-28 h-28 rounded-full border border-border/40" />
          </div>
          <LedgerCard subtitle="Une règle : un seul vote CONTINUER suffit à entraîner tout le groupe.">
          <div className="mb-6 space-y-1.5 border border-border/20 px-3 py-3 text-xs text-muted-foreground/70">
            <p>① Crée un compte et choisis un personnage</p>
            <p>② Fonde ou rejoins une guilde (via code d'invitation)</p>
            <p>③ Lance une expédition avec au moins 3 membres</p>
            <p>④ Vote à chaque étape — personne ne sait ce que les autres ont voté</p>
            <p>La mort est définitive.</p>
          </div>
          <div className="space-y-2">
            <button onClick={() => setMode("signup")}
              className="w-full rounded-sm border px-4 py-3 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10">
              Rejoindre le registre
            </button>
            <button onClick={() => setMode("signin")}
              className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.14em] uppercase border-border/40 text-muted-foreground hover:bg-border/10">
              J'ai déjà un compte
            </button>
            <div className="flex gap-2 pt-1">
              <button onClick={() => navigate({ to: "/carte" })}
                className="flex-1 text-xs tracking-[0.12em] uppercase text-muted-foreground/60 hover:text-primary transition-colors py-1">
                Carte des guildes
              </button>
              <button onClick={() => navigate({ to: "/monde" })}
                className="flex-1 text-xs tracking-[0.12em] uppercase text-muted-foreground/60 hover:text-primary transition-colors py-1">
                Le monde
              </button>
            </div>
          </div>
        </LedgerCard>
        </>
      ) : mode === "signup" ? (
        <SignUpScreen onSwitch={() => setMode("signin")} onNotice={setNotice} notice={notice} />
      ) : (
        <SignInScreen onSwitch={() => setMode("signup")} />
      )}
    </LedgerPage>
  );
  if (profileMissing) return <LedgerPage bg="/register_book.png"><CreateProfileScreen onDone={refresh} /></LedgerPage>;
  if (!character) return <LedgerPage bg="/register_book.png"><CreateOrReviveScreen onDone={refresh} /></LedgerPage>;
  if (!character.guild_id) return <LedgerPage bg="/guild_hall_bg.png"><GuildScreen character={character} onDone={refresh} /></LedgerPage>;

  const isInExpedition = activeExpedition && members.some(m => m.id === character.id);

  return (
    <LedgerPage bg="/guild_hall_bg.png" wide>
      <LedgerCard title={guild?.name ?? "Guilde"} subtitle={`Trésor : ${Math.round(guild?.gold ?? 0)} or · ${members.length} membre${members.length > 1 ? "s" : ""} · il faut 3 membres pour partir en expédition`}>

        {guild && (
          <div className="flex items-center gap-2 mb-4">
            <GuildBanner symbol={guild.banner_symbol} color={guild.banner_color} size={32} />
            {session?.user?.id === guild.founder_profile_id && (
              <GuildBannerEditor guildId={guild.id} characterId={character.id} currentSymbol={guild.banner_symbol ?? null} currentColor={guild.banner_color ?? null} onDone={refresh} />
            )}
          </div>
        )}

        {/* Vocation à choisir en priorité (surtout pour les persos créés avant ce système) */}
        {myVocation === null && (
          <RetroVocationPicker characterId={character.id} onDone={refresh} />
        )}

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
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="border border-border/60 p-3">
                <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">Niveau</dt>
                <dd className="mt-1 font-mono text-xl text-primary">{character.level}</dd>
              </div>
              <div className="border border-border/60 p-3">
                <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">XP</dt>
                <dd className="mt-1 font-mono text-xl text-primary">{character.xp}</dd>
              </div>
            </div>

            {/* Vocation */}
            {myVocation && (
              <VocationPanel vocationId={myVocation} characterId={character.id} />
            )}

            {/* Bouton expédition */}
            {!activeExpedition && (
              <button onClick={() => navigate({ to: "/expedition" })}
                className="w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase border-primary/60 text-primary hover:bg-primary/10 mb-3">
                Partir en expédition
              </button>
            )}

            {/* Historique */}
            {history.length > 0 && (
              <div className="mt-4 border-t border-border/20 pt-4">
                <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Historique</p>
                <ul className="space-y-1">
                  {history.map((e) => (
                    <li key={e.id} className="px-3 py-2 border border-border/20 text-xs text-muted-foreground">
                      <span className={`inline-block mr-2 ${e.event_type === "member_died" ? "text-red-400" : e.event_type === "expedition_completed" ? "text-primary" : "text-muted-foreground"}`}>
                        {e.event_type === "member_died" ? "✝" : e.event_type === "expedition_completed" ? "⚔" : "·"}
                      </span>
                      {e.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Colonne latérale : membres, demandes, chat, joueurs en ligne, navigation */}
          <div className="min-w-0 mt-6 lg:mt-0">
            {/* Membres */}
            <div className="mb-5">
              <Frame variant="bar" className="mb-3 max-w-xs mx-auto lg:mx-0 lg:max-w-none">
                <span className="text-xs tracking-[0.16em] uppercase font-serif">Membres</span>
              </Frame>
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
                      <VocationBadge vocationId={m.declared_vocation} className="!border-[#f2e4c8]/40 !text-[#f2e4c8]" />
                    </div>
                  </MemberFrame>
                ))}
              </div>
            </div>

            {guild && (
              <>
                <JoinRequestsPanel guildId={guild.id} character={character} onResolved={refresh} />
                <GuildChatBox guildId={guild.id} character={character} />
              </>
            )}

            <OnlinePlayersPanel guildName={guild?.name} />

            <div className="mt-3 border-t border-border/20 pt-3 space-y-1">
              <button onClick={() => navigate({ to: "/profil" })}
                className="w-full text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors py-1">
                Mon profil
              </button>
              <button onClick={() => navigate({ to: "/monde" })}
                className="w-full text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors py-1">
                Le monde
              </button>
              <button onClick={() => navigate({ to: "/carte" })}
                className="w-full text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors py-1">
                Carte des guildes
              </button>
              <button onClick={() => navigate({ to: "/inviter" })}
                className="w-full text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors py-1">
                Inviter quelqu'un dans la guilde
              </button>
              <LeaveGuildButton character={character} onDone={refresh} />
            </div>
            <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
          </div>
        </div>
      </LedgerCard>
    </LedgerPage>
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
      className="w-full text-xs tracking-[0.12em] uppercase text-red-400/50 hover:text-red-400 transition-colors py-1">
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
    const { error: rpcError } = await supabase.rpc("create_guild", { p_guild_name: guildName, p_character_id: character.id });
    if (rpcError) setError(rpcError.message); else await onDone();
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
          <Field label="Nom de la guilde" required value={guildName} onChange={(e) => setGuildName(e.target.value)} />
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


type GuildChatMessage = { id: string; character_id: string; message: string; created_at: string; character: { name: string } };

function GuildChatBox({ guildId, character }: { guildId: string; character: Character }) {
  const [messages, setMessages] = useState<GuildChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("guild_chat_messages")
      .select("id, character_id, message, created_at, character:characters(name)")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: true })
      .limit(50);
    setMessages((data as any) ?? []);
  }, [guildId]);

  useEffect(() => {
    void fetchMessages();
    pollRef.current = setInterval(fetchMessages, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages]);

  const prevMsgCount = useRef(0);
  useEffect(() => {
    if (messages.length > prevMsgCount.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    prevMsgCount.current = messages.length;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    await supabase.from("guild_chat_messages").insert({ guild_id: guildId, character_id: character.id, message: text.trim() });
    setText("");
    await fetchMessages();
    setBusy(false);
  }

  return (
    <div className="mt-4 border-t border-border/20 pt-4">
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Chat de guilde</p>
      <div className="h-32 overflow-y-auto space-y-1 mb-2 pr-1">
        {messages.length === 0
          ? <p className="text-xs text-muted-foreground/40 italic">Silence dans la guilde.</p>
          : messages.map((m) => (
            <div key={m.id} className={`text-xs ${m.character_id === character.id ? "text-primary" : "text-muted-foreground"}`}>
              <span className="font-semibold">{(m.character as any)?.name ?? "?"}</span>
              <span className="mx-1 opacity-40">·</span>
              <span>{m.message}</span>
            </div>
          ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} maxLength={200}
          placeholder="Écris à ta guilde…"
          className="flex-1 bg-transparent border border-border/40 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40" />
        <button type="submit" disabled={busy || !text.trim()}
          className="px-3 py-1.5 text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-30">
          Envoyer
        </button>
      </form>
    </div>
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
    <div className="relative mb-4 bg-primary/5 px-4 py-4">
      <DecorativeBorder variant="wide" />
      <p className="text-xs tracking-[0.14em] uppercase text-primary mb-2">Demandes pour rejoindre la guilde</p>
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
    <div className="mb-4">
      <Frame variant="journal" contentClassName="!flex-col !items-stretch !justify-start text-left !inset-[16%_12%_11%_14%]">
        <p className="text-xs tracking-[0.14em] uppercase opacity-90 mb-1">Ta vocation</p>
        <p className="text-sm font-serif text-primary">{vocationLabel(vocationId)}</p>
        <p className="text-xs mt-1">{VOCATIONS.find(v => v.id === vocationId)?.description}</p>

        {vocationId === "Traitre" && (
          <div className="mt-3 pt-3 border-t border-[#f2e4c8]/20">
            {!declaring ? (
              <button onClick={() => setDeclaring(true)} className="text-xs uppercase tracking-[0.1em] border border-[#f2e4c8]/40 px-2.5 py-1 hover:bg-white/5">
                Mentir sur ma vocation déclarée
              </button>
            ) : (
              <>
                <VocationPicker value={lie} onChange={setLie} title="Vocation à déclarer publiquement (modifiable à volonté)" />
                <LedgerError message={error} />
                {notice && <p className="text-xs text-emerald-300 mt-2">{notice}</p>}
                <button onClick={submitLie} disabled={!lie || busy}
                  className="mt-3 w-full text-xs uppercase tracking-[0.1em] border border-primary/50 text-primary px-3 py-1.5 hover:bg-primary/10 disabled:opacity-30">
                  {busy ? "…" : "Valider ce mensonge"}
              </button>
            </>
          )}
        </div>
      )}
      </Frame>
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
