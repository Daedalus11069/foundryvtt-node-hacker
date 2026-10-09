<script setup lang="ts">
import { onMounted, ref } from "vue";
import DesignerCanvas from "./DesignerCanvas.vue";
import GraphStore from "@/classes/GraphStore";
import type { HackGraphConfig } from "@/classes/HackGraph";

const BLANK_GRAPH: HackGraphConfig = { name: "New Graph", nodes: [], edges: [] };

const props = defineProps<{ initial: HackGraphConfig }>();
const emit = defineEmits<{ save: [HackGraphConfig] }>();

const graph = ref<HackGraphConfig>(structuredClone(props.initial));
const savedGraphs = ref<HackGraphConfig[]>([]);
const selectedToLoad = ref("");

async function refreshList() {
  savedGraphs.value = await GraphStore.list();
}
onMounted(refreshList);

async function onSave() {
  if (!graph.value.name.trim()) {
    ui.notifications?.warn("Give the graph a name before saving.");
    return;
  }
  await GraphStore.save(graph.value);
  await refreshList();
  emit("save", graph.value);
}

function onNew() {
  graph.value = structuredClone(BLANK_GRAPH);
  selectedToLoad.value = "";
}

async function onLoad() {
  if (!selectedToLoad.value) return;
  // Fetched fresh from the store rather than trusting the cached savedGraphs list (only
  // populated at mount and after this window's own save/delete) - if the graph was saved by
  // a different Designer window, or by another user's session, that cache could be stale or
  // simply not contain it yet, and the dropdown would silently fail to load anything.
  const found = await GraphStore.get(selectedToLoad.value);
  if (found) {
    graph.value = structuredClone(found);
  } else {
    ui.notifications?.warn(`Could not find a saved graph named "${selectedToLoad.value}".`);
  }
}

async function onDelete() {
  if (!selectedToLoad.value) return;
  const confirmed = await Dialog.confirm({
    title: "Delete Node Graph",
    content: `<p>Permanently delete the saved graph "${selectedToLoad.value}"?</p>`
  });
  if (!confirmed) return;
  await GraphStore.delete(selectedToLoad.value);
  if (graph.value.name === selectedToLoad.value) onNew();
  selectedToLoad.value = "";
  await refreshList();
}
</script>

<template>
  <div class="node-hacker-designer-root">
    <div class="node-hacker-designer-root__header">
      <input v-model="graph.name" type="text" placeholder="Graph name" />
      <select v-model="selectedToLoad">
        <option value="">Load saved graph...</option>
        <option v-for="g in savedGraphs" :key="g.name" :value="g.name">{{ g.name }}</option>
      </select>
      <button type="button" :disabled="!selectedToLoad" @click="onLoad">Load</button>
      <button type="button" :disabled="!selectedToLoad" @click="onDelete">Delete</button>
      <button type="button" @click="onNew">New</button>
      <button type="button" @click="onSave">Save Graph</button>
    </div>
    <DesignerCanvas v-model="graph" />
  </div>
</template>
