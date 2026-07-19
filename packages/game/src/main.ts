import { FP } from '@wotc/sim';

// Boot placeholder — replaced by engine boot in M2.
const el = document.createElement('div');
el.style.cssText = 'position:fixed;top:12px;left:12px;font:12px monospace;color:#7fff9f';
el.textContent = `World of TechnoCraft — scaffold OK (FP=${FP}, crossOriginIsolated=${globalThis.crossOriginIsolated})`;
document.getElementById('hud')?.appendChild(el);
