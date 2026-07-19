// Minimap: walls + fog + entity dots + camera indicator. Click to fly the
// camera. Redrawn at ~10 Hz from the latest snapshot.

import { isWalkable, type WalkGrid } from '@wotc/sim';
import { BUILDINGS_BY_ID } from '@wotc/data';
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { UnitView } from '../simHost.ts';

const SIZE = 176;
const TEAM_COLORS = ['#59ff8c', '#ff4dbf', '#4dbfff', '#ffd24d'];

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private walls: HTMLCanvasElement;
  private lastDraw = 0;

  constructor(
    private grid: WalkGrid,
    private camera: FreeCamera,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.canvas.style.cssText =
      'position:fixed;right:12px;bottom:12px;border:1px solid #333;background:#000;' +
      'pointer-events:auto;cursor:crosshair;image-rendering:pixelated';
    document.getElementById('hud')?.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Prerender static walls once.
    this.walls = document.createElement('canvas');
    this.walls.width = SIZE;
    this.walls.height = SIZE;
    const wc = this.walls.getContext('2d')!;
    wc.fillStyle = '#15151c';
    wc.fillRect(0, 0, SIZE, SIZE);
    wc.fillStyle = '#3a3a48';
    const s = SIZE / grid.w;
    for (let cy = 0; cy < grid.h; cy++) {
      for (let cx = 0; cx < grid.w; cx++) {
        if (!isWalkable(grid, cx, cy)) wc.fillRect(cx * s, cy * s, Math.ceil(s), Math.ceil(s));
      }
    }

    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const wx = ((e.clientX - rect.left) / SIZE) * grid.w;
      const wy = ((e.clientY - rect.top) / SIZE) * grid.h;
      camera.position.x = wx;
      camera.position.z = wy - 28; // keep the RTS camera offset
    });
  }

  update(views: UnitView[], fog: Uint8Array | null, now: number): void {
    if (now - this.lastDraw < 100) return;
    this.lastDraw = now;
    const { ctx, grid } = this;
    const s = SIZE / grid.w;
    ctx.drawImage(this.walls, 0, 0);

    // Fog dim: block-average is overkill — sample every 2 cells.
    if (fog) {
      ctx.fillStyle = '#000000cc';
      for (let cy = 0; cy < grid.h; cy += 2) {
        for (let cx = 0; cx < grid.w; cx += 2) {
          if (fog[cx + cy * grid.w] === 0) ctx.fillRect(cx * s, cy * s, s * 2, s * 2);
        }
      }
      ctx.fillStyle = '#00000066';
      for (let cy = 0; cy < grid.h; cy += 2) {
        for (let cx = 0; cx < grid.w; cx += 2) {
          if (fog[cx + cy * grid.w] === 1) ctx.fillRect(cx * s, cy * s, s * 2, s * 2);
        }
      }
    }

    for (const v of views) {
      if (fog && v.player !== 0) {
        const ci = Math.floor(v.x) + Math.floor(v.y) * grid.w;
        const seen = v.building ? fog[ci] !== 0 : fog[ci] === 2;
        if (!seen) continue;
      }
      ctx.fillStyle = TEAM_COLORS[v.player % TEAM_COLORS.length]!;
      if (v.building) {
        const def = BUILDINGS_BY_ID.get(v.kind);
        const w = (def?.w ?? 2) * s;
        ctx.fillRect(v.x * s - w / 2, v.y * s - w / 2, w, w);
      } else {
        ctx.fillRect(v.x * s - 1, v.y * s - 1, 2, 2);
      }
    }

    // Camera indicator.
    ctx.strokeStyle = '#ffffff88';
    ctx.strokeRect(this.camera.position.x * s - 10, (this.camera.position.z + 28) * s - 7, 20, 14);
  }
}
