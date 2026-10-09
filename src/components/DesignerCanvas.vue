<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { NodeType } from "@/constants";
import { iconForNodeType } from "@/classes/nodeIcons";
import DifficultyConfig from "@/classes/DifficultyConfig";
import type { HackNodeConfig } from "@/classes/HackNode";
import type { GraphEdgeConfig, HackGraphConfig } from "@/classes/HackGraph";

const NODE_SIZE = 72;
// The canvas isn't literally infinite (an actual DOM element still needs a finite size), but
// a fixed offset/size this generous - roughly +/-55 cells in every direction from (0,0) - is
// far more room than any graph will ever need, so it reads as unbounded in practice. Node
// coordinates can go negative; ORIGIN is where grid cell (0,0) actually lands within this div.
// Must itself be an exact multiple of NODE_SIZE - the tiled background grid pattern (see
// .node-hacker-designer__grid) always starts at this div's own pixel (0, 0), so an ORIGIN
// that doesn't land on a cell boundary puts every node visibly off-center from its square.
const ORIGIN = NODE_SIZE * 56;
const CANVAS_SIZE = 8000;

const props = defineProps<{ modelValue: HackGraphConfig }>();
const emit = defineEmits<{ "update:modelValue": [HackGraphConfig] }>();

const selectedTool = ref<NodeType>(NodeType.NODE);
const difficulty = ref(1);

// A node's base difficulty is clamped to whatever the integrating system has configured via
// the API (see DifficultyConfig) - 3+ only ever exists as a runtime Fortify bonus on top of
// that ceiling, never a base value a designer sets directly. Read live (not cached at setup)
// so the input's own max attribute stays correct if a system changes this after the fact.
const maxDifficulty = computed(() => DifficultyConfig.getMax());
function clampDifficulty(value: number): number {
  return DifficultyConfig.clamp(value);
}

/** A pending link source, set by the inspector's "Link From Here" button - the *next* node
 * clicked completes the edge, rather than every node click starting one (which made it
 * impossible to just select a node to inspect/edit it without also wiring up a link). */
const linkFrom = ref<HackNodeConfig | null>(null);

type Selection = { kind: "node"; node: HackNodeConfig } | { kind: "edge"; edge: GraphEdgeConfig } | null;
const selection = ref<Selection>(null);

function findNode(x: number, y: number): HackNodeConfig | undefined {
  return props.modelValue.nodes.find((n) => n.x === x && n.y === y);
}

/** Pixel center of grid cell (x, y) within the canvas div - every node/edge coordinate goes
 * through this so the ORIGIN offset only ever lives in one place. */
function cellCenter(x: number, y: number): { x: number; y: number } {
  return { x: ORIGIN + x * NODE_SIZE + NODE_SIZE / 2, y: ORIGIN + y * NODE_SIZE + NODE_SIZE / 2 };
}

function commit(next: HackGraphConfig) {
  emit("update:modelValue", next);
}

/**
 * Hand-rolled pan/zoom, same interaction as NodeGraphView's gameplay map - drag to pan,
 * wheel to zoom toward the cursor. Unlike NodeGraphView, there's no non-interactive
 * "background" to distinguish from clickable content here (every point on the canvas is a
 * potential click target - either an existing node or a spot to place a new one), so pointer
 * capture is deferred until an actual drag is detected (past DRAG_THRESHOLD) rather than
 * started unconditionally on pointerdown - a plain click with no real movement never captures
 * at all, so it still reaches whatever node/connection was actually under the cursor normally.
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
let activePointerId: number | null = null;

const transformStyle = computed(() => ({
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
  transformOrigin: "0 0"
}));

/** Centers the viewport on the current graph's own content (its nodes' bounding-box middle,
 * or plain (0,0) for a blank graph) - not tied to a re-render-triggering watch (the canvas is
 * unbounded now, so there's no "footprint growing" to react to, and re-centering on every
 * single edit would fight the user's own panning). Called once on mount, and manually via the
 * toolbar's "Center View" button (e.g. after Load/New, or just to find your way back). */
function centerContent() {
  const el = viewport.value;
  if (!el) return;
  const nodes = props.modelValue.nodes;
  const midX = nodes.length ? (Math.min(...nodes.map((n) => n.x)) + Math.max(...nodes.map((n) => n.x))) / 2 : 0;
  const midY = nodes.length ? (Math.min(...nodes.map((n) => n.y)) + Math.max(...nodes.map((n) => n.y))) / 2 : 0;
  const { x: contentX, y: contentY } = cellCenter(midX, midY);
  pan.value = {
    x: el.clientWidth / 2 - contentX * zoom.value,
    y: el.clientHeight / 2 - contentY * zoom.value
  };
}
onMounted(() => nextTick(centerContent));

