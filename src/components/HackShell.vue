<script setup lang="ts">
defineProps<{ kicker: string; title: string }>();
</script>

<template>
  <section class="nh-shell">
    <header class="nh-header">
      <div>
        <p class="nh-kicker">{{ kicker }}</p>
        <h2>{{ title }}</h2>
      </div>
      <div class="nh-status">
        <slot name="status" />
      </div>
    </header>
    <div class="nh-grid">
      <aside class="nh-panel">
        <slot name="panel" />
      </aside>
      <main class="nh-map">
        <slot />
      </main>
    </div>
  </section>
</template>
