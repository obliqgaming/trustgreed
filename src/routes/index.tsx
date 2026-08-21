import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Field, LedgerCard, LedgerError, LedgerPage, SealButton, TextLink } from "@/components/ledger";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Index,
});

type Character = { id: string; name: string; level: number; xp: number; guild_id: string | null };
type Guild = { id: string; name: string; gold: number };
type Member = { id: string; name: string; level: number };
type HistoryEvent = { id: string; event_type: string; description: string; created_at: string };
type ActiveExpedition = { id: string; status: string; participant_count: number } | null;

function Index() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [profileMissing, setProfileMissing] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);
  const [guild, setGuild] = useState<Guild | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [activeExpedition, setActiveExpedition] = useState<ActiveExpedition>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user) { setCharacter(null); setProfileMissing(false); setGuild(null); setMembers([]); setHistory([]); setActiveExpedition(null); return; }

    const { data: profile } = await supabase.from("profiles").select("id").eq("id", session.user.id).maybeSingle();
    setProfileMissing(!profile);

    const { data: char } = await supabase.from("characters").select("id, name, level, xp, guild_id").eq("profile_id", session.user.id).eq("is_alive", true).maybeSingle();
    setCharacter(char ?? null);

    if (char?.guild_id) {
      const { data: g } = await supabase.from("guilds").select("id, name, gold").eq("id", char.guild_id).maybeSingle();
      setGuild(g ?? null);

      const { data: m } = await supabase.from("characters").select("id, name, level").eq("guild_id", char.guild_id).eq("is_alive", true).order("level", { ascending: false });
      setMembers(m ?? []);

      const { data: h } = await supabase.from("guild_history_events").select("id, event_type, description, created_at").eq("guild_id", char.guild_id).order("created_at", { ascending: false }).limit(10);
      setHistory(h ?? []);

      // Expédition en cours (waiting ou active)
      const { data: exp } = await supabase.from("expeditions").select("id, status").eq("guild_id", char.guild_id).in("status", ["waiting", "active"]).maybeSingle();
      if (exp) {
        const { count } = await supabase.from("expedition_participants").select("character_id", { count: "exact", head: true }).eq("expedition_id", exp.id);
        setActiveExpedition({ id: exp.id, status: exp.status, participant_count: count ?? 0 });
      } else {
        setActiveExpedition(null);
      }
    } else {
      setGuild(null); setMembers([]); setHistory([]); setActiveExpedition(null);
    }
    setReady(true);
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

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

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Ouverture du registre…</p></LedgerPage>;
  if (!session) return <LedgerPage>{mode === "signup" ? <SignUpScreen onSwitch={() => setMode("signin")} onNotice={setNotice} notice={notice} /> : <SignInScreen onSwitch={() => setMode("signup")} />}</LedgerPage>;
  if (profileMissing) return <LedgerPage><CreateProfileScreen onDone={refresh} /></LedgerPage>;
  if (!character) return <LedgerPage><CreateCharacterScreen onDone={refresh} /></LedgerPage>;
  if (!character.guild_id) return <LedgerPage><GuildScreen character={character} onDone={refresh} /></LedgerPage>;

  const isInExpedition = activeExpedition && members.some(m => m.id === character.id);

  return (
    <LedgerPage>
      <LedgerCard title={guild?.name ?? "Guilde"} subtitle={`Trésor : ${Math.round(guild?.gold ?? 0)} or · ${members.length} membre${members.length > 1 ? "s" : ""}`}>

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
              onClick={() => activeExpedition.status === "active"
                ? navigate({ to: "/vote", search: { expedition: activeExpedition.id } })
                : navigate({ to: "/expedition" })}
              className="w-full text-xs tracking-[0.12em] uppercase border border-primary/40 text-primary py-1.5 hover:bg-primary/10"
            >
              {activeExpedition.status === "active" ? "Rejoindre l'expédition" : "Voir la salle d'attente"}
            </button>
          </div>
        )}

        {/* Membres */}
        <div className="mb-4">
          <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Membres</p>
          <ul className="space-y-1">
            {members.map((m) => (
              <li key={m.id} className={`flex justify-between px-3 py-2 text-sm border ${m.id === character.id ? "border-primary/60 text-primary" : "border-border/30 text-foreground"}`}>
                <span>{m.name}{m.id === character.id ? " (toi)" : ""}</span>
                <span className="font-mono text-xs text-muted-foreground">niv. {m.level}</span>
              </li>
            ))}
          </ul>
        </div>

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

        <div className="mt-3 border-t border-border/20 pt-3 space-y-1">
          <button onClick={() => navigate({ to: "/carte" })}
            className="w-full text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors py-1">
            Carte des guildes
          </button>
          <button onClick={() => navigate({ to: "/inviter" })}
            className="w-full text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors py-1">
            Inviter quelqu'un dans la guilde
          </button>
        </div>
        <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}

function GuildScreen({ character, onDone }: { character: Character; onDone: () => Promise<void> }) {
  const [guilds, setGuilds] = useState<(Guild & { member_count: number })[]>([]);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [guildName, setGuildName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("guilds").select("id, name, gold").order("gold", { ascending: false }).limit(10);
      if (data) {
        const withCounts = await Promise.all(data.map(async (g) => {
          const { count } = await supabase.from("characters").select("id", { count: "exact", head: true }).eq("guild_id", g.id).eq("is_alive", true);
          return { ...g, member_count: count ?? 0 };
        }));
        setGuilds(withCounts);
      }
    })();
  }, []);

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
    <LedgerCard title={character.name} subtitle="Ton personnage n'appartient à aucune guilde.">
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
              <ul className="space-y-2">
                {guilds.map((g) => (
                  <li key={g.id} className="flex justify-between border border-border/40 px-3 py-2 text-sm">
                    <span>{g.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{g.member_count} membre{g.member_count > 1 ? "s" : ""} · {Math.round(g.gold)} or</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      )}
      <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
    </LedgerCard>
  );
}

function SignUpScreen({ onSwitch, onNotice, notice }: { onSwitch: () => void; onNotice: (v: string | null) => void; notice: string | null }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); onNotice(null); setBusy(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (signUpError) { setError(signUpError.message); setBusy(false); return; }
    if (!data.session) { onNotice("Compte créé. Connecte-toi pour choisir ton pseudo."); setBusy(false); return; }
    const { error: rpcError } = await supabase.rpc("create_profile", { p_username: username });
    if (rpcError) setError(rpcError.message);
    setBusy(false);
  }
  return (
    <LedgerCard title="Inscription" subtitle="Crée ton compte pour rejoindre le registre.">
      <form onSubmit={submit} noValidate>
        <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Mot de passe" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Pseudo" required value={username} onChange={(e) => setUsername(e.target.value)} />
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
    if (rpcError) setError(rpcError.message); else await onDone();
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

function CreateCharacterScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const { error: rpcError } = await supabase.rpc("create_character", { p_name: name });
    if (rpcError) setError(rpcError.message); else await onDone();
    setBusy(false);
  }
  return (
    <LedgerCard title="Créer un personnage" subtitle="Un seul nom, inscrit à l'encre.">
      <form onSubmit={submit} noValidate>
        <Field label="Nom du personnage" required value={name} onChange={(e) => setName(e.target.value)} />
        <LedgerError message={error} />
        <SealButton type="submit" disabled={busy}>{busy ? "Inscription…" : "Inscrire au registre"}</SealButton>
      </form>
      <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
    </LedgerCard>
  );
}
