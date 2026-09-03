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

export function getNextTitleThreshold(level: number): number | null {
  for (const tier of TITLE_TIERS) {
    if (level < tier.minLevel) return tier.minLevel;
  }
  return null; // déjà Légende, rien au-delà
}
