import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type GuildChatMessage = { id: string; character_id: string; message: string; created_at: string; character: { name: string } };

export function GuildChatBox({ guildId, characterId }: { guildId: string; characterId: string }) {
  const [messages, setMessages] = useState<GuildChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("guild_chat_messages")
      .select("id, character_id, message, created_at, character:characters(name)")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: true })
      .limit(50);
    setMessages((data as any) ?? []);
  }, [guildId]);

  useEffect(() => {
    void fetchMessages();
    pollRef.current = setInterval(fetchMessages, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages]);

  const prevMsgCount = useRef(0);
  useEffect(() => {
    if (messages.length > prevMsgCount.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    prevMsgCount.current = messages.length;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const { error } = await supabase.from("guild_chat_messages").insert({ guild_id: guildId, character_id: characterId, message: text.trim() });
    if (error) console.error("[chat guilde] échec d'envoi :", error.message);
    setText("");
    await fetchMessages();
    setBusy(false);
  }

  return (
    <div className="mt-4 border-t border-border/20 pt-4">
      <p className="text-xs tracking-[0.14em] uppercase text-muted-foreground mb-2">Chat de guilde</p>
      <div className="h-32 overflow-y-auto space-y-1 mb-2 pr-1">
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
