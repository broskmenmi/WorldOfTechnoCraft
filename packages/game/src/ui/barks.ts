// Bark toasts: deadpan one-liners from @wotc/data, bottom-left, rate-limited.

import { BARKS, EVENT_LINES } from '@wotc/data';
import { UNITS_BY_ID } from '@wotc/data';

const TOAST_MS = 3500;
const COOLDOWN_MS = 2500;

export class BarkFeed {
  private container: HTMLDivElement;
  private lastBark = 0;
  private rng = Math.random; // presentation-only randomness is fine here

  constructor() {
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:fixed;left:12px;bottom:120px;display:flex;flex-direction:column;gap:6px;' +
      'pointer-events:none;max-width:380px';
    document.getElementById('hud')?.appendChild(this.container);
  }

  /** A unit bark (rate-limited so click-spam doesn't become a podcast). */
  unitBark(kind: number, event: 'onSelect' | 'onMove' | 'onAttack' | 'onDeath'): void {
    const now = performance.now();
    if (now - this.lastBark < COOLDOWN_MS) return;
    const key = UNITS_BY_ID.get(kind)?.key;
    const lines = key ? BARKS[key]?.[event] : undefined;
    if (!lines || lines.length === 0) return;
    this.lastBark = now;
    this.toast(`“${lines[Math.floor(this.rng() * lines.length)]!}”`, '#bdbdbd');
  }

  /** Event lines always show (they matter). */
  event(kind: keyof typeof EVENT_LINES): void {
    const lines = EVENT_LINES[kind];
    this.toast(lines[Math.floor(this.rng() * lines.length)]!, '#ffd75f');
  }

  private toast(text: string, color: string): void {
    const el = document.createElement('div');
    el.style.cssText =
      `font:12px monospace;color:${color};background:#000c;padding:6px 10px;` +
      'border-radius:4px;border-left:2px solid currentColor;opacity:1;transition:opacity .6s';
    el.textContent = text;
    this.container.appendChild(el);
    setTimeout(() => (el.style.opacity = '0'), TOAST_MS - 600);
    setTimeout(() => el.remove(), TOAST_MS);
    while (this.container.children.length > 4) this.container.firstChild?.remove();
  }
}
