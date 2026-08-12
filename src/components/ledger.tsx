import { useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import fondwild from "@/assets/fondwild2.webp.asset.json";

export function LedgerPage({ children }: { children: ReactNode }) {
  return (
    <main
      className="min-h-screen w-full bg-background px-4 py-10 sm:py-16"
      style={{
        backgroundImage: `linear-gradient(rgba(18,17,15,0.88), rgba(18,17,15,0.94)), url(${fondwild.url})`,
        backgroundSize: "cover",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="mx-auto w-full max-w-md">{children}</div>
    </main>
  );
}

export function LedgerCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-sm border border-border bg-card/80 p-6 shadow-[0_0_0_1px_rgba(184,148,77,0.12)] backdrop-blur-sm sm:p-8">
      <h1 className="font-serif text-2xl tracking-[0.12em] text-primary uppercase">{title}</h1>
      {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function LedgerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mt-4 border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
    >
      {message}
    </p>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mt-4 block first:mt-0">
      <span className="mb-1.5 block text-xs tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      <input
        {...props}
        className={cn(
          "w-full rounded-sm border border-input bg-background/60 px-3 py-2 text-foreground",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      />
    </label>
  );
}

/** Bouton de confirmation principal, avec bref effet de sceau au clic. */
export function SealButton({
  children,
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const [sealed, setSealed] = useState(false);

  return (
    <button
      {...props}
      onClick={(e) => {
        setSealed(true);
        window.setTimeout(() => setSealed(false), 450);
        onClick?.(e);
      }}
      className={cn(
        "relative mt-6 w-full overflow-hidden rounded-sm border border-primary/60 bg-primary/10 px-4 py-2.5",
        "font-serif tracking-[0.16em] text-primary uppercase transition-colors",
        "hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {sealed ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="h-16 w-16 animate-[ping_0.45s_ease-out_1] rounded-full border-2 border-destructive/70 bg-destructive/30" />
        </span>
      ) : null}
      <span className="relative">{children}</span>
    </button>
  );
}

export function TextLink({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="mt-4 text-sm text-muted-foreground underline underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  );
}
