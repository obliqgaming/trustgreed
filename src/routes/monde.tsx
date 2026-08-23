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

type WorldStats = {
  guild_count: number;
  total_gold: number;
  total_deaths: number;
  total_expeditions: number;
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
  const [stats, setStats] = useState<WorldStats | null>(null);
  const [ready, setReady] = useState(false);

  const loadEvents = async () => {
    const { data } = await supabase
      .from("guild_history_events")
      .select("id, event_type, description, created_at, guild:guilds(name)")
      .order("created_at", { ascending: false })
      .limit(50);
    setEvents((data as any) ?? []);
  };

  const loadStats = async () => {
    const { count: guildCount } = await supabase
      .from("guilds").select("id", { count: "exact", head: true });

    const { data: goldData } = await supabase
      .from("guilds").select("gold");
    const totalGold = (goldData ?? []).reduce((sum, g) => sum + (g.gold ?? 0), 0);

    const { count: deathCount } = await supabase
      .from("guild_history_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "member_died");

    const { count: expCount } = await supabase
      .from("expeditions")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed");

    setStats({
      guild_count: guildCount ?? 0,
      total_gold: Math.round(totalGold),
      total_deaths: deathCount ?? 0,
      total_expeditions: expCount ?? 0,
    });
  };

  useEffect(() => {
    void (async () => {
      await Promise.all([loadEvents(), loadStats()]);
      setReady(true);

      const channel = supabase.channel("monde_events")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "guild_history_events" },
          async () => { await Promise.all([loadEvents(), loadStats()]); })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    })();
  }, []);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "à l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `il y a ${diffH}h`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  };

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Lecture du registre…</p></LedgerPage>;

  return (
    <LedgerPage>
      <div className="w-full max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="font-serif text-3xl tracking-[0.16em] uppercase text-primary">Le Monde</h1>
            <p className="text-xs text-muted-foreground mt-1">Ce que le registre a retenu.</p>
          </div>
          <div className="flex gap-4">
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

        {/* Stats globales */}
        {stats && (
          <div className="grid grid-cols-2 gap-2 mb-8 sm:grid-cols-4">
            {[
              { label: "Guildes", value: stats.guild_count },
              { label: "Or total", value: `${stats.total_gold}` },
              { label: "Expéditions", value: stats.total_expeditions },
              { label: "Morts", value: stats.total_deaths, red: stats.total_deaths > 0 },
            ].map((s) => (
              <div key={s.label} className="border border-border/30 px-3 py-3 text-center">
                <p className={`font-mono text-xl ${s.red ? "text-red-400" : "text-primary"}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-[0.1em] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Fil d'événements */}
        {events.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">Le registre est vide.</p>
            <p className="text-muted-foreground/50 text-xs mt-1">Rien ne s'est encore passé dans ce monde.</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-3 border border-border/20 hover:border-border/40 transition-colors">
                <span className={`text-sm w-4 flex-shrink-0 mt-0.5 ${EVENT_COLOR[e.event_type] ?? "text-muted-foreground"}`}>
                  {EVENT_ICON[e.event_type] ?? "·"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug">{e.description}</p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    <span className="text-primary/50">{(e.guild as any)?.name ?? "?"}</span>
                    <span className="mx-1.5">·</span>
                    {fmt(e.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 border-t border-border/20 pt-6 text-center">
          <p className="text-xs text-muted-foreground mb-4">
            Trust & Greed — un jeu de guildes, d'expéditions, et de confiance trahie.
          </p>
          <button onClick={() => navigate({ to: "/" })}
            className="text-xs tracking-[0.16em] uppercase border border-primary/40 text-primary px-6 py-2.5 hover:bg-primary/10 transition-colors">
            Rejoindre le monde
          </button>
        </div>
      </div>
    </LedgerPage>
  );
}
