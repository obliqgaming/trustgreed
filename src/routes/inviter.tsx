import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerCard, LedgerError, LedgerPage, SealButton, TextLink } from "@/components/ledger";

export const Route = createFileRoute("/inviter")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Inviter quelqu'un — Trust & Greed" },
      {
        name: "description",
        content:
          "Génère un code d'invitation Trust & Greed et transmets-le à la personne que tu veux faire entrer dans le registre.",
      },
      { property: "og:title", content: "Inviter quelqu'un — Trust & Greed" },
      {
        property: "og:description",
        content: "Génère un code d'invitation et fais entrer quelqu'un dans le registre.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Inviter,
});

function Inviter() {
  const navigate = useNavigate();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setError(null);
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("create_invitation");
    if (rpcError) setError(rpcError.message);
    else setCode((data as { code: string } | null)?.code ?? null);
    setBusy(false);
  }

  async function copy() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <LedgerPage>
      <LedgerCard title="Inviter quelqu'un" subtitle="Chaque code n'est valable qu'une seule fois.">
        {code ? (
          <div>
            <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase">Code généré</p>
            <p className="mt-2 border border-border/60 px-4 py-3 font-mono text-2xl tracking-[0.2em] text-primary">
              {code}
            </p>
            <button
              onClick={copy}
              className="mt-4 w-full rounded-sm border border-primary/60 px-4 py-2.5 font-serif tracking-[0.16em] text-primary uppercase hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              {copied ? "Copié" : "Copier le code"}
            </button>
          </div>
        ) : (
          <>
            <LedgerError message={error} />
            <SealButton onClick={generate} disabled={busy}>
              {busy ? "Génération…" : "Générer un code"}
            </SealButton>
          </>
        )}
        <TextLink onClick={() => navigate({ to: "/" })}>Retour</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}
