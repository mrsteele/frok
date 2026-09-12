<script setup>
import { onMounted, ref } from 'vue';
const info = ref(null), error = ref('');
onMounted(async () => { try { info.value = await window.frokDocs?.info(); if (info.value) document.documentElement.classList.add('frok-offline-docs'); } catch {} });
async function online() {
  try { await window.frokDocs.openOnline(); error.value = ''; }
  catch { error.value = 'Could not open your browser.'; }
}
</script>

<template>
  <div v-if="info" class="desktop-docs-notice">
    <span>Offline documentation · Frok {{ info.version }}</span>
    <button v-if="info.onlineAvailable" @click="online">View online ↗</button>
    <span v-if="error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.desktop-docs-notice { position:fixed; bottom:0; left:0; right:0; z-index:35; display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; padding:10px 24px; border-top:1px solid var(--vp-c-divider); background:var(--vp-c-bg-alt); color:var(--vp-c-text-2); font-size:13px; }
:global(.frok-offline-docs .Layout) { padding-bottom:70px; }
:global(.frok-offline-docs .VPSidebar) { padding-bottom:90px; }
button { color:var(--vp-c-brand-1); font-weight:600; }
button:focus-visible { outline:2px solid var(--vp-c-brand-1); outline-offset:4px; }
</style>
