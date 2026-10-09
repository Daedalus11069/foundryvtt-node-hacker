<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import HackGraph from "@/classes/HackGraph";
import HackNode from "@/classes/HackNode";
import NodeComponent from "./NodeComponent.vue";
import ConnectionComponent from "./ConnectionComponent.vue";

/** Fixed grid cell size in pixels - matches hacking-minigame-test's LevelGrid (a plain CSS
 * grid with fixed-size rows/columns, nodes placed via grid-column/grid-row), not percentage
 * math against a container whose size can be zero/unsettled/degenerate on one axis. */
const CELL_SIZE = 100;

const props = withDefaults(
  defineProps<{
    graph: HackGraph;
    trace: boolean;
    interactive: boolean;
    revealOpponent?: boolean;
    selectedKey?: string | null;
    /** HackSession.activeNodeKey - see NodeComponent's `active` prop. */
    activeKey?: string | null;
  }>(),
  { revealOpponent: true, selectedKey: null, activeKey: null }
);

const emit = defineEmits<{
  select: [node: HackNode, x: number, y: number];
  move: [node: HackNode];
}>();

const nodes = computed(() => [...props.graph.nodes.values()]);

// Node coordinates can be negative or zero (the Node Designer's canvas is unbounded in every
// direction - see DesignerCanvas.vue's ORIGIN comment), but CSS Grid line numbers used for
// placement below (:style="{ gridColumn: ... }") must be positive integers >= 1: a node at
// x <= 0 would otherwise get an invalid explicit line reference and silently fall back to the
// browser's own auto-placement, landing it somewhere else in the grid entirely rather than at
// its actual designed position. minX/minY shift every coordinate into non-negative space
// before it's ever used for placement (both here and by ConnectionComponent's line geometry,
// which must agree on the same shifted space for lines to still meet at node centers) -
// clamped to <= 0 so an all-positive graph (every procedurally generated one) is never shifted
// at all, keeping this a no-op for the common case.
const minX = computed(() => Math.min(0, ...nodes.value.map((n) => n.x)));
const minY = computed(() => Math.min(0, ...nodes.value.map((n) => n.y)));
const cols = computed(() => Math.max(0, ...nodes.value.map((n) => n.x - minX.value)) + 1);
const rows = computed(() => Math.max(0, ...nodes.value.map((n) => n.y - minY.value)) + 1);

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols.value}, ${CELL_SIZE}px)`,
  gridTemplateRows: `repeat(${rows.value}, ${CELL_SIZE}px)`,
  width: `${cols.value * CELL_SIZE}px`,
  height: `${rows.value * CELL_SIZE}px`
}));

const linksStyle = computed(() => ({
  width: `${cols.value * CELL_SIZE}px`,
  height: `${rows.value * CELL_SIZE}px`
}));

/**
 * Hand-rolled pan/zoom (hacking-minigame-test's own level view uses the React-only
 * react-easy-panzoom library, so there's no drop-in Vue equivalent to reuse - this
 * reproduces the same drag-to-pan/wheel-to-zoom interaction directly).
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 4;

const pan = ref({ x: 0, y: 0 });
const zoom = ref(1);
const isPanning = ref(false);
const viewport = ref<HTMLElement | null>(null);
let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };
let dragDistance = 0;

const transformStyle = computed(() => ({
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`
}));

/**
 * Content starts pinned to the viewport's top-left corner (.nh-map-inner is
 * `position: absolute; top: 0; left: 0`) with pan defaulting to {0, 0} - for any graph
 * smaller than the viewport (most of them), that means it just sits in the corner instead
 * of being centered in the visible work area. Centers once the viewport has a real
 * measured size, and re-centers whenever the graph's own footprint changes (e.g. a
 * managed session's graph gets rebuilt from broadcast state).
 */
function centerContent() {
  const el = viewport.value;
  if (!el) return;
  const contentWidth = cols.value * CELL_SIZE;
  const contentHeight = rows.value * CELL_SIZE;
  pan.value = {
    x: (el.clientWidth - contentWidth * zoom.value) / 2,
    y: (el.clientHeight - contentHeight * zoom.value) / 2
  };
}

watch(
  () => [cols.value, rows.value],
  () => nextTick(centerContent),
  { immediate: true }
);

