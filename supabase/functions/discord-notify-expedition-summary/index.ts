// Déclenchée par un trigger Postgres sur UPDATE dans `expeditions`, quand
// le statut passe à 'completed' (couvre les deux façons dont ça arrive :
// retour volontaire dans begin_resolution, ou anéantissement total dans
// finalize_resolution — un seul trigger sur la table couvre les deux).
//
// Poste le résumé dans le SALON DE GUILDE (pas un DM) : étape atteinte,
// or récolté, qui est mort, qui a volé / qui s'est fait prendre en larcin
// (larceny_attempts : character_id, succeeded, amount — structure confirmée
// le 19/09, complétée après coup).
//
// Chaque lecture vérifie son erreur et la trace : après le bug du 18/09
// (une erreur d'écriture avalée en silence a fait échouer l'attribution
// de rôle Discord pendant des heures sans qu'on le voie), plus aucune
// requête de ce fichier n'ignore silencieusement un échec.
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

  const { data: guild, error: guildError } = await supabase
    .from("guilds")
    .select("discord_channel_id")
    .eq("id", expedition.guild_id)
    .single();
  if (guildError) {
    console.error("Échec lecture guilds.discord_channel_id :", guildError);
  }
  if (!guild?.discord_channel_id) {
    // Guilde sans salon Discord (pas encore créé, ou lié à un serveur
    // Discord différent) : rien à faire, on ne bloque rien côté jeu.
    return new Response("Pas de salon Discord pour cette guilde", { status: 200 });
  }

  const { data: steps, error: stepsError } = await supabase
    .from("expedition_steps")
    .select("step_number")
    .eq("expedition_id", expedition.id)
    .order("step_number", { ascending: false })
    .limit(1);
  if (stepsError) {
    console.error("Échec lecture expedition_steps.step_number :", stepsError);
  }
  const lastStep = steps?.[0]?.step_number ?? "?";

  const { data: deadCharacters, error: deadError } = await supabase
    .from("characters")
    .select("name")
    .eq("died_in_expedition_id", expedition.id)
    .eq("is_alive", false);
  if (deadError) {
    console.error("Échec lecture characters (morts) :", deadError);
  }

  const lootFinal = expedition.total_loot_kept ?? expedition.total_loot_earned ?? 0;

  let message = `📜 **Expédition terminée** — arrivée jusqu'à l'étape ${lastStep}. Butin final : **${Math.round(lootFinal)} or**.`;
  if (deadCharacters && deadCharacters.length > 0) {
    const names = deadCharacters.map((c: any) => c.name).join(", ");
    message += `\n💀 Ont péri durant l'expédition : ${names}.`;
  } else if (!deadError) {
    message += `\n✅ Personne n'est mort — belle expédition !`;
  }

  // Larcins : requête séparée puis jointure faite ici en JS, même principe
  // que pour les morts ci-dessus — pas d'embed PostgREST imbriqué.
  // IMPORTANT : on ne révèle JAMAIS un larcin réussi (succeeded = true) —
  // même dans le salon privé de la guilde. Un vol jamais découvert doit
  // rester secret pour toujours, c'est le principe même du jeu ; l'annoncer
  // après coup, même en privé, casserait la mécanique de confiance. Seuls
  // les larcins RATÉS (pris en flagrant délit) sont mentionnés ici.
  const { data: caughtLarcenies, error: larcenyError } = await supabase
    .from("larceny_attempts")
    .select("character_id")
    .eq("expedition_id", expedition.id)
    .eq("succeeded", false);
  if (larcenyError) {
    console.error("Échec lecture larceny_attempts :", larcenyError);
  }

  if (caughtLarcenies && caughtLarcenies.length > 0) {
    const caughtCharacterIds = [...new Set(caughtLarcenies.map((l: any) => l.character_id))];
    const { data: caughtCharacters, error: caughtCharError } = await supabase
      .from("characters")
      .select("id, name")
      .in("id", caughtCharacterIds);
    if (caughtCharError) {
      console.error("Échec lecture characters (larcins) :", caughtCharError);
    }
    const nameById = new Map((caughtCharacters ?? []).map((c: any) => [c.id, c.name]));
    const names = caughtLarcenies.map((l: any) => nameById.get(l.character_id) ?? "?");
    message += `\n🚨 S'est fait prendre la main dans le sac : ${[...new Set(names)].join(", ")}.`;
  }

  await postMessage(guild.discord_channel_id, message);

  return new Response("OK", { status: 200 });
});
