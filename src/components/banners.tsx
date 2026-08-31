export const BANNER_SYMBOLS = ["⚔", "🛡", "🏴", "☠", "🐺", "🦅", "🔥", "⚓"];
export const BANNER_COLORS = ["#c9a24b", "#b0413e", "#4a7c6f", "#6b5b95", "#8a8a8a", "#3f5d7d"];

export function GuildBanner({ symbol, color, size = 28 }: { symbol?: string | null; color?: string | null; size?: number }) {
  if (!symbol) return null;
  return (
    <span
      style={{
        width: size, height: size, color: color ?? "#c9a24b",
        borderColor: color ?? "#c9a24b",
        fontSize: size * 0.55,
      }}
      className="inline-flex items-center justify-center rounded-full border shrink-0"
    >
      {symbol}
    </span>
  );
}

export function BannerPicker({
  symbol, color, onChangeSymbol, onChangeColor,
}: { symbol: string | null; color: string | null; onChangeSymbol: (s: string) => void; onChangeColor: (c: string) => void }) {
  return (
    <div>
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Symbole</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {BANNER_SYMBOLS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChangeSymbol(s)}
            style={{ borderColor: symbol === s ? (color ?? "#c9a24b") : undefined, color: symbol === s ? (color ?? "#c9a24b") : undefined }}
            className={`w-10 h-10 flex items-center justify-center rounded-full border text-lg ${symbol === s ? "" : "border-border/30 text-muted-foreground hover:border-border/60"}`}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Couleur</p>
      <div className="flex flex-wrap gap-2">
        {BANNER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChangeColor(c)}
            style={{ backgroundColor: c, outline: color === c ? `2px solid ${c}` : undefined, outlineOffset: 2 }}
            className="w-8 h-8 rounded-full border border-black/20"
          />
        ))}
      </div>
    </div>
  );
}
