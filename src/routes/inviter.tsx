import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerCard, LedgerError, LedgerPage, SealButton, TextLink } from "@/components/ledger";

export const Route = createFileRoute("/inviter")({
  ssr: false,
  component: Inviter,
});

function Inviter() {
  const navigate = useNavigate();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [guildName, setGuildName] = useState<string | null>(null);
  const [characterName, setCharacterName] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate({ to: "/" }); return; }

      const { data: char } = await supabase
        .from("characters")
        .select("name, guild_id")
        .eq("profile_id", session.user.id)
        .eq("is_alive", true)
        .eq("is_bot", false)
        .maybeSingle();
      if (!char) { navigate({ to: "/" }); return; }
      setCharacterName(char.name);

      if (char.guild_id) {
        const { data: guild } = await supabase
          .from("guilds")
          .select("name")
          .eq("id", char.guild_id)
          .maybeSingle();
        setGuildName(guild?.name ?? null);
      }
    })();
  }, [navigate]);

  async function generate() {
    setError(null); setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("create_invitation");
    if (rpcError) setError(rpcError.message);
    else setCode((data as { code: string } | null)?.code ?? null);
    setBusy(false);
  }

  async function copy() {
    if (!code) return;
    // Copie un message complet plutôt que juste le code
    const message = guildName
      ? `${characterName} t'invite à rejoindre la guilde "${guildName}" sur Trust & Greed.\n\nTon code d'invitation : ${code}\n\nhttps://trustgreed.lovable.app/`
      : `${characterName} t'invite sur Trust & Greed.\n\nTon code d'invitation : ${code}\n\nhttps://trustgreed.lovable.app/`;
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <LedgerPage>
      <LedgerCard
        title="Inviter quelqu'un"
        subtitle={guildName ? `Dans la guilde "${guildName}"` : "Chaque code n'est valable qu'une seule fois."}
      >
        {guildName && (
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            Ce code permettra à la personne de rejoindre directement ta guilde.
            Ne le donne qu'à quelqu'un en qui tu as confiance — une fois dedans,
            elle sera membre à part entière.
          </p>
        )}

        {code ? (
          <div>
            <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase mb-2">Code généré</p>
            <p className="border border-border/60 px-4 py-3 font-mono text-2xl tracking-[0.2em] text-primary">
              {code}
            </p>
            <button onClick={copy}
              className="mt-4 w-full rounded-sm border border-primary/60 px-4 py-2.5 font-serif tracking-[0.16em] text-primary uppercase hover:bg-primary/10">
              {copied ? "Message copié ✓" : "Copier le message d'invitation"}
            </button>
            <p className="mt-2 text-xs text-muted-foreground text-center">
              Colle ce message dans Discord, Twitch, ou ailleurs.
            </p>
            <button onClick={() => setCode(null)}
              className="mt-3 w-full text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors py-1">
              Générer un autre code
            </button>
          </div>
        ) : (
          <>
            <LedgerError message={error} />
            <SealButton onClick={generate} disabled={busy}>
              {busy ? "Génération…" : "Générer un code d'invitation"}
            </SealButton>
          </>
        )}
        <TextLink onClick={() => navigate({ to: "/" })}>Retour</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}
