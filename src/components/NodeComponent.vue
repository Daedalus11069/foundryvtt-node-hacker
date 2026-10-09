<script setup lang="ts">
import { computed } from "vue";
import { Side } from "@/constants";
import { iconForNodeType } from "@/classes/nodeIcons";
import type HackNode from "@/classes/HackNode";

const props = withDefaults(
  defineProps<{
    node: HackNode;
    trace: boolean;
    interactive: boolean;
    selected?: boolean;
    /** This viewer's current position - HackSession.activeNodeKey for the hacker (there's no
     * equivalent tracked for the trace side). Purely a display anchor, doesn't gate anything
     * mechanically - see HackSession.activeNodeKey's own comment. */
    active?: boolean;
    /** Whether this viewer can see the opponent's ownership/capture-in-progress/stop-virus
     * state on this node. Always true for a viewer looking at their own side; only matters
     * for the fog of war in a managed session (gated on hackerSpotted/traceMapped). */
    revealOpponent?: boolean;
  }>(),
  { revealOpponent: true, selected: false, active: false }
);

const emit = defineEmits<{
  select: [node: HackNode, x: number, y: number];
  move: [node: HackNode];
}>();

const viewerSide = computed(() => (props.trace ? Side.TRACE : Side.HACKER));
const opponentSide = computed(() => (props.trace ? Side.HACKER : Side.TRACE));

/** The owner as this viewer is allowed to perceive it - opponent ownership is masked out
 * (shown as unclaimed) unless revealOpponent is set. */
const visibleOwner = computed(() => {
  if (props.node.owner === opponentSide.value && !props.revealOpponent) return null;
  return props.node.owner;
});

const status = computed(() => {
  if (props.node.capturing === viewerSide.value) return "capturing";
  if (props.node.capturing === opponentSide.value && props.revealOpponent) return "enemy-capturing";
  if (visibleOwner.value === viewerSide.value) return "owned";
  if (visibleOwner.value === opponentSide.value) return "enemy";
  return "none";
});

/** Evidence the opponent is present (a stop-virus effect they applied) - only meaningful to
 * show the trace side once the hacker's been spotted; the hacker always sees their own. */
const showStopped = computed(() => props.node.stopped && (viewerSide.value === Side.HACKER || props.revealOpponent));

const iconClass = computed(() => iconForNodeType(props.node.type));

/** Left-click on a node this viewer already owns just moves there directly - costs a turn
 * like every other action, but no dice check, and no reason to make the player go through
 * the menu for it (see HackSession.moveTo/traceMoveTo). Every other left-click, and every
 * right-click regardless of ownership (so Fortify/Stop Virus on an owned node stay
 * reachable), opens the full contextual menu instead. */
function onClick(e: MouseEvent) {
  if (!props.interactive) return;
  if (props.node.owner === viewerSide.value) {
    emit("move", props.node);
    return;
  }
  e.preventDefault();
  emit("select", props.node, e.clientX, e.clientY);
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  if (!props.interactive) return;
  emit("select", props.node, e.clientX, e.clientY);
}
</script>

<template>
  <button
    type="button"
    class="nh-node"
    :class="[`type-${node.type}`, `status-${status}`, { interactive, stopped: showStopped, selected, active }]"
    :disabled="!interactive"
    :aria-label="`${node.type} node, difficulty ${node.difficulty}`"
    @click="onClick"
    @contextmenu="onContextMenu"
  >
    <span class="nh-node__face">
      <i class="nh-node__icon fa-solid" :class="iconClass"></i>
      <span class="nh-node__core">{{ node.difficulty }}</span>
    </span>
    <span v-if="node.label" class="nh-node__label">{{ node.label }}</span>
  </button>
</template>
