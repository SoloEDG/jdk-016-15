import type { PoseFace, Vec3, View } from "../../../shared/types";
import { cameraPoint, project } from "./projection";
import { cross, dot, scale, sub, unit } from "../../../shared/vector";
import {
  clipHalfPlane,
  convexIntersect,
  convexSubtract,
  cross2,
  normalize,
  segmentConvexTRange,
  type Pt,
} from "./geometry2d";

/**
 * 深度迟滞阈值（世界单位）。
 * 沿视线方向深度差小于该值的两个点视为同层，不做遮挡判定，
 * 从而在接近平行的纸面、播放插值与高倍缩放下保持层序稳定。
 */
export const DEPTH_EPS = 0.008;
/** 面心排序的量化桶宽，与迟滞阈值一致，避免浮点尾差引起的整体抖动。 */
const SORT_BUCKET = DEPTH_EPS;

export interface Plane {
  n: Vec3;
  k: number;
}

export interface ScreenFace {
  id: string;
  index: number;
  pose: PoseFace;
  screen: Pt[];
  plane: Plane;
  back: boolean;
  centroidDepth: number;
}

/**
 * 相机视线方向（远离相机的单位向量）。
 * 相机旋转矩阵第三行是相机 +Z 轴（指向观察者），视线取其反向。
 */
export function viewForward(view: View): Vec3 {
  const a = (view.yaw * Math.PI) / 180;
  const b = (view.pitch * Math.PI) / 180;
  return [
    -Math.cos(b) * Math.sin(a),
    -Math.sin(b),
    -Math.cos(b) * Math.cos(a),
  ];
}

export function facePlane(face: PoseFace): Plane {
  return { n: face.normal, k: dot(face.normal, face.points[0]!) };
}

/**
 * 从纸面上的点 p 沿视线（远离相机）到遮挡面 plane 的有符号距离。
 * t > EPS：plane 在 p 后方，p 可见；
 * t < -EPS：plane 更靠近相机，p 被遮挡；
 * 中间为同层迟滞区。plane 与视线平行时返回 null（不产生遮挡）。
 */
export function signedGap(p: Vec3, plane: Plane, forward: Vec3): number | null {
  const denom = dot(plane.n, forward);
  if (Math.abs(denom) < 1e-9) return null;
  return (plane.k - dot(plane.n, p)) / denom;
}

/** 两个平面的交线（世界坐标），返回线上一点与单位方向；平行时返回 null。 */
function intersectPlanes(p1: Plane, p2: Plane): { p0: Vec3; dir: Vec3 } | null {
  const d = cross(p1.n, p2.n);
  const d2 = dot(d, d);
  if (d2 < 1e-12) return null;
  const p0 = scale(
    [
      dot(cross(p2.n, d), [p1.k, 0, 0]) + dot(cross(d, p1.n), [p2.k, 0, 0]),
      dot(cross(p2.n, d), [0, p1.k, 0]) + dot(cross(d, p1.n), [0, p2.k, 0]),
      dot(cross(p2.n, d), [0, 0, p1.k]) + dot(cross(d, p1.n), [0, 0, p2.k]),
    ],
    1 / d2,
  );
  return { p0, dir: unit(d) };
}

export function toScreenFace(
  pose: PoseFace,
  index: number,
  view: View,
): ScreenFace {
  const screen = normalize(
    pose.points.map((p) => {
      const v = project(p, view);
      return { x: v.x, y: v.y };
    }),
  );
  const centroidDepth =
    pose.points.reduce((s, p) => s + cameraPoint(p, view)[2]!, 0) /
    pose.points.length;
  return {
    id: pose.id,
    index,
    pose,
    screen,
    plane: facePlane(pose),
    back: cameraPoint(pose.normal, view)[2]! > 0,
    centroidDepth,
  };
}

interface OrderEntry {
  face: ScreenFace;
  pieces: Pt[][];
}

/**
 * 精确遮挡求解：按绘制顺序（远→近）返回每个纸面在当前视角下真正可见的凸多边形分片。
 * 不使用整块纸面的平均深度，而是对投影交叠区域逐点比较视线深度；
 * 两平面交叉时沿真实交线分裂遮挡区，同层深度由 DEPTH_EPS 迟滞吸收。
 */
export function buildVisibleFaces(
  faces: ScreenFace[],
  view: View,
): { face: ScreenFace; pieces: Pt[][] }[] {
  const forward = viewForward(view);
  // 面心深度仅决定粗略的前后处理顺序，量化 + 原始下标兜底，保证确定性。
  // 本相机约定中相机空间 +z 指向观察者，z 越大越靠近相机：
  // 降序即“近 → 远”的遮挡处理顺序，输出时再翻回“远 → 近”供绘制。
  const order = [...faces].sort(
    (a, b) =>
      Math.round(b.centroidDepth / SORT_BUCKET) -
        Math.round(a.centroidDepth / SORT_BUCKET) || a.index - b.index,
  );
  const entries: OrderEntry[] = order.map((face) => ({
    face,
    pieces: face.screen.length >= 3 ? [face.screen] : [],
  }));

  // 近 → 远处理：每个纸面只被已经处理过、更靠近相机的纸面遮挡。
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    for (let j = 0; j < i; j++) {
      const blocker = entries[j]!;
      if (!entry.pieces.length) break;
      for (const blockerPiece of blocker.pieces) {
        if (!entry.pieces.length) break;
        entry.pieces = entry.pieces.flatMap((piece) =>
          subtractBlocker(piece, entry.face, blockerPiece, blocker.face, view, forward),
        );
      }
    }
  }
  // 反转回“远 → 近”的绘制顺序，供 SVG painter's 输出。
  return entries
    .reverse()
    .filter((e) => e.pieces.length)
    .map((e) => ({ face: e.face, pieces: e.pieces }));
}

