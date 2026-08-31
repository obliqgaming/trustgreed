export type VocationId = "Eclaireur" | "Tresorier" | "Miracule" | "Pingre" | "Martyr" | "Traitre" | "Inquisiteur";

export const VOCATIONS: { id: VocationId; label: string; description: string }[] = [
  { id: "Eclaireur", label: "Éclaireur", description: "Peut révéler à tout le groupe le vrai risque de mort de l'étape en cours (1×/expédition)." },
  { id: "Tresorier", label: "Trésorier", description: "Réduit la ponction sur le trésor commun en cas de mort pendant l'expédition." },
  { id: "Miracule", label: "Miraculé", description: "Échappe automatiquement au tirage au sort des morts, une seule fois dans sa vie." },
  { id: "Pingre", label: "Pingre", description: "Augmente le butin de l'expédition, mais s'expose davantage lui-même au tirage des morts." },
  { id: "Martyr", label: "Martyr", description: "Peut garantir être le premier tiré au sort en cas de mort à l'étape en cours (1×/expédition)." },
  { id: "Traitre", label: "Traître", description: "Peut mentir sur sa vocation déclarée, et manigancer une mise trafiquée : plus de butin, mais plus de risque pour tout le groupe (1×/expédition)." },
  { id: "Inquisiteur", label: "Inquisiteur", description: "Peut vérifier en privé si la vocation déclarée d'un personnage est authentique." },
];

export function vocationLabel(id: string | null | undefined): string {
  return VOCATIONS.find(v => v.id === id)?.label ?? "—";
}

export function VocationBadge({ vocationId, className = "" }: { vocationId: string | null | undefined; className?: string }) {
  if (!vocationId) return null;
  return (
    <span className={`text-[10px] tracking-[0.08em] uppercase border border-border/40 text-muted-foreground px-1.5 py-0.5 rounded-sm ${className}`}>
      {vocationLabel(vocationId)}
    </span>
  );
}

export function VocationPicker({ value, onChange }: { value: VocationId | null; onChange: (id: VocationId) => void }) {
  return (
    <div>
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Vocation (choix définitif)</p>
      <div className="space-y-2">
        {VOCATIONS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onChange(v.id)}
            className={`w-full text-left border px-3 py-2 transition-colors ${value === v.id ? "border-primary/60 bg-primary/5" : "border-border/30 hover:border-border/60"}`}
          >
            <p className={`text-sm font-serif tracking-[0.08em] ${value === v.id ? "text-primary" : "text-foreground"}`}>{v.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{v.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
