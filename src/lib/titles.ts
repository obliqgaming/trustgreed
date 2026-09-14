// Titres de personnage par niveau — paliers volontairement exponentiels :
// les premiers tombent vite, les derniers demandent une vraie ancienneté.
// Seuils ajustables ; le principe (écarts croissants) est ce qui compte.

export const TITLE_TIERS: { title: string; minLevel: number }[] = [
  { title: "Chétif", minLevel: 1 },
  { title: "Frêle", minLevel: 3 },
  { title: "Juvénile", minLevel: 6 },
  { title: "Apte", minLevel: 10 },
  { title: "Adapté", minLevel: 16 },
  { title: "Aguerri", minLevel: 24 },
  { title: "Endurci", minLevel: 34 },
  { title: "Solide", minLevel: 46 },
  { title: "Tenace", minLevel: 60 },
  { title: "Sauvage", minLevel: 76 },
  { title: "Dominant", minLevel: 94 },
  { title: "Increvable", minLevel: 114 },
  { title: "Primordial", minLevel: 136 },
  { title: "Ancestral", minLevel: 160 },
  { title: "Légende", minLevel: 200 },
];

export function getTitleForLevel(level: number): string {
  let current = TITLE_TIERS[0]!.title;
  for (const tier of TITLE_TIERS) {
    if (level >= tier.minLevel) current = tier.title;
    else break;
  }
  return current;
}

export function getTitleProgress(level: number): number {
  let floor = TITLE_TIERS[0]!.minLevel;
  let ceiling: number | null = null;
  for (const tier of TITLE_TIERS) {
    if (level >= tier.minLevel) floor = tier.minLevel;
    else { ceiling = tier.minLevel; break; }
  }
  if (ceiling === null) return 1; // déjà Légende
  return Math.min(1, Math.max(0, (level - floor) / (ceiling - floor)));
}

export function getNextTitleThreshold(level: number): number | null {
  for (const tier of TITLE_TIERS) {
    if (level < tier.minLevel) return tier.minLevel;
  }
  return null; // déjà Légende, rien au-delà
}

// PV max par titre — même principe que TITLE_TIERS : montée rapide au
// début (Frêle, déjà +2), puis régulière jusqu'à 50 à Légende. Reflète
// exactement title_max_hp() côté SQL, pour un affichage sans aller-retour.
export function getMaxHp(level: number): number {
  if (level >= 200) return 50;
  if (level >= 160) return 48;
  if (level >= 136) return 45;
  if (level >= 114) return 42;
  if (level >= 94) return 39;
  if (level >= 76) return 36;
  if (level >= 60) return 33;
  if (level >= 46) return 30;
  if (level >= 34) return 27;
  if (level >= 24) return 24;
  if (level >= 16) return 21;
  if (level >= 10) return 18;
  if (level >= 6) return 15;
  if (level >= 3) return 12;
  return 10;
}
