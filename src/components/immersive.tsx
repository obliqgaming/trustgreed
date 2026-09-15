import type { ReactNode } from "react";

// Cadres décoratifs étirables — barre2.webp à barre5.webp (panneaux
// rectangulaires, avec de la hauteur pour du texte). barre1.webp est un
// filet fin avec des losanges aux extrémités, pas un cadre de contenu —
// volontairement exclu ici, à réserver plus tard pour un usage de
// séparateur horizontal, pas une boîte à étirer.
// Rendu en `border-image` (9-slice) comme DecorativeBorder : les coins
// arrondis gardent leur forme réelle quelle que soit la hauteur de la
// boîte encadrée, seuls les bords se répètent. `slice` mesuré sur chaque
// fichier (rayon du coin + épaisseur du bord), pas deviné. Couleur de
// texte adaptée à chaque cadre : barre2 a un remplissage clair
// (parchemin), barre3/4/5 ont un remplissage sombre — vérifié sur les
// images réelles.
const FRAME_IS_LIGHT: Record<number, boolean> = { 2: true, 3: false, 4: false, 5: false };
// `slice` = dimensions réelles dans le fichier source (où couper les coins),
// mesuré sur chaque image, ne change jamais avec la taille de la carte.
// `displayWidth` = épaisseur affichée à l'écran (fine, façon liseré autour
// du texte) — le navigateur redimensionne les coins découpés du fichier
// source pour rentrer dans cette épaisseur. Les confondre (même valeur pour
// les deux) affiche le cadre à l'échelle 1:1 du fichier source, énorme et
// disproportionné sur une carte compacte — c'est le bug qu'on corrige ici.
const FRAME_SLICE: Record<number, number> = { 2: 50, 3: 50, 4: 50, 5: 50 };
const FRAME_DISPLAY_WIDTH = 12;
export function FramedBox({ frame, children, className = "" }: { frame: 2 | 3 | 4 | 5; children: ReactNode; className?: string }) {
  const isLight = FRAME_IS_LIGHT[frame];
  const slice = FRAME_SLICE[frame];
  return (
    <div
      className={`relative ${className}`}
      style={{
        borderStyle: "solid",
        borderWidth: `${FRAME_DISPLAY_WIDTH}px`,
        borderImageSource: `url(/barre${frame}.webp)`,
        borderImageSlice: `${slice} fill`,
        borderImageWidth: `${FRAME_DISPLAY_WIDTH}px`,
        borderImageRepeat: "round",
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
