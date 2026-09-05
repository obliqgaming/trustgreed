export const PORTRAITS: { id: string; label: string; src: string; premium?: boolean }[] = [
  { id: "archer",     label: "L'Archer",    src: "/portrait_archer.png" },
  { id: "masque",     label: "Le Masque",   src: "/portrait_masque.png" },
  { id: "viking",     label: "Le Viking",   src: "/portrait_viking.png" },
  { id: "mage",       label: "Le Mage",     src: "/portrait_mage.png" },
  { id: "capuche",    label: "La Capuche",  src: "/portrait_capuche.png" },
  { id: "chevalier",  label: "Le Chevalier",src: "/portrait_chevalier.webp" },
  // Portraits premium — débloqués via la boutique (rayon Apparence), pas encore
  // vendables tant que l'or personnel n'existe pas. En attendant, ils
  // n'apparaissent simplement pas dans PortraitPicker (voir filtre plus bas).
  { id: "archer_nocturne",   label: "L'Archer Nocturne",   src: "/portrait_archer_nocturne.webp",   premium: true },
  { id: "peste_lanterne",    label: "Le Porte-Lanterne",   src: "/portrait_peste_lanterne.webp",    premium: true },
  { id: "seigneur_cornu",    label: "Le Seigneur Cornu",   src: "/portrait_seigneur_cornu.webp",    premium: true },
  { id: "sorciere_pic",      label: "La Sorcière du Pic",  src: "/portrait_sorciere_pic.webp",      premium: true },
  { id: "assassin_capuche",  label: "L'Assassin",          src: "/portrait_assassin_capuche.webp",  premium: true },
  { id: "chevalier_radiant", label: "Le Chevalier Radiant",src: "/portrait_chevalier_radiant.webp", premium: true },
];

export function PortraitDisplay({ portraitId, size = 64 }: { portraitId: string; size?: number }) {
  const portrait = PORTRAITS.find(p => p.id === portraitId) ?? PORTRAITS[4]; // capuche par défaut
  return (
    <div style={{ width: size, height: size }}
      className="rounded-sm border border-border/40 overflow-hidden flex-shrink-0 bg-black">
      <img
        src={portrait?.src ?? ""}
        alt={portrait?.label ?? ""}
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
      />
    </div>
  );
}

export function PortraitPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const available = PORTRAITS.filter(p => !p.premium); // les premium arrivent avec la boutique
  return (
    <div>
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-3">Portrait</p>
      <div className="grid grid-cols-3 gap-2">
        {available.map(p => (
          <button key={p.id} onClick={() => onChange(p.id)}
            className={`border rounded-sm overflow-hidden transition-colors ${value === p.id ? "border-primary/60" : "border-border/30 hover:border-border/60"}`}>
            <img src={p.src} alt={p.label}
              className="w-full aspect-square object-cover object-top" />
          </button>
        ))}
      </div>
    </div>
  );
}
