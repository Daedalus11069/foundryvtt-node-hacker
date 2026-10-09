<script setup lang="ts">
import { computed } from "vue";
import { TraceUnit } from "@/constants";
import type Trace from "@/classes/Trace";

const props = defineProps<{ trace: Trace }>();

const percent = computed(() => Math.min(100, Math.round((props.trace.value / props.trace.max) * 100)));

// Managed mode's trace value is derived from graph proximity (how close the trace side's
// territory is to the hacker's entry point - see HackSession.recomputeManagedTrace), and
// POINTS mode is a straight 0-100% failure meter (see Trace.registerAttempt) - neither is a
// count of anything real like elapsed turns or seconds, so both read better as a percentage
// than as "X / Y". TIME's literal countdown is the one case that's an actual unit worth
// showing raw.
const isPercentBased = computed(() => props.trace.unit === TraceUnit.TURNS || props.trace.unit === TraceUnit.POINTS);
const label = computed(() => (props.trace.unit === TraceUnit.TURNS ? "Proximity" : "Trace"));

// TIME mode's countdown doesn't run at all until the hacker first trips detection (fails a
// node attempt) - showing "0 / 20s" the whole time would read as "the clock just hasn't
// gotten anywhere yet" instead of "the clock hasn't started".
const notYetTripped = computed(() => props.trace.unit === TraceUnit.TIME && !props.trace.started);
</script>

<template>
  <div>
    <div class="nh-readout">
      <span>{{ label }}</span>
      <strong v-if="notYetTripped">Not yet detected</strong>
      <strong v-else-if="isPercentBased">{{ percent }}%</strong>
      <strong v-else>{{ trace.value }} / {{ trace.max }}s</strong>
    </div>
    <div class="nh-bar" :class="{ detected: trace.detected, paused: trace.isPaused }">
      <div class="nh-bar__fill" :style="{ width: percent + '%' }" />
    </div>
    <p v-if="trace.isPaused || trace.detected" class="nh-notice">
      <span v-if="trace.isPaused">Trace paused.</span>
      <span v-if="trace.detected" class="nh-detected-label">DETECTED</span>
    </p>
  </div>
</template>
