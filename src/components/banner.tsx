// Composant bannière de guilde — fond coloré + symbole SVG colorable
// À placer dans src/components/banner.tsx

export const SYMBOLS: { id: string; label: string; path: string }[] = [
  { id: "shield", label: "Bouclier", path: "M50 10 L80 25 L80 55 Q80 75 50 88 Q20 75 20 55 L20 25 Z" },
  { id: "sword", label: "Épée", path: "M50 8 L56 44 L62 80 L50 90 L38 80 L44 44 Z M35 35 L65 35" },
  { id: "skull", label: "Crâne", path: "M50 20 Q30 20 30 40 Q30 55 38 60 L38 70 L62 70 L62 60 Q70 55 70 40 Q70 20 50 20 Z M42 42 Q42 47 45 47 Q48 47 48 42 Q48 37 45 37 Q42 37 42 42 Z M52 42 Q52 47 55 47 Q58 47 58 42 Q58 37 55 37 Q52 37 52 42 Z M44 62 L44 70 M50 60 L50 70 M56 62 L56 70" },
  { id: "crown", label: "Couronne", path: "M20 65 L20 45 L35 55 L50 30 L65 55 L80 45 L80 65 Z" },
  { id: "eye", label: "Œil", path: "M50 35 Q70 35 80 50 Q70 65 50 65 Q30 65 20 50 Q30 35 50 35 Z M50 42 Q56 42 56 50 Q56 58 50 58 Q44 58 44 50 Q44 42 50 42 Z" },
  { id: "flame", label: "Flamme", path: "M50 85 Q30 70 30 50 Q30 35 45 25 Q40 40 50 38 Q45 28 55 15 Q65 30 65 45 Q72 35 68 25 Q80 38 70 58 Q65 72 50 85 Z" },
  { id: "wolf", label: "Loup", path: "M25 60 L35 40 L30 25 L42 35 L50 20 L58 35 L70 25 L65 40 L75 60 L60 55 Q55 70 50 72 Q45 70 40 55 Z" },
  { id: "serpent", label: "Serpent", path: "M30 70 Q20 50 35 35 Q50 20 65 35 Q80 50 65 60 Q55 65 50 55 Q45 48 55 42 Q62 38 58 50" },
  { id: "tower", label: "Tour", path: "M35 80 L35 30 L40 30 L40 20 L45 20 L45 15 L50 10 L55 15 L55 20 L60 20 L60 30 L65 30 L65 80 Z M44 80 L44 55 L56 55 L56 80" },
  { id: "star", label: "Étoile", path: "M50 12 L57 35 L82 35 L62 50 L69 73 L50 58 L31 73 L38 50 L18 35 L43 35 Z" },
  { id: "moon", label: "Lune", path: "M60 20 Q35 25 35 50 Q35 75 60 80 Q40 78 33 62 Q25 45 33 30 Q40 18 60 20 Z" },
  { id: "anchor", label: "Ancre", path: "M50 20 Q40 20 40 28 Q40 36 50 36 Q60 36 60 28 Q60 20 50 20 Z M50 36 L50 75 M35 55 Q28 60 30 70 Q35 80 50 75 M65 55 Q72 60 70 70 Q65 80 50 75 M38 36 L62 36" },
];

const BG_COLORS = [
  { id: "#1a1915", label: "Encre" },
  { id: "#1a1525", label: "Nuit" },
  { id: "#1a1515", label: "Sang sombre" },
  { id: "#151a15", label: "Forêt" },
  { id: "#151515", label: "Ardoise" },
  { id: "#1a1a10", label: "Bronze sombre" },
];

const SYMBOL_COLORS = [
  { id: "#B8944D", label: "Or terni" },
  { id: "#C0C0C0", label: "Argent" },
  { id: "#EDE9E0", label: "Ivoire" },
  { id: "#7A2E2E", label: "Cramoisi" },
  { id: "#2E5E7A", label: "Saphir" },
  { id: "#4A7A2E", label: "Jade" },
];

export function GuildBanner({
  symbol = "shield",
  symbolColor = "#B8944D",
  bgColor = "#1a1915",
  size = 80,
}: {
  symbol?: string;
  symbolColor?: string;
  bgColor?: string;
  size?: number;
}) {
  const sym = SYMBOLS.find(s => s.id === symbol) ?? SYMBOLS[0];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"
      style={{ borderRadius: 2, border: "1px solid rgba(184,148,77,0.3)" }}>
      <rect width="100" height="100" fill={bgColor} />
      <path d={sym?.path ?? ""} fill={symbolColor} fillRule="evenodd" opacity="0.9" />
    </svg>
  );
}

export function BannerPicker({
  symbol, symbolColor, bgColor,
  onChange,
}: {
  symbol: string; symbolColor: string; bgColor: string;
  onChange: (s: string, sc: string, bg: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Aperçu */}
      <div className="flex items-center gap-4">
        <GuildBanner symbol={symbol} symbolColor={symbolColor} bgColor={bgColor} size={72} />
        <div>
          <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground">Aperçu</p>
          <p className="text-xs text-muted-foreground/60 mt-1">La bannière de ta guilde.</p>
        </div>
      </div>

      {/* Fond */}
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Fond</p>
        <div className="flex gap-2 flex-wrap">
          {BG_COLORS.map(c => (
            <button key={c.id} onClick={() => onChange(symbol, symbolColor, c.id)}
              title={c.label}
              className={`w-8 h-8 rounded-sm border-2 transition-all ${bgColor === c.id ? "border-primary" : "border-transparent"}`}
              style={{ backgroundColor: c.id }} />
          ))}
        </div>
      </div>

      {/* Couleur du symbole */}
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Couleur du symbole</p>
        <div className="flex gap-2 flex-wrap">
          {SYMBOL_COLORS.map(c => (
            <button key={c.id} onClick={() => onChange(symbol, c.id, bgColor)}
              title={c.label}
              className={`w-8 h-8 rounded-sm border-2 transition-all ${symbolColor === c.id ? "border-primary" : "border-transparent"}`}
              style={{ backgroundColor: c.id }} />
          ))}
        </div>
      </div>

      {/* Symbole */}
      <div>
        <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Symbole</p>
        <div className="grid grid-cols-6 gap-2">
          {SYMBOLS.map(s => (
            <button key={s.id} onClick={() => onChange(s.id, symbolColor, bgColor)}
              className={`p-1 border rounded-sm transition-colors ${symbol === s.id ? "border-primary/60 bg-primary/5" : "border-border/30 hover:border-border/60"}`}>
              <svg width="32" height="32" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <rect width="100" height="100" fill={bgColor} />
                <path d={s.path} fill={symbolColor} fillRule="evenodd" opacity="0.9" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
