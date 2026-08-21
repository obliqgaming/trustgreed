import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerPage } from "@/components/ledger";

export const Route = createFileRoute("/carte")({
  ssr: false,
  component: CartePage,
});

type GuildEntry = {
  id: string; name: string; gold: number; member_count: number;
  founder: string; expedition_count: number; death_count: number;
};

function CartePage() {
  const navigate = useNavigate();
  const [guilds, setGuilds] = useState<GuildEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [myGuildId, setMyGuildId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: char } = await supabase
          .from("characters")
          .select("guild_id")
          .eq("profile_id", session.user.id)
          .eq("is_alive", true)
          .maybeSingle();
        setMyGuildId(char?.guild_id ?? null);
      }

      const { data: guildData } = await supabase
        .from("guilds")
        .select("id, name, gold, founder_profile_id")
        .order("gold", { ascending: false });

      if (!guildData) { setReady(true); return; }

      const enriched = await Promise.all(guildData.map(async (g) => {
        const { count: members } = await supabase
          .from("characters")
          .select("id", { count: "exact", head: true })
          .eq("guild_id", g.id)
          .eq("is_alive", true);

        const { count: expeditions } = await supabase
          .from("expeditions")
          .select("id", { count: "exact", head: true })
          .eq("guild_id", g.id)
          .eq("status", "completed");

        const { count: deaths } = await supabase
          .from("guild_history_events")
          .select("id", { count: "exact", head: true })
          .eq("guild_id", g.id)
          .eq("event_type", "member_died");

        const { data: founderChar } = await supabase
          .from("characters")
          .select("name")
          .eq("profile_id", g.founder_profile_id)
          .limit(1)
          .maybeSingle();

        return {
          id: g.id, name: g.name, gold: g.gold,
          member_count: members ?? 0,
          expedition_count: expeditions ?? 0,
          death_count: deaths ?? 0,
          founder: founderChar?.name ?? "Inconnu",
        };
      }));

      setGuilds(enriched);
      setReady(true);
    })();
  }, []);

  const maxGold = Math.max(...guilds.map(g => g.gold), 1);

  if (!ready) return <LedgerPage><p className="text-center text-sm text-muted-foreground">Consultation du registre…</p></LedgerPage>;

  return (
    <LedgerPage>
      <div className="w-full max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-2xl tracking-[0.16em] uppercase text-primary">Carte des guildes</h1>
            <p className="text-xs text-muted-foreground mt-1">{guilds.length} guilde{guilds.length > 1 ? "s" : ""} active{guilds.length > 1 ? "s" : ""}</p>
          </div>
          <button onClick={() => navigate({ to: "/" })}
            className="text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors">
            Retour
          </button>
        </div>

        {guilds.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm">Aucune guilde n'a encore écrit son histoire.</p>
        ) : (
          <ul className="space-y-4">
            {guilds.map((g, i) => {
              const barWidth = Math.max(4, Math.round((g.gold / maxGold) * 100));
              const isMyGuild = g.id === myGuildId;
              return (
                <li key={g.id}
                  className={`border px-4 py-4 transition-colors ${isMyGuild ? "border-primary/60 bg-primary/5" : "border-border/30"}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                        <span className={`font-serif tracking-[0.12em] uppercase ${isMyGuild ? "text-primary" : "text-foreground"}`}>
                          {g.name}
                        </span>
                        {isMyGuild && <span className="text-xs text-primary/60">(ta guilde)</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">Fondée par {g.founder}</p>
                    </div>
                    <span className="font-mono text-lg text-primary">{Math.round(g.gold)} or</span>
                  </div>

                  {/* Barre de richesse proportionnelle */}
                  <div className="h-1.5 bg-border/20 rounded-sm mb-3 overflow-hidden">
                    <div
                      className={`h-full rounded-sm transition-all duration-700 ${isMyGuild ? "bg-primary" : "bg-primary/40"}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>

                  {/* Stats */}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{g.member_count} membre{g.member_count > 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>{g.expedition_count} expédition{g.expedition_count > 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span className={g.death_count > 0 ? "text-red-400/70" : ""}>
                      {g.death_count} mort{g.death_count > 1 ? "s" : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </LedgerPage>
  );
}
