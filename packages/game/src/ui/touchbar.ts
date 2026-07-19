// On-screen controls for touch devices — everything that lives on keys on
// desktop. Shown when the primary pointer is coarse (phones/tablets).

import type { Controls } from '../input/controls.ts';
import type { TechnoEngine } from '../audio/techno.ts';

const BTN =
  'pointer-events:auto;min-width:52px;height:44px;padding:0 10px;border-radius:8px;' +
  'border:1px solid #444;background:#111c;color:#e8e8e8;font:12px monospace;' +
  'display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none';

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

export class TouchBar {
  private bar: HTMLDivElement;
  private attackBtn: HTMLDivElement;
  private buildBtn: HTMLDivElement;
  private trainBtns: HTMLDivElement[] = [];

  constructor(
    private controls: Controls,
    audio: TechnoEngine,
  ) {
    this.bar = document.createElement('div');
    this.bar.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);bottom:12px;display:flex;' +
      'gap:8px;pointer-events:none;flex-wrap:wrap;justify-content:center;max-width:96vw';
    document.getElementById('hud')?.appendChild(this.bar);

    const btn = (label: string, onTap: () => void): HTMLDivElement => {
      const el = document.createElement('div');
      el.style.cssText = BTN;
      el.textContent = label;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onTap();
      });
      this.bar.appendChild(el);
      return el;
    };

    this.attackBtn = btn('⚔ ATTACK', () => controls.toggleAttackMove());
    btn('✋ STOP', () => controls.stopSelected());
    this.buildBtn = btn('🏗 BUILD', () => controls.cycleBuild());
    for (let i = 0; i < 2; i++) {
      const b = btn(`T${i + 1}`, () => controls.train(i));
      b.style.display = 'none';
      this.trainBtns.push(b);
    }
    btn('🚪 DOOR', () => controls.cyclePolicy());
    btn('✕', () => controls.cancel());
    btn('🔊', () => audio.toggleMute());
  }

  /** Called from the render loop to reflect current state. */
  update(): void {
    this.attackBtn.style.background = this.controls.attackMovePending ? '#a22c' : '#111c';
    const buildName = this.controls.buildModeName();
    this.buildBtn.textContent = buildName ? `🏗 ${buildName.toUpperCase()}` : '🏗 BUILD';
    this.buildBtn.style.background = buildName ? '#173c17cc' : '#111c';
    const options = this.controls.trainOptions();
    this.trainBtns.forEach((b, i) => {
      const name = options[i];
      b.style.display = name ? 'flex' : 'none';
      if (name) b.textContent = `＋ ${name.toUpperCase()}`;
    });
  }
}
