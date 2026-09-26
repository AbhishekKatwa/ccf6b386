import type { Farm, Shed, ShedGeometry } from '@/types';

/**
 * Site-plan maths for the farm layout editor.
 *
 * Everything here is plain geometry: React and Zustand own the numbers, this module only
 * resolves, constrains and compares them. Metres throughout, origin at the centre of the
 * farm plot, X along the plot's length and Y across it (three.js maps that to X/Z).
 */

export const DEFAULT_PLOT = { lengthM: 300, widthM: 200 };

/** A typical Amrut layer shed: 100m × 15m × 5m. */
export const DEFAULT_SHED = { lengthM: 100, widthM: 15, heightM: 5 };

export const LIMITS = {
  lengthM: { min: 6, max: 250 },
  widthM: { min: 3, max: 120 },
  heightM: { min: 2, max: 20 },
  plotLengthM: { min: 60, max: 2000 },
  plotWidthM: { min: 40, max: 2000 },
} as const;

/** Snap step for moves and resizes, in metres. */
export const GRID_STEP = 5;
/** Rotation increments; a full turn is 24 of them. */
export const ROTATE_STEP = 15;
/** Clearance a shed wants from the plot edge; also the gap between auto-placed rows. */
export const GUTTER = 10;
/** Minor grid lines every 5m, emphasised every 25m. */
export const MAJOR_GRID = 25;

export interface Placement {
  layoutX: number;
  layoutY: number;
  rotationDeg: number;
  lengthM: number;
  widthM: number;
  heightM: number;
}

export type Plot = { lengthM: number; widthM: number };

export function plotOf(farm: Pick<Farm, 'plotLengthM' | 'plotWidthM'> | null | undefined): Plot {
  return {
    lengthM: num(farm?.plotLengthM) ?? DEFAULT_PLOT.lengthM,
    widthM: num(farm?.plotWidthM) ?? DEFAULT_PLOT.widthM,
  };
}

/** How many sheds of `span` fit end to end in `run`, at `gutter` clearance. */
function count(run: number, span: number, gutter: number): number {
  return Math.max(1, Math.floor(1 + (run - 2 * gutter - span) / (span + gutter)));
}

/** Sheds created before the editor existed still need a place to stand. */
export function autoPlace(index: number, plot: Plot): Placement {
  const { lengthM, widthM } = DEFAULT_SHED;
  const cols = count(plot.lengthM, lengthM, GUTTER);
  const row = Math.floor(index / cols);
  const col = index % cols;
  return clampToPlot({
    ...DEFAULT_SHED,
    layoutX: -plot.lengthM / 2 + GUTTER + lengthM / 2 + col * (lengthM + GUTTER),
    layoutY: -plot.widthM / 2 + GUTTER + widthM / 2 + row * (widthM + GUTTER),
    rotationDeg: 0,
  }, plot);
}

export function geometryOf(shed: Shed, index: number, plot: Plot): Placement {
  const auto = autoPlace(index, plot);
  return clampToPlot({
    layoutX: num(shed.layoutX) ?? auto.layoutX,
    layoutY: num(shed.layoutY) ?? auto.layoutY,
    rotationDeg: normDeg(num(shed.rotationDeg) ?? 0),
    lengthM: clamp(num(shed.lengthM) ?? auto.lengthM, LIMITS.lengthM),
    widthM: clamp(num(shed.widthM) ?? auto.widthM, LIMITS.widthM),
    heightM: clamp(num(shed.heightM) ?? auto.heightM, LIMITS.heightM),
  }, plot);
}

export function snap(v: number, step = GRID_STEP): number {
  return Math.round(v / step) * step;
}

export function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Rotated half-extents along the world axes — the shed's bounding box on the ground. */
export function halfExtents(g: Pick<Placement, 'lengthM' | 'widthM' | 'rotationDeg'>) {
  const rad = (g.rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    hx: (c * g.lengthM) / 2 + (s * g.widthM) / 2,
    hy: (s * g.lengthM) / 2 + (c * g.widthM) / 2,
  };
}

export function clampToPlot(g: Placement, plot: Plot): Placement {
  const { hx, hy } = halfExtents(g);
  const mx = Math.max(0, plot.lengthM / 2 - hx);
  const my = Math.max(0, plot.widthM / 2 - hy);
  return {
    ...g,
    layoutX: clamp(g.layoutX, { min: -mx, max: mx }),
    layoutY: clamp(g.layoutY, { min: -my, max: my }),
  };
}

/** True when a shed's bounding box stays inside the plot. */
export function insidePlot(g: Placement, plot: Plot): boolean {
  const { hx, hy } = halfExtents(g);
  return Math.abs(g.layoutX) + hx <= plot.lengthM / 2 + 1e-6
    && Math.abs(g.layoutY) + hy <= plot.widthM / 2 + 1e-6;
}

