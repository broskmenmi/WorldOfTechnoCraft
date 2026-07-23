// "How do I play" overlay — a ? button that explains the goal and controls,
// per input mode. Shown automatically on first visit.

import { setOverlayOpen } from './theme.ts';

const SEEN_KEY = 'wotc-help-seen';

const GOAL = `<b style="color:#ffd75f">WIN THE SOUND CLASH FOR THE CITY.</b><br>
Two scenes, one postcode. You run the club (SW); the Gabber Legion runs the
warcamp (NE, past the wall). Nobody dies here — outclashed crew members
<i>rage-quit and go home</i>, and buildings get <i>shut down by the city council</i>.
You win when every Legion structure is shut down; you lose when yours are.<br><br>
<b>The loop:</b> Clubgoers haul <b>Cash</b> from <b>The Queue</b> (the gold line outside
your door) and <b>Gear</b> from crate stacks — right-click/tap a node to put them
to work. Build <b>Monitor Stacks</b> for Headroom (crowd cap), a <b>Booth</b> to grow
the crew, and tier up your HQ for the heavy hitters. Your <b>Resident DJ</b> levels
up from clashes and casts Q/W/E/R — at level 6: <b>THE DROP</b>.<br>
Wandering <b>inspectors and feral gabbers</b> hold the middle — confronting them
pays bounty + XP. At <b>night</b> everyone sees shorter. Speakers raise <b>Heat</b>;
too much and the council sends a raid.`;

const CAMERA_DESKTOP = `<b style="color:#7fff9f">Camera:</b> arrow keys pan · push the mouse to a screen edge ·
wheel zoom · click/drag the minimap · Space = back to base`;

const DESKTOP = `<b>Mouse:</b> left-click/drag select · right-click move / harvest (on a node) /
rally (buildings) · shift+right-click queue waypoints · double-click = select all of a type<br>
<b>Keys:</b> A confront-move · F select whole crew · , (comma) idle worker ·
T/Y/U/I train · V tier up · Q/W/E/R DJ abilities · G re-book the DJ ·
P door policy · H hold · ctrl+0-9 groups · M mute · F3 debug · F9 replay · Esc cancel<br>
<b>Everything is also on the command card</b> at the bottom — select something and
the buttons appear with names and costs.`;

const CAMERA_TOUCH = `<b style="color:#7fff9f">Camera:</b> two-finger drag pan · pinch zoom · tap/drag the minimap`;

const TOUCH = `<b>Touch:</b> tap = select · drag = box select · with a crew selected,
<b>tap the ground to move</b>, tap a gold/brown node to harvest<br>
<b>The command card</b> at the bottom has every action for whatever you selected —
build, train, abilities, tier up — with names and costs on the buttons.`;

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
    `<div style="max-width:660px;margin:16px;padding:20px 24px;background:#0d0d12;border:1px solid #333;` +
    `border-radius:8px;font:13px/1.6 monospace;color:#ccc;max-height:86vh;overflow-y:auto">` +
    `<div style="font-size:18px;color:#7fff9f;margin-bottom:10px">WORLD OF TECHNOCRAFT</div>` +
    `${GOAL}<br><br>${touch ? CAMERA_TOUCH : CAMERA_DESKTOP}<br><br>${touch ? TOUCH : DESKTOP}<br><br>` +
    `<i style="color:#777">"The lineup doesn't matter. It's about the vibe." — tap/click anywhere to close</i></div>`;
  document.getElementById('hud')?.appendChild(overlay);

  const show = () => {
    overlay.style.display = 'flex';
    setOverlayOpen(true);
  };
  const hide = () => {
    overlay.style.display = 'none';
    setOverlayOpen(false);
  };
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
