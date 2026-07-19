// "How do I play" overlay — a ? button that explains the goal and controls,
// per input mode. Shown automatically on first visit.

const SEEN_KEY = 'wotc-help-seen';

const GOAL = `<b style="color:#ffd75f">SURVIVE UNTIL SUNRISE.</b><br>
You run the club at the bottom of the map. The Legion of Rotterdam attacks
through the wall in escalating waves. If <b>The Door</b> (your HQ) falls, you lose.<br><br>
<b>The loop:</b> Clubgoers dancing near your <b>Dancefloor</b> earn Vibe · the <b>Bar</b>
earns Cash · spend both on buildings and units · <b>Speaker Stacks</b> extend vision
but raise <b>Heat</b> — too much Heat and the police raid you · the <b>Door Policy</b>
trades income against Heat · defend until dawn. Score = peak Vibe.`;

const DESKTOP = `<b>Mouse:</b> left-click/drag select · right-click move (rally for buildings) ·
shift+right-click queue waypoints<br>
<b>Keys:</b> A+right-click attack-move · B cycle building (click to place) · with a
building selected T/Y/U/I train units · P door policy · H stop · ctrl+0-9 / 0-9
control groups · double-click select-type · M mute · F9 save replay · Esc cancel<br>
<b>Camera:</b> arrow keys pan · mouse wheel zoom · click the minimap to jump`;

const TOUCH = `<b>Touch:</b> tap a unit to select · drag a box to select many · with units
selected, <b>tap the ground to move there</b> · tap an enemy area with ⚔ ATTACK armed
to fight your way in<br>
<b>Buttons:</b> ⚔ arm attack-move · ✋ stop · 🏗 cycle building then tap to place ·
＋ buttons train (select one of your buildings first) · 🚪 door policy · ✕ cancel<br>
<b>Camera:</b> two-finger drag to pan · pinch to zoom · tap the minimap to jump`;

export function setupHelp(touch: boolean): void {
  const btn = document.createElement('div');
  btn.textContent = '?';
  btn.style.cssText =
    'position:fixed;top:12px;right:12px;width:36px;height:36px;border-radius:50%;' +
    'border:1px solid #555;background:#111c;color:#7fff9f;font:bold 18px monospace;' +
    'display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer';
  document.getElementById('hud')?.appendChild(btn);

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:#000d;display:none;align-items:center;' +
    'justify-content:center;pointer-events:auto;z-index:10';
  overlay.innerHTML =
    `<div style="max-width:640px;margin:16px;padding:20px 24px;background:#0d0d12;border:1px solid #333;` +
    `border-radius:8px;font:13px/1.6 monospace;color:#ccc">` +
    `<div style="font-size:18px;color:#7fff9f;margin-bottom:10px">WORLD OF TECHNOCRAFT</div>` +
    `${GOAL}<br><br>${touch ? TOUCH : DESKTOP}<br><br>` +
    `<i style="color:#777">"The lineup doesn't matter. It's about the vibe." — tap/click anywhere to close</i></div>`;
  document.getElementById('hud')?.appendChild(overlay);

  const show = () => (overlay.style.display = 'flex');
  const hide = () => (overlay.style.display = 'none');
  btn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    show();
  });
  overlay.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    hide();
  });

  if (!localStorage.getItem(SEEN_KEY)) {
    localStorage.setItem(SEEN_KEY, '1');
    show();
  }
}
