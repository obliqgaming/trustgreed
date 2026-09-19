// Déclenchée par un trigger Postgres sur INSERT dans `expeditions` — chaque
// nouvelle ligne est forcément une salle d'attente fraîche (create_expedition
// n'indique jamais explicitement `status`, la valeur par défaut est
// 'waiting'). Poste dans le salon DE LA GUILDE, avec mention du rôle, pour
// recruter — contrairement aux notifications "c'est ton tour" (DM,
// asynchrone uniquement), celle-ci s'applique aux DEUX modes : qu'elle
// tourne en synchrone ou en asynchrone, l'idée est la même — prévenir tout
// le monde qu'une place se libère.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { postMessage } from "../_shared/discord.ts";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const APP_BASE_URL = "https://trustgreed.lovable.app";

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const expedition = payload.record as {
    id: string;
    guild_id: string;
    target_size: number;
    vote_window_seconds: number;
  };
  if (!expedition?.id || !expedition?.guild_id) {
    return new Response("Payload invalide", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: guild, error: guildError } = await supabase
    .from("guilds")
    .select("discord_channel_id, discord_role_id")
    .eq("id", expedition.guild_id)
    .single();
  if (guildError) {
    console.error("Échec lecture guilds.discord_channel_id/discord_role_id :", guildError);
  }
  if (!guild?.discord_channel_id) {
    // Guilde sans salon Discord : rien à faire, ne bloque rien côté jeu.
    return new Response("Pas de salon Discord pour cette guilde", { status: 200 });
  }

  const modeLabel = expedition.vote_window_seconds === 180
    ? "⚡ Synchrone (rejoignez vite, ça va tourner en direct)"
    : "🌙 Asynchrone (aucune limite de temps, jouez quand vous pouvez)";

  const roleMention = guild.discord_role_id ? `<@&${guild.discord_role_id}> ` : "";
  const message =
    `${roleMention}📯 **Une nouvelle expédition se prépare !** ` +
    `Il faut ${expedition.target_size} aventuriers.\n` +
    `${modeLabel}\n` +
    `${APP_BASE_URL}/expedition`;

  try {
    await postMessage(guild.discord_channel_id, message);
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(`Erreur Discord : ${err}`, { status: 200 });
  }
});
