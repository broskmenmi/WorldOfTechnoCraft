// Onboarding objectives: a checklist that watches the match state and ticks
// itself off, so a new player always knows the next move. Pure observation —
// no sim involvement. Dismissible; stays hidden for players who finished it.

import { BUILDINGS, UNITS } from '@wotc/data';
import type { SimHost, UnitView } from '../simHost.ts';
import { ACCENT, CHROME_BG, CHROME_BORDER, DIM, FONT, GOLD, TEXT } from './theme.ts';

const DONE_KEY = 'wotc-objectives-done';

interface Objective {
  text: string;
  hint: string;
  check(views: UnitView[], host: SimHost): boolean;
}

const OBJECTIVES: Objective[] = [
  {
    text: 'Put the crew to work',
    hint: 'select Clubgoers, right-click/tap The Queue (gold) outside your door',
    check: (views) => views.some((v) => v.player === 0 && v.carrying),
  },
  {
    text: 'Build a Monitor Stack',
    hint: 'select a Clubgoer → pick it on the card below (more headroom = bigger crowd)',
    check: (views) => views.some((v) => v.player === 0 && v.building && v.kind === BUILDINGS.monitor_stack.id),
  },
  {
    text: 'Hire 3 Bouncers',
    hint: 'select your Booth (build one if needed) and train them',
    check: (views) => views.filter((v) => v.player === 0 && v.kind === UNITS.bouncer.id).length >= 3,
  },
  {
    text: 'Reach Tier 2',
    hint: 'select The Door → Tier up (unlocks Monks, Bass Cannons, Smoke Machines)',
    check: (_views, host) => host.tier >= 2,
  },
  {
    text: 'Scout the Legion camp',
    hint: 'send someone north-east past the wall — the rival scene is up there',
    check: (views) => views.some((v) => v.player === 1 && v.building),
  },
  {
    text: 'Shut down their Warcamp',
    hint: 'confront (A) with your full crew — win the sound clash for the city',
    check: (_views, host) => host.matchState === 1,
  },
];

export class Objectives {
  private el: HTMLDivElement;
  private rows: HTMLDivElement[] = [];
  private done: boolean[] = OBJECTIVES.map(() => false);
  private lastCheck = 0;
  private dismissed = false;

  constructor(isReplay: boolean) {
    this.el = document.createElement('div');
    this.el.id = 'objectives';
    this.el.style.cssText =
      `position:fixed;right:12px;top:58px;width:230px;background:${CHROME_BG};` +
      `border:${CHROME_BORDER};border-radius:8px;padding:8px 10px;font:${FONT};` +
      `color:${TEXT};pointer-events:auto`;
    this.dismissed = isReplay || localStorage.getItem(DONE_KEY) === '1';
    if (this.dismissed) {
      this.el.style.display = 'none';
    }

    const head = document.createElement('div');
    head.style.cssText = `display:flex;justify-content:space-between;color:${GOLD};margin-bottom:4px`;
    head.innerHTML = `<b>THE PLAN</b><span style="cursor:pointer;color:${DIM}" title="hide">✕</span>`;
    head.querySelector('span')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.dismiss();
    });
    this.el.appendChild(head);

    for (const o of OBJECTIVES) {
      const row = document.createElement('div');
      row.style.cssText = 'margin:3px 0';
      row.innerHTML =
        `<span data-check style="color:${DIM}">☐</span> <span data-text>${o.text}</span>` +
        `<div data-hint style="color:${DIM};font-size:10px;margin-left:16px;display:none">${o.hint}</div>`;
      this.el.appendChild(row);
      this.rows.push(row);
    }
    document.getElementById('hud')?.appendChild(this.el);
  }

  private dismiss(): void {
    this.dismissed = true;
    this.el.style.display = 'none';
    localStorage.setItem(DONE_KEY, '1');
  }

  /** Called every frame; actually evaluates ~2×/sec. */
  update(views: UnitView[], host: SimHost, now: number): boolean {
    if (this.dismissed) return false;
    if (now - this.lastCheck < 500) return false;
    this.lastCheck = now;

    let advanced = false;
    let activeShown = false;
    for (let i = 0; i < OBJECTIVES.length; i++) {
      const row = this.rows[i]!;
      const check = row.querySelector('[data-check]') as HTMLElement;
      const text = row.querySelector('[data-text]') as HTMLElement;
      const hint = row.querySelector('[data-hint]') as HTMLElement;
      if (!this.done[i] && OBJECTIVES[i]!.check(views, host)) {
        this.done[i] = true;
        advanced = true;
      }
      if (this.done[i]) {
        check.textContent = '☑';
        check.style.color = ACCENT;
        text.style.color = DIM;
        text.style.textDecoration = 'line-through';
        hint.style.display = 'none';
      } else if (!activeShown) {
        // The first unfinished objective shows its hint.
        activeShown = true;
        text.style.color = TEXT;
        hint.style.display = 'block';
      } else {
        text.style.color = DIM;
        hint.style.display = 'none';
      }
    }
    if (this.done.every(Boolean)) {
      localStorage.setItem(DONE_KEY, '1');
      setTimeout(() => (this.el.style.display = 'none'), 4000);
    }
    return advanced;
  }
}
