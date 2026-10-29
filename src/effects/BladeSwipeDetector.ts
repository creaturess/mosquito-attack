/**
 * BladeSwipeDetector.ts
 * Manages Fruit Ninja-style touchscreen & mouse blade slicing:
 * - High-speed trail point tracking with timestamp decay.
 * - Glowing neon katana trail rendering (electric cyan + pure white core).
 * - Segment-to-circle mathematical collision test with minimum slice speed enforcement.
 */

export interface SwipePoint {
  x: number;
  y: number;
  time: number;
}

export interface MosquitoScreenTarget {
  id: string;
  screenX: number;
  screenY: number;
  radiusPx: number;
  isDead: boolean;
  userData: unknown;
}

export interface SliceHitResult {
  targetId: string;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  swipeSpeed: number;
}

export class BladeSwipeDetector {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private points: SwipePoint[] = [];

  // Key adjustable parameters
  public trailLifetimeMs: number = 160;  // How long the blade trail persists (ms)
  public minSwipeSpeed: number = 220;    // Min speed in px/s to trigger a valid slice
  public minSegmentLength: number = 8;    // Min pixel length per segment
  public coreColor: string = '#ffffff';  // Blade core color
  public glowColor: string = '#38bdf8';  // Neon blade glow color

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  public resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  public addPoint(x: number, y: number) {
    const now = performance.now();
    this.points.push({ x, y, time: now });
  }

  public endStroke() {
    // Keep points for a brief frame to allow visual fade
  }

  /**
   * Tests intersection between the most recent swipe segment and a list of screen targets.
   * Uses geometric segment-to-point projection.
   */
  public checkIntersections(targets: MosquitoScreenTarget[]): SliceHitResult[] {
    const hits: SliceHitResult[] = [];
    if (this.points.length < 2) return hits;

    const p2 = this.points[this.points.length - 1];
    const p1 = this.points[this.points.length - 2];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < this.minSegmentLength) return hits;

    const dt = Math.max((p2.time - p1.time) / 1000, 0.001);
    const speed = len / dt;

    // Reject slow drags (must be a decisive slice)
    if (speed < this.minSwipeSpeed) return hits;

    const lenSq = len * len;

    for (const target of targets) {
      if (target.isDead) continue;

      const cx = target.screenX;
      const cy = target.screenY;
      const radius = target.radiusPx;

      // Projection parameter t of target center onto line segment p1 -> p2
      // t = ((C - P1) · (P2 - P1)) / |P2 - P1|²
      const dot = (cx - p1.x) * dx + (cy - p1.y) * dy;
      const t = Math.max(0, Math.min(1, dot / lenSq));

      // Closest point Q on segment to circle center
      const qx = p1.x + t * dx;
      const qy = p1.y + t * dy;

      // Distance from circle center to Q
      const distSq = (cx - qx) * (cx - qx) + (cy - qy) * (cy - qy);

      if (distSq <= radius * radius) {
        hits.push({
          targetId: target.id,
          p1: { x: p1.x, y: p1.y },
          p2: { x: p2.x, y: p2.y },
          swipeSpeed: speed,
        });
      }
    }

    return hits;
  }

  /**
   * Renders the dynamic glowing Fruit Ninja blade trail on the 2D overlay canvas.
   */
  public render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = performance.now();

    // Prune stale points older than trailLifetimeMs
    this.points = this.points.filter((pt) => now - pt.time <= this.trailLifetimeMs);

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.points.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Draw outer neon glow pass
    for (let i = 0; i < this.points.length - 1; i++) {
      const ptA = this.points[i];
      const ptB = this.points[i + 1];

      const ageA = (now - ptA.time) / this.trailLifetimeMs;
      const progress = i / (this.points.length - 1);
      const alpha = Math.max(0, (1 - ageA) * progress);

      ctx.beginPath();
      ctx.moveTo(ptA.x, ptA.y);
      ctx.lineTo(ptB.x, ptB.y);

      ctx.strokeStyle = this.glowColor;
      ctx.globalAlpha = alpha * 0.85;
      ctx.lineWidth = 10 * progress + 2;
      ctx.shadowColor = this.glowColor;
      ctx.shadowBlur = 12;
      ctx.stroke();
    }

    // 2. Draw sharp white blade core pass
    for (let i = 0; i < this.points.length - 1; i++) {
      const ptA = this.points[i];
      const ptB = this.points[i + 1];

      const ageA = (now - ptA.time) / this.trailLifetimeMs;
      const progress = i / (this.points.length - 1);
      const alpha = Math.max(0, (1 - ageA) * progress);

      ctx.beginPath();
      ctx.moveTo(ptA.x, ptA.y);
      ctx.lineTo(ptB.x, ptB.y);

      ctx.strokeStyle = this.coreColor;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 4 * progress + 1;
      ctx.shadowBlur = 0;
      ctx.stroke();
    }

    ctx.restore();
  }

  public clear() {
    this.points = [];
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}
