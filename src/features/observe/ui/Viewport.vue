<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Document, PoseFace } from "../../../shared/types";
import { project } from "../lib/projection";
import { orbit, zoom, setView, toggleXray } from "../model/camera";
import { downloadView } from "../lib/export";
import {
  buildVisibleFaces,
  pointsString,
  toScreenFace,
  visibleSegmentRanges,
  type SegmentRange,
} from "../lib/visibility";
import { lerp, type Pt } from "../lib/geometry2d";

const props = defineProps<{
  doc: Document;
  pose: PoseFace[];
  hinges: {
    id: string;
    a: [number, number, number];
    b: [number, number, number];
  }[];
}>();
const emit = defineEmits<{ select: [id: string] }>();

const svg = ref<SVGSVGElement>();
let dragging = false,
  lastX = 0,
  lastY = 0,
  moved = 0;
const DRAG_CLICK_SLOP = 6;

/**
 * 场景求解：每个纸面只保留当前视角下真正可见的凸多边形分片。
 * 正面/背面着色、明暗、纹理、折痕标记共用同一份可见性结果；
 * 透视模式下跳过遮挡裁剪，所有纸层半透明、全部折痕可点。
 */
const scene = computed(() => {
  const view = props.doc.view;
  const screenFaces = props.pose.map((f, i) => toScreenFace(f, i, view));
  return view.xray
    ? screenFaces
        .map((face) => ({
          face,
          pieces: face.screen.length >= 3 ? [face.screen] : [],
        }))
        .filter((e) => e.pieces.length)
    : buildVisibleFaces(screenFaces, view);
});

const piecesByFace = computed(
  () => new Map(scene.value.map((e) => [e.face.id, e.pieces])),
);

interface HingeView {
  id: string;
  a: Pt;
  b: Pt;
  ranges: SegmentRange[];
  label: Pt;
}

/**
 * 折痕只在宿主纸面的可见区间内生成几何与命中区域，
 * 被前方纸张挡住的折痕段既不绘制也不可点击。
 */
const hingeView = computed<HingeView[]>(() => {
  const view = props.doc.view;
  return props.hinges.map((h) => {
    const pa = project(h.a, view);
    const pb = project(h.b, view);
    const a: Pt = { x: pa.x, y: pa.y };
    const b: Pt = { x: pb.x, y: pb.y };
    const host = props.doc.paper.creases.find((c) => c.id === h.id)?.face;
    const ranges =
      view.xray || !host
        ? [{ t0: 0, t1: 1 }]
        : visibleSegmentRanges(a, b, piecesByFace.value.get(host) ?? []);
    const longest = ranges.reduce(
      (best, r) => (r.t1 - r.t0 > best.t1 - best.t0 ? r : best),
      ranges[0] ?? { t0: 0, t1: 0 },
    );
    return { id: h.id, a, b, ranges, label: lerp(a, b, (longest.t0 + longest.t1) / 2) };
  });
});

