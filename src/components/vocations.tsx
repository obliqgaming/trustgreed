export type VocationId = "Eclaireur" | "Tresorier" | "Miracule" | "Pingre" | "Martyr" | "Inquisiteur";

export const VOCATIONS: { id: VocationId; label: string; description: string }[] = [
  { id: "Eclaireur", label: "Éclaireur", description: "Voit en permanence, et pour lui seul, le pourcentage de risque exact de l'étape en cours." },
  { id: "Tresorier", label: "Trésorier", description: "Une fois par expédition, met 30% du butin accumulé à l'abri d'un anéantissement total — guilde et part personnelle de chacun." },
  { id: "Miracule", label: "Miraculé", description: "Une fois par expédition, peut miser son miracle sur l'étape en cours : s'il devait mourir à cette résolution, il survit à 1 PV." },
  { id: "Pingre", label: "Opportuniste", description: "Une fois par expédition, augmente publiquement le butin de l'étape de 50% — en échange, reçoit le plus gros paquet de dégâts si l'étape échoue." },
  { id: "Martyr", label: "Martyr", description: "Désigne quelqu'un à chaque étape : si cette personne devait recevoir un coup mortel, le Martyr le prend à sa place. Redésignable gratuitement tant que ça ne s'est jamais déclenché." },
  { id: "Inquisiteur", label: "Inquisiteur", description: "Une fois par expédition, désigne un joueur pour l'étape : à la résolution, voit son vote réel, qui il a tenté de pousser devant, s'il a tenté un larcin, et s'il a utilisé une capacité secrète." },
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

export function VocationPicker({ value, onChange, title = "Vocation (choix définitif)" }: { value: VocationId | null; onChange: (id: VocationId) => void; title?: string }) {
  return (
    <div>
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">{title}</p>
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
