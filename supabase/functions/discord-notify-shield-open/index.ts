// Déclenchée par un trigger Postgres sur INSERT dans `expedition_shields`,
// filtré côté SQL sur le mode asynchrone uniquement (le vote de bouclier
// existe aussi en synchrone, mais dans ce mode tout le monde est déjà
// devant l'écran, la notification n'a d'intérêt qu'en asynchrone).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyAliveParticipants } from "../_shared/discord.ts";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const APP_BASE_URL = "https://trustgreed.lovable.app";

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const shield = payload.record as { id: string; expedition_id: string; rarity: string };
  if (!shield?.expedition_id) {
    return new Response("Payload invalide", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const rarityLabel = shield.rarity === "leger" ? "léger" : shield.rarity === "moyen" ? "moyen" : "lourd";
  const message =
    `🛡️ **C'est ton tour !** Un bouclier ${rarityLabel} est apparu — vote pour qui doit le porter.\n` +
    `${APP_BASE_URL}/vote?expedition=${shield.expedition_id}`;

  await notifyAliveParticipants(supabase, shield.expedition_id, message);

  return new Response("OK", { status: 200 });
});
