<script setup>
import { useData, withBase } from 'vitepress'
import { product } from '../../../desktop/product.mjs'
import WorkflowDemo from './WorkflowDemo.vue'
const { isDark } = useData()
const guide = (path) => withBase(path + '.html')
</script>

<template>
  <div class="product-home">
    <section class="hero" aria-labelledby="product-title">
      <div>
        <p class="eyebrow">OPEN SOURCE. ON YOUR MACHINE.</p>
        <h1 id="product-title">A little idea.<br>A whole world<br><em>of possibilities.</em></h1>
        <p class="description">Meet Frok, your <strong class="local-word">local<svg viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true"><path d="M3 8 Q42 1 96 6 M9 12 Q53 6 88 10"/></svg></strong> image and video studio. Make an image, give it movement, and follow the versions you love.</p>
        <div class="actions"><a class="button primary" :href="product.releasesUrl">Download Frok ↗</a><a class="button secondary" :href="guide('/guide/getting-started')">Quick setup →</a></div>
        <p class="note">Bring your own runner. Keep your creative workspace local.</p>
      </div>
      <div class="hero-art">
        <div class="studio-preview">
          <div class="preview-title"><img :src="withBase('/mark-light.svg')" alt="" width="23" height="23"/><span>Frok</span><small>YOUR CREATIVE SPACE</small></div>
          <WorkflowDemo />
          <div class="preview-footer">Start with a few words.<span>See where they take you. →</span></div>
        </div>
        <a class="motion-note" :href="guide('/guide/videos')"><span aria-hidden="true">↳</span><div><strong>Found a frame you love?</strong><p>Give it a little movement.</p></div><span aria-hidden="true">↗</span></a>
      </div>
    </section>
    <div class="tools-strip"><span>YOUR TOOLS, TOGETHER</span><p>Vpipe <i>·</i> ComfyUI <i>·</i> Ollama</p><span>Connect only what you need.</span></div>
    <section class="possibilities" aria-labelledby="possibilities-title">
      <div class="intro"><p class="eyebrow">ROOM TO EXPLORE</p><h2 id="possibilities-title">From “what if”<br>to your favorite take.</h2><p>Less jumping between tools. More time finding the image, the motion, and the mood you had in mind.</p></div>
      <div class="benefits">
        <a :href="guide('/guide/images')"><span class="number">01 / CREATE</span><h3>Find your starting point.</h3><p>Turn a prompt into images. Explore fresh variations, adjust your direction, and save the frames worth keeping.</p><span class="learn">Explore images ↗</span></a>
        <a :href="guide('/guide/videos')"><span class="number">02 / ANIMATE</span><h3>Let the picture move.</h3><p>Describe what happens next. Animate a starting frame, work with references, or build a scene from words.</p><span class="learn">Explore video ↗</span></a>
        <a :href="guide('/guide/library')"><span class="number">03 / REFINE</span><h3>Keep the whole story.</h3><p>Browse a creation’s video takes together. Save your favorites, compare versions, and download the result.</p><span class="learn">Explore your library ↗</span></a>
      </div>
    </section>
    <section class="control" aria-labelledby="control-title">
      <div class="control-image"><img :src="withBase('/screenshots/asset-video-controls.png')" alt="Frok video controls with a motion prompt, render button, fixed seed indicator and link to the asset's job log" width="677" height="265" loading="lazy"/><p>Real controls. A clear path from prompt to render.</p></div>
      <div><p class="eyebrow">MAKE IT YOURS</p><h2 id="control-title">A friendly studio.<br>Your choice of tools.</h2><p>Frok brings Vpipe, ComfyUI, and optional Ollama prompt enhancement into one place. Choose your pipelines, tune your settings, and inspect the job behind each creation.</p><a class="text-link" :href="guide('/pipelines')">See how pipelines work ↗</a></div>
    </section>
    <section class="getting-started" aria-labelledby="start-title">
      <div class="intro"><p class="eyebrow">YOUR FIRST SESSION</p><h2 id="start-title">A small setup.<br>Then room to play.</h2></div>
      <ol class="steps"><li><span>01</span><h3>Connect a runner.</h3><p>Use your Vpipe or ComfyUI installation. Add Ollama if you want help enriching prompts.</p></li><li><span>02</span><h3>Choose a pipeline.</h3><p>Prepare the models for the kind of creation you want to make. Check for Ready.</p></li><li><span>03</span><h3>Try one small idea.</h3><p>Start with a preview image. Pick a favorite frame and explore a little motion.</p></li></ol>
      <div class="start-footer"><a class="button primary" :href="guide('/tutorials/first-creation')">Make your first creation ↗</a><p>Generation runs through separately installed tools and models.<br>Hardware requirements depend on the pipeline you choose.</p></div>
    </section>
    <section class="closing"><img :src="withBase(isDark?'/mark-light.svg':'/mark.svg')" alt="" width="48" height="48"/><p class="eyebrow">BUILT IN THE OPEN</p><h2>Your next idea<br>deserves a little space.</h2><p>Frok is an open-source project in early development.<br>Try it, explore the source, and help shape what comes next.</p><div class="actions"><a class="button primary" :href="product.releasesUrl">Download Frok ↗</a><a class="text-link" :href="guide('/documentation')">Read the documentation →</a></div></section>
  </div>
