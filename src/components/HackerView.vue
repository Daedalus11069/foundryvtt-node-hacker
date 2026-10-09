<script setup lang="ts">
import { computed, ref } from "vue";
import type HackSession from "@/classes/HackSession";
import type HackNode from "@/classes/HackNode";
import { Side } from "@/constants";
import advanceCombatTurn from "@/classes/advanceCombatTurn";
import NodeGraphView from "./NodeGraphView.vue";
import TraceStatusBar from "./TraceStatusBar.vue";
import HackShell from "./HackShell.vue";
import NodeLegend from "./NodeLegend.vue";
import NodeContextMenu from "./NodeContextMenu.vue";
import CompletionSplash from "./CompletionSplash.vue";

// onChanged is a plain callback prop, not a defineEmits event - "changed" is deliberately
// NOT declared as an emit, so this stays a real awaitable function call (`await
// props.onChanged?.()` below) instead of a fire-and-forget `emit("changed")`, which discards
// whatever promise its listener (HackerApp's onSessionChanged, which persists the session)
// returns. See SessionPersistence's own comment on why awaiting that write matters.
const props = defineProps<{ session: HackSession; onChanged?: () => void | Promise<void> }>();
const emit = defineEmits<{ close: [] }>();

const busy = ref(false);
const menu = ref<{ node: HackNode; x: number; y: number } | null>(null);

const nodeCount = computed(() => props.session.graph.nodes.size);
const ownedCount = computed(
  () => [...props.session.graph.nodes.values()].filter((n) => n.owner === Side.HACKER).length
);

// Read-only for display purposes - the actual one-time completion chat card is posted from
// HackerApp's onChanged handler via session.checkCompletion(), not from this computed (a
// reactive getter shouldn't itself carry a side effect that must only ever fire once).
const result = computed(() => props.session.isComplete());
const breachedDatabases = computed(() =>
  [...props.session.graph.getDatabaseNodes()]
    .filter((n) => n.owner === Side.HACKER)
    .map((n) => ({ label: n.label ?? "Database", difficulty: n.difficulty, reward: n.reward }))
);

const canNuke = computed(() => {
  const actor = props.session.actor;
  return !!actor && props.session.items.getNukeItems(actor).length > 0;
});
const canStop = computed(() => {
  const actor = props.session.actor;
  return !!actor && props.session.items.getStopItems(actor).length > 0;
});

function onSelect(node: HackNode, x: number, y: number) {
  menu.value = { node, x, y };
}

const activeNode = computed(() =>
  props.session.activeNodeKey ? (props.session.graph.nodes.get(props.session.activeNodeKey) ?? null) : null
);

/** Every node action costs one turn, spent against Foundry's own combat tracker rather than
 * a bespoke counter - see advanceCombatTurn. Also what drives a managed session's automatic
 * trace-side counterplay, but this is solo play, so it's just the pacing cost here. */
async function runAction(action: () => Promise<boolean>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
    await advanceCombatTurn();
    await props.onChanged?.();
  } finally {
    busy.value = false;
  }
}

function onCapture(node: HackNode) {
  return runAction(() => props.session.captureNode(node));
}

function onNuke(node: HackNode) {
  return runAction(() => props.session.nukeNode(node));
}

function onStop(node: HackNode) {
  return runAction(() => props.session.stopVirus(node));
}

function onFortify(node: HackNode) {
  return runAction(() => props.session.fortifyHackerNode(node));
}

function onMove(node: HackNode) {
  return runAction(() => Promise.resolve(props.session.moveTo(node)));
}

/** Calls off the attempt and closes the window immediately rather than showing the
 * completion splash - aborting is a deliberate "I'm done here", not a result to review.
 * The actual session.abort() + chat card happens in HackerApp.close() itself, so any other
 * way this window closes (titlebar X included) gets the same treatment. */
function onAbort() {
  if (busy.value) return;
  emit("close");
}
</script>

<template>
  <HackShell kicker="Node Hacker / intrusion layer" title="Hacking...">
    <template #status>
      <span>{{ ownedCount }} / {{ nodeCount }} nodes held</span>
    </template>
    <template v-if="!result" #panel>
      <div class="nh-panel-section">
        <TraceStatusBar :trace="session.trace" />
      </div>

      <div class="nh-panel-section">
        <h3 class="nh-panel-heading">Objective</h3>
        <p class="nh-notice">Click a node for a menu of what you can do with it. Each action costs one turn.</p>
      </div>

      <NodeLegend />

      <div class="nh-panel-section nh-actions-section">
        <h3 class="nh-panel-heading">Actions</h3>
        <div class="nh-actions">
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
      :trace="false"
      :interactive="!busy"
      :selected-key="menu?.node.key"
      :active-key="session.activeNodeKey"
      @select="onSelect"
      @move="onMove"
    />
  </HackShell>

  <!-- Rendered outside NodeGraphView's pan/zoom-transformed subtree on purpose - see
       NodeContextMenu's own comment on why that matters for `position: fixed`. -->
  <NodeContextMenu
    v-if="menu && !result"
    :node="menu.node"
    :x="menu.x"
    :y="menu.y"
    :can-nuke="canNuke"
    :can-stop="canStop"
    :busy="busy"
    :is-active="menu?.node.key === session.activeNodeKey"
    :active-node="activeNode"
    @capture="onCapture"
    @nuke="onNuke"
    @stop="onStop"
    @fortify="onFortify"
    @move="onMove"
    @close="menu = null"
  />
</template>
