// Déclenchée par un trigger Postgres sur UPDATE dans `expedition_steps`,
// filtré côté SQL à la fois sur le mode asynchrone ET sur la transition
// resolving false -> true (via une clause WHEN sur le trigger, voir le
// fichier SQL). Prévient les participants vivants que la fenêtre
// intervenir/fouiller/passer est ouverte.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyAliveParticipants } from "../_shared/discord.ts";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const APP_BASE_URL = "https://trustgreed.lovable.app";

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const step = payload.record as { id: string; expedition_id: string; step_number: number };
  if (!step?.expedition_id) {
    return new Response("Payload invalide", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const message =
    `🎲 **C'est ton tour !** Le sort de l'étape ${step.step_number} se joue — ` +
    `intervenir, fouiller ou passer, à toi de voir.\n${APP_BASE_URL}/vote?expedition=${step.expedition_id}`;

  await notifyAliveParticipants(supabase, step.expedition_id, message);

  return new Response("OK", { status: 200 });
});
