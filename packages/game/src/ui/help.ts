// "How do I play" overlay — a ? button that explains the goal and controls,
// per input mode. Shown automatically on first visit.

const SEEN_KEY = 'wotc-help-seen';

const GOAL = `<b style="color:#ffd75f">RAZE THE WARCAMP. PROTECT THE CLUB.</b><br>
Classic RTS rules: you win by destroying every Legion building (they're NE,
beyond the wall); you lose when your last building falls. The Legion AI plays
the same game you do — harvests, builds, tiers up, attacks.<br><br>
<b>The economy:</b> Clubgoers haul <b>Cash</b> from <b>The Queue</b> (the gold line outside
your door) and <b>Gear</b> from crate stacks — right-click/tap a node to put them
to work. <b>Monitor Stacks</b> raise your Headroom (supply cap). Upgrade your HQ
(<b>V</b>) to unlock tier-2 units. Your <b>Resident DJ</b> is a hero: earns XP from
kills, levels up, casts Q/W/E/R — at level 6, <b>THE DROP</b>.<br>
Neutral <b>creep camps</b> guard the middle: farm them for bounty + XP. At <b>night</b>
everyone sees shorter. Speakers raise <b>Heat</b>; too much and the police raid.`;

const DESKTOP = `<b>Mouse:</b> left-click/drag select · right-click move / harvest (on a node) /
rally (buildings) · shift+right-click queue waypoints<br>
<b>Keys:</b> A attack-move · B cycle building, click to place · T/Y/U/I train (building
selected) · V tier upgrade · Q/W/E/R hero abilities (at the cursor) · G revive ·
P door policy · H stop · ctrl+0-9 groups · M mute · F9 replay · Esc cancel<br>
<b>Camera:</b> arrow keys pan · wheel zoom · click the minimap to jump`;

const TOUCH = `<b>Touch:</b> tap = select · drag = box select · with units selected,
<b>tap the ground to move</b>, tap a gold/brown node to harvest · ⚔ then tap =
attack-move<br>
<b>Buttons:</b> ⚔ attack · ✋ stop · 🏗 build then tap to place · ＋ train (select a
building) · Q/W/E/R hero abilities (Q/E arm, then tap the target) · ⬆ TIER ·
💿 revive · 🚪 door policy · ✕ cancel<br>
<b>Camera:</b> two-finger drag pan · pinch zoom · tap the minimap to jump`;

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
