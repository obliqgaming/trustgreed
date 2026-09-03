import { createFileRoute, redirect } from "@tanstack/react-router";

// "Le monde" a été fusionné dans "Carte des guildes" (mêmes informations,
// une seule page à consulter). Cette route reste en place pour ne pas casser
// d'éventuels liens existants, et redirige simplement.
export const Route = createFileRoute("/monde")({
  beforeLoad: () => {
    throw redirect({ to: "/carte" });
  },
});
