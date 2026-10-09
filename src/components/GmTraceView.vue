<script setup lang="ts">
import { computed, ref } from "vue";
import { Side } from "@/constants";
import type HackSession from "@/classes/HackSession";
import type HackNode from "@/classes/HackNode";
import ManagedSession from "@/managed/ManagedSession";
import NodeGraphView from "./NodeGraphView.vue";
import TraceStatusBar from "./TraceStatusBar.vue";
import HackShell from "./HackShell.vue";
import NodeLegend from "./NodeLegend.vue";
import CompletionSplash from "./CompletionSplash.vue";
import TraceContextMenu from "./TraceContextMenu.vue";

const props = defineProps<{ session: HackSession; sessionId: string }>();
const emit = defineEmits<{ close: [] }>();

const busy = ref(false);
const menu = ref<{ node: HackNode; x: number; y: number } | null>(null);

function onSelect(node: HackNode, x: number, y: number) {
  menu.value = { node, x, y };
}

/** Every manual GM action broadcasts to the player afterward, same as the automatic
 * Advance-Trace-turn button - the GM client is the authoritative session, so it just needs
 * to push its own updated state out rather than round-trip through a socket request. */
async function runAction(action: () => Promise<boolean>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
    ManagedSession.broadcast(props.sessionId, props.session);
  } finally {
    busy.value = false;
  }
}

function onCapture(node: HackNode) {
  return runAction(() => props.session.traceCaptureNode(node));
}

function onFortify(node: HackNode) {
  return runAction(() => props.session.fortifyTraceNode(node));
}

function onMove(node: HackNode) {
  return runAction(() => Promise.resolve(props.session.traceMoveTo(node)));
}

const activeNode = computed(() =>
  props.session.traceActiveNodeKey ? (props.session.graph.nodes.get(props.session.traceActiveNodeKey) ?? null) : null
);

/** Before the hacker causes any trace progress (or the GM successfully scans for them),
 * the GM sees only which nodes the trace itself controls — not the hacker's progress. */
const revealed = computed(() => props.session.hackerSpotted || props.session.hackerMapped);

const nodeCount = computed(() => props.session.graph.nodes.size);
const traceHeldCount = computed(
  () => [...props.session.graph.nodes.values()].filter((n) => n.owner === Side.TRACE).length
);

// The GM's own view holds the live, authoritative session directly - no broadcast state to
// derive this from, unlike PlayerManagedView.
const result = computed(() => props.session.isComplete());
const breachedDatabases = computed(() =>
  [...props.session.graph.getDatabaseNodes()]
    .filter((n) => n.owner === Side.HACKER)
    .map((n) => ({ label: n.label ?? "Database", difficulty: n.difficulty, reward: n.reward }))
);

function onAdvanceTurn() {
  ManagedSession.advanceTurn(props.sessionId);
}

async function onScan() {
  await props.session.scan(Side.TRACE);
}

/** Closes the GM's own window immediately rather than showing the completion splash - the
 * player's window still shows it, since they weren't the one who made the call. The actual
 * session.abort() + broadcast happens in GmTraceApp.close() itself, so any other way this
 * window closes (titlebar X included) gets the same treatment. */
function onAbort() {
  emit("close");
}
</script>

<template>
  <HackShell kicker="Node Hacker / trace layer" title="Run the Trace">
    <template #status>
      <span>{{ traceHeldCount }} / {{ nodeCount }} nodes held</span>
      <span v-if="revealed">Hacker spotted</span>
      <span v-else>No contact</span>
    </template>
    <template v-if="!result" #panel>
      <div class="nh-panel-section">
        <h3 class="nh-panel-heading">Trace</h3>
        <TraceStatusBar :trace="session.trace" />
      </div>

      <div class="nh-panel-section">
        <h3 class="nh-panel-heading">Status</h3>
        <p class="nh-notice">
          <template v-if="!revealed">
            The hacker has not been spotted. Node states below reflect only your own trace defenses.
          </template>
          <template v-else>The hacker has been spotted - their held nodes are now visible.</template>
        </p>
      </div>

      <NodeLegend />

      <div class="nh-panel-section nh-actions-section">
        <h3 class="nh-panel-heading">Actions</h3>
        <p class="nh-notice">Click a node to manually capture or fortify it - each costs one turn, same as the hacker's own moves.</p>
        <div class="nh-actions">
          <button type="button" @click="onAdvanceTurn">Advance Trace (Auto)</button>
          <button type="button" @click="onScan">Scan for Hacker</button>
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
      :graph="session.graph"
      :trace="true"
      :interactive="!busy"
      :reveal-opponent="revealed"
      :selected-key="menu?.node.key"
      :active-key="session.traceActiveNodeKey"
      @select="onSelect"
      @move="onMove"
    />
  </HackShell>

  <TraceContextMenu
    v-if="menu && !result"
    :node="menu.node"
    :x="menu.x"
    :y="menu.y"
    :busy="busy"
    :active-node="activeNode"
    :is-active="menu?.node.key === session.traceActiveNodeKey"
    @capture="onCapture"
    @fortify="onFortify"
    @move="onMove"
    @close="menu = null"
  />
</template>
