<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import ManagedSession, { type ManagedSessionState } from "@/managed/ManagedSession";
import buildGraphFromState from "@/managed/buildGraphFromState";
import type HackGraph from "@/classes/HackGraph";
import Trace from "@/classes/Trace";
import { Side, TraceMode } from "@/constants";
import type HackNode from "@/classes/HackNode";
import NodeGraphView from "./NodeGraphView.vue";
import TraceStatusBar from "./TraceStatusBar.vue";
import HackShell from "./HackShell.vue";
import NodeLegend from "./NodeLegend.vue";
import NodeContextMenu from "./NodeContextMenu.vue";
import CompletionSplash from "./CompletionSplash.vue";

const props = defineProps<{ sessionId: string; initialState: ManagedSessionState }>();
const emit = defineEmits<{ close: [] }>();

const graph = ref<HackGraph>(buildGraphFromState(props.initialState));
const traceMapped = ref(props.initialState.traceMapped);
const trace = ref<Trace>(
  Object.assign(
    new Trace({ mode: TraceMode.MANAGED, max: props.initialState.trace.max }, props.initialState.trace.unit),
    props.initialState.trace
  )
);
const menu = ref<{ nodeKey: string; x: number; y: number } | null>(null);

// The GM's client is authoritative for items (nuke/stop) - this client has no direct access to
// the hacker actor's item list, so these come from the broadcast state instead of being assumed.
const canNuke = ref(props.initialState.canNuke);
const canStop = ref(props.initialState.canStop);
const aborted = ref(props.initialState.aborted);
const activeNodeKey = ref(props.initialState.activeNodeKey);

const nodeCount = computed(() => graph.value.nodes.size);
const ownedCount = computed(() => [...graph.value.nodes.values()].filter((n) => n.owner === Side.HACKER).length);
// Re-resolved off the live `graph` each time (rather than holding the HackNode object
// directly) since `graph` gets entirely rebuilt from scratch on every broadcast - the object
// held in `menu` would otherwise go stale the instant a new state update arrives.
const menuNode = computed(() => (menu.value ? graph.value.nodes.get(menu.value.nodeKey) ?? null : null));
const activeNode = computed(() => (activeNodeKey.value ? graph.value.nodes.get(activeNodeKey.value) ?? null : null));

// Mirrors HackSession.isComplete() client-side - this view only ever has the broadcast
// state, never the live session, so completion has to be derived from the same rebuilt
// graph/trace this view already renders rather than asked of the GM.
const result = computed<"won" | "lost" | "aborted" | null>(() => {
  if (aborted.value) return "aborted";
  if (graph.value.isGoalCaptured()) return "won";
  if (trace.value.detected || graph.value.isTraceVictory()) return "lost";
  return null;
});
const breachedDatabases = computed(() =>
  [...graph.value.getDatabaseNodes()]
    .filter((n) => n.owner === Side.HACKER)
    .map((n) => ({ label: n.label ?? "Database", difficulty: n.difficulty, reward: n.reward }))
);

function onState(state: ManagedSessionState) {
  graph.value = buildGraphFromState(state);
  traceMapped.value = state.traceMapped;
  canNuke.value = state.canNuke;
  canStop.value = state.canStop;
  aborted.value = state.aborted;
  activeNodeKey.value = state.activeNodeKey;
  Object.assign(trace.value, state.trace);
}

onMounted(() => ManagedSession.onState(props.sessionId, onState));
onUnmounted(() => ManagedSession.offState(props.sessionId, onState));

function onSelect(node: HackNode, x: number, y: number) {
  menu.value = { nodeKey: node.key, x, y };
}

function onCapture(node: HackNode) {
  ManagedSession.requestCapture(props.sessionId, node);
}

function onNuke(node: HackNode) {
  ManagedSession.requestNuke(props.sessionId, node);
}

function onStop(node: HackNode) {
  ManagedSession.requestStop(props.sessionId, node);
}

function onStopGlobal() {
  ManagedSession.requestStop(props.sessionId);
}

function onFortify(node: HackNode) {
  ManagedSession.requestFortify(props.sessionId, node);
}

function onMove(node: HackNode) {
  ManagedSession.requestMove(props.sessionId, node);
}

function onScan() {
  ManagedSession.requestScan(props.sessionId);
}

/** Closes this window immediately rather than showing the completion splash - aborting is
 * a deliberate "I'm done here", not a result to review. The actual abort request to the GM
 * happens in PlayerManagedApp.close() itself, so any other way this window closes (titlebar
 * X included) gets the same treatment. */
function onAbort() {
  emit("close");
}
</script>

<template>
  <HackShell kicker="Node Hacker / intrusion layer" title="Hacking... (Live)">
    <template #status>
      <span>{{ ownedCount }} / {{ nodeCount }} nodes held</span>
    </template>
    <template v-if="!result" #panel>
      <div class="nh-panel-section">
        <h3 class="nh-panel-heading">Trace</h3>
        <TraceStatusBar :trace="trace" />
      </div>

      <div class="nh-panel-section">
        <h3 class="nh-panel-heading">Status</h3>
        <p class="nh-notice">The GM is running the trace live. Stay quiet — every action risks detection.</p>
      </div>

      <NodeLegend />

      <div class="nh-panel-section nh-actions-section">
        <h3 class="nh-panel-heading">Actions</h3>
        <div class="nh-actions">
          <button type="button" @click="onStopGlobal">Use Stop Virus</button>
          <button type="button" @click="onScan">Scan for Trace</button>
          <button type="button" @click="onAbort">Abort Hack</button>
        </div>
      </div>
    </template>

    <CompletionSplash
      v-if="result"
      :result="result"
      :databases="breachedDatabases"
      @close="emit('close')"
    />
    <NodeGraphView
      v-else
      :graph="graph"
      :trace="false"
      :interactive="true"
      :selected-key="menu?.nodeKey"
      :active-key="activeNodeKey"
      :reveal-opponent="traceMapped"
      @select="onSelect"
      @move="onMove"
    />
  </HackShell>

  <!-- Rendered outside NodeGraphView's pan/zoom-transformed subtree on purpose - see
       NodeContextMenu's own comment on why that matters for `position: fixed`. -->
  <NodeContextMenu
    v-if="menuNode && !result"
    :node="menuNode"
    :x="menu!.x"
    :y="menu!.y"
    :can-nuke="canNuke"
    :can-stop="canStop"
    :busy="false"
    :active-node="activeNode"
    :is-active="menuNode?.key === activeNodeKey"
    @capture="onCapture"
    @nuke="onNuke"
    @stop="onStop"
    @move="onMove"
    @fortify="onFortify"
    @close="menu = null"
  />
</template>
