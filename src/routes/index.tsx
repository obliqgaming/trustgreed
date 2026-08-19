import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  Field,
  LedgerCard,
  LedgerError,
  LedgerPage,
  SealButton,
  TextLink,
} from "@/components/ledger";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Index,
});

type Character = { id: string; name: string; level: number; xp: number; guild_id: string | null };
type Guild = { id: string; name: string; gold: number; member_count: number };

function Index() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [profileMissing, setProfileMissing] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setCharacter(null);
      setProfileMissing(false);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", session.user.id)
      .maybeSingle();
    setProfileMissing(!profile);

    const { data: char } = await supabase
      .from("characters")
      .select("id, name, level, xp, guild_id")
      .eq("profile_id", session.user.id)
      .eq("is_alive", true)
      .maybeSingle();
    setCharacter(char ?? null);
    setReady(true);
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Ouverture du registre…</p></LedgerPage>;

  if (!session) return (
    <LedgerPage>
      {mode === "signup"
        ? <SignUpScreen onSwitch={() => setMode("signin")} onNotice={setNotice} notice={notice} />
        : <SignInScreen onSwitch={() => setMode("signup")} />}
    </LedgerPage>
  );

  if (profileMissing) return <LedgerPage><CreateProfileScreen onDone={refresh} /></LedgerPage>;
  if (!character) return <LedgerPage><CreateCharacterScreen onDone={refresh} /></LedgerPage>;
  if (!character.guild_id) return <LedgerPage><GuildScreen character={character} onDone={refresh} /></LedgerPage>;

  return (
    <LedgerPage>
      <LedgerCard title={`Bienvenue ${character.name}`} subtitle="Inscription au registre confirmée.">
        <dl className="grid grid-cols-2 gap-4">
          <div className="border border-border/60 p-4">
            <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">Niveau</dt>
            <dd className="mt-1 font-mono text-2xl text-primary">{character.level}</dd>
          </div>
          <div className="border border-border/60 p-4">
            <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">XP</dt>
            <dd className="mt-1 font-mono text-2xl text-primary">{character.xp}</dd>
          </div>
        </dl>
        <button
          onClick={() => navigate({ to: "/inviter" })}
          className="mt-6 w-full rounded-sm border border-primary/60 px-4 py-2.5 font-serif tracking-[0.16em] text-primary uppercase hover:bg-primary/10"
        >
          Inviter quelqu'un
        </button>
        <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}

function GuildScreen({ character, onDone }: { character: Character; onDone: () => Promise<void> }) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [guildName, setGuildName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviterName, setInviterName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("guilds")
        .select("id, name, gold")
        .order("gold", { ascending: false })
        .limit(10);
      if (data) {
        const withCounts = await Promise.all(data.map(async (g) => {
          const { count } = await supabase
            .from("characters")
            .select("id", { count: "exact", head: true })
            .eq("guild_id", g.id)
            .eq("is_alive", true);
          return { ...g, member_count: count ?? 0 };
        }));
        setGuilds(withCounts);
      }
    })();
  }, []);

  async function createGuild(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("create_guild", {
      p_guild_name: guildName,
      p_character_id: character.id,
    });
    if (rpcError) setError(rpcError.message);
    else await onDone();
    setBusy(false);
  }

  async function joinGuild(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    // Trouver le personnage parrain via son nom
    const { data: inviter } = await supabase
      .from("characters")
      .select("id, guild_id")
      .eq("name", inviterName)
      .eq("is_alive", true)
      .maybeSingle();
    if (!inviter) {
      setError("Personnage parrain introuvable ou mort.");
      setBusy(false);
      return;
    }
    const { error: rpcError } = await supabase.rpc("join_guild", {
      p_guild_id: inviter.guild_id,
      p_character_id: character.id,
      p_invited_by_character_id: inviter.id,
    });
    if (rpcError) setError(rpcError.message);
    else await onDone();
    setBusy(false);
  }

  return (
    <LedgerCard title={character.name} subtitle="Ton personnage n'appartient à aucune guilde.">
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("create")}
          className={`flex-1 py-2 text-xs tracking-[0.14em] uppercase border rounded-sm ${tab === "create" ? "border-primary text-primary" : "border-border/40 text-muted-foreground"}`}
        >
          Fonder une guilde
        </button>
        <button
          onClick={() => setTab("join")}
          className={`flex-1 py-2 text-xs tracking-[0.14em] uppercase border rounded-sm ${tab === "join" ? "border-primary text-primary" : "border-border/40 text-muted-foreground"}`}
        >
          Rejoindre une guilde
        </button>
      </div>

      {tab === "create" ? (
        <form onSubmit={createGuild} noValidate>
          <Field label="Nom de la guilde" required value={guildName} onChange={(e) => setGuildName(e.target.value)} />
          <LedgerError message={error} />
          <SealButton type="submit" disabled={busy}>{busy ? "Fondation…" : "Fonder la guilde"}</SealButton>
        </form>
      ) : (
        <form onSubmit={joinGuild} noValidate>
          <Field label="Nom du personnage qui t'invite" required value={inviterName} onChange={(e) => setInviterName(e.target.value)} />
          <LedgerError message={error} />
          <SealButton type="submit" disabled={busy}>{busy ? "Entrée…" : "Rejoindre"}</SealButton>
          {guilds.length > 0 && (
            <div className="mt-6">
              <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-3">Guildes actives</p>
              <ul className="space-y-2">
                {guilds.map((g) => (
                  <li key={g.id} className="flex justify-between border border-border/40 px-3 py-2 text-sm">
                    <span className="text-foreground">{g.name}</span>
                    <span className="font-mono text-primary text-xs">{g.member_count} membres · {Math.round(g.gold)} or</span>
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    onNotice(null);
    setBusy(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (signUpError) { setError(signUpError.message); setBusy(false); return; }
    if (!data.session) { onNotice("Compte créé. Confirme ton adresse email, puis connecte-toi."); setBusy(false); return; }
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
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
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("create_profile", { p_username: username });
    if (rpcError) setError(rpcError.message);
    else await onDone();
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
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("create_character", { p_name: name });
    if (rpcError) setError(rpcError.message);
    else await onDone();
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