/** Converts a raw pointer position into the grid cell underneath it, inverting the current
 * pan/zoom and the ORIGIN offset - used for placing a node wherever the background was
 * actually clicked, since there's no longer one DOM element per cell to read a fixed (x, y)
 * off of. */
function cellFromClientPoint(clientX: number, clientY: number): { x: number; y: number } | null {
  const el = viewport.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const contentX = (clientX - rect.left - pan.value.x) / zoom.value - ORIGIN;
  const contentY = (clientY - rect.top - pan.value.y) / zoom.value - ORIGIN;
  return { x: Math.floor(contentX / NODE_SIZE), y: Math.floor(contentY / NODE_SIZE) };
}

function onViewportPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  dragDistance = 0;
  activePointerId = e.pointerId;
  dragStart = { x: e.clientX, y: e.clientY, panX: pan.value.x, panY: pan.value.y };
}

function onViewportPointerMove(e: PointerEvent) {
  if (activePointerId !== e.pointerId) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  dragDistance = Math.max(dragDistance, Math.abs(dx), Math.abs(dy));
  if (!isPanning.value) {
    if (dragDistance <= DRAG_THRESHOLD) return;
    isPanning.value = true;
    viewport.value?.setPointerCapture(e.pointerId);
  }
  pan.value = { x: dragStart.panX + dx, y: dragStart.panY + dy };
}

function onViewportPointerUp(e: PointerEvent) {
  if (activePointerId !== e.pointerId) return;
  isPanning.value = false;
  activePointerId = null;
}

/** A drag that actually moved the view should not ALSO register as a click on whatever cell
 * ends up under the cursor at release - caught here, in the capture phase, before it reaches
 * a cell's own @click handler. */
function onViewportClickCapture(e: MouseEvent) {
  if (dragDistance > DRAG_THRESHOLD) e.stopPropagation();
}

/** Zoom toward the cursor, not the grid's fixed top-left origin - a naive scale() change
 * alone shrinks/grows everything away from that corner, which anywhere else in the viewport
 * looks exactly like an unrequested pan happening alongside the zoom. */
