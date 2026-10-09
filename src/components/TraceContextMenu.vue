<script setup lang="ts">
import { computed } from "vue";
import { Side } from "@/constants";
import { iconForNodeType } from "@/classes/nodeIcons";
import type HackNode from "@/classes/HackNode";

/**
 * The trace side's half of NodeContextMenu: same floating-menu-at-cursor pattern (see that
 * component's own comment on why it's teleported to <body>), but scoped to the two manual
 * actions the GM's trace side actually has - Capture and Fortify. No Nuke/Stop here, those
 * are hacker-only items; the trace side's only "instant" option is the automatic
 * Advance-Trace-turn button in GmTraceView, not a per-node action.
 */
const props = withDefaults(
  defineProps<{
    node: HackNode;
    x: number;
    y: number;
    busy: boolean;
    /** The trace side's current-position node (HackSession.traceActiveNodeKey, resolved) -
     * Capture now requires adjacency to THIS specific node, not to any node the trace side
     * owns anywhere on the graph (see HackNode.canBeCaptured). */
    activeNode: HackNode | null;
    /** Whether this node is already traceActiveNodeKey - hides the redundant "Move Here". */
    isActive?: boolean;
  }>(),
  { isActive: false }
);

const emit = defineEmits<{
  capture: [node: HackNode];
  fortify: [node: HackNode];
  move: [node: HackNode];
  close: [];
}>();

const iconClass = computed(() => iconForNodeType(props.node.type));

const canCapture = computed(() => props.node.canBeCaptured(true, props.activeNode) && !props.node.stopped);
const canFortify = computed(
  () => props.node.owner === Side.TRACE && props.node.capturing === null && props.node.fortifyBonus < 1
);
const canMove = computed(() => props.node.owner === Side.TRACE && !props.isActive);
const hasAnyAction = computed(() => canCapture.value || canFortify.value || canMove.value);

const MENU_WIDTH = 200;
const MENU_HEIGHT = 180;
const clampedX = computed(() => Math.min(props.x, window.innerWidth - MENU_WIDTH - 8));
const clampedY = computed(() => Math.min(props.y, window.innerHeight - MENU_HEIGHT - 8));

function act(action: "capture" | "fortify" | "move") {
  if (action === "capture") emit("capture", props.node);
  else if (action === "fortify") emit("fortify", props.node);
  else emit("move", props.node);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div class="nh-menu-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div
        class="nh-context-menu"
        :style="{ left: `${clampedX}px`, top: `${clampedY}px` }"
        @click.stop
        @contextmenu.stop.prevent
      >
        <div class="nh-context-menu__header">
          <i class="fa-solid" :class="iconClass"></i>
          <span class="nh-context-menu__type">{{ node.type }}</span>
          <span class="nh-context-menu__dc">Difficulty {{ node.effectiveDifficulty() }}</span>
        </div>
        <p v-if="node.fortifyBonus > 0" class="nh-context-menu__note">
          Fortified: +{{ node.fortifyBonus }} to retake.
        </p>
        <p v-if="node.stopped" class="nh-context-menu__note">Stopped: the hacker has suppressed recapture here.</p>

        <button type="button" v-if="canCapture" :disabled="busy" @click="act('capture')">Capture</button>
        <button type="button" v-if="canFortify" :disabled="busy" @click="act('fortify')">Fortify</button>
        <button type="button" v-if="canMove" :disabled="busy" @click="act('move')">Move Here</button>
        <p v-if="!hasAnyAction" class="nh-context-menu__note">No actions available on this node.</p>
      </div>
    </div>
  </Teleport>
</template>