</template>

<style scoped>
.studio-preview,.studio-preview *{pointer-events:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-user-drag:none}
.local-word{position:relative;display:inline-block;color:var(--vp-c-brand-1);font-weight:650}.local-word svg{position:absolute;left:-5%;bottom:-5px;width:110%;height:9px;overflow:visible;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;transform:rotate(-3deg)}
.product-home{max-width:1200px;margin:auto;padding:0 40px;color:var(--vp-c-text-1)}
.hero{display:grid;grid-template-columns:1fr 1.05fr;gap:48px;align-items:center;padding:90px 0 74px}
.eyebrow{font-size:10px;line-height:1.5;font-weight:650;letter-spacing:.15em;color:var(--vp-c-brand-1)}
h1{font-size:clamp(40px,4.4vw,64px);line-height:1.06;letter-spacing:-.06em;font-weight:600;margin:24px 0}em{font-style:normal;color:var(--vp-c-brand-1)}
.description{font-size:17px;line-height:1.75;max-width:440px;color:var(--vp-c-text-2)}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:28px}.button{display:inline-flex;align-items:center;justify-content:center;padding:13px 20px;border-radius:9px;font-size:13px;font-weight:600}.primary{background:var(--vp-c-brand-3);color:#fff}.primary:hover{background:#205c39}.secondary{border:1px solid var(--vp-c-divider)}.secondary:hover{background:var(--vp-c-bg-soft)}.note{font-size:11px;color:var(--vp-c-text-2);margin-top:17px}
.hero-art{padding:48px 0;background:radial-gradient(ellipse at center,var(--vp-c-brand-soft),transparent 72%)}.studio-preview{background:#080808;border:1px solid #353d37;border-radius:14px;overflow:hidden;box-shadow:0 25px 70px #143f221a;color:#eaeaea}.preview-title{display:flex;align-items:center;gap:8px;padding:15px 18px;font-size:14px;border-bottom:1px solid #272727}.preview-title img{border-radius:5px}.preview-title small{font-size:8px;letter-spacing:.12em;margin-left:auto;color:#999}.composer{width:100%;height:auto;display:block;padding:20px 12px}.preview-footer{display:flex;gap:7px;font-size:9px;padding:14px 18px;border-top:1px solid #252525;color:#aaa}.preview-footer span{margin-left:auto;font-size:8px}.motion-note{display:flex;align-items:center;gap:15px;width:85%;margin:18px 0 0 auto;border:1px solid var(--vp-c-divider);background:var(--vp-c-bg-soft);border-radius:12px;padding:16px 20px}.motion-note>span{font-size:25px;color:var(--vp-c-brand-1)}.motion-note>span:last-child{margin-left:auto;font-size:17px}.motion-note strong{font-size:12px}.motion-note p{font-size:11px;color:var(--vp-c-text-2);margin:2px 0 0}
.tools-strip{display:flex;align-items:center;justify-content:space-between;gap:20px;border-block:1px solid var(--vp-c-divider);padding:25px 0}.tools-strip>span:first-child{font-size:9px;letter-spacing:.14em;font-weight:600}.tools-strip p{font-size:20px;font-weight:550;letter-spacing:-.03em}.tools-strip i{font-style:normal;color:var(--vp-c-brand-1);padding:0 17px}.tools-strip>span:last-child{font-size:11px;color:var(--vp-c-text-2)}
.possibilities{padding:90px 0}.intro{max-width:530px}h2{font-size:clamp(30px,3.3vw,44px);line-height:1.12;font-weight:550;letter-spacing:-.045em;margin:16px 0 20px}.intro>p:last-child,.control>div>p:not(.eyebrow){font-size:15px;line-height:1.85;color:var(--vp-c-text-2)}.benefits{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:38px}.benefits>a{padding:28px;border:1px solid var(--vp-c-divider);border-radius:12px;background:var(--vp-c-bg-soft);display:flex;flex-direction:column}.benefits>a:hover{border-color:var(--vp-c-brand-1)}.number{font-size:9px;letter-spacing:.13em;color:var(--vp-c-brand-1)}h3{font-size:19px;letter-spacing:-.025em;font-weight:550;margin:23px 0 12px}.benefits p,.steps p{font-size:13px;color:var(--vp-c-text-2);line-height:1.8}.learn{font-size:11px;font-weight:600;margin-top:auto;padding-top:25px}
.control{display:grid;grid-template-columns:1.1fr 1fr;gap:65px;align-items:center;padding:20px 0 90px}.control-image{padding:22px;background:var(--vp-c-bg-soft);border:1px solid var(--vp-c-divider);border-radius:14px}.control-image img{width:100%;height:auto;border-radius:9px;border:1px solid #333}.control-image p{font-size:10px!important;margin:14px 0 0;text-align:center}.text-link{font-size:13px;font-weight:600;color:var(--vp-c-brand-1);display:inline-block;margin-top:16px}
.getting-started{padding:65px 0;border-block:1px solid var(--vp-c-divider)}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:45px;list-style:none;padding:0;margin:38px 0}.steps li>span{font-size:12px;color:var(--vp-c-brand-1);border-bottom:1px solid var(--vp-c-divider);display:block;padding-bottom:15px}.steps h3{margin-top:20px}.start-footer{display:flex;align-items:center;gap:30px;margin-top:35px}.start-footer p{font-size:11px;line-height:1.8;color:var(--vp-c-text-2)}.closing{text-align:center;padding:85px 0 90px}.closing img{margin:0 auto 20px;border-radius:10px}.closing>p:not(.eyebrow){color:var(--vp-c-text-2);font-size:14px;line-height:1.8}.closing .actions{justify-content:center}.closing .text-link{margin:0}a:focus-visible{outline:3px solid var(--vp-c-brand-1);outline-offset:4px}
@media(max-width:960px){.hero{gap:28px}.tools-strip>span:last-child{display:none}.benefits>a{padding:20px}.control{gap:30px}.preview-footer span{display:none}}
@media(max-width:700px){.product-home{padding:0 24px}.hero{grid-template-columns:1fr;padding:48px 0 35px;gap:10px}h1{font-size:48px}.hero-art{padding:20px 0}.tools-strip{flex-wrap:wrap;justify-content:center;gap:10px;text-align:center}.tools-strip>span:first-child{width:100%}.tools-strip p{font-size:18px}.possibilities{padding:55px 0}.benefits,.control,.steps{grid-template-columns:1fr}.benefits{gap:12px}.control{padding-bottom:55px}.control>div:last-child{grid-row:1}.steps{gap:25px}.start-footer{align-items:flex-start;flex-direction:column;gap:15px}.getting-started{padding:45px 0}.closing{padding:60px 0}.description{font-size:16px}}
</style>
