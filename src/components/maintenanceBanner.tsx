import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function MaintenanceBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("app_settings" as any).select("value").eq("key", "maintenance").maybeSingle();
      const v = (data as any)?.value;
      setMessage(v?.active && v?.message ? v.message : null);
    })();
  }, []);

  if (!message) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-950/95 border-b border-amber-500/40 text-amber-200 text-xs text-center py-1.5 px-3">
      ⚠ {message}
    </div>
  );
}