/** 计算 piece 被 blocker 遮挡后剩余的可见分片。 */
function subtractBlocker(
  piece: Pt[],
  owner: ScreenFace,
  blockerPiece: Pt[],
  blocker: ScreenFace,
  view: View,
  forward: Vec3,
): Pt[][] {
  const overlap = convexIntersect(piece, blockerPiece);
  if (overlap.length < 3) return [piece];

  // 交叠顶点反投影到 owner 平面，再沿视线求到 blocker 平面的有符号距离。
  // 保留与 overlap 顶点一一对应的下标，避免过滤 null 后索引错位。
  const samples = overlap.map((v) => {
    const world = rayPlaneAtScreen(v, owner, view);
    return world ? signedGap(world, blocker.plane, forward) : null;
  });
  const validIdx = samples
    .map((t, i) => (t === null ? -1 : i))
    .filter((i): i is number => i >= 0);
  if (!validIdx.length) return [piece];
  const gaps = validIdx.map((i) => samples[i]!);
  const minT = Math.min(...gaps);
  const maxT = Math.max(...gaps);

  // 没有任何点真正位于 blocker 之后（含迟滞同层），不产生遮挡。
  if (minT >= -DEPTH_EPS) return [piece];
  // 交叠区整体位于 blocker 之后，直接挖掉整块交叠。
  if (maxT <= DEPTH_EPS) return convexSubtract(piece, overlap);

  // 混合情形：两平面在交叠区内交叉，沿真实交线分裂，只挖掉 blocker 一侧。
  const line = intersectPlanes(owner.plane, blocker.plane);
  if (!line) return convexSubtract(piece, overlap);
  const span = 6;
  const p1 = project(sub(line.p0, scale(line.dir, span)), view);
  const p2 = project([...addScaled(line.p0, line.dir, span)], view);
  const e1: Pt = { x: p1.x, y: p1.y };
  const e2: Pt = { x: p2.x, y: p2.y };
  if (Math.hypot(e2.x - e1.x, e2.y - e1.y) < 1e-6) {
    // 交线几乎正对视线、投影退化为点：保守挖掉整块交叠。
    return convexSubtract(piece, overlap);
  }
  let behindOverlapIdx = validIdx[0]!;
  for (const i of validIdx) {
    if (samples[i]! < samples[behindOverlapIdx]!) behindOverlapIdx = i;
  }
  const behindIsLeft = cross2(e1, e2, overlap[behindOverlapIdx]!) > 0;
  const behindPart = clipHalfPlane(overlap, e1, e2, behindIsLeft);
  if (behindPart.length < 3) return [piece];
  return convexSubtract(piece, behindPart);
}

function addScaled(p: Vec3, d: Vec3, s: number): Vec3 {
  return [p[0]! + d[0]! * s, p[1]! + d[1]! * s, p[2]! + d[2]! * s];
}

/** 屏幕点对应视线与指定纸面平面的交点（世界坐标）。 */
export function rayPlaneAtScreen(v: Pt, face: ScreenFace, view: View): Vec3 | null {
  const forward = viewForward(view);
  const denom = dot(face.plane.n, forward);
  if (Math.abs(denom) < 1e-9) return null;
  const origin = screenRayOrigin(v, view);
  const t = (face.plane.k - dot(face.plane.n, origin)) / denom;
  return addScaled(origin, forward, t);
}

/** 由屏幕坐标反算相机空间原点，再经旋转矩阵转置得到世界射线上的一点。 */
function screenRayOrigin(v: Pt, view: View): Vec3 {
  const cx = (v.x - 400) / (145 * view.zoom);
  const cy = (280 - v.y) / (145 * view.zoom);
  const ca = Math.cos((view.yaw * Math.PI) / 180);
  const sa = Math.sin((view.yaw * Math.PI) / 180);
  const cb = Math.cos((view.pitch * Math.PI) / 180);
  const sb = Math.sin((view.pitch * Math.PI) / 180);
  return [
    ca * cx - sa * sb * cy,
    cb * cy,
    -sa * cx - ca * sb * cy,
  ];
}

export interface SegmentRange {
  t0: number;
  t1: number;
}

/**
 * 折痕线段在宿主纸面可见分片中的可见参数区间（合并重叠区间）。
 * 只有真正可见的折痕段才会被绘制并参与点击命中。
 */
export function visibleSegmentRanges(
  a: Pt,
  b: Pt,
  pieces: Pt[][],
): SegmentRange[] {
  const ranges: SegmentRange[] = [];
  for (const piece of pieces) {
    const r = segmentConvexTRange(a, b, piece);
    if (r) ranges.push({ t0: r[0], t1: r[1] });
  }
  ranges.sort((u, v) => u.t0 - v.t0);
  const merged: SegmentRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.t0 <= last.t1 + 1e-9) {
      last.t1 = Math.max(last.t1, r.t1);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

export function pointsString(poly: Pt[]): string {
  return poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}
