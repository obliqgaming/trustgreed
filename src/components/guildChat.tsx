import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type GuildChatMessage = { id: string; character_id: string; message: string; created_at: string; character: { name: string } };

export function GuildChatBox({ guildId, characterId }: { guildId: string; characterId: string }) {
  const [messages, setMessages] = useState<GuildChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    // Même bug que le chat d'expédition (vote.tsx) : order(ascending:
    // true).limit(50) garde les 50 PREMIERS messages de la guilde (les plus
    // vieux), pas les 50 derniers, puisque le LIMIT s'applique après le tri
    // du plus ancien au plus récent. Passé 50 messages au total, le chat
    // reste figé sur les tout premiers échanges et plus aucun nouveau
    // message n'apparaît. On trie par le plus récent pour prendre les 50
    // DERNIERS, puis on ré-inverse côté client pour l'affichage
    // chronologique normal.
    const { data } = await supabase
      .from("guild_chat_messages")
      .select("id, character_id, message, created_at, character:characters(name)")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false })
      .limit(50);
    setMessages(((data as any) ?? []).slice().reverse());
  }, [guildId]);

  useEffect(() => {
    void fetchMessages();
    // Écoute en direct les nouveaux messages : le sondage de 8s ci-dessous
    // ne sert plus que de filet de sécurité si Realtime rate un événement
    // (même schéma que expedition.tsx pour les participants), au lieu
    // d'être la seule source de mise à jour — c'est ce qui donnait
    // l'impression que le chat « se figeait ».
    const channel = supabase
      .channel(`guild_chat_${guildId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "guild_chat_messages",
        filter: `guild_id=eq.${guildId}`,
      }, () => { void fetchMessages(); })
      .subscribe();
    pollRef.current = setInterval(fetchMessages, 8000);
    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [guildId, fetchMessages]);

  // Ne fait défiler automatiquement vers le bas que si le joueur était déjà
  // proche du bas (ou que c'est lui qui vient d'envoyer un message) — sauf
  // au tout premier chargement, qui doit toujours atterrir en bas (pas de
  // position de lecture à respecter à l'arrivée).
  const prevMsgCount = useRef(0);
  const sentByMeRef = useRef(false);
  const initialScrollDone = useRef(false);
  useEffect(() => {
    const grew = messages.length > prevMsgCount.current;
    const isInitialLoad = !initialScrollDone.current && messages.length > 0;
    prevMsgCount.current = messages.length;
    if (!grew && !isInitialLoad) return;
    if (isInitialLoad) {
      initialScrollDone.current = true;
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
      return;
    }
    const box = scrollBoxRef.current;
    const wasNearBottom = box
      ? box.scrollHeight - box.scrollTop - box.clientHeight < 60
      : true;
    if (wasNearBottom || sentByMeRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    sentByMeRef.current = false;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    sentByMeRef.current = true;
    const { error } = await supabase.from("guild_chat_messages").insert({ guild_id: guildId, character_id: characterId, message: text.trim() });
    if (error) { console.error("[chat guilde] échec d'envoi :", error.message); sentByMeRef.current = false; }
    setText("");
    await fetchMessages();
    setBusy(false);
  }

  return (
    <div className="mt-4 border-t border-border/20 pt-4">
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Chat de guilde</p>
      <div ref={scrollBoxRef} className="h-32 overflow-y-auto space-y-1 mb-2 pr-1">
        {messages.length === 0
          ? <p className="text-xs text-muted-foreground/40 italic">Silence dans la guilde.</p>
          : messages.map((m) => (
            <div key={m.id} className={`text-xs ${m.character_id === characterId ? "text-primary" : "text-muted-foreground"}`}>
              <span className="font-semibold">{(m.character as any)?.name ?? "?"}</span>
              <span className="mx-1 opacity-40">·</span>
              <span>{m.message}</span>
            </div>
          ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} maxLength={200}
          placeholder="Écris à ta guilde…"
          className="flex-1 bg-transparent border border-border/40 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40" />
        <button type="submit" disabled={busy || !text.trim()}
          className="px-3 py-1.5 text-xs uppercase tracking-[0.1em] border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-30">
          Envoyer
        </button>
      </form>
    </div>
  );
}
