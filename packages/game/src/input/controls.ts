// RTS control spine: drag-box select, click select, double-click select-type,
// right-click orders (shift = queue waypoints, A = attack-move), control
// groups 0–9, instant acknowledgment (ring flash + blip on ISSUE, not on sim
// confirm — the sim applies the command next tick).
//
// Shift-queued waypoints live host-side: each queued leg is issued as a
// normal move command when the unit goes idle, so the stamped command stream
// stays the complete record and replays reproduce the exact same movement.

import { FP, isWalkable, type WalkGrid } from '@wotc/sim';
import { BUILDINGS, BUILDINGS_BY_ID, UNITS } from '@wotc/data';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { blipOrder, blipSelect } from '../audio/blip.ts';
import type { GameScene } from '../render/scene.ts';
import type { SimHost, UnitView } from '../simHost.ts';

/** Buildable roster for the player faction, cycled with B. */
const BUILDABLE = [
  BUILDINGS.dancefloor,
  BUILDINGS.bar,
  BUILDINGS.speaker_stack,
  BUILDINGS.booth,
  BUILDINGS.smoke_machine,
];

/** Training hotkeys: T/Y/U/I map to the selected building's trains[0..3]. */
const TRAIN_KEYS: Record<string, number> = { KeyT: 0, KeyY: 1, KeyU: 2, KeyI: 3 };

const CLICK_RADIUS_PX = 16;
const DRAG_THRESHOLD_PX = 5;
const PLAYER_ID = 0;

interface Waypoint {
  x: number;
  y: number;
  mode?: 'a';
}

export class Controls {
  readonly selected = new Set<number>();
  attackMovePending = false;
  /** Index into BUILDABLE while in build-placement mode, or -1. */
  buildMode = -1;

  private groups = new Map<number, number[]>();
  private queues = new Map<number, Waypoint[]>();
  /** Don't re-drain a unit's queue until the sim confirms its last order. */
  private inFlightUntil = new Map<number, number>();
  private dragStart: { x: number; y: number } | null = null;
  private dragRect: HTMLDivElement;
  private views: UnitView[] = [];
  private ghost: Mesh;
  private ghostMat: StandardMaterial;
  private lastPointer = { x: 0, y: 0 };

  constructor(
    private game: GameScene,
    private host: SimHost,
    private grid: WalkGrid,
  ) {
    this.ghost = MeshBuilder.CreateBox('ghost', { size: 1 }, game.scene);
    this.ghostMat = new StandardMaterial('ghostMat', game.scene);
    this.ghostMat.alpha = 0.45;
    this.ghostMat.disableLighting = true;
    this.ghost.material = this.ghostMat;
    this.ghost.isPickable = false;
    this.ghost.setEnabled(false);
    this.dragRect = document.createElement('div');
    this.dragRect.style.cssText =
      'position:fixed;border:1px solid #7fff9f;background:#7fff9f22;display:none;pointer-events:none';
    document.getElementById('hud')?.appendChild(this.dragRect);

    const canvas = game.scene.getEngine().getRenderingCanvas()!;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    host.onSnapshot = () => this.drainQueues();
  }

