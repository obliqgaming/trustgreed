import type { ReactNode } from "react";

// Cadres décoratifs étirables — barre2.webp à barre5.webp (panneaux
// rectangulaires, avec de la hauteur pour du texte). barre1.webp est un
// filet fin avec des losanges aux extrémités, pas un cadre de contenu —
// volontairement exclu ici, à réserver plus tard pour un usage de
// séparateur horizontal, pas une boîte à étirer.
// Fond étiré pour remplir la boîte (pas de découpe en 9 morceaux, on n'a
// pas les mesures précises des bordures). Couleur de texte adaptée à
// chaque cadre : barre2 a un remplissage clair (parchemin), barre3/4/5 ont
// un remplissage sombre — vérifié sur les images réelles, pas deviné.
const FRAME_IS_LIGHT: Record<number, boolean> = { 2: true, 3: false, 4: false, 5: false };
export function FramedBox({ frame, children, className = "" }: { frame: 2 | 3 | 4 | 5; children: ReactNode; className?: string }) {
  const isLight = FRAME_IS_LIGHT[frame];
  return (
    <div
      className={`relative ${className}`}
      style={{
        backgroundImage: `url(/barre${frame}.webp)`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div
        className="relative"
        style={{
          color: isLight ? "#241a0d" : "#f2e4c8",
          textShadow: isLight ? "0 1px 2px rgba(255,255,255,0.5)" : "0 1px 3px rgba(0,0,0,0.9)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Boutons immersifs — deux ambiances opposées à dessein : "sombre" pour une
// action de repli/renoncement, "clair" pour une action qui donne envie
// d'avancer. Ne pas neutraliser cette opposition en les traitant pareil.
export function ImmersiveButton({
  variant, onClick, disabled, children, className = "",
}: {
  variant: "sombre" | "clair";
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const isSombre = variant === "sombre";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative py-4 font-serif tracking-[0.14em] uppercase whitespace-nowrap inline-flex items-center justify-center transition-opacity disabled:opacity-30 hover:opacity-90 ${className}`}
      style={{
        backgroundImage: `url(/boutonimmersif${isSombre ? "" : "2"}.webp)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        color: isSombre ? "#e8dcc0" : "#1a140a",
        textShadow: isSombre ? "0 1px 3px rgba(0,0,0,0.9)" : "0 1px 2px rgba(255,255,255,0.4)",
      }}
    >
      {children}
    </button>
  );
}
