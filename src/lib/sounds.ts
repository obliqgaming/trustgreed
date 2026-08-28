// ═══════════════════════════════════════════════════════════════
// Trust & Greed — Web Audio Sound Design
// Adapté depuis ObliqWild. Synthèse pure, aucun asset.
// ═══════════════════════════════════════════════════════════════

let audioCtx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
  } catch { return null; }
}

export function unlockAudio(): void {
  if (unlocked) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => { unlocked = true; });
  } else { unlocked = true; }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  osc.connect(gain).connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + 0.01);
}

function tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine', detune = 0) {
  const ctx = getCtx(); if (!ctx) return;
  if (ctx.state === 'suspended') { ctx.resume(); return; }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  if (detune) osc.detune.setValueAtTime(detune, ctx.currentTime + start);
  gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.05);
}

function noise(start: number, dur: number, vol: number, highpass = 200) {
  const ctx = getCtx(); if (!ctx) return;
  if (ctx.state === 'suspended') { ctx.resume(); return; }
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass'; filter.frequency.value = highpass;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(ctx.currentTime + start);
}

// ── UI générale ─────────────────────────────────────────────
export function soundTap() { tone(440, 0, 0.04, 0.05, 'triangle'); }
export function soundError() { tone(220, 0, 0.15, 0.05, 'sawtooth'); tone(180, 0.1, 0.2, 0.04, 'sawtooth'); }
export function soundOpen() { tone(520, 0, 0.08, 0.06); tone(680, 0.05, 0.06, 0.04); }

// ── Vote secret ──────────────────────────────────────────────
// Son grave et sourd quand on clique CONTINUER — engagement, risque
export function soundVoteContinuer() {
  tone(180, 0, 0.12, 0.06, 'sine');
  tone(220, 0.08, 0.15, 0.05, 'sine');
  noise(0, 0.08, 0.02, 100);
}

// Son discret et neutre pour RENTRER — retrait, prudence
export function soundVoteRentrer() {
  tone(350, 0, 0.08, 0.04, 'triangle');
  tone(280, 0.07, 0.12, 0.03, 'triangle');
}

// Confirmation que le vote est enregistré
export function soundVoteEnregistre() {
  tone(523, 0, 0.06, 0.05, 'sine');
  tone(659, 0.07, 0.06, 0.04, 'sine');
}

// Tension croissante — joué en boucle pendant l'attente des votes
// (appeler toutes les 8s environ, pas en boucle continue)
export function soundTensionPulse() {
  tone(80, 0, 0.4, 0.03, 'sine');
  tone(85, 0.1, 0.35, 0.02, 'sine', -10);
  noise(0, 0.15, 0.012, 50);
}

// Quand le dernier vote arrive (tous ont voté)
export function soundAllVoted() {
  tone(440, 0, 0.06, 0.04, 'triangle');
  tone(554, 0.07, 0.06, 0.04, 'triangle');
  tone(659, 0.14, 0.1, 0.05, 'triangle');
}

// ── Révélation du résultat ──────────────────────────────────
// Clic sur "Révéler" — suspension avant de savoir
export function soundRevealClick() {
  noise(0, 0.06, 0.04, 800);
  tone(880, 0, 0.04, 0.09, 'sine');
  tone(1100, 0.03, 0.08, 0.07, 'sine');
  tone(660, 0.05, 0.12, 0.05, 'sine');
}

// Résultat : personne n'est mort, on continue
export function soundSurvived() {
  tone(523, 0, 0.1, 0.07, 'sine');
  tone(659, 0.08, 0.1, 0.06, 'sine');
  tone(784, 0.16, 0.2, 0.06, 'sine');
}

// Résultat : quelqu'un est mort
export function soundMortMembre() {
  tone(200, 0, 0.2, 0.06, 'sawtooth');
  noise(0, 0.15, 0.05, 100);
  tone(150, 0.2, 0.3, 0.05, 'sawtooth');
  tone(100, 0.45, 0.5, 0.04, 'sine');
}

// Mort personnelle — plus lourd, plus long
export function soundMaMort() {
  tone(150, 0, 0.3, 0.07, 'sawtooth');
  noise(0, 0.25, 0.06, 80);
  tone(100, 0.3, 0.5, 0.06, 'sawtooth');
  tone(70, 0.7, 0.8, 0.05, 'sine');
  noise(0.6, 0.5, 0.03, 60);
}

// ── Retour d'expédition ──────────────────────────────────────
// Retour victorieux avec butin
export function soundRetourVictoire() {
  tone(392, 0, 0.12, 0.07, 'sine');
  tone(523, 0.10, 0.12, 0.07, 'sine');
  tone(659, 0.20, 0.12, 0.07, 'sine');
  tone(784, 0.30, 0.2, 0.07, 'sine');
  tone(1047, 0.45, 0.4, 0.06, 'sine');
}

// Retour après wipe — solennel, sombre
export function soundRetourWipe() {
  tone(220, 0, 0.4, 0.05, 'sawtooth');
  tone(185, 0.3, 0.5, 0.05, 'sawtooth');
  tone(147, 0.7, 0.6, 0.04, 'sine');
  noise(0, 0.2, 0.02, 80);
}

// ── Salle d'attente ──────────────────────────────────────────
// Quelqu'un rejoint la salle d'attente
export function soundMemberJoins() {
  tone(440, 0, 0.05, 0.04, 'triangle');
  tone(554, 0.06, 0.07, 0.04, 'triangle');
}

// Expédition lancée — départ
export function soundExpeditionStart() {
  noise(0, 0.08, 0.04, 300);
  tone(293, 0, 0.08, 0.06, 'square');
  tone(369, 0.07, 0.08, 0.05, 'square');
  tone(440, 0.14, 0.12, 0.06, 'square');
}

// ── XP et niveau ────────────────────────────────────────────
export function soundXpGain() { tone(600, 0, 0.06, 0.05); tone(750, 0.06, 0.08, 0.04); }
export function soundLevelUp() {
  tone(523, 0, 0.08, 0.06, 'sine');
  tone(659, 0.09, 0.08, 0.06, 'sine');
  tone(784, 0.18, 0.08, 0.06, 'sine');
  tone(1047, 0.27, 0.1, 0.07, 'sine');
  tone(1319, 0.37, 0.1, 0.07, 'sine');
  tone(1047, 0.50, 0.4, 0.08, 'sine');
  tone(1568, 0.50, 0.4, 0.07, 'sine');
  noise(0.50, 0.12, 0.025, 3000);
}
