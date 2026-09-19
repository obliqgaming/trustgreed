// Déclenchée par un Database Webhook Supabase sur UPDATE dans `characters`.
// Se déclenche sur CHAQUE modification d'un personnage (PV, niveau, etc.),
// donc on vérifie nous-mêmes que c'est bien guild_id qui a changé avant
// de faire quoi que ce soit — le webhook lui-même ne filtre pas la colonne.
//
// Chaque lecture vérifie son erreur et la trace (voir discord-on-guild-created
// pour le pourquoi : une erreur d'écriture avalée en silence a fait échouer
// une fonction pendant des heures sans qu'on le voie, le 18/09).
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("discord_user_id")
    .eq("id", record.profile_id)
    .single();
  if (profileError) {
    console.error("Échec lecture profiles.discord_user_id :", profileError);
  }
  if (!profile?.discord_user_id) {
    // Pas de Discord lié : rien à faire côté Discord, le jeu continue
    // normalement sans que ça bloque quoi que ce soit.
    return new Response("Pas de Discord lié", { status: 200 });
  }

  try {
    // A quitté une guilde (ou en a changé) : retire l'ancien rôle s'il y en
    // avait un, pour ne pas laisser un rôle périmé.
    if (oldRecord.guild_id) {
      const { data: oldGuild, error: oldGuildError } = await supabase
        .from("guilds")
        .select("discord_role_id")
        .eq("id", oldRecord.guild_id)
        .single();
      if (oldGuildError) {
        console.error("Échec lecture guilds.discord_role_id (ancienne guilde) :", oldGuildError);
      }
      if (oldGuild?.discord_role_id) {
        await removeRole(profile.discord_user_id, oldGuild.discord_role_id);
      }
    }

    // A rejoint une nouvelle guilde : donne le nouveau rôle.
    if (record.guild_id) {
      const { data: newGuild, error: newGuildError } = await supabase
        .from("guilds")
        .select("discord_role_id")
        .eq("id", record.guild_id)
        .single();
      if (newGuildError) {
        console.error("Échec lecture guilds.discord_role_id (nouvelle guilde) :", newGuildError);
      }
      if (newGuild?.discord_role_id) {
        await assignRole(profile.discord_user_id, newGuild.discord_role_id);
      }
      // Remarque (pas un bug) : pour le FONDATEUR d'une guilde toute
      // neuve, ce lookup peut légitimement trouver discord_role_id encore
      // vide — create_guild insère la guilde ET met à jour guild_id du
      // personnage dans la même transaction, alors que discord-on-guild-
      // created écrit discord_role_id de façon asynchrone (pg_net) juste
      // après. Sans conséquence : le fondateur reçoit déjà son rôle via
      // discord-on-guild-created directement (qui a le roleId en mémoire).
      // Ce lookup ici sert surtout pour ceux qui rejoignent PLUS TARD, une
      // fois que discord_role_id est déjà en base.
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(`Erreur Discord : ${err}`, { status: 200 });
  }
});
