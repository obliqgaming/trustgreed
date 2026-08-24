// Portraits SVG placeholder — à remplacer par les vraies illustrations
// Chaque portrait est une silhouette abstraite unique

export const PORTRAITS: { id: string; label: string; svg: string }[] = [
  {
    id: "ombre",
    label: "L'Ombre",
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#12110F"/>
      <ellipse cx="50" cy="35" rx="18" ry="20" fill="#2a2820"/>
      <ellipse cx="50" cy="35" rx="14" ry="16" fill="#1a1915"/>
      <path d="M25 100 Q30 60 50 55 Q70 60 75 100Z" fill="#2a2820"/>
      <ellipse cx="42" cy="32" rx="3" ry="4" fill="#B8944D" opacity="0.6"/>
      <ellipse cx="58" cy="32" rx="3" ry="4" fill="#B8944D" opacity="0.6"/>
    </svg>`
  },
  {
    id: "masque",
    label: "Le Masque",
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#12110F"/>
      <ellipse cx="50" cy="38" rx="20" ry="22" fill="#1e1c18"/>
      <rect x="30" y="30" width="40" height="28" rx="4" fill="#252318"/>
      <rect x="32" y="32" width="36" height="24" rx="3" fill="#1a1915"/>
      <line x1="35" y1="40" x2="45" y2="40" stroke="#B8944D" stroke-width="2" opacity="0.7"/>
      <line x1="55" y1="40" x2="65" y2="40" stroke="#B8944D" stroke-width="2" opacity="0.7"/>
      <path d="M43 50 Q50 54 57 50" stroke="#B8944D" stroke-width="1.5" fill="none" opacity="0.5"/>
      <path d="M25 100 Q30 62 50 58 Q70 62 75 100Z" fill="#1e1c18"/>
    </svg>`
  },
  {
    id: "capuche",
    label: "La Capuche",
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#12110F"/>
      <path d="M20 45 Q20 10 50 10 Q80 10 80 45 L78 55 Q65 50 50 50 Q35 50 22 55Z" fill="#1e1c18"/>
      <ellipse cx="50" cy="42" rx="16" ry="18" fill="#151412"/>
      <ellipse cx="44" cy="40" rx="3" ry="3.5" fill="#B8944D" opacity="0.5"/>
      <ellipse cx="56" cy="40" rx="3" ry="3.5" fill="#B8944D" opacity="0.5"/>
      <path d="M22 55 Q25 65 50 65 Q75 65 78 55 L80 100 L20 100Z" fill="#1e1c18"/>
    </svg>`
  },
  {
    id: "couronne",
    label: "La Couronne",
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#12110F"/>
      <path d="M30 30 L35 20 L50 28 L65 20 L70 30 L68 36 L32 36Z" fill="#B8944D" opacity="0.4"/>
      <ellipse cx="50" cy="48" rx="17" ry="18" fill="#1e1c18"/>
      <ellipse cx="43" cy="46" rx="3" ry="3.5" fill="#B8944D" opacity="0.6"/>
      <ellipse cx="57" cy="46" rx="3" ry="3.5" fill="#B8944D" opacity="0.6"/>
      <path d="M44 54 Q50 57 56 54" stroke="#B8944D" stroke-width="1.5" fill="none" opacity="0.4"/>
      <path d="M25 100 Q28 65 50 60 Q72 65 75 100Z" fill="#1e1c18"/>
    </svg>`
  },
  {
    id: "cicatrice",
    label: "La Cicatrice",
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#12110F"/>
      <ellipse cx="50" cy="38" rx="18" ry="20" fill="#1e1c18"/>
      <ellipse cx="43" cy="36" rx="3" ry="3.5" fill="#B8944D" opacity="0.6"/>
      <ellipse cx="57" cy="36" rx="3" ry="3.5" fill="#B8944D" opacity="0.6"/>
      <line x1="48" y1="28" x2="52" y2="50" stroke="#7A2E2E" stroke-width="1.5" opacity="0.8"/>
      <path d="M44 44 Q50 47 56 44" stroke="#B8944D" stroke-width="1.5" fill="none" opacity="0.4"/>
      <path d="M25 100 Q28 62 50 57 Q72 62 75 100Z" fill="#1e1c18"/>
    </svg>`
  },
  {
    id: "voile",
    label: "Le Voile",
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#12110F"/>
      <ellipse cx="50" cy="38" rx="18" ry="20" fill="#1e1c18"/>
      <rect x="32" y="40" width="36" height="3" rx="1" fill="#252318"/>
      <rect x="30" y="43" width="40" height="2" rx="1" fill="#1e1c18"/>
      <ellipse cx="43" cy="34" rx="3" ry="3.5" fill="#B8944D" opacity="0.7"/>
      <ellipse cx="57" cy="34" rx="3" ry="3.5" fill="#B8944D" opacity="0.7"/>
      <path d="M25 100 Q28 62 50 57 Q72 62 75 100Z" fill="#1e1c18"/>
      <path d="M32 43 Q40 55 50 58 Q60 55 68 43" stroke="#252318" stroke-width="4" fill="none"/>
    </svg>`
  },
];

export function PortraitDisplay({ portraitId, size = 64 }: { portraitId: string; size?: number }) {
  const portrait = PORTRAITS.find(p => p.id === portraitId) ?? PORTRAITS[0];
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-sm border border-border/40 overflow-hidden flex-shrink-0"
      dangerouslySetInnerHTML={{ __html: portrait.svg }}
    />
  );
}

export function PortraitPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div>
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-3">Portrait</p>
      <div className="grid grid-cols-3 gap-2">
        {PORTRAITS.map(p => (
          <button key={p.id} onClick={() => onChange(p.id)}
            className={`flex flex-col items-center p-2 border rounded-sm transition-colors ${value === p.id ? "border-primary/60 bg-primary/5" : "border-border/30 hover:border-border/60"}`}>
            <div className="w-16 h-16 rounded-sm overflow-hidden border border-border/20"
              dangerouslySetInnerHTML={{ __html: p.svg }} />
          </button>
        ))}
      </div>
    </div>
  );
}
