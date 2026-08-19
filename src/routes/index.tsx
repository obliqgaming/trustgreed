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
type Guild = { id: string; name: string; gold: number };
type Member = { id: string; name: string; level: number };

function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [profileMissing, setProfileMissing] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);
  const [guild, setGuild] = useState<Guild | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user) { setCharacter(null); setProfileMissing(false); setGuild(null); setMembers([]); return; }
    const { data: profile } = await supabase.from("profiles").select("id").eq("id", session.user.id).maybeSingle();
    setProfileMissing(!profile);
    const { data: char } = await supabase.from("characters").select("id, name, level, xp, guild_id").eq("profile_id", session.user.id).eq("is_alive", true).maybeSingle();
    setCharacter(char ?? null);
    if (char?.guild_id) {
      const { data: g } = await supabase.from("guilds").select("id, name, gold").eq("id", char.guild_id).maybeSingle();
      setGuild(g ?? null);
      const { data: m } = await supabase.from("characters").select("id, name, level").eq("guild_id", char.guild_id).eq("is_alive", true).order("level", { ascending: false });
      setMembers(m ?? []);
    } else {
      setGuild(null);
      setMembers([]);
    }
    setReady(true);
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Ouverture du registre…</p></LedgerPage>;
  if (!session) return <LedgerPage>{mode === "signup" ? <SignUpScreen onSwitch={() => setMode("signin")} onNotice={setNotice} notice={notice} /> : <SignInScreen onSwitch={() => setMode("signup")} />}</LedgerPage>;
  if (profileMissing) return <LedgerPage><CreateProfileScreen onDone={refresh} /></LedgerPage>;
  if (!character) return <LedgerPage><CreateCharacterScreen onDone={refresh} /></LedgerPage>;
  if (!character.guild_id) return <LedgerPage><GuildScreen character={character} onDone={refresh} /></LedgerPage>;

  return (
    <LedgerPage>
      <LedgerCard title={guild?.name ?? "Guilde"} subtitle={`Trésor de la guilde : ${Math.round(guild?.gold ?? 0)} or`}>
        <div className="mb-4">
          <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Membres ({members.length})</p>
          <ul className="space-y-1">
            {members.map((m) => (
              <li key={m.id} className={`flex justify-between px-3 py-2 text-sm border ${m.id === character.id ? "border-primary/60 text-primary" : "border-border/30 text-foreground"}`}>
                <span>{m.name}{m.id === character.id ? " (toi)" : ""}</span>
                <span className="font-mono text-xs text-muted-foreground">niv. {m.level}</span>
              </li>
            ))}
          </ul>
        </div>

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

        <button
          onClick={() => navigate({ to: "/expedition" })}
          className="mt-2 w-full rounded-sm border px-4 py-2.5 font-serif tracking-[0.16em] uppercase transition-colors border-primary/60 text-primary hover:bg-primary/10"
        >
          Partir en expédition
        </button>

        <div className="mt-3 border-t border-border/20 pt-3">
          <button
            onClick={() => window.location.href = "/inviter"}
            className="w-full text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors py-1"
          >
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
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2 text-xs tracking-[0.14em] uppercase border rounded-sm ${tab === t ? "border-primary text-primary" : "border-border/40 text-muted-foreground"}`}>
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