function onPointerDown(e: PointerEvent) {
  // Only the left mouse button (or a touch/pen contact) pans. A pointerdown that started on a
  // node button must NOT start a pan gesture at all: setPointerCapture below redirects the
  // matching pointerup (and, in practice, the click that follows it) to this viewport element
  // instead of the button, so a node's own @click handler never sees the click - every node
  // click was silently being swallowed as a (zero-distance) pan instead of ever reaching
  // NodeComponent's onClick.
  if (e.button !== 0) return;
  // Reset BEFORE the node-target early return below, not after - onClickCapture checks this
  // value on every click regardless of where the pointerdown that preceded it landed. Left
  // stale from a genuine pan gesture (dragDistance > DRAG_THRESHOLD), every subsequent
  // pointerdown starting directly on a node would return early right here without ever
  // clearing it, so onClickCapture kept suppressing that node's own click indefinitely -
  // permanently breaking left-click on nodes after the first real pan, while right-click
  // (a separate @contextmenu event, untouched by this suppression) kept working.
  dragDistance = 0;
  if ((e.target as HTMLElement | null)?.closest(".nh-node")) return;
  isPanning.value = true;
  dragStart = { x: e.clientX, y: e.clientY, panX: pan.value.x, panY: pan.value.y };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!isPanning.value) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  dragDistance = Math.max(dragDistance, Math.abs(dx), Math.abs(dy));
  pan.value = { x: dragStart.panX + dx, y: dragStart.panY + dy };
}

function onPointerUp() {
  isPanning.value = false;
}

/**
 * A drag that barely moved should still register as a click on whatever node is underneath
 * (picking up/putting down the mouse in place to capture a node) - a real pan suppresses
 * the click that would otherwise fire on release, in the capture phase, before it reaches
 * NodeComponent's own @click handler.
 */
function onClickCapture(e: MouseEvent) {
  if (dragDistance > DRAG_THRESHOLD) {
    e.stopPropagation();
  }
}

/**
 * Zoom toward the cursor, not the content's fixed top-left origin (.nh-map-inner's
 * transform-origin is 0 0, so a naive scale() change alone shrinks/grows everything away
 * from that corner - anywhere else in the viewport, that looks exactly like an
 * unrequested scroll/pan happening alongside the zoom). Keeps whatever content point is
 * currently under the cursor fixed in place as the scale changes.
 */
function onWheel(e: WheelEvent) {
  e.preventDefault();
  const rect = viewport.value?.getBoundingClientRect();
  if (!rect) return;

  const cursorX = e.clientX - rect.left;
  const cursorY = e.clientY - rect.top;
  const oldZoom = zoom.value;
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  if (newZoom === oldZoom) return;

  const contentX = (cursorX - pan.value.x) / oldZoom;
  const contentY = (cursorY - pan.value.y) / oldZoom;
  pan.value = { x: cursorX - contentX * newZoom, y: cursorY - contentY * newZoom };
  zoom.value = newZoom;
}
</script>

<template>
  <div
    ref="viewport"
    class="nh-map-viewport"
    :class="{ panning: isPanning }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
    @click.capture="onClickCapture"
  >
    <div class="nh-map-inner" :style="transformStyle">
      <div class="nh-map-grid" :style="gridStyle">
        <NodeComponent
          v-for="node in nodes"
          :key="node.key"
          :node="node"
          :trace="trace"
          :interactive="interactive"
          :selected="node.key === selectedKey"
          :active="node.key === activeKey"
          :reveal-opponent="revealOpponent"
          :style="{ gridColumn: `${node.x - minX + 1} / span 1`, gridRow: `${node.y - minY + 1} / span 1` }"
          class="nh-map-grid__cell"
          @select="(node, x, y) => emit('select', node, x, y)"
          @move="(node) => emit('move', node)"
        />
      </div>
      <div class="nh-links" :style="linksStyle">
        <ConnectionComponent
          v-for="(c, i) in graph.connections"
          :key="i"
          :connection="c"
          :trace="trace"
          :cell-size="CELL_SIZE"
          :offset-x="minX"
          :offset-y="minY"
        />
      </div>
    </div>
  </div>
</template>
