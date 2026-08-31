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
      <div className={`absolute overflow-auto flex items-center justify-center ${contentClassName}`} style={{ inset: cfg.inset }}>
        {children}
      </div>
    </div>
  );
}

const MEMBER_CARD_RATIO = 1685 / 666;
// Zones mesurées sur l'asset card_member.png (top right bottom left en %)
const MEMBER_PORTRAIT_BOX = { top: "18%", left: "13%", width: "22%", height: "63%" };
const MEMBER_TEXT_INSET = "18% 6% 20% 34%";

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
      <div className="absolute overflow-auto flex flex-col justify-center" style={{ inset: MEMBER_TEXT_INSET }}>
        {children}
      </div>
    </div>
  );
}
