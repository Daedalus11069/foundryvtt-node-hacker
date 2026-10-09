<script setup lang="ts">
import { computed } from "vue";
import { Side } from "@/constants";
import { iconForNodeType } from "@/classes/nodeIcons";
import type HackNode from "@/classes/HackNode";

/**
 * A real contextual menu, not a persistent sidebar section: clicking a node pops this up
 * right at the cursor with whichever of Capture/Nuke/Stop/Fortify actually apply, and it
 * closes itself again on any action or on an outside click. Positioned with `position:
 * fixed` using the raw click coordinates (already viewport-relative) - deliberately mounted
 * outside NodeGraphView's pan/zoom-transformed subtree (see HackerView/PlayerManagedView),
 * since a `fixed` element's containing block becomes whatever transformed ancestor it's
 * nested under instead of the real viewport otherwise, which would reintroduce exactly the
 * kind of transform-math positioning bugs this sidesteps by using fixed positioning at all.
 */
const props = withDefaults(
  defineProps<{
    node: HackNode;
    x: number;
    y: number;
    /** Whether the hacker actor currently has at least one Nuke Virus item. */
    canNuke: boolean;
    /** Whether the hacker actor currently has at least one Stop Virus item. */
    canStop: boolean;
    busy: boolean;
    /** Whether this node is already HackSession.activeNodeKey - hides the redundant "Move
     * Here" action on the node the hacker's already at. */
    isActive?: boolean;
    /** The hacker's current-position node (HackSession.activeNodeKey, resolved) - Capture/
     * Nuke now require adjacency to THIS specific node, not to any node the hacker owns
     * anywhere on the graph (see HackNode.canBeCaptured). */
    activeNode: HackNode | null;
  }>(),
  { canNuke: true, canStop: true, isActive: false }
);

const emit = defineEmits<{
  capture: [node: HackNode];
  nuke: [node: HackNode];
  stop: [node: HackNode];
  fortify: [node: HackNode];
  move: [node: HackNode];
  close: [];
}>();

const iconClass = computed(() => iconForNodeType(props.node.type));

const canCapture = computed(() => props.node.canBeCaptured(false, props.activeNode));
const canNukeThis = computed(() => props.node.canBeCaptured(false, props.activeNode) && props.canNuke);
const canStopThis = computed(() => props.canStop);
const canFortify = computed(
  () => props.node.owner === Side.HACKER && props.node.capturing === null && props.node.fortifyBonus < 1
);
// Free movement between owned territory (see HackSession.moveTo) - available on any owned
// node other than wherever the hacker already is, regardless of fortify/capturing state.
const canMove = computed(() => props.node.owner === Side.HACKER && !props.isActive);
const hasAnyAction = computed(
  () => canCapture.value || canNukeThis.value || canStopThis.value || canFortify.value || canMove.value
);

// Keeps the menu on-screen without needing to measure its own rendered size first - a rough
// fixed budget for its own width/height is good enough since it's a small, fixed-content menu.
const MENU_WIDTH = 200;
const MENU_HEIGHT = 220;
const clampedX = computed(() => Math.min(props.x, window.innerWidth - MENU_WIDTH - 8));
const clampedY = computed(() => Math.min(props.y, window.innerHeight - MENU_HEIGHT - 8));

function act(action: "capture" | "nuke" | "stop" | "fortify" | "move") {
  switch (action) {
    case "capture":
      emit("capture", props.node);
      break;
    case "nuke":
      emit("nuke", props.node);
      break;
    case "stop":
      emit("stop", props.node);
      break;
    case "fortify":
      emit("fortify", props.node);
      break;
    case "move":
      emit("move", props.node);
      break;
  }
  emit("close");
}
</script>

<template>
  <!-- Teleported straight to <body>: Foundry's ApplicationV2 window content establishes its
       own containing block for `position: fixed` descendants (via CSS containment), so
       merely mounting outside NodeGraphView's transformed subtree isn't enough - nested
       anywhere inside the app's DOM at all, this menu's `fixed` coordinates would resolve
       against that clipped container instead of the real viewport and render off-screen. -->
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

        <button type="button" v-if="canCapture" :disabled="busy" @click="act('capture')">Capture</button>
        <button type="button" v-if="canNukeThis" :disabled="busy" @click="act('nuke')">Nuke Virus</button>
        <button type="button" v-if="canStopThis" :disabled="busy" @click="act('stop')">Stop Virus</button>
        <button type="button" v-if="canFortify" :disabled="busy" @click="act('fortify')">Fortify</button>
        <button type="button" v-if="canMove" :disabled="busy" @click="act('move')">Move Here</button>
        <p v-if="!hasAnyAction" class="nh-context-menu__note">No actions available on this node.</p>
      </div>
    </div>
  </Teleport>
</template>
