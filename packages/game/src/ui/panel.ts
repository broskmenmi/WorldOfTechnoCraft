// Selection panel: portrait, name, flavor, HP; hero abilities with cooldown
// sweeps; building production/upgrade. DOM, bottom-center.

import { BUILDINGS_BY_ID, HEROES_BY_UNIT_ID, NODES_BY_ID, UNITS_BY_ID } from '@wotc/data';
import type { Controls } from '../input/controls.ts';
import type { SimHost, UnitView } from '../simHost.ts';

const GLYPHS: Record<number, string> = {
  0: '🕺', 1: '🚪', 2: '💡', 3: '🧘', 6: '📢', 16: '🧰', 17: '⛷️', 18: '🐂', 19: '📣',
  32: '🎧', 33: '👑', 48: '🕵️', 49: '🌀', 50: '📋', 60: '🪩',
  100: '🏛️', 106: '🏛️', 107: '🏛️', 110: '🔊', 104: '🎛️', 103: '📡', 105: '🌫️',
  116: '⛺', 117: '🏭', 118: '🏟️', 119: '⚙️', 120: '⛺', 300: '🪙', 301: '📦',
};

const PANEL_CSS =
  'position:fixed;left:50%;transform:translateX(-50%);bottom:12px;display:none;' +
  'gap:12px;align-items:center;background:#0d0d13ee;border:1px solid #2a2a33;' +
  'border-radius:8px;padding:10px 14px;font:12px monospace;color:#ccc;' +
  'pointer-events:auto;max-width:92vw';

export class SelectionPanel {
  private el: HTMLDivElement;
  private touchOffset: boolean;

  constructor(
    private controls: Controls,
    private host: SimHost,
    touch: boolean,
  ) {
    this.touchOffset = touch;
    this.el = document.createElement('div');
    this.el.id = 'sel-panel';
    this.el.style.cssText = PANEL_CSS;
    if (touch) this.el.style.bottom = '68px'; // sit above the touch bar
    document.getElementById('hud')?.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  update(views: UnitView[]): void {
    const selected = views.filter((v) => this.controls.selected.has(v.eid));
    if (selected.length === 0) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = 'flex';
    if (selected.length === 1) this.renderSingle(selected[0]!);
    else this.renderMulti(selected);
  }

  private hpBar(v: UnitView, width = 140): string {
    const frac = v.maxHp > 0 ? Math.max(0, v.hp / v.maxHp) : 0;
    const hue = Math.round(frac * 110);
    return (
      `<div style="width:${width}px;height:8px;background:#222;border-radius:3px;margin-top:3px">` +
      `<div style="width:${Math.round(frac * 100)}%;height:100%;background:hsl(${hue} 80% 55%);border-radius:3px"></div></div>` +
      `<div style="color:#888">${v.hp}/${v.maxHp}</div>`
    );
  }

  private renderSingle(v: UnitView): void {
    const def = v.node
      ? NODES_BY_ID.get(v.kind)
      : v.building
        ? BUILDINGS_BY_ID.get(v.kind)
        : UNITS_BY_ID.get(v.kind);
    const glyph = GLYPHS[v.kind] ?? '▪️';
    let extra = '';

    if (v.hero) {
      const h = this.host.hero;
      const heroDef = HEROES_BY_UNIT_ID.get(v.kind);
      const xpFrac = h.xpNext > 0 ? Math.min(1, h.xp / h.xpNext) : 0;
      const buttons = (heroDef?.abilities ?? [])
        .map((a, i) => {
          const cd = h.cds[i] ?? 0;
          const locked = h.level < a.unlockLevel;
          const label = ['Q', 'W', 'E', 'R'][i];
          const state = locked ? `lvl ${a.unlockLevel}` : cd > 0 ? `${Math.ceil(cd / 20)}s` : a.name;
          const bg = this.controls.abilityPending === i ? '#a22' : locked || cd > 0 ? '#222' : '#1d3a26';
          return (
            `<div data-slot="${i}" style="min-width:64px;padding:5px 8px;border-radius:5px;background:${bg};` +
            `border:1px solid #333;text-align:center;cursor:pointer;opacity:${locked ? 0.5 : 1}">` +
            `<b>${label}</b><br><span style="font-size:10px">${state}</span></div>`
          );
        })
        .join('');
      extra =
        `<div style="color:#ffd75f">Level ${h.level} — ${heroDef?.title ?? ''}</div>` +
        `<div style="width:140px;height:5px;background:#222;border-radius:3px;margin:3px 0">` +
        `<div style="width:${Math.round(xpFrac * 100)}%;height:100%;background:#b98cff;border-radius:3px"></div></div>` +
        `<div style="color:#888">hype ${h.hype}/${h.hypeMax}</div>` +
        `<div style="display:flex;gap:6px;margin-top:6px">${buttons}</div>`;
    } else if (v.building) {
      const canUp = this.controls.canUpgradeSelected();
      extra =
        (v.progress < 100 ? `<div style="color:#ffd75f">under construction: ${v.progress}%</div>` : '') +
        (canUp
          ? `<div data-upgrade="1" style="margin-top:6px;padding:5px 10px;border-radius:5px;background:#1d3a26;border:1px solid #333;cursor:pointer;display:inline-block">⬆ Upgrade tier</div>`
          : '');
    } else if (v.node) {
      extra = `<div style="color:#ffd75f">reserves: ${v.progress}%</div>`;
    }

    this.el.innerHTML =
      `<div style="font-size:34px">${glyph}</div>` +
      `<div><b style="color:#e8e8e8">${def?.name ?? '?'}</b>` +
      `<div style="max-width:320px;color:#777;font-size:11px">${(def as { flavor?: string })?.flavor ?? ''}</div>` +
      (v.node ? '' : this.hpBar(v)) +
      `${extra}</div>`;

    // Wire buttons.
    this.el.querySelectorAll('[data-slot]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const slot = Number((btn as HTMLElement).dataset['slot']);
        this.controls.touchAbility(slot);
      });
    });
    const up = this.el.querySelector('[data-upgrade]');
    up?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.controls.upgradeSelected();
    });
  }

  private renderMulti(selected: UnitView[]): void {
    const byKind = new Map<number, number>();
    for (const v of selected) byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1);
    const chips = [...byKind.entries()]
      .map(
        ([kind, n]) =>
          `<div style="padding:4px 8px;background:#1a1a22;border-radius:5px">${GLYPHS[kind] ?? '▪️'} ×${n}</div>`,
      )
      .join('');
    this.el.innerHTML =
      `<div><b style="color:#e8e8e8">${selected.length} selected</b>` +
      `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${chips}</div></div>`;
  }
}
