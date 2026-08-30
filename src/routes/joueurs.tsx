import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LedgerCard, LedgerPage, TextLink } from "@/components/ledger";
import { OnlinePlayersPanel } from "@/components/onlinePlayers";

export const Route = createFileRoute("/joueurs")({
  ssr: false,
  component: Joueurs,
});

function Joueurs() {
  const navigate = useNavigate();
  return (
    <LedgerPage>
      <LedgerCard title="Joueurs">
        <OnlinePlayersPanel />
        <TextLink onClick={() => navigate({ to: "/" })}>Retour</TextLink>
      </LedgerCard>
    </LedgerPage>
  );
}
