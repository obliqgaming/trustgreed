// Utilitaire de notifications navigateur
// À importer dans index.tsx pour notifier les membres de la guilde

export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function notifyExpeditionOpen(guildName: string, participantCount: number, expeditionId: string) {
  if (Notification.permission !== "granted") return;
  const n = new Notification(`${guildName} — Salle d'attente ouverte`, {
    body: `${participantCount} participant${participantCount > 1 ? "s" : ""} en attente. Rejoins l'expédition.`,
    icon: "/favicon.ico",
    tag: `expedition_${expeditionId}`, // évite les doublons
  });
  n.onclick = () => {
    window.focus();
    window.location.href = "/expedition";
  };
}

export function notifyExpeditionStarted(guildName: string, expeditionId: string) {
  if (Notification.permission !== "granted") return;
  const n = new Notification(`${guildName} — L'expédition commence`, {
    body: "Le groupe est parti. Rejoins-les maintenant.",
    icon: "/favicon.ico",
    tag: `expedition_start_${expeditionId}`,
  });
  n.onclick = () => {
    window.focus();
    window.location.href = `/vote?expedition=${expeditionId}`;
  };
}
