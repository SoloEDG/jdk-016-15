// 屏幕空间的凸多边形 / 线段几何工具。
// 所有多边形在内部统一为逆时针（CCW）绕序，裁剪的“内侧”即边的左侧。
export interface Pt {
  x: number;
  y: number;
}

export const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** 二维叉积：b-a 与 c-a 的 z 分量，符号表示 c 位于有向边 a->b 的哪一侧。 */
export function cross2(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** 统一为逆时针绕序，剔除重复顶点与面积过小的退化多边形（返回空数组）。 */
export function normalize(poly: Pt[]): Pt[] {
  let pts = poly.filter(
    (p, i) =>
      i === 0 ||
      Math.hypot(p.x - poly[i - 1]!.x, p.y - poly[i - 1]!.y) > 1e-9,
  );
  // 首尾重合时去掉尾点。
  while (
    pts.length > 1 &&
    Math.hypot(
      pts[0]!.x - pts[pts.length - 1]!.x,
      pts[0]!.y - pts[pts.length - 1]!.y,
    ) <= 1e-9
  ) {
    pts.pop();
  }
  if (pts.length < 3) return [];
  if (polygonArea(pts) < 0) pts = pts.reverse();
  // 退化（共线/零面积）多边形不参与后续运算与渲染。
  if (Math.abs(polygonArea(pts)) < 1e-7) return [];
  return pts;
}

export interface HalfPlane {
  a: Pt;
  b: Pt;
  /** true 保留有向边 a->b 左侧（cross2 >= 0），false 保留右侧。 */
  keepLeft: boolean;
}

/** Sutherland–Hodgman 半平面裁剪，返回保留侧的凸多边形（可能不足 3 点）。 */
export function clipHalfPlane(
  poly: Pt[],
  a: Pt,
  b: Pt,
  keepLeft: boolean,
): Pt[] {
  if (poly.length < 3) return [];
  const out: Pt[] = [];
  const inside = (p: Pt) => {
    const c = cross2(a, b, p);
    return keepLeft ? c >= 0 : c <= 0;
  };
  let prev = poly[poly.length - 1]!;
  let prevIn = inside(prev);
  for (const cur of poly) {
    const curIn = inside(cur);
    if (curIn !== prevIn) {
      const t =
        cross2(a, b, prev) / (cross2(a, b, prev) - cross2(a, b, cur));
      out.push(lerp(prev, cur, t));
    }
    if (curIn) out.push(cur);
    prev = cur;
    prevIn = curIn;
  }
  return normalize(out);
}

/** 凸多边形交集：依次用 clipPoly 的每条边做半平面裁剪。 */
export function convexIntersect(poly: Pt[], clipPoly: Pt[]): Pt[] {
  let cur = normalize(poly);
  const clip = normalize(clipPoly);
  for (let i = 0; i < clip.length && cur.length >= 3; i++) {
    cur = clipHalfPlane(cur, clip[i]!, clip[(i + 1) % clip.length]!, true);
  }
  return cur.length >= 3 ? cur : [];
}

/**
 * 凸多边形差集 P \\ Q，返回互不重叠的凸多边形分片，恰好覆盖 P 中不在 Q 内的部分。
 * 逐边把“当前仍在 Q 内的残片”切出外侧分片，最后完全落在 Q 内的残片被丢弃。
 */
export function convexSubtract(poly: Pt[], clipPoly: Pt[]): Pt[][] {
  const q = normalize(clipPoly);
  let remaining = normalize(poly);
  const out: Pt[][] = [];
  for (let i = 0; i < q.length && remaining.length >= 3; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % q.length]!;
    const outside = clipHalfPlane(remaining, a, b, false);
    const inside = clipHalfPlane(remaining, a, b, true);
    if (outside.length >= 3) out.push(outside);
    remaining = inside;
  }
  return out;
}

/** 点是否落在凸多边形内（含边界）。poly 需为逆时针。 */
export function pointInConvex(p: Pt, poly: Pt[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (cross2(poly[i]!, poly[(i + 1) % poly.length]!, p) < -1e-9)
      return false;
  }
  return poly.length >= 3;
}

/**
 * 线段 a->b 落在一组半平面交集中的参数区间 [t0, t1]。
 * Liang–Barsky：对每条边取 s(t)=cross(edge, p(t)-edge.a)，
 * 左闭条件 s>=0（keepLeft=false 时取反），平行且在外侧返回 null。
 */
export function segmentHalfPlanesTRange(
  a: Pt,
  b: Pt,
  planes: HalfPlane[],
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const hp of planes) {
    const ex = hp.b.x - hp.a.x;
    const ey = hp.b.y - hp.a.y;
    const s0 = ex * (a.y - hp.a.y) - ey * (a.x - hp.a.x);
    const sd = ex * dy - ey * dx;
    const v0 = hp.keepLeft ? s0 : -s0;
    const vd = hp.keepLeft ? sd : -sd;
    // 要求 v0 + vd*t >= 0。
    if (Math.abs(vd) < 1e-12) {
      if (v0 < 0) return null;
      continue;
    }
    const t = -v0 / vd;
    if (vd > 0) {
      t0 = Math.max(t0, t); // 下界：t >= -v0/vd
    } else {
      t1 = Math.min(t1, t); // 上界：t <= -v0/vd
    }
    if (t0 > t1 + 1e-12) return null;
  }
  return [Math.max(0, t0), Math.min(1, t1)];
}

/** 线段落在凸多边形内的参数区间（含边界）。 */
export function segmentConvexTRange(
  a: Pt,
  b: Pt,
  poly: Pt[],
): [number, number] | null {
  const p = normalize(poly);
  if (p.length < 3) return null;
  const planes: HalfPlane[] = p.map((v, i) => ({
    a: v,
    b: p[(i + 1) % p.length]!,
    keepLeft: true,
  }));
  const r = segmentHalfPlanesTRange(a, b, planes);
  if (!r || r[1] - r[0] <= 1e-10) return null;
  return r;
}
