import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LedgerPage } from "@/components/ledger";
import { GuildBanner } from "@/components/banners";

export const Route = createFileRoute("/carte")({
  ssr: false,
  component: CartePage,
});

type GuildEntry = {
  id: string; name: string; gold: number; member_count: number;
  founder: string; expedition_count: number; death_count: number;
  map_x: number; map_y: number; building_style: string;
  banner_symbol: string | null; banner_color: string | null;
  tier: number; rank: number;
};

const TIER_SCALE: Record<number, number> = { 1: 0.5, 2: 0.8, 3: 1, 4: 1.2, 5: 1.5 };
const BASE_BUILDING_WIDTH = 56; // px, à l'échelle 100% (palier 3)

function CartePage() {
  const navigate = useNavigate();
  const [guilds, setGuilds] = useState<GuildEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [myGuildId, setMyGuildId] = useState<string | null>(null);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60000); // recalcul live, pas de tâche planifiée nécessaire
    return () => clearInterval(t);
  }, []);

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data: char } = await supabase
        .from("characters")
        .select("guild_id")
        .eq("profile_id", session.user.id)
        .eq("is_alive", true)
        .eq("is_bot", false)
        .maybeSingle();
      setMyGuildId(char?.guild_id ?? null);
    }

    const { data: guildData } = await supabase
      .from("guilds")
      .select("id, name, gold, founder_profile_id, map_x, map_y, building_style, banner_symbol, banner_color")
      .order("gold", { ascending: false });

    const { data: tierData } = await supabase.rpc("get_guild_building_tiers");
    const tierMap = new Map((tierData ?? []).map((t: any) => [t.guild_id, t]));

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

      const tierInfo = tierMap.get(g.id) as { tier: number; rank: number } | undefined;

      return {
        id: g.id, name: g.name, gold: g.gold,
        member_count: members ?? 0,
        expedition_count: expeditions ?? 0,
        death_count: deaths ?? 0,
        founder: founderChar?.name ?? "Inconnu",
        map_x: g.map_x, map_y: g.map_y, building_style: g.building_style ?? "chaos",
        banner_symbol: g.banner_symbol, banner_color: g.banner_color,
        tier: tierInfo?.tier ?? 1, rank: tierInfo?.rank ?? 999,
      };
    }));

    setGuilds(enriched);
    setReady(true);
  }

  const maxGold = Math.max(...guilds.map(g => g.gold), 1);

  if (!ready) return <LedgerPage bg="/world_map_bg.png"><p className="text-center text-sm text-muted-foreground">Consultation du registre…</p></LedgerPage>;

  return (
    <LedgerPage bg="/world_map_bg.png" wide>
      <div className="w-full max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 bg-card/85 backdrop-blur-md border border-border/40 px-4 py-3 rounded-sm">
          <div>
            <h1 className="font-serif text-2xl tracking-[0.16em] uppercase text-primary">Carte des guildes</h1>
            <p className="text-xs text-muted-foreground mt-1">{guilds.length} guilde{guilds.length > 1 ? "s" : ""} active{guilds.length > 1 ? "s" : ""} · mise à jour en direct</p>
          </div>
          <div className="flex gap-3">
            {!myGuildId && (
              <button onClick={() => navigate({ to: "/" })}
                className="text-xs tracking-[0.12em] uppercase border border-primary/40 text-primary px-3 py-1.5 hover:bg-primary/10 transition-colors">
                Rejoindre
              </button>
            )}
            <button onClick={() => navigate({ to: "/" })}
              className="text-xs tracking-[0.12em] uppercase text-muted-foreground hover:text-primary transition-colors">
              {myGuildId ? "Retour" : "Connexion"}
            </button>
          </div>
        </div>

        {/* La carte vivante : chaque guilde a une position permanente, un bâtiment
            qui grandit avec son classement + sa richesse. */}
        <div className="relative w-full mb-8 border border-border/40 overflow-hidden rounded-sm" style={{ aspectRatio: "1672/941" }}>
          <img src="/guild_map_bg.webp" alt="" className="absolute inset-0 w-full h-full object-cover" />
          {guilds.map((g) => {
            const scale = TIER_SCALE[g.tier] ?? 1;
            const width = BASE_BUILDING_WIDTH * scale;
            const isMyGuild = g.id === myGuildId;
            return (
              <div
                key={g.id}
                className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-full"
                style={{ left: `${g.map_x * 100}%`, top: `${g.map_y * 100}%` }}
                title={`${g.name} — ${Math.round(g.gold)} or · #${g.rank}`}
              >
                <div className="flex items-center gap-1 mb-0.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-sm whitespace-nowrap">
                  {g.banner_symbol && <GuildBanner symbol={g.banner_symbol} color={g.banner_color} size={12} />}
                  <span className={`text-[10px] font-serif uppercase tracking-[0.05em] ${isMyGuild ? "text-primary" : "text-foreground/90"}`}>
                    {g.name}
                  </span>
                </div>
                <img
                  src={`/guildbuildings/${g.building_style}_tier${g.tier}.webp`}
                  alt={g.name}
                  style={{ width, height: "auto" }}
                  className={isMyGuild ? "drop-shadow-[0_0_6px_rgba(201,162,75,0.6)]" : ""}
                />
              </div>
            );
          })}
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
                  className={`border px-4 py-4 transition-colors backdrop-blur-md rounded-sm ${isMyGuild ? "border-primary/60 bg-primary/10" : "border-border/40 bg-card/85"}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                        <span className={`font-serif tracking-[0.12em] uppercase ${isMyGuild ? "text-primary" : "text-foreground"}`}>
                          {g.name}
                        </span>
                        {isMyGuild && <span className="text-xs text-primary/60">(ta guilde)</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">Fondée par {g.founder} · palier {g.tier}/5</p>
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