function onViewportWheel(e: WheelEvent) {
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

function isSelectedNode(n: HackNodeConfig): boolean {
  return selection.value?.kind === "node" && selection.value.node === n;
}

/** A node's own click handler - stops propagation so it never also reaches the background's
 * own click handler on the canvas underneath it (see onBackgroundClick). */
function onNodeClick(node: HackNodeConfig, e: MouseEvent) {
  e.stopPropagation();
  if (linkFrom.value) {
    // Clicking the link's own source node again just cancels the pending link (a self-loop
    // isn't a meaningful edge) rather than leaving linkFrom stuck.
    if (linkFrom.value !== node) addEdge(linkFrom.value, node);
    linkFrom.value = null;
    selection.value = { kind: "node", node };
    return;
  }
  // Clicking the already-selected node again deselects it, rather than being a no-op that
  // leaves no way to deselect other than the inspector's own button.
  selection.value = selection.value?.kind === "node" && selection.value.node === node ? null : { kind: "node", node };
}

function onNodeRightClick(node: HackNodeConfig, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  void deleteNode(node);
}

/** Click on the canvas that didn't land on a node or a connection (both stop propagation
 * before it gets here) - cancels a pending link instead of dropping it somewhere meaningless,
 * and otherwise places a new node with the toolbar's current tool/difficulty wherever was
 * actually clicked, translated through the current pan/zoom. */
function onBackgroundClick(e: MouseEvent) {
  const cell = cellFromClientPoint(e.clientX, e.clientY);
  if (!cell) return;

  if (linkFrom.value) {
    linkFrom.value = null;
    return;
  }

  const node: HackNodeConfig = { ...cell, type: selectedTool.value, difficulty: clampDifficulty(difficulty.value) };
  if (selectedTool.value === NodeType.DATABASE) {
    node.reward = { kind: "stop", quantity: 1 };
  }
  commit({ ...props.modelValue, nodes: [...props.modelValue.nodes, node] });
  selection.value = { kind: "node", node };
}

/** Foundry's Dialog.confirm, not the browser's native window.confirm() - the latter is a
 * blocking OS-chrome popup that looks and behaves nothing like the rest of the app. */
async function deleteNode(target: HackNodeConfig) {
  const confirmed = await Dialog.confirm({
    title: "Delete Node",
    content: `<p>Delete this ${target.type} node and every connection to it?</p>`
  });
  if (!confirmed) return;

  const nodes = props.modelValue.nodes.filter((n) => n !== target);
  const edges = props.modelValue.edges.filter(
    (edge) => !(sameCell(edge.from, [target.x, target.y]) || sameCell(edge.to, [target.x, target.y]))
  );
  commit({ ...props.modelValue, nodes, edges });
  if (linkFrom.value === target) linkFrom.value = null;
  if (selection.value?.kind === "node" && selection.value.node === target) selection.value = null;
}

function sameCell(a: [number, number], b: [number, number]) {
  return a[0] === b[0] && a[1] === b[1];
}

function addEdge(from: HackNodeConfig, to: HackNodeConfig) {
  const edge: GraphEdgeConfig = { from: [from.x, from.y], to: [to.x, to.y], bidirectional: true };
  commit({ ...props.modelValue, edges: [...props.modelValue.edges, edge] });
}

function startLinkFromSelection() {
  if (selection.value?.kind === "node") linkFrom.value = selection.value.node;
}

function cancelLink() {
  linkFrom.value = null;
}

/** Escape clears whatever's currently selected/pending - the only other way to deselect a
 * connection (a plain click on empty ground always places a new node there instead, by
 * design) is the inspector's own "Deselect" button. Delete/Backspace removes whatever's
 * currently selected, same as the inspector's own "Delete Node"/"Delete Connection" button -
 * skipped while an actual text/number input has focus, so backspacing in the graph name or
 * difficulty field doesn't also delete a selected node out from under you. */
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    linkFrom.value = null;
    selection.value = null;
    return;
  }

  if (e.key !== "Delete" && e.key !== "Backspace") return;
  const target = e.target as HTMLElement | null;
  if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;

  if (selection.value?.kind === "node") {
    e.preventDefault();
    void deleteNode(selection.value.node);
  } else if (selection.value?.kind === "edge") {
    e.preventDefault();
    deleteSelectedEdge();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

/** Two evenly-spaced points (at 1/3 and 2/3 along the line, not clumped at the exact
 * midpoint) + angle (degrees), per one-way edge, for the direction arrows drawn along its
 * line instead of at either endpoint - see the template's comment on why. Flattened into one
 * plain list (rather than a nested v-for inside each edge's own v-for block in the template)
 * so the SVG markup stays a single, unremarkable v-for. */
const ARROW_POSITIONS = [1 / 3, 2 / 3];
const oneWayArrows = computed(() => {
  const points: { key: string; x: number; y: number; angle: number; edge: GraphEdgeConfig }[] = [];
  props.modelValue.edges.forEach((edge, i) => {
    if (edge.bidirectional) return;
    const { x: x1, y: y1 } = cellCenter(edge.from[0], edge.from[1]);
    const { x: x2, y: y2 } = cellCenter(edge.to[0], edge.to[1]);
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    ARROW_POSITIONS.forEach((t, j) => {
      points.push({
        key: `${i}-${j}`,
        x: x1 + (x2 - x1) * t,
        y: y1 + (y2 - y1) * t,
        angle,
        edge
      });
    });
  });
  return points;
});

function selectEdge(edge: GraphEdgeConfig, e: MouseEvent) {
  e.stopPropagation();
  // Clicking the already-selected connection again deselects it, same as a node.
  selection.value = selection.value?.kind === "edge" && selection.value.edge === edge ? null : { kind: "edge", edge };
}

function updateSelectedNode(patch: Partial<HackNodeConfig>) {
  if (selection.value?.kind !== "node") return;
  const target = selection.value.node;
  const nodes = props.modelValue.nodes.map((n) => (n === target ? { ...n, ...patch } : n));
  const updated = nodes.find((n) => n.x === target.x && n.y === target.y)!;
  commit({ ...props.modelValue, nodes });
  selection.value = { kind: "node", node: updated };
}

function onTypeChange(type: NodeType) {
  const patch: Partial<HackNodeConfig> = { type };
  if (type === NodeType.DATABASE && selection.value?.kind === "node" && !selection.value.node.reward) {
    patch.reward = { kind: "stop", quantity: 1 };
  }
  updateSelectedNode(patch);
}

function toggleEdgeDirection() {
  if (selection.value?.kind !== "edge") return;
  const target = selection.value.edge;
  const edges = props.modelValue.edges.map((e) =>
    e === target ? { ...e, bidirectional: !e.bidirectional } : e
  );
  commit({ ...props.modelValue, edges });
  selection.value = { kind: "edge", edge: edges.find((e) => sameCell(e.from, target.from) && sameCell(e.to, target.to))! };
}

function swapEdgeDirection() {
  if (selection.value?.kind !== "edge") return;
  const target = selection.value.edge;
  const edges = props.modelValue.edges.map((e) =>
    e === target ? { ...e, from: e.to, to: e.from } : e
  );
  commit({ ...props.modelValue, edges });
  selection.value = { kind: "edge", edge: edges.find((e) => sameCell(e.from, target.to) && sameCell(e.to, target.from))! };
}

function deleteSelectedEdge() {
  if (selection.value?.kind !== "edge") return;
  const target = selection.value.edge;
  const edges = props.modelValue.edges.filter((e) => e !== target);
  commit({ ...props.modelValue, edges });
  selection.value = null;
}

function deleteSelectedNode() {
  if (selection.value?.kind === "node") deleteNode(selection.value.node);
}
</script>

<template>
  <div class="node-hacker-designer">
    <div class="node-hacker-designer__toolbar">
      <label>
        Tool:
        <select v-model="selectedTool">
          <option :value="NodeType.NODE">Node</option>
          <option :value="NodeType.ENTRY">Entry</option>
          <option :value="NodeType.EXIT">Exit</option>
          <option :value="NodeType.SERVER">Server</option>
          <option :value="NodeType.DATABASE">Database</option>
        </select>
      </label>
      <label>
        Difficulty:
        <input
          :value="difficulty"
          type="number"
          min="1"
          :max="maxDifficulty"
          @change="difficulty = clampDifficulty(Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <p class="hint">
        Click empty ground to place. Click a node to select/edit it. Use "Link From Here" in
        the inspector, then click another node to connect them. Right-click a node to delete
        it. Drag to pan, scroll to zoom.
      </p>
      <button type="button" @click="centerContent">Center View</button>
    </div>

    <div class="node-hacker-designer__body">
      <div
        ref="viewport"
        class="node-hacker-designer__viewport"
        :class="{ panning: isPanning }"
        @pointerdown="onViewportPointerDown"
        @pointermove="onViewportPointerMove"
        @pointerup="onViewportPointerUp"
        @pointercancel="onViewportPointerUp"
        @wheel="onViewportWheel"
        @click.capture="onViewportClickCapture"
      >
        <div
          class="node-hacker-designer__grid"
          :style="{ width: CANVAS_SIZE + 'px', height: CANVAS_SIZE + 'px', ...transformStyle }"
          @click="onBackgroundClick"
        >
          <svg class="node-hacker-designer__links" :width="CANVAS_SIZE" :height="CANVAS_SIZE">
            <g v-for="(edge, i) in modelValue.edges" :key="i">
              <!-- Wide, invisible hit-area line so an edge is actually clickable without
                   requiring pixel-perfect precision on the thin 3px visible stroke. -->
              <line
                :x1="cellCenter(edge.from[0], edge.from[1]).x"
                :y1="cellCenter(edge.from[0], edge.from[1]).y"
                :x2="cellCenter(edge.to[0], edge.to[1]).x"
                :y2="cellCenter(edge.to[0], edge.to[1]).y"
                class="node-hacker-designer__link-hit"
                @click="selectEdge(edge, $event)"
              />
              <line
                :x1="cellCenter(edge.from[0], edge.from[1]).x"
                :y1="cellCenter(edge.from[0], edge.from[1]).y"
                :x2="cellCenter(edge.to[0], edge.to[1]).x"
                :y2="cellCenter(edge.to[0], edge.to[1]).y"
                class="node-hacker-designer__link"
                :class="{ 'is-one-way': !edge.bidirectional, 'is-selected': selection?.kind === 'edge' && selection.edge === edge }"
              />
            </g>
            <!-- Drawn along each one-way connection's line rather than via marker-end at its
                 terminal point - an arrowhead at the endpoint sits right on top of the target
                 node's own icon (and, worse, right where that node's own click hit-area needs
                 priority - see .has-node's z-index), where it's barely legible. Free-floating
                 triangles along the line read clearly and never compete with a node for
                 clicks - two of them (rather than one) keeps direction obvious even on a long
                 connection where a single arrow reads as just a small dot from a distance. A
                 flat, precomputed list rather than a nested v-for per edge. -->
            <path
              v-for="pt in oneWayArrows"
              :key="pt.key"
              class="node-hacker-designer__link-arrow"
              :class="{ 'is-selected': selection?.kind === 'edge' && selection.edge === pt.edge }"
              d="M-8,-8 L8,0 L-8,8 Z"
              :transform="`translate(${pt.x}, ${pt.y}) rotate(${pt.angle})`"
            />
          </svg>
          <div
            v-for="node in modelValue.nodes"
            :key="`${node.x},${node.y}`"
            class="node-hacker-designer__cell has-node"
            :class="{ linking: linkFrom === node, selected: isSelectedNode(node) }"
            :style="{ left: cellCenter(node.x, node.y).x - NODE_SIZE / 2 + 'px', top: cellCenter(node.x, node.y).y - NODE_SIZE / 2 + 'px' }"
            @click="onNodeClick(node, $event)"
            @contextmenu="onNodeRightClick(node, $event)"
          >
            <div class="nh-node" :class="`type-${node.type}`">
              <span class="nh-node__face">
                <i class="nh-node__icon fa-solid" :class="iconForNodeType(node.type)"></i>
                <span class="nh-node__core">{{ node.difficulty }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="node-hacker-designer__inspector">
        <template v-if="linkFrom">
          <p class="hint">Linking from ({{ linkFrom.x }}, {{ linkFrom.y }}) - click a target node.</p>
          <button type="button" @click="cancelLink">Cancel Link</button>
        </template>

        <template v-else-if="selection?.kind === 'node'">
          <h4>Node</h4>
          <label>
            Label:
            <input
              type="text"
              placeholder="(optional)"
              :value="selection.node.label ?? ''"
              @change="updateSelectedNode({ label: ($event.target as HTMLInputElement).value || undefined })"
            />
          </label>
          <label>
            Type:
            <select :value="selection.node.type" @change="onTypeChange(($event.target as HTMLSelectElement).value as NodeType)">
              <option :value="NodeType.NODE">Node</option>
              <option :value="NodeType.ENTRY">Entry</option>
              <option :value="NodeType.EXIT">Exit</option>
              <option :value="NodeType.SERVER">Server</option>
              <option :value="NodeType.DATABASE">Database</option>
            </select>
          </label>
          <label>
            Difficulty:
            <input
              type="number"
              min="1"
              :max="maxDifficulty"
              :value="selection.node.difficulty"
              @change="updateSelectedNode({ difficulty: clampDifficulty(Number(($event.target as HTMLInputElement).value)) })"
            />
          </label>
          <template v-if="selection.node.type === NodeType.DATABASE">
            <label>
              Data:
              <textarea
                placeholder="(optional) What this database holds - GM reference only, echoed to the GM if the hacker captures it."
                :value="selection.node.data ?? ''"
                @change="updateSelectedNode({ data: ($event.target as HTMLTextAreaElement).value || undefined })"
              ></textarea>
            </label>
            <label>
              Reward:
              <select
                :value="selection.node.reward?.kind ?? 'stop'"
                @change="updateSelectedNode({ reward: { kind: ($event.target as HTMLSelectElement).value as 'nuke' | 'stop', quantity: selection.node.reward?.quantity ?? 1 } })"
              >
                <option value="stop">Stop Virus</option>
                <option value="nuke">Nuke Virus</option>
              </select>
            </label>
            <label>
              Quantity:
              <input
                type="number"
                min="1"
                max="9"
                :value="selection.node.reward?.quantity ?? 1"
                @change="updateSelectedNode({ reward: { kind: selection.node.reward?.kind ?? 'stop', quantity: Number(($event.target as HTMLInputElement).value) } })"
              />
            </label>
          </template>
          <div class="node-hacker-designer__inspector-actions">
            <button type="button" @click="startLinkFromSelection">Link From Here</button>
            <button type="button" @click="selection = null">Deselect</button>
            <button type="button" class="danger" @click="deleteSelectedNode">Delete Node</button>
          </div>
        </template>

        <template v-else-if="selection?.kind === 'edge'">
          <h4>Connection</h4>
          <p>({{ selection.edge.from[0] }}, {{ selection.edge.from[1] }}) &rarr; ({{ selection.edge.to[0] }}, {{ selection.edge.to[1] }})</p>
          <label>
            <input type="checkbox" :checked="selection.edge.bidirectional" @change="toggleEdgeDirection" />
            Bidirectional
          </label>
          <div class="node-hacker-designer__inspector-actions">
            <button type="button" v-if="!selection.edge.bidirectional" @click="swapEdgeDirection">Swap Direction</button>
            <button type="button" @click="selection = null">Deselect</button>
            <button type="button" class="danger" @click="deleteSelectedEdge">Delete Connection</button>
          </div>
        </template>

        <template v-else>
          <p class="hint">Click a node or connection to inspect it.</p>
        </template>
      </div>
    </div>
  </div>
</template>
