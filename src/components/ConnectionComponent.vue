<script setup lang="ts">
import { computed } from "vue";
import { Side } from "@/constants";
import type HackConnection from "@/classes/HackConnection";
import { calculateConnectorStyle } from "@/classes/ConnectorGeometry";

const props = withDefaults(
  defineProps<{
    connection: HackConnection;
    trace: boolean;
    cellSize: number;
    /** Same minX/minY shift NodeGraphView applies to node grid placement (see its own
     * comment) - connector geometry is computed straight from the nodes' raw x/y below, so
     * it must be shifted into the same non-negative space those nodes are actually
     * rendered in, or a line would point at where a negative-coordinate node WOULD be
     * without the shift instead of where it actually now is. */
    offsetX?: number;
    offsetY?: number;
  }>(),
  { offsetX: 0, offsetY: 0 }
);

/** Solid blue when the hacker holds both ends, solid red when the trace holds both ends,
 * dashed otherwise. */
const pathClass = computed(() => {
  const { a, b } = props.connection;
  if (a.owner === Side.HACKER && b.owner === Side.HACKER) return "is-hacker-path";
  if (a.owner === Side.TRACE && b.owner === Side.TRACE) return "is-trace-path";
  return "";
});

/** Rendered line thickness. The box's own center (not its left edge) must land exactly on
 * ConnectorGeometry's computed point, since rotation pivots around the box's center by
 * default - offsetting `left` by half this width is what actually achieves that; leaving
 * `left` as the raw computed value (with a `border-left` providing the visible stroke
 * instead of a real `width`) puts the visible line off to one side of the intended point,
 * and rotating around that off-center pivot visibly swings the far end away from the node. */
const LINE_WIDTH = 3;

const style = computed(() => {
  const { a, b } = props.connection;
  const geo = calculateConnectorStyle(
    { x: a.x - props.offsetX, y: a.y - props.offsetY },
    { x: b.x - props.offsetX, y: b.y - props.offsetY },
    props.cellSize
  );
  return {
    top: `${geo.top}px`,
    left: `${geo.left - LINE_WIDTH / 2}px`,
    height: `${geo.height}px`,
    transform: `rotate(${geo.rotationDeg}deg)`
  };
});
</script>

<template>
  <div class="nh-link" :class="pathClass" :style="style"></div>
</template>