  /** Called each frame with the latest interpolated views. */
  setViews(views: UnitView[]): void {
    this.views = views;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  private screenPos(u: UnitView, out: Vector3): Vector3 {
    const engine = this.game.scene.getEngine();
    return Vector3.ProjectToRef(
      new Vector3(u.x, 0.55, u.y),
      Matrix.IdentityReadOnly,
      this.game.scene.getTransformMatrix(),
      this.game.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
      out,
    );
  }

  private selectableAt(px: number, py: number): UnitView | null {
    const tmp = new Vector3();
    let best: UnitView | null = null;
    let bestD = CLICK_RADIUS_PX;
    for (const u of this.views) {
      if (u.player !== PLAYER_ID) continue;
      this.screenPos(u, tmp);
      const d = Math.hypot(tmp.x - px, tmp.y - py);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private applySelection(eids: number[], additive: boolean): void {
    if (!additive) this.selected.clear();
    for (const eid of eids) this.selected.add(eid);
    if (eids.length > 0) blipSelect();
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 0) {
      if (this.buildMode >= 0) {
        this.placeBuilding(e.clientX, e.clientY, e.shiftKey);
        return;
      }
      this.dragStart = { x: e.clientX, y: e.clientY };
    } else if (e.button === 2) {
      if (this.buildMode >= 0) {
        this.exitBuildMode();
        return;
      }
      this.issueOrder(e.clientX, e.clientY, e.shiftKey);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.buildMode >= 0) this.updateGhost();
    if (!this.dragStart) return;
    const x0 = Math.min(this.dragStart.x, e.clientX);
    const y0 = Math.min(this.dragStart.y, e.clientY);
    const w = Math.abs(e.clientX - this.dragStart.x);
    const h = Math.abs(e.clientY - this.dragStart.y);
    if (w + h > DRAG_THRESHOLD_PX) {
      Object.assign(this.dragRect.style, {
        display: 'block',
        left: `${x0}px`,
        top: `${y0}px`,
        width: `${w}px`,
        height: `${h}px`,
      });
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.dragStart) return;
    const start = this.dragStart;
    this.dragStart = null;
    this.dragRect.style.display = 'none';

    const w = Math.abs(e.clientX - start.x);
    const h = Math.abs(e.clientY - start.y);
    if (w + h <= DRAG_THRESHOLD_PX) {
      const hit = this.selectableAt(e.clientX, e.clientY);
      this.applySelection(hit ? [hit.eid] : [], e.shiftKey);
      return;
    }
    const x0 = Math.min(start.x, e.clientX);
    const x1 = Math.max(start.x, e.clientX);
    const y0 = Math.min(start.y, e.clientY);
    const y1 = Math.max(start.y, e.clientY);
    const tmp = new Vector3();
    const eids: number[] = [];
    for (const u of this.views) {
      if (u.player !== PLAYER_ID) continue;
      this.screenPos(u, tmp);
      if (tmp.x >= x0 && tmp.x <= x1 && tmp.y >= y0 && tmp.y <= y1) eids.push(u.eid);
    }
    this.applySelection(eids, e.shiftKey);
  }

  private onDoubleClick(e: MouseEvent): void {
    const hit = this.selectableAt(e.clientX, e.clientY);
    if (!hit) return;
    const engine = this.game.scene.getEngine();
    const tmp = new Vector3();
    const eids: number[] = [];
    for (const u of this.views) {
      if (u.player !== PLAYER_ID || u.kind !== hit.kind) continue;
      this.screenPos(u, tmp);
      if (tmp.x >= 0 && tmp.x <= engine.getRenderWidth() && tmp.y >= 0 && tmp.y <= engine.getRenderHeight()) {
        eids.push(u.eid);
      }
    }
    this.applySelection(eids, e.shiftKey);
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  private groundPoint(px: number, py: number): { x: number; y: number } | null {
    const pick = this.game.scene.pick(px, py, (m) => m === this.game.ground);
    if (!pick?.pickedPoint) return null;
    return { x: pick.pickedPoint.x, y: pick.pickedPoint.z };
  }

  private isBuildingEid(eid: number): boolean {
    return this.views.some((v) => v.eid === eid && v.building);
  }

  private issueOrder(px: number, py: number, queue: boolean): void {
    const target = this.groundPoint(px, py);
    if (!target) return;
    const alive = [...this.selected].filter((eid) => this.host.isAlive(eid));
    // Buildings get a rally point instead of a move order.
    const buildings = alive.filter((eid) => this.isBuildingEid(eid));
    for (const b of buildings) {
      this.host.issue({
        playerId: PLAYER_ID,
        type: 'rally',
        buildingId: b,
        x: Math.round(target.x * FP),
        y: Math.round(target.y * FP),
      });
    }
    const unitIds = alive.filter((eid) => !this.isBuildingEid(eid));
    if (unitIds.length === 0) {
      if (buildings.length > 0) {
        this.game.ping(target.x, target.y, 'move');
        blipOrder();
      }
      return;
    }

    const mode = this.attackMovePending ? ('a' as const) : undefined;
    this.attackMovePending = false;
    const wp: Waypoint = mode ? { x: target.x, y: target.y, mode } : { x: target.x, y: target.y };

    if (queue) {
      for (const eid of unitIds) {
        const q = this.queues.get(eid) ?? [];
        q.push(wp);
        this.queues.set(eid, q);
      }
    } else {
      for (const eid of unitIds) this.queues.delete(eid);
      this.sendMove(unitIds, wp);
    }
    this.game.ping(target.x, target.y, mode ? 'attack' : 'move');
    blipOrder();
  }

  private sendMove(unitIds: number[], wp: Waypoint): void {
    this.host.issue({
      playerId: PLAYER_ID,
      type: 'move',
      unitIds,
      x: Math.round(wp.x * FP),
      y: Math.round(wp.y * FP),
      ...(wp.mode ? { mode: wp.mode } : {}),
    });
    const until = this.host.tick + 3;
    for (const eid of unitIds) this.inFlightUntil.set(eid, until);
  }

  /** Issue the next queued waypoint for units that have gone idle. */
  private drainQueues(): void {
    if (this.queues.size === 0) return;
    const tick = this.host.tick;
    for (const [eid, q] of this.queues) {
      if (!this.host.isAlive(eid)) {
        this.queues.delete(eid);
        continue;
      }
      if (this.host.isMoving(eid) || (this.inFlightUntil.get(eid) ?? 0) > tick) continue;
      const wp = q.shift();
      if (wp) this.sendMove([eid], wp);
      if (q.length === 0) this.queues.delete(eid);
    }
  }

  // ── Build placement ───────────────────────────────────────────────────────

  /** Human-readable current build selection for the HUD. */
  buildModeName(): string | null {
    return this.buildMode >= 0 ? BUILDABLE[this.buildMode]!.name : null;
  }

  private exitBuildMode(): void {
    this.buildMode = -1;
    this.ghost.setEnabled(false);
  }

  private ghostCell(): { cellX: number; cellY: number } | null {
    const p = this.groundPoint(this.lastPointer.x, this.lastPointer.y);
    if (!p) return null;
    const def = BUILDABLE[this.buildMode]!;
    return {
      cellX: Math.round(p.x - def.w / 2),
      cellY: Math.round(p.y - def.h / 2),
    };
  }

  private footprintFree(cellX: number, cellY: number, w: number, h: number): boolean {
    for (let y = cellY; y < cellY + h; y++) {
      for (let x = cellX; x < cellX + w; x++) {
        if (!isWalkable(this.grid, x, y)) return false;
      }
    }
    // Approximate check against known buildings (sim revalidates anyway).
    for (const v of this.views) {
      if (!v.building) continue;
      const def = BUILDINGS_BY_ID.get(v.kind);
      if (!def) continue;
      const bx = v.x - def.w / 2;
      const by = v.y - def.h / 2;
      if (cellX < bx + def.w && cellX + w > bx && cellY < by + def.h && cellY + h > by) {
        return false;
      }
    }
    return true;
  }

  private updateGhost(): void {
    const cell = this.ghostCell();
    if (!cell) {
      this.ghost.setEnabled(false);
      return;
    }
    const def = BUILDABLE[this.buildMode]!;
    const ok = this.footprintFree(cell.cellX, cell.cellY, def.w, def.h);
    this.ghost.setEnabled(true);
    this.ghost.scaling.set(def.w * 0.95, 2, def.h * 0.95);
    this.ghost.position.set(cell.cellX + def.w / 2, 1, cell.cellY + def.h / 2);
    this.ghostMat.emissiveColor = ok ? new Color3(0.2, 0.9, 0.4) : new Color3(0.9, 0.2, 0.2);
  }

  private findBuilder(): number | null {
    // Prefer a selected Cable Guy, else any own idle one.
    const isBuilderView = (v: UnitView) =>
      v.player === PLAYER_ID && !v.building && v.kind === UNITS.cable_guy.id;
    const selected = this.views.find((v) => this.selected.has(v.eid) && isBuilderView(v));
    if (selected) return selected.eid;
    const any = this.views.find(isBuilderView);
    return any ? any.eid : null;
  }

  private placeBuilding(px: number, py: number, keepPlacing: boolean): void {
    this.lastPointer = { x: px, y: py };
    const cell = this.ghostCell();
    if (!cell) return;
    const def = BUILDABLE[this.buildMode]!;
    if (!this.footprintFree(cell.cellX, cell.cellY, def.w, def.h)) return;
    const builder = this.findBuilder();
    if (builder === null) return;
    this.host.issue({
      playerId: PLAYER_ID,
      type: 'build',
      builderId: builder,
      kind: def.id,
      cellX: cell.cellX,
      cellY: cell.cellY,
    });
    this.game.ping(cell.cellX + def.w / 2, cell.cellY + def.h / 2, 'move');
    blipOrder();
    if (!keepPlacing) this.exitBuildMode();
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    const digit = /^Digit(\d)$/.exec(e.code)?.[1];
    if (digit !== undefined) {
      const n = Number(digit);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(n, [...this.selected]);
      } else {
        const alive = (this.groups.get(n) ?? []).filter((eid) => this.host.isAlive(eid));
        this.groups.set(n, alive);
        this.applySelection(alive, false);
      }
      return;
    }
    if (e.code === 'KeyA') this.attackMovePending = true;
    if (e.code === 'KeyB') {
      this.buildMode = (this.buildMode + 1) % BUILDABLE.length;
      this.updateGhost();
    }
    if (e.code === 'KeyP') {
      this.host.issue({ playerId: PLAYER_ID, type: 'policy', value: (this.host.policy + 1) % 3 });
    }
    const trainSlot = TRAIN_KEYS[e.code];
    if (trainSlot !== undefined) {
      const building = this.views.find(
        (v) => this.selected.has(v.eid) && v.building && v.player === PLAYER_ID,
      );
      if (building) {
        const def = BUILDINGS_BY_ID.get(building.kind);
        const kind = def?.trains[trainSlot];
        if (kind !== undefined) {
          this.host.issue({ playerId: PLAYER_ID, type: 'train', buildingId: building.eid, kind });
          blipOrder();
        }
      }
    }
    if (e.code === 'Escape') {
      this.attackMovePending = false;
      if (this.buildMode >= 0) this.exitBuildMode();
      else this.selected.clear();
    }
    if (e.code === 'KeyH') {
      const unitIds = [...this.selected].filter((eid) => this.host.isAlive(eid));
      if (unitIds.length > 0) {
        for (const eid of unitIds) this.queues.delete(eid);
        this.host.issue({ playerId: PLAYER_ID, type: 'stop', unitIds });
        blipOrder();
      }
    }
  }
}
