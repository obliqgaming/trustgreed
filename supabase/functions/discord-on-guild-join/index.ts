// Déclenchée par un Database Webhook Supabase sur UPDATE dans `characters`.
// Se déclenche sur CHAQUE modification d'un personnage (PV, niveau, etc.),
// donc on vérifie nous-mêmes que c'est bien guild_id qui a changé avant
// de faire quoi que ce soit — le webhook lui-même ne filtre pas la colonne.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { assignRole, removeRole } from "../_shared/discord.ts";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const record = payload.record as { id: string; profile_id: string; guild_id: string | null };
  const oldRecord = payload.old_record as { guild_id: string | null };

  if (record.guild_id === oldRecord.guild_id) {
    return new Response("guild_id inchangé", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: profile } = await supabase
    .from("profiles")
    .select("discord_user_id")
    .eq("id", record.profile_id)
    .single();
  if (!profile?.discord_user_id) {
    // Pas de Discord lié : rien à faire côté Discord, le jeu continue
    // normalement sans que ça bloque quoi que ce soit.
    return new Response("Pas de Discord lié", { status: 200 });
  }

  try {
    // A quitté une guilde (ou en a changé) : retire l'ancien rôle s'il y en
    // avait un, pour ne pas laisser un rôle périmé.
    if (oldRecord.guild_id) {
      const { data: oldGuild } = await supabase
        .from("guilds")
        .select("discord_role_id")
        .eq("id", oldRecord.guild_id)
        .single();
      if (oldGuild?.discord_role_id) {
        await removeRole(profile.discord_user_id, oldGuild.discord_role_id);
      }
    }

    // A rejoint une nouvelle guilde : donne le nouveau rôle.
    if (record.guild_id) {
      const { data: newGuild } = await supabase
        .from("guilds")
        .select("discord_role_id")
        .eq("id", record.guild_id)
        .single();
      if (newGuild?.discord_role_id) {
        await assignRole(profile.discord_user_id, newGuild.discord_role_id);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(`Erreur Discord : ${err}`, { status: 200 });
  }
});
