import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerCard, LedgerPage, TextLink } from "@/components/ledger";

export const Route = createFileRoute("/profil")({
  ssr: false,
  component: ProfilPage,
});

type CharacterRecord = {
  id: string; name: string; level: number; xp: number;
  is_alive: boolean; died_at: string | null;
  guild: { name: string } | null;
};

function ProfilPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate({ to: "/" }); return; }

      const { data: profile } = await supabase
        .from("profiles").select("username").eq("id", session.user.id).maybeSingle();
      setUsername(profile?.username ?? null);

      const { data: chars } = await supabase
        .from("characters")
        .select("id, name, level, xp, is_alive, died_at, guild:guilds(name)")
        .eq("profile_id", session.user.id)
        .order("created_at", { ascending: false });
      setCharacters((chars as any) ?? []);
      setReady(true);
    })();
  }, [navigate]);

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Chargement…</p></LedgerPage>;

  const alive = characters.filter(c => c.is_alive);
  const dead = characters.filter(c => !c.is_alive);

  return (
    <LedgerPage>
      <LedgerCard title={username ?? "Profil"} subtitle={`${characters.length} personnage${characters.length > 1 ? "s" : ""} au total`}>

        {alive.length > 0 && (
          <div className="mb-6">
            <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Personnage actif</p>
            {alive.map(c => (
              <div key={c.id} className="border border-primary/40 px-4 py-3 bg-primary/5">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-serif text-lg tracking-[0.1em] text-primary uppercase">{c.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(c.guild as any)?.name ?? "Sans guilde"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-lg text-primary">niv. {c.level}</p>
                    <p className="font-mono text-xs text-muted-foreground">{c.xp} XP</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {dead.length > 0 && (
          <div>
            <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">
              Mémorial — {dead.length} mort{dead.length > 1 ? "s" : ""}
            </p>
            <ul className="space-y-1.5">
              {dead.map(c => (
                <li key={c.id} className="border border-border/20 px-4 py-2.5 opacity-60">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-serif text-sm tracking-[0.08em] text-foreground line-through">
                        {c.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(c.guild as any)?.name ?? "Sans guilde"}
                        {c.died_at && (
                          <span> · mort le {new Date(c.died_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                        )}
                      </p>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">niv. {c.level}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {characters.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Aucun personnage encore créé.</p>
        )}

        <div className="mt-6 border-t border-border/20 pt-4 space-y-1">
          <TextLink onClick={() => navigate({ to: "/" })}>Retour à la guilde</TextLink>
        </div>
      </LedgerCard>
    </LedgerPage>
  );
}
