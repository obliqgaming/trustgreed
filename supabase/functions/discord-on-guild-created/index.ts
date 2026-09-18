// Déclenchée par un Database Webhook Supabase sur INSERT dans `guilds`.
// Crée le salon + le rôle Discord de la nouvelle guilde, donne le rôle au
// fondateur (s'il a déjà lié son Discord), poste un message de bienvenue.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  findOrCreateGuildsCategory,
  createGuildRole,
  createGuildChannel,
  assignRole,
  postMessage,
} from "../_shared/discord.ts";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const guild = payload.record as { id: string; name: string; founder_profile_id: string };
  if (!guild?.id || !guild?.name) {
    return new Response("Payload invalide", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Garde-fou anti-doublon : si cette guilde a déjà un salon Discord, on ne
  // refait rien (protège contre une éventuelle double livraison du webhook).
  const { data: existing } = await supabase
    .from("guilds")
    .select("discord_channel_id")
    .eq("id", guild.id)
    .single();
  if (existing?.discord_channel_id) {
    return new Response("Déjà traité", { status: 200 });
  }

  try {
    const categoryId = await findOrCreateGuildsCategory();
    const roleId = await createGuildRole(guild.name);
    const channelId = await createGuildChannel(guild.name, categoryId, roleId);

    await supabase
      .from("guilds")
      .update({ discord_channel_id: channelId, discord_role_id: roleId })
      .eq("id", guild.id);

    // Le fondateur reçoit le rôle tout de suite s'il a déjà lié son Discord
    // (create_profile le fait automatiquement à la connexion) ; sinon rien
    // ne bloque, il l'aura dès sa prochaine connexion via une future passe.
    const { data: founderProfile } = await supabase
      .from("profiles")
      .select("discord_user_id")
      .eq("id", guild.founder_profile_id)
      .single();
    if (founderProfile?.discord_user_id) {
      await assignRole(founderProfile.discord_user_id, roleId);
    }

    await postMessage(
      channelId,
      `Bienvenue dans le salon de **${guild.name}** ! Les membres de cette guilde seront mentionnés ici pour les salles d'attente et les résultats d'expédition.`
    );

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(err);
    // On renvoie 200 quand même : la guilde existe déjà côté jeu, un souci
    // Discord ne doit jamais faire échouer la création de guilde elle-même
    // côté client (qui a déjà réussi avant que ce webhook ne se déclenche).
    return new Response(`Erreur Discord : ${err}`, { status: 200 });
  }
});