export function corners(g: Pick<Placement, 'layoutX' | 'layoutY' | 'lengthM' | 'widthM' | 'rotationDeg'>) {
  const rad = (g.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const lx = g.lengthM / 2;
  const ly = g.widthM / 2;
  return [[-lx, -ly], [lx, -ly], [lx, ly], [-lx, ly]].map(([px, py]) => ({
    x: g.layoutX + px * c - py * s,
    y: g.layoutY + px * s + py * c,
  }));
}

function axesOf(g: Pick<Placement, 'rotationDeg'>) {
  const rad = (g.rotationDeg * Math.PI) / 180;
  return [{ x: Math.cos(rad), y: Math.sin(rad) }, { x: -Math.sin(rad), y: Math.cos(rad) }];
}

/** Separating-axis test on two rectangles lying on the ground. */
export function overlaps(a: Placement, b: Placement, gap = 0): boolean {
  const inflate = (g: Placement) => corners({ ...g, lengthM: g.lengthM + gap, widthM: g.widthM + gap });
  const [ca, cb] = [inflate(a), inflate(b)];
  return [...axesOf(a), ...axesOf(b)].every(axis => {
    const [pa, pb] = [ca, cb].map(cs => {
      const proj = cs.map(p => p.x * axis.x + p.y * axis.y);
      return [Math.min(...proj), Math.max(...proj)] as const;
    });
    return pa[0] < pb[1] && pb[0] < pa[1];
  });
}

/** Ids of every placement that collides with another, plus the ones hanging off the plot. */
export function layoutIssues(rows: Placement[], plot: Plot) {
  const colliding = new Set<number>();
  const outside = new Set<number>();
  rows.forEach((a, i) => {
    if (!insidePlot(a, plot)) outside.add(i);
    rows.forEach((b, j) => {
      if (i !== j && overlaps(a, b)) colliding.add(i);
    });
  });
  return { colliding, outside };
}

/** The nearest clear grid position at or around `g`, pushed outward along the row it sits in. */
export function findFreeSpot(g: Placement, others: Placement[], plot: Plot): Placement {
  if (!others.some(o => overlaps(o, g))) return clampToPlot(g, plot);
  const pitchX = g.lengthM + GUTTER;
  const pitchY = g.widthM + GUTTER;
  for (let i = 1; i <= 60; i++) {
    for (const d of [pitchY, -pitchY, pitchX, -pitchX]) {
      const horizontal = Math.abs(d) === pitchX;
      const candidate: Placement = horizontal
        ? { ...g, layoutX: snap(g.layoutX + d) }
        : { ...g, layoutY: snap(g.layoutY + d) };
      if (insidePlot(candidate, plot) && !others.some(o => overlaps(o, candidate))) return candidate;
    }
  }
  return clampToPlot(g, plot);
}

export function areaOf(g: Pick<Placement, 'lengthM' | 'widthM'>): number {
  return g.lengthM * g.widthM;
}

/** `shed_001` — the scannable tag the editor shows beside a shed's own name. */
export function objectCode(index: number): string {
  return `shed_${String(index + 1).padStart(3, '0')}`;
}

const DIM_LABEL = { lengthM: 'length', widthM: 'width', heightM: 'height' } as const;

/** Numeric fields arrive from text inputs; reject a typo rather than clamp it into a wall. */
export function dimensionError(g: Pick<Placement, 'lengthM' | 'widthM' | 'heightM'>): string | null {
  for (const key of ['lengthM', 'widthM', 'heightM'] as const) {
    const v = g[key];
    if (!Number.isFinite(v)) return `Enter a valid ${DIM_LABEL[key]}`;
    if (v < LIMITS[key].min || v > LIMITS[key].max) {
      return `${cap(DIM_LABEL[key])} must be between ${LIMITS[key].min}m and ${LIMITS[key].max}m`;
    }
  }
  return null;
}

export function plotError(plot: Plot): string | null {
  if (!Number.isFinite(plot.lengthM) || !Number.isFinite(plot.widthM)) return 'Enter a valid plot size';
  if (plot.lengthM < LIMITS.plotLengthM.min || plot.lengthM > LIMITS.plotLengthM.max) {
    return `Plot length must be between ${LIMITS.plotLengthM.min}m and ${LIMITS.plotLengthM.max}m`;
  }
  if (plot.widthM < LIMITS.plotWidthM.min || plot.widthM > LIMITS.plotWidthM.max) {
    return `Plot width must be between ${LIMITS.plotWidthM.min}m and ${LIMITS.plotWidthM.max}m`;
  }
  return null;
}

/**
 * What the editor holds versus what the store holds. Cheap, so Save can honestly say
 * whether anything is pending, and Discard can prove it has nothing left to undo.
 */
export function layoutSignature(rows: Array<{ id: string; name: string; geo: Placement }>, plot: Plot): string {
  return `${plot.lengthM}x${plot.widthM}|` + rows
    .map(({ id, name, geo }) => `${id}:${name},${geo.layoutX},${geo.layoutY},${geo.rotationDeg},${geo.lengthM},${geo.widthM},${geo.heightM}`)
    .sort()
    .join('|');
}

/** Six numbers say whether a shed moved; used to skip writing rows nobody touched. */
export function placementEqual(a: Placement, b: Placement): boolean {
  return a.layoutX === b.layoutX && a.layoutY === b.layoutY && a.rotationDeg === b.rotationDeg
    && a.lengthM === b.lengthM && a.widthM === b.widthM && a.heightM === b.heightM;
}

export function geometryPatch(g: Placement): Required<ShedGeometry> {  return {
    layoutX: round3(g.layoutX),
    layoutY: round3(g.layoutY),
    rotationDeg: round3(g.rotationDeg),
    lengthM: round3(g.lengthM),
    widthM: round3(g.widthM),
    heightM: round3(g.heightM),
  };
}

function round3(v: number) { return Math.round(v * 1000) / 1000; }
function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function clamp(v: number, { min, max }: { min: number; max: number }): number {
  return Math.min(Math.max(v, min), max);
}
