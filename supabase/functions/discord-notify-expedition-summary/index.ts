// Déclenchée par un trigger Postgres sur UPDATE dans `expeditions`, quand
// le statut passe à 'completed' (couvre les deux façons dont ça arrive :
// retour volontaire dans begin_resolution, ou anéantissement total dans
// finalize_resolution — un seul trigger sur la table couvre les deux).
//
// Poste le résumé dans le SALON DE GUILDE (pas un DM) : étape atteinte,
// or récolté, qui est mort. N'inclut PAS pour l'instant qui a volé / qui
// s'est fait prendre en larcin — je ne connais pas la vraie structure de
// la table larceny_attempts, voir NOTES_POUR_DEMAIN.md.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { postMessage } from "../_shared/discord.ts";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const expedition = payload.record as {
    id: string;
    guild_id: string;
    total_loot_earned: number;
    total_loot_kept: number;
  };
  if (!expedition?.id || !expedition?.guild_id) {
    return new Response("Payload invalide", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: guild } = await supabase
    .from("guilds")
    .select("discord_channel_id")
    .eq("id", expedition.guild_id)
    .single();
  if (!guild?.discord_channel_id) {
    // Guilde sans salon Discord (pas encore créé, ou lié à un serveur
    // Discord différent) : rien à faire, on ne bloque rien côté jeu.
    return new Response("Pas de salon Discord pour cette guilde", { status: 200 });
  }

  const { data: steps } = await supabase
    .from("expedition_steps")
    .select("step_number")
    .eq("expedition_id", expedition.id)
    .order("step_number", { ascending: false })
    .limit(1);
  const lastStep = steps?.[0]?.step_number ?? "?";

  const { data: deadCharacters } = await supabase
    .from("characters")
    .select("name")
    .eq("died_in_expedition_id", expedition.id)
    .eq("is_alive", false);

  const lootFinal = expedition.total_loot_kept ?? expedition.total_loot_earned ?? 0;

  let message = `📜 **Expédition terminée** — arrivée jusqu'à l'étape ${lastStep}. Butin final : **${Math.round(lootFinal)} or**.`;
  if (deadCharacters && deadCharacters.length > 0) {
    const names = deadCharacters.map((c: any) => c.name).join(", ");
    message += `\n💀 Ont péri durant l'expédition : ${names}.`;
  } else {
    message += `\n✅ Personne n'est mort — belle expédition !`;
  }

  await postMessage(guild.discord_channel_id, message);

  return new Response("OK", { status: 200 });
});
