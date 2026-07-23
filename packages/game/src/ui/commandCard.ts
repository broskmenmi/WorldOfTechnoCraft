// The command card: one bottom-center panel that owns selection info AND all
// contextual actions (build menu, training, hero abilities, tier, policy).
// The DOM is rebuilt only when the selection signature changes — per-frame
// updates touch existing nodes, so a button never vanishes mid-tap.

import {
  BUILDINGS_BY_ID,
  DOOR_POLICIES,
  HEROES_BY_UNIT_ID,
  NODES_BY_ID,
  UNITS_BY_ID,
  type BuildingDef,
} from '@wotc/data';
import type { Controls } from '../input/controls.ts';
import type { SimHost, UnitView } from '../simHost.ts';
import { ACCENT, BTN_ACTIVE_BG, BTN_ARMED_BG, BTN_CSS, CHROME_BG, CHROME_BORDER, DIM, FONT, GOLD, TEXT } from './theme.ts';

const GLYPHS: Record<number, string> = {
  0: '🕺', 1: '🚪', 2: '💡', 3: '🧘', 6: '📢', 16: '🧰', 17: '⛷️', 18: '🐂', 19: '📣',
  32: '🎧', 33: '👑', 48: '🕵️', 49: '🌀', 50: '📋', 60: '🪩',
  100: '🚪', 106: '🏛️', 107: '🏛️', 110: '🎚️', 104: '🎛️', 103: '🔊', 105: '🌫️',
  116: '⛺', 117: '🏭', 118: '🏟️', 119: '⚙️', 120: '⛺', 300: '🪙', 301: '📦',
};

/** What each buildable does, in one non-violent line (shown on its button). */
const BUILD_BLURBS: Record<number, string> = {
  110: '+8 headroom (crowd cap)',
  104: 'trains your crew',
  103: 'sees far, heard further',
  105: 'fog turret: repels intruders',
};

function costText(def: { cost: { cash: number; gear: number } }): string {
  const parts: string[] = [];
  if (def.cost.cash > 0) parts.push(`€${def.cost.cash}`);
  if (def.cost.gear > 0) parts.push(`${def.cost.gear}⚙`);
  return parts.join(' ') || 'free';
}

export class CommandCard {
  private el: HTMLDivElement;
  private signature = '';

  constructor(
    private controls: Controls,
    private host: SimHost,
    private touch: boolean,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'command-card';
    this.el.style.cssText =
      `position:fixed;left:50%;transform:translateX(-50%);bottom:${touch ? 8 : 10}px;` +
      `display:none;gap:12px;align-items:stretch;background:${CHROME_BG};border:${CHROME_BORDER};` +
      `border-radius:10px;padding:10px 12px;font:${FONT};color:${TEXT};` +
      'pointer-events:auto;max-width:min(96vw,760px)';
    document.getElementById('hud')?.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Called every frame. Cheap unless the selection signature changed. */
  update(views: UnitView[]): void {
    const sel = views.filter((v) => this.controls.selected.has(v.eid));
    const c = this.controls;
    const h = this.host;
    const primary = sel[0];
    const heroDead = h.hero.eid === 0;
    const sig = [
      sel.map((v) => v.eid).join(','),
      primary?.kind ?? -1,
      c.buildMode,
      c.abilityPending,
      c.attackMovePending ? 1 : 0,
      h.tier,
      heroDead ? 1 : 0,
      this.affordSig(),
      h.hero.level,
      h.policy,
    ].join('|');

    if (sig !== this.signature) {
      this.signature = sig;
      this.rebuild(sel);
    }
    this.refresh(sel);
  }

  /** Affordability flips rebuild the card (buttons grey in/out). */
  private affordSig(): string {
    let bits = '';
    for (const def of this.controls.buildOptions()) {
      bits += this.canAfford(def) && this.host.tier >= def.requiresTier ? '1' : '0';
    }
    return bits;
  }

  private canAfford(def: { cost: { cash: number; gear: number } }): boolean {
    return this.host.cash >= def.cost.cash && this.host.gear >= def.cost.gear;
  }

  // ── DOM construction ──────────────────────────────────────────────────────

  private rebuild(sel: UnitView[]): void {
    this.el.replaceChildren();
    if (sel.length === 0 && !(this.host.hero.eid === 0 && this.host.hero.reviveCost > 0)) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = 'flex';

    if (sel.length === 0) {
      // Only the revive pill (DJ went home in a huff).
      this.el.appendChild(this.grid([this.reviveButton()]));
      return;
    }
    if (sel.length === 1) this.buildSingle(sel[0]!);
    else this.buildMulti(sel);
  }

  private buildSingle(v: UnitView): void {
    const def = v.node
      ? NODES_BY_ID.get(v.kind)
      : v.building
        ? BUILDINGS_BY_ID.get(v.kind)
        : UNITS_BY_ID.get(v.kind);
    this.el.appendChild(this.portrait(GLYPHS[v.kind] ?? '▪️', def?.name ?? '?', (def as { flavor?: string })?.flavor ?? '', v));

    const buttons: HTMLElement[] = [];
    if (v.hero && v.player === 0) {
      buttons.push(...this.heroButtons(v));
    } else if (v.building && v.player === 0) {
      buttons.push(...this.buildingButtons(v));
    } else if (!v.node && v.player === 0) {
      const unitDef = UNITS_BY_ID.get(v.kind);
      if (unitDef?.isBuilder) buttons.push(...this.buildButtons());
      buttons.push(this.confrontButton(), this.stopButton());
    }
    if (this.host.hero.eid === 0 && this.host.hero.reviveCost > 0) buttons.push(this.reviveButton());
    if (buttons.length > 0) this.el.appendChild(this.grid(buttons));
  }

  private buildMulti(sel: UnitView[]): void {
    const byKind = new Map<number, number>();
    for (const v of sel) byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1);
    const info = document.createElement('div');
    info.style.cssText = 'display:flex;flex-direction:column;gap:6px;justify-content:center';
    const chips = [...byKind.entries()]
      .map(([kind, n]) => `<span style="padding:3px 7px;background:#1a1a22;border-radius:5px">${GLYPHS[kind] ?? '▪️'}×${n}</span>`)
      .join(' ');
    info.innerHTML = `<b style="color:${TEXT}">${sel.length} in the crew</b><div style="display:flex;gap:5px;flex-wrap:wrap;max-width:280px">${chips}</div>`;
    this.el.appendChild(info);

    const buttons: HTMLElement[] = [this.confrontButton(), this.stopButton()];
    const anyBuilder = sel.some((v) => UNITS_BY_ID.get(v.kind)?.isBuilder);
    if (anyBuilder) buttons.unshift(...this.buildButtons());
    this.el.appendChild(this.grid(buttons));
  }

