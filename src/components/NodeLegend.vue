<script setup lang="ts">
/** A swatch + label list in the side panel explaining the map: contested ownership
 * (blue/red). */
</script>

<template>
  <div class="nh-panel-section">
    <h3 class="nh-panel-heading">Legend</h3>
    <div class="nh-legend">
      <span><i class="nh-legend-dot" /> unclaimed</span>
      <span><i class="nh-legend-dot status-owned" /> hacker-held</span>
      <span><i class="nh-legend-dot status-enemy" /> trace-held</span>
      <span><i class="nh-legend-dot status-capturing" /> in progress</span>
      <span><i class="nh-legend-dot type-database" /> database</span>
      <span><i class="nh-legend-dot type-server" /> server</span>
      <span><i class="nh-legend-dot type-exit" /> exit</span>
      <span><i class="nh-legend-line" /> route</span>
      <span><i class="nh-legend-line is-hacker-path" /> hacker path</span>
      <span><i class="nh-legend-line is-trace-path" /> trace path</span>
    </div>
  </div>
</template>
