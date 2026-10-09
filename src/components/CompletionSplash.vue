<script setup lang="ts">
import { computed } from "vue";
import type { DatabaseReward } from "@/classes/HackNode";

const props = defineProps<{
  result: "won" | "lost" | "aborted";
  databases: { label: string; difficulty: number; reward?: DatabaseReward }[];
}>();

const emit = defineEmits<{ close: [] }>();

const cardClass = computed(() => (props.result === "won" ? "is-won" : props.result === "lost" ? "is-lost" : "is-aborted"));
const title = computed(() =>
  props.result === "won" ? "Hack Complete" : props.result === "lost" ? "Trace Complete" : "Hack Aborted"
);
const subtitle = computed(() => {
  if (props.result === "won") return "The goal has been reached.";
  if (props.result === "lost") return "The trace caught up before the goal was reached.";
  return "The attempt was called off before it resolved.";
});
</script>

<template>
  <div class="nh-splash">
    <div class="nh-splash__card" :class="cardClass">
      <h2 class="nh-splash__title">{{ title }}</h2>
      <p class="nh-splash__subtitle">{{ subtitle }}</p>

      <div class="nh-splash__loot">
        <h3>Databases Breached</h3>
        <ul v-if="databases.length">
          <li v-for="(d, i) in databases" :key="i">
            <span>{{ d.label }}</span>
            <span v-if="d.reward" class="nh-splash__reward">
              {{ d.reward.quantity }}x {{ d.reward.kind === "nuke" ? "Nuke Virus" : "Stop Virus" }}
            </span>
          </li>
        </ul>
        <p v-else class="nh-notice">None breached.</p>
      </div>

      <button type="button" @click="emit('close')">Close</button>
    </div>
  </div>
</template>