  private portrait(glyph: string, name: string, flavor: string, v: UnitView): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;gap:10px;align-items:center;min-width:190px;max-width:250px';
    box.innerHTML =
      `<div style="font-size:34px">${glyph}</div>` +
      `<div style="min-width:0"><b style="color:${TEXT}">${name}</b>` +
      `<div style="color:${DIM};font-size:11px">${flavor}</div>` +
      (v.node
        ? `<div style="color:${GOLD};font-size:11px">reserves <span data-vibe-num>${v.progress}</span>%</div>`
        : `<div style="width:130px;height:7px;background:#222;border-radius:3px;margin-top:4px">` +
          `<div data-vibe style="width:${Math.round((v.hp / Math.max(1, v.maxHp)) * 100)}%;height:100%;background:${ACCENT};border-radius:3px"></div></div>` +
          `<div style="color:${DIM};font-size:11px">vibe <span data-vibe-num>${v.hp}</span>/${v.maxHp}</div>`) +
      `</div>`;
    return box;
  }

  private grid(buttons: HTMLElement[]): HTMLElement {
    const g = document.createElement('div');
    g.style.cssText = `display:flex;gap:6px;flex-wrap:wrap;align-items:center;max-width:${this.touch ? '70vw' : '460px'}`;
    for (const b of buttons) g.appendChild(b);
    return g;
  }

  private button(
    lines: string[],
    opts: {
      hotkey?: string | undefined;
      tooltip?: string | undefined;
      disabled?: boolean;
      armed?: boolean;
      active?: boolean;
      onTap: () => void;
    },
  ): HTMLElement {
    const b = document.createElement('div');
    const size = this.touch ? 'min-width:64px;min-height:52px;padding:4px 8px' : 'min-width:72px;min-height:46px;padding:4px 8px';
    b.style.cssText = `${BTN_CSS};${size}`;
    if (opts.armed) b.style.background = BTN_ARMED_BG;
    else if (opts.active) b.style.background = BTN_ACTIVE_BG;
    if (opts.disabled) {
      b.style.opacity = '0.4';
      b.style.cursor = 'default';
    }
    if (opts.tooltip) b.title = opts.tooltip;
    b.innerHTML =
      lines.map((l, i) => `<span style="font-size:${i === 0 ? 12 : 10}px;${i > 0 ? `color:${DIM}` : ''}">${l}</span>`).join('') +
      (opts.hotkey && !this.touch ? `<span style="font-size:9px;color:${ACCENT}">[${opts.hotkey}]</span>` : '');
    if (!opts.disabled) {
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        opts.onTap();
      });
    }
    return b;
  }

  // ── Button sets ───────────────────────────────────────────────────────────

  private buildButtons(): HTMLElement[] {
    return this.controls.buildOptions().map((def: BuildingDef, i: number) => {
      const locked = this.host.tier < def.requiresTier;
      const broke = !this.canAfford(def);
      return this.button(
        [`${GLYPHS[def.id] ?? '🏗'} ${def.name}`, costText(def), locked ? `tier ${def.requiresTier}` : (BUILD_BLURBS[def.id] ?? '')],
        {
          tooltip: def.flavor,
          disabled: locked || broke,
          armed: this.controls.buildMode === i,
          onTap: () => this.controls.setBuildMode(i),
        },
      );
    });
  }

  private buildingButtons(v: UnitView): HTMLElement[] {
    const def = BUILDINGS_BY_ID.get(v.kind);
    const out: HTMLElement[] = [];
    (def?.trains ?? []).forEach((unitId, slot) => {
      const u = UNITS_BY_ID.get(unitId);
      if (!u) return;
      const locked = this.host.tier < u.requiresTier;
      out.push(
        this.button([`${GLYPHS[unitId] ?? '＋'} ${u.name}`, `${costText(u)} · ${u.headroom}👥`, locked ? `tier ${u.requiresTier}` : ''], {
          hotkey: ['T', 'Y', 'U', 'I'][slot],
          tooltip: u.flavor,
          disabled: locked || !this.canAfford(u),
          onTap: () => this.controls.train(slot),
        }),
      );
    });
    if (this.controls.canUpgradeSelected() && def) {
      const next = BUILDINGS_BY_ID.get(def.upgradesTo);
      out.push(
        this.button(['⬆ Tier up', `€${def.upgradeCost.cash} ${def.upgradeCost.gear}⚙`, next?.name ?? ''], {
          hotkey: 'V',
          tooltip: next?.flavor ?? '',
          disabled: this.host.cash < def.upgradeCost.cash || this.host.gear < def.upgradeCost.gear,
          onTap: () => this.controls.upgradeSelected(),
        }),
      );
    }
    if (def?.isDepot) {
      const policy = DOOR_POLICIES[this.host.policy];
      out.push(
        this.button(['🚪 ' + (policy?.name ?? 'Door'), `${policy?.vibeIncomePct ?? 100}% income`], {
          hotkey: 'P',
          tooltip: policy?.flavor ?? '',
          onTap: () => this.controls.cyclePolicy(),
        }),
      );
    }
    return out;
  }

  private heroButtons(v: UnitView): HTMLElement[] {
    const heroDef = HEROES_BY_UNIT_ID.get(v.kind);
    const h = this.host.hero;
    const labels = ['Q', 'W', 'E', 'R'];
    return (heroDef?.abilities ?? []).map((a, i) => {
      const cd = h.cds[i] ?? 0;
      const locked = h.level < a.unlockLevel;
      return this.button(
        [a.name, locked ? `at level ${a.unlockLevel}` : `<span data-cd="${i}">${cd > 0 ? `${Math.ceil(cd / 20)}s` : `${a.hypeCost} hype`}</span>`],
        {
          hotkey: labels[i],
          tooltip: a.flavor,
          disabled: locked,
          armed: this.controls.abilityPending === i,
          onTap: () => this.controls.touchAbility(i),
        },
      );
    });
  }

  private confrontButton(): HTMLElement {
    return this.button(['⚡ Confront', 'move + engage'], {
      hotkey: 'A',
      tooltip: 'Sound-clash anything hostile on the way. Nobody gets hurt; egos do.',
      armed: this.controls.attackMovePending,
      onTap: () => this.controls.toggleAttackMove(),
    });
  }

  private stopButton(): HTMLElement {
    return this.button(['✋ Hold', 'stop here'], { hotkey: 'H', onTap: () => this.controls.stopSelected() });
  }

  private reviveButton(): HTMLElement {
    return this.button(['💿 Re-book the DJ', `€${this.host.hero.reviveCost}`], {
      hotkey: 'G',
      tooltip: 'The DJ went home in a huff. Money mends feelings.',
      disabled: this.host.cash < this.host.hero.reviveCost,
      onTap: () => this.controls.revive(),
    });
  }

  // ── Per-frame refresh (no DOM churn) ──────────────────────────────────────

  private refresh(sel: UnitView[]): void {
    if (this.el.style.display === 'none') return;
    const v = sel[0];
    if (sel.length === 1 && v) {
      const bar = this.el.querySelector('[data-vibe]') as HTMLElement | null;
      if (bar) bar.style.width = `${Math.round((v.hp / Math.max(1, v.maxHp)) * 100)}%`;
      const num = this.el.querySelector('[data-vibe-num]');
      if (num) num.textContent = String(v.node ? v.progress : v.hp);
    }
    const h = this.host.hero;
    this.el.querySelectorAll('[data-cd]').forEach((span) => {
      const i = Number((span as HTMLElement).dataset['cd']);
      const cd = h.cds[i] ?? 0;
      if (cd > 0) span.textContent = `${Math.ceil(cd / 20)}s`;
    });
  }
}
