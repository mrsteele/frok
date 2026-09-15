---
layout: false
search: false
---

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import WorkflowDemo from './.vitepress/theme/WorkflowDemo.vue'

const viewport = ref(), demo = ref(), scale = ref(1)
let observer
onMounted(() => {
  observer = new ResizeObserver(() => {
    scale.value = Math.min(1,
      viewport.value.clientWidth / demo.value.offsetWidth,
      viewport.value.clientHeight / demo.value.offsetHeight)
  })
  observer.observe(viewport.value)
  observer.observe(demo.value)
})
onUnmounted(() => observer?.disconnect())
</script>

<div ref="viewport" class="welcome-demo-viewport">
  <div ref="demo" class="welcome-demo-embed" :style="{ transform: `scale(${scale})` }"><WorkflowDemo /></div>
</div>

<style>
html:has(.welcome-demo-viewport), body:has(.welcome-demo-viewport), #app:has(.welcome-demo-viewport) { margin: 0; padding: 0; min-width: 0; overflow: hidden; background: transparent; }
.welcome-demo-viewport { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.welcome-demo-embed { width: 480px; flex-shrink: 0; transform-origin: center; }
</style>
