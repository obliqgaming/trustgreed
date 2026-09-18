// Petites fonctions réutilisables pour parler à l'API Discord depuis les
// deux fonctions (création de guilde, rejoindre une guilde). Rien de
// spécifique au jeu ici — juste les appels REST Discord bruts.

const DISCORD_API = "https://discord.com/api/v10";
const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN")!;
const SERVER_ID = Deno.env.get("DISCORD_SERVER_ID")!;

function authHeaders() {
  return {
    Authorization: `Bot ${BOT_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function discordFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  // Discord renvoie parfois un corps vide (204) — safe-parse.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Trouve la catégorie "GUILDES" si elle existe déjà, sinon la crée.
// Idempotent : appelée à chaque nouvelle guilde, ne duplique jamais la
// catégorie une fois qu'elle existe.
export async function findOrCreateGuildsCategory(): Promise<string> {
  const channels = await discordFetch(`/guilds/${SERVER_ID}/channels`);
  const existing = (channels as any[]).find((c) => c.type === 4 && c.name === "GUILDES");
  if (existing) return existing.id;

  const created = await discordFetch(`/guilds/${SERVER_ID}/channels`, {
    method: "POST",
    body: JSON.stringify({ name: "GUILDES", type: 4 }),
  });
  return created.id;
}

// Un rôle par guilde, nommé d'après elle — sert à la fois à mentionner
// tout le monde d'un coup et à restreindre l'accès au salon.
export async function createGuildRole(guildName: string): Promise<string> {
  const role = await discordFetch(`/guilds/${SERVER_ID}/roles`, {
    method: "POST",
    body: JSON.stringify({ name: guildName, mentionable: true }),
  });
  return role.id;
}

// Salon texte dans la catégorie GUILDES, visible uniquement par le rôle de
// la guilde (et les rôles admin du serveur, qui voient tout par défaut
// sauf restriction explicite — on ne touche qu'à @everyone et au rôle créé).
export async function createGuildChannel(guildName: string, categoryId: string, roleId: string): Promise<string> {
  const channel = await discordFetch(`/guilds/${SERVER_ID}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: guildName,
      type: 0,
      parent_id: categoryId,
      permission_overwrites: [
        { id: SERVER_ID, type: 0, deny: "1024" }, // @everyone (l'ID du rôle @everyone = l'ID du serveur) : refuse VIEW_CHANNEL
        { id: roleId, type: 0, allow: "1024" },   // le rôle de la guilde : autorise VIEW_CHANNEL
      ],
    }),
  });
  return channel.id;
}

export async function assignRole(discordUserId: string, roleId: string) {
  await discordFetch(`/guilds/${SERVER_ID}/members/${discordUserId}/roles/${roleId}`, {
    method: "PUT",
  });
}

export async function removeRole(discordUserId: string, roleId: string) {
  await discordFetch(`/guilds/${SERVER_ID}/members/${discordUserId}/roles/${roleId}`, {
    method: "DELETE",
  });
}

export async function postMessage(channelId: string, content: string) {
  await discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function sendDM(discordUserId: string, content: string) {
  const dmChannel = await discordFetch(`/users/@me/channels`, {
    method: "POST",
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  await postMessage(dmChannel.id, content);
}
