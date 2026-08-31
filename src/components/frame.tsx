import type { ReactNode, CSSProperties } from "react";

export type FrameVariant = "journal" | "bar";

/**
 * Configuration par variante : chemin de l'image, ratio largeur/hauteur natif,
 * et zone de contenu en % (top right bottom left, comme le CSS `inset`).
 * Pour ajouter un futur gabarit (bloc stat, bouton, champ de saisie une fois
 * générés) : déposer l'image dans /public/frames/ et ajouter une entrée ici,
 * rien d'autre à changer dans l'app.
 */
const FRAME_CONFIG: Record<FrameVariant, { src: string; ratio: number; inset: string }> = {
  journal: { src: "/frames/panel_journal.png", ratio: 1287 / 1222, inset: "10% 12% 11% 14%" },
  bar: { src: "/frames/bar_header.png", ratio: 1684 / 767, inset: "28% 8% 35% 8%" },
};

export function Frame({
  variant,
  children,
  className = "",
  contentClassName = "",
}: {
  variant: FrameVariant;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const cfg = FRAME_CONFIG[variant];
  const wrapperStyle: CSSProperties = { aspectRatio: String(cfg.ratio) };

  return (
    <div className={`relative w-full ${className}`} style={wrapperStyle}>
      <img src={cfg.src} alt="" aria-hidden className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none" />
      <div
        className={`absolute overflow-auto flex items-center justify-center text-[#f2e4c8] [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] ${contentClassName}`}
        style={{ inset: cfg.inset }}
      >
        {children}
      </div>
    </div>
  );
}

const MEMBER_CARD_RATIO = 1805 / 871;
// Zone mesurée précisément (composantes connexes, pixel-perfect) sur card_member.png
const MEMBER_PORTRAIT_BOX = { top: "33%", left: "16%", width: "20%", height: "39%" };
const MEMBER_TEXT_INSET = "20% 6% 20% 40%";

/** Carte de membre avec fente portrait dédiée + zone de texte (nom, niveau, vocation). */
export function MemberFrame({
  portrait,
  children,
  className = "",
}: {
  portrait: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative w-full ${className}`} style={{ aspectRatio: String(MEMBER_CARD_RATIO) }}>
      <img src="/frames/card_member.png" alt="" aria-hidden className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none" />
      <div className="absolute overflow-hidden rounded-sm" style={MEMBER_PORTRAIT_BOX}>
        {portrait}
      </div>
      <div
        className="absolute overflow-auto flex flex-col justify-center text-[#f2e4c8] [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]"
        style={{ inset: MEMBER_TEXT_INSET }}
      >
        {children}
      </div>
    </div>
  );
}

const BORDER_CONFIG = {
  wide: "/frames/border_wide.png",
  square: "/frames/border_square.png",
} as const;

/**
 * Bordure ornée superposée sur un contenu existant, sans imposer de fond ni de
 * ratio — s'applique par-dessus n'importe quelle boîte déjà stylée (fond,
 * flou, padding gérés par l'appelant). Le parent doit être `position: relative`.
 * Usage : enrober une carte, une liste, un panneau, etc. sans reconstruire sa
 * mise en page.
 */
export function DecorativeBorder({ variant = "wide", className = "" }: { variant?: keyof typeof BORDER_CONFIG; className?: string }) {
  return (
    <img
      src={BORDER_CONFIG[variant]}
      alt=""
      aria-hidden
      className={`absolute inset-0 w-full h-full object-fill pointer-events-none select-none ${className}`}
    />
  );
}
