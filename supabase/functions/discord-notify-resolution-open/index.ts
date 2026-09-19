// Déclenchée par un trigger Postgres sur INSERT dans `expedition_steps`,
// filtré côté SQL pour ne se déclencher qu'en mode asynchrone (voir le
// fichier SQL correspondant — notify_async_turn()). Prévient tous les
// participants vivants qu'une nouvelle étape attend leur vote
// continuer/rentrer.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyAliveParticipants } from "../_shared/discord.ts";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
// Base du site — utilisée pour construire le lien direct vers l'étape.
// Je pars du domaine vu tout au long de la soirée dans les captures
// d'écran (trustgreed.lovable.app). À corriger si ce n'est plus le bon
// domaine de production au moment où tu lis ceci.
const APP_BASE_URL = "https://trustgreed.lovable.app";

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const step = payload.record as { id: string; expedition_id: string; step_number: number; event_type: string };
  if (!step?.expedition_id) {
    return new Response("Payload invalide", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const message =
    `⚔️ **C'est ton tour !** Étape ${step.step_number} (${step.event_type}) est ouverte, ` +
    `à toi de voter *Continuer* ou *Rentrer*.\n${APP_BASE_URL}/vote?expedition=${step.expedition_id}`;

  await notifyAliveParticipants(supabase, step.expedition_id, message);

  return new Response("OK", { status: 200 });
});
