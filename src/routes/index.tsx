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
  head: () => ({
    meta: [
      { title: "Trust & Greed — Registre de guilde" },
      {
        name: "description",
        content:
          "Rejoins Trust & Greed : crée ton compte avec un code d'invitation, forge ton personnage et entre au registre de la guilde.",
      },
      { property: "og:title", content: "Trust & Greed — Registre de guilde" },
      {
        property: "og:description",
        content:
          "Crée ton compte avec un code d'invitation et inscris ton personnage au registre de la guilde.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Character = { id: string; name: string; level: number; xp: number };

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
      .select("id, name, level, xp")
      .eq("profile_id", session.user.id)
      .eq("is_alive", true)
      .maybeSingle();
    setCharacter(char ?? null);
    setReady(true);
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ready) {
    return (
      <LedgerPage>
        <p className="text-center text-sm text-muted-foreground">Ouverture du registre…</p>
      </LedgerPage>
    );
  }

  if (!session) {
    return (
      <LedgerPage>
        {mode === "signup" ? (
          <SignUpScreen onSwitch={() => setMode("signin")} onNotice={setNotice} notice={notice} />
        ) : (
          <SignInScreen onSwitch={() => setMode("signup")} />
        )}
      </LedgerPage>
    );
  }

  if (profileMissing) {
    return (
      <LedgerPage>
        <RedeemScreen onDone={refresh} />
      </LedgerPage>
    );
  }

  if (!character) {
    return (
      <LedgerPage>
        <CreateCharacterScreen onDone={refresh} />
      </LedgerPage>
    );
  }

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
          className="mt-6 w-full rounded-sm border border-primary/60 px-4 py-2.5 font-serif tracking-[0.16em] text-primary uppercase hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          Inviter quelqu'un
        </button>
        <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}

function SignUpScreen({
  onSwitch,
  onNotice,
  notice,
}: {
  onSwitch: () => void;
  onNotice: (v: string | null) => void;
  notice: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    onNotice(null);
    setBusy(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (signUpError) {
      setError(signUpError.message);
      setBusy(false);
      return;
    }
    if (!data.session) {
      onNotice(
        "Compte créé. Confirme ton adresse email, puis connecte-toi : le code d'invitation te sera redemandé.",
      );
      setBusy(false);
      return;
    }
    const { error: rpcError } = await supabase.rpc("redeem_invitation", {
      p_code: code,
      p_username: username,
    });
    if (rpcError) setError(rpcError.message);
    setBusy(false);
  }

  return (
    <LedgerCard title="Inscription" subtitle="L'entrée au registre exige un code d'invitation.">
      <form onSubmit={submit} noValidate>
        <Field
          label="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Mot de passe"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Pseudo"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label="Code d'invitation"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <LedgerError message={error} />
        {notice ? <p className="mt-4 text-sm text-muted-foreground">{notice}</p> : null}
        <SealButton type="submit" disabled={busy}>
          {busy ? "Scellement…" : "Sceller l'inscription"}
        </SealButton>
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
        <Field
          label="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Mot de passe"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <LedgerError message={error} />
        <SealButton type="submit" disabled={busy}>
          {busy ? "Vérification…" : "Entrer"}
        </SealButton>
      </form>
      <TextLink onClick={onSwitch}>Créer un compte</TextLink>
    </LedgerCard>
  );
}

function RedeemScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [isEmpty, setIsEmpty] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .then(({ count }) => {
        if (!cancelled) setIsEmpty(count === 0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isEmpty === null) {
    return (
      <LedgerCard title="Vérification du registre…">
        <p className="text-sm text-muted-foreground">Lecture des archives en cours.</p>
      </LedgerCard>
    );
  }

  if (isEmpty) {
    return <BootstrapFirstProfileScreen onDone={onDone} />;
  }

  return <RedeemInvitationScreen onDone={onDone} />;
}

function BootstrapFirstProfileScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("bootstrap_first_profile", {
      p_username: username,
    });
    if (rpcError) setError(rpcError.message);
    else await onDone();
    setBusy(false);
  }

  return (
    <LedgerCard
      title="Premier au registre"
      subtitle="Tu es la première personne à rejoindre le monde. Choisis ton pseudo pour fonder le registre."
    >
      <form onSubmit={submit} noValidate>
        <Field
          label="Pseudo"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <LedgerError message={error} />
        <SealButton type="submit" disabled={busy}>
          {busy ? "Scellement…" : "Fonder le registre"}
        </SealButton>
      </form>
      <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
    </LedgerCard>
  );
}

function RedeemInvitationScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("redeem_invitation", {
      p_code: code,
      p_username: username,
    });
    if (rpcError) setError(rpcError.message);
    else await onDone();
    setBusy(false);
  }

  return (
    <LedgerCard title="Code d'invitation" subtitle="Ton compte n'est pas encore inscrit au registre.">
      <form onSubmit={submit} noValidate>
        <Field
          label="Pseudo"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label="Code d'invitation"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <LedgerError message={error} />
        <SealButton type="submit" disabled={busy}>
          {busy ? "Scellement…" : "Valider le code"}
        </SealButton>
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
        <Field
          label="Nom du personnage"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <LedgerError message={error} />
        <SealButton type="submit" disabled={busy}>
          {busy ? "Inscription…" : "Inscrire au registre"}
        </SealButton>
      </form>
      <TextLink onClick={() => supabase.auth.signOut()}>Se déconnecter</TextLink>
    </LedgerCard>
  );
}
