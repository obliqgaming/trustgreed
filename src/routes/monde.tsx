import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerPage } from "@/components/ledger";

export const Route = createFileRoute("/monde")({
  ssr: false,
  component: MondePage,
});

type Event = {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
  guild: { name: string };
};

const EVENT_ICON: Record<string, string> = {
  member_died: "✝",
  expedition_completed: "⚔",
  member_joined: "→",
  member_left: "←",
  guild_founded: "⊕",
  wealth_lost: "↓",
};

const EVENT_COLOR: Record<string, string> = {
  member_died: "text-red-400/80",
  expedition_completed: "text-primary",
  member_joined: "text-emerald-400/70",
  member_left: "text-muted-foreground",
  guild_founded: "text-primary/70",
  wealth_lost: "text-amber-400/70",
};

function MondePage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [ready, setReady] = useState(false);

  const loadEvents = async () => {
    const { data } = await supabase
      .from("guild_history_events")
      .select("id, event_type, description, created_at, guild:guilds(name)")
      .order("created_at", { ascending: false })
      .limit(50);
    setEvents((data as any) ?? []);
  };

  useEffect(() => {
    void (async () => {
      await loadEvents();
      setReady(true);

      const channel = supabase.channel("monde_events")
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "guild_history_events",
        }, async () => { await loadEvents(); })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    })();
  }, []);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) +
      " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Lecture du registre…</p></LedgerPage>;

  return (
    <LedgerPage>
      <div className="w-full max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-2xl tracking-[0.16em] uppercase text-primary">Le Monde</h1>
            <p className="text-xs text-muted-foreground mt-1">Ce que le registre a retenu.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate({ to: "/carte" })}
              className="text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors">
              Carte
            </button>
            <button onClick={() => navigate({ to: "/" })}
              className="text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors">
              Accueil
            </button>
          </div>
        </div>

        {events.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm">Le registre est vide. Rien ne s'est encore passé.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-3 border border-border/20 hover:border-border/40 transition-colors">
                <span className={`text-base w-4 flex-shrink-0 ${EVENT_COLOR[e.event_type] ?? "text-muted-foreground"}`}>
                  {EVENT_ICON[e.event_type] ?? "·"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug">{e.description}</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    <span className="text-primary/60">{(e.guild as any)?.name ?? "?"}</span>
                    <span className="mx-1">·</span>
                    {fmt(e.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 border-t border-border/20 pt-6 text-center">
          <button onClick={() => navigate({ to: "/" })}
            className="text-xs tracking-[0.16em] uppercase border border-primary/40 text-primary px-6 py-2.5 hover:bg-primary/10 transition-colors">
            Rejoindre le monde
          </button>
        </div>
      </div>
    </LedgerPage>
  );
}
