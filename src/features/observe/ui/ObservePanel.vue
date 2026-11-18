<script setup lang="ts">
import type { Document } from "../../../shared/types";
defineProps<{ doc: Document }>();
</script>
<template>
  <section class="panel observe-panel">
    <div class="section-heading">
      <span>观察提示</span><small>INSPECT</small>
    </div>
    <div class="inspect-icon">⌘</div>
    <p>换个角度，发现纸的可能。</p>
    <span class="muted small"
      >遮挡按视线逐点精确计算，折痕只能在纸面实际可见处点选；按 X 或点击
      ◊ 可临时透视纸层，选择被挡住的内部折痕，退出后选择与视角都会保留。</span
    >
    <div class="legend">
      <span><i :style="{ background: doc.front }"></i>正面</span
      ><span><i :style="{ background: doc.back }"></i>背面</span
      ><span>┄ 折痕</span>
    </div>
  </section>
</template>
