// Shared HUD look: one place for the chrome palette and control styles so the
// top bar, command card, objectives, and overlays read as one instrument.

export const CHROME_BG = '#0d0d13f2';
export const CHROME_BORDER = '1px solid #26262f';
export const ACCENT = '#7fff9f';
export const GOLD = '#ffd75f';
export const TEXT = '#d8d8de';
export const DIM = '#8a8a94';
export const FONT = '12px/1.45 monospace';

/** A clickable HUD button. Interactive elements opt into pointer events. */
export const BTN_CSS =
  'pointer-events:auto;border-radius:6px;border:1px solid #34343f;background:#15151d;' +
  `color:${TEXT};font:${FONT};display:flex;flex-direction:column;align-items:center;` +
  'justify-content:center;user-select:none;-webkit-user-select:none;cursor:pointer;text-align:center';

export const BTN_ACTIVE_BG = '#1d3a26';
export const BTN_ARMED_BG = '#5a2020';
export const BTN_DISABLED = 'opacity:0.4;cursor:default';

/** Overlay-open marker: camera edge-scroll and hotkeys check this. */
export function setOverlayOpen(open: boolean): void {
  if (open) document.body.dataset['overlay'] = '1';
  else delete document.body.dataset['overlay'];
}

export function isOverlayOpen(): boolean {
  return document.body.dataset['overlay'] === '1';
}