function down(e: PointerEvent) {
  if ((e.target as Element).closest(".hinge")) return;
  dragging = true;
  moved = 0;
  lastX = e.clientX;
  lastY = e.clientY;
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  moved += Math.abs(dx) + Math.abs(dy);
  orbit(props.doc, dx, dy);
  lastX = e.clientX;
  lastY = e.clientY;
}
/** 旋转拖拽结束落在折痕上时不应当成点选。 */
function onHingeClick(id: string) {
  if (moved > DRAG_CLICK_SLOP) return;
  emit("select", id);
}
function onKey(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== "x") return;
  const t = e.target as Element | null;
  if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
  toggleXray(props.doc);
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>
<template>
  <section class="viewport">
    <div class="viewport-top">
      <div class="view-tabs">
        <button class="active" @click="setView(doc, 'iso')">立体视图</button
        ><button @click="setView(doc, 'top')">俯视</button
        ><button @click="setView(doc, 'front')">正视</button>
      </div>
      <span class="live" :class="{ xray: doc.view.xray }"
        ><i></i>{{ doc.view.xray ? "透视模式 · 内部折痕可点选" : "实时预览" }}</span
      >
    </div>
    <svg
      ref="svg"
      class="paper-scene"
      :class="{ xray: doc.view.xray }"
      viewBox="0 0 800 560"
      aria-label="三维折纸预览"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="dragging = false"
      @pointercancel="dragging = false"
      @wheel.prevent="zoom(doc, -$event.deltaY * 0.001)"
    >
      <defs>
        <pattern id="grid" width="35" height="35" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#d4d9d0" />
        </pattern>
        <pattern
          id="fiber"
          width="13"
          height="17"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M1 2l3 1M8 11l2 -2M3 14l1 -2"
            stroke="#fff"
            stroke-opacity=".22"
            stroke-width=".7"
          />
        </pattern>
        <pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r=".65" fill="#fff" fill-opacity=".4" />
        </pattern>
        <filter id="shadow"><feGaussianBlur stdDeviation="15" /></filter>
      </defs>
      <rect width="800" height="560" fill="#f6f7f2" />
      <rect v-if="doc.view.grid" width="800" height="560" fill="url(#grid)" />
      <ellipse
        cx="400"
        cy="401"
        rx="180"
        ry="32"
        fill="#63705a"
        opacity=".15"
        filter="url(#shadow)"
      />
      <!-- 纸层：填充、明暗、纹理共用同一套精确可见分片 -->
      <g
        v-for="entry in scene"
        :key="entry.face.id"
        :data-face="entry.face.id"
        class="paper-face"
      >
        <polygon
          v-for="(poly, k) in entry.pieces"
          :key="'fill-' + k"
          :points="pointsString(poly)"
          :fill="entry.face.back ? doc.back : doc.front"
          :fill-opacity="doc.view.xray ? 0.3 : 1"
          stroke="#785945"
          :stroke-opacity="doc.view.xray ? 0.45 : 0.35"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
        <polygon
          v-for="(poly, k) in entry.pieces"
          :key="'shade-' + k"
          :points="pointsString(poly)"
          fill="#314638"
          :opacity="
            Math.max(0, 0.1 + entry.face.pose.normal[1]! * 0.08) *
            (doc.view.xray ? 0.4 : 1)
          "
        />
        <template v-if="doc.texture !== 'plain'">
          <polygon
            v-for="(poly, k) in entry.pieces"
            :key="'tex-' + k"
            :points="pointsString(poly)"
            :fill="'url(#' + doc.texture + ')'"
            :fill-opacity="doc.view.xray ? 0.35 : 1"
          />
        </template>
      </g>
      <!-- 折痕：仅绘制宿主纸面上实际可见的线段，命中区与显示区完全一致 -->
      <g v-if="doc.view.wire" class="hinge-layer">
        <g
          v-for="(h, i) in hingeView"
          :key="h.id"
          class="hinge"
          :class="{ selectable: h.ranges.length > 0 }"
        >
          <template v-for="(r, ri) in h.ranges" :key="ri">
            <line
              class="hinge-hit"
              :x1="lerp(h.a, h.b, r.t0).x"
              :y1="lerp(h.a, h.b, r.t0).y"
              :x2="lerp(h.a, h.b, r.t1).x"
              :y2="lerp(h.a, h.b, r.t1).y"
              stroke="transparent"
              stroke-width="18"
              @click.stop="onHingeClick(h.id)"
            />
            <line
              class="hinge-line"
              :x1="lerp(h.a, h.b, r.t0).x"
              :y1="lerp(h.a, h.b, r.t0).y"
              :x2="lerp(h.a, h.b, r.t1).x"
              :y2="lerp(h.a, h.b, r.t1).y"
              :stroke="
                h.id === doc.selected
                  ? '#fff8d9'
                  : doc.view.xray
                    ? '#5b7d96'
                    : '#746f57'
              "
              :stroke-width="h.id === doc.selected ? 2.5 : 1.2"
              stroke-dasharray="5 4"
            />
          </template>
          <g
            v-if="h.ranges.length"
            class="hinge-tag"
            :transform="`translate(${h.label.x},${h.label.y})`"
            @click.stop="onHingeClick(h.id)"
          >
            <circle
              r="11"
              :fill="h.id === doc.selected ? '#384d3f' : '#f7f6ee'"
              :stroke="doc.view.xray ? '#5b7d96' : '#c9c3ac'"
              stroke-width="1"
            />
            <text
              y="3.5"
              text-anchor="middle"
              font-size="10"
              :fill="h.id === doc.selected ? 'white' : '#555'"
            >
              {{ i + 1 }}
            </text>
          </g>
        </g>
      </g>
      <g transform="translate(58,475)" stroke-width="1.5">
        <path d="M0 0l28 12" stroke="#be806c" />
        <path d="M0 0v-30" stroke="#839b72" />
        <path d="M0 0l-18 15" stroke="#839eae" />
        <text x="32" y="17" font-size="10" fill="#ad7a69">X</text>
        <text x="-3" y="-37" font-size="10" fill="#789069">Y</text>
        <text x="-28" y="23" font-size="10" fill="#839eae">Z</text>
      </g>
    </svg>
    <div class="scene-caption">
      <span>{{
        doc.view.xray
          ? "透视中 · 点击任意折痕选择，退出后选择与视角保留"
          : "拖动旋转视角 · 滚轮缩放 · 按 X 透视纸层"
      }}</span
      ><b>{{ Math.round(doc.view.zoom * 100) }}%</b>
    </div>
    <div class="scene-tools">
      <button
        :class="{ selected: doc.view.grid }"
        title="网格"
        @click="doc.view.grid = !doc.view.grid"
      >
        ▦</button
      ><button
        :class="{ selected: doc.view.wire }"
        title="折痕"
        @click="doc.view.wire = !doc.view.wire"
      >
        ⌁</button
      ><button
        :class="{ selected: doc.view.xray }"
        title="透视纸层：点选被遮挡的内部折痕（快捷键 X）"
        @click="toggleXray(doc)"
        >◊</button
      ><i></i><button title="放大" @click="zoom(doc, 0.1)">＋</button
      ><button title="缩小" @click="zoom(doc, -0.1)">−</button
      ><button title="重置视角" @click="setView(doc, 'iso')">⤢</button><i></i
      ><button title="下载观察图" @click="svg && downloadView(svg)">↓</button>
    </div>
  </section>
</template>
