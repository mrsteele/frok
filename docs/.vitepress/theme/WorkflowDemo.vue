<script setup>
import { withBase } from 'vitepress'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const imagePrompt = 'A red sailboat on a quiet alpine lake. Warm sunrise light, gentle reflections.'
const motionPrompt = 'The sailboat drifts slowly to the right. Gentle ripples, a steady camera.'
const scenes = [
  {name:'Write an image prompt',duration:5000,target:'prompt',click:true},
  {name:'Generate image',duration:1100,target:'generate',click:true},
  {name:'Rendering image',duration:4200,target:'rest'},
  {name:'Image ready',duration:2200,target:'rest'},
  {name:'Animate this image',duration:1300,target:'animate',click:true},
  {name:'Describe the motion',duration:4500,target:'prompt',click:true},
  {name:'Render video',duration:1100,target:'generate',click:true},
  {name:'Rendering video',duration:4400,target:'rest'},
  {name:'Your idea, in motion',duration:6500,target:'rest'},
]
const step=ref(0),elapsed=ref(0),reduced=ref(false),visible=ref(false),pageVisible=ref(true)
const root=ref(),interaction=ref(),promptTarget=ref(),generateTarget=ref(),animateTarget=ref(),clip=ref()
const pointer=ref({x:0,y:0}),videoFailed=ref(false)
const current=computed(()=>scenes[step.value])
const videoMode=computed(()=>step.value>=5)
const rendering=computed(()=>step.value===2||step.value===7)
const typing=computed(()=>step.value===0||step.value===5)
const progress=computed(()=>Math.min(99,Math.floor(elapsed.value/current.value.duration*100)))
const prompt=computed(()=>{
  const value=videoMode.value?motionPrompt:imagePrompt
  if(!typing.value)return value
  return value.slice(0,Math.floor(Math.max(0,elapsed.value-700)/(current.value.duration-1100)*value.length))
})
const active=computed(()=>visible.value&&pageVisible.value&&!reduced.value)
const playing=computed(()=>active.value&&step.value===8&&!videoFailed.value)
let timer,observer,resizeObserver,media,lastTick
function positionPointer(){
  const area=interaction.value?.getBoundingClientRect();if(!area)return
  // The welcome embed scales this demo; pointer coordinates stay in local pixels.
  const scaleX=interaction.value.offsetWidth/area.width,scaleY=interaction.value.offsetHeight/area.height
  const target={prompt:promptTarget.value,generate:generateTarget.value,animate:animateTarget.value}[current.value.target]
  const rect=target?.getBoundingClientRect()
  pointer.value=rect?{x:(rect.left-area.left)*scaleX+(current.value.target==='prompt'?22:rect.width*scaleX*.65),y:(rect.top-area.top)*scaleY+(current.value.target==='prompt'?10:rect.height*scaleY*.5)}:{x:interaction.value.offsetWidth*.93,y:interaction.value.offsetHeight*.62}
}
function syncPlayback(){
  if(!clip.value)return
  if(playing.value)void clip.value.play().catch(error=>{if(error.name!=='AbortError'&&playing.value)videoFailed.value=true})
  else clip.value.pause()
}
function preference(){
  reduced.value=media.matches;step.value=media.matches?3:0;elapsed.value=0
}
function visibility(){pageVisible.value=!document.hidden;lastTick=performance.now()}
watch(step,async()=>{
  await nextTick();positionPointer()
  if(clip.value&&step.value!==8)clip.value.currentTime=0
  syncPlayback()
})
watch(playing,syncPlayback)
onMounted(()=>{
  pageVisible.value=!document.hidden
  media=window.matchMedia('(prefers-reduced-motion: reduce)');preference();media.addEventListener('change',preference)
  document.addEventListener('visibilitychange',visibility)
  observer=new IntersectionObserver(([entry])=>{visible.value=entry.isIntersecting},{threshold:.1});observer.observe(root.value)
  resizeObserver=new ResizeObserver(positionPointer);resizeObserver.observe(interaction.value)
  positionPointer();lastTick=performance.now()
  timer=setInterval(()=>{
    const now=performance.now(),delta=Math.min(150,now-lastTick);lastTick=now
    if(!active.value)return
    elapsed.value+=delta
    if(elapsed.value>=current.value.duration){step.value=(step.value+1)%scenes.length;elapsed.value=0}
  },50)
})
onUnmounted(()=>{clearInterval(timer);observer?.disconnect();resizeObserver?.disconnect();media?.removeEventListener('change',preference);document.removeEventListener('visibilitychange',visibility)})
</script>

<template>
  <div ref="root" class="workflow-demo" role="img" aria-label="Automatic Frok walkthrough: a user types a sailboat prompt, generates an image, describes its motion, and renders a short video. Actual generated media; demonstration timing is condensed." :class="{inactive:!active}" :data-stage="step">
    <div aria-hidden="true">
      <div class="demo-top"><span>{{ videoMode?'VIDEO':'IMAGE' }} <span class="mode-detail">{{ videoMode?'· 6s / 480p':'· 1 image / Preview' }}</span></span><span class="local-status"><i/> On your device</span></div>
      <div ref="interaction" class="interaction-area">
        <div class="canvas">
          <img v-if="step>=2" class="result-image" :src="withBase('/demo/sailboat.webp')" alt="" width="512" height="384" draggable="false" :style="step===2?{filter:`blur(${(1-progress/100)*16}px)`,opacity:.25+progress/133}:{}"/>
          <video ref="clip" class="result-video" :class="{show:step===8&&!reduced&&!videoFailed}" :src="visible&&!reduced?withBase('/demo/sailboat.mp4'):undefined" :poster="withBase('/demo/sailboat.webp')" muted playsinline preload="none" disablepictureinpicture disableremoteplayback tabindex="-1" @canplay="syncPlayback" @error="videoFailed=true"/>
          <div v-if="step<2" class="empty-scene"><span>✦</span><strong>Envision anything.</strong><p>Your next creation starts here.</p></div>
          <div v-if="rendering" class="render-status"><span>{{ step===2?'Rendering image':'Rendering video' }}</span><span>{{ progress }}%</span><div class="progress"><i :style="{width:progress+'%'}"/></div></div>
          <span v-if="step===3||step===4" ref="animateTarget" class="animate-action" :class="{pressed:step===4&&elapsed>750}">Animate image <span>▷</span></span>
          <span v-if="step===8" class="result-tag">Video ready <span>✓</span></span>
          <div v-if="step===8" class="playback-track"><i :style="{width:Math.min(100,elapsed/6000*100)+'%'}"/></div>
        </div>
        <div class="prompt" :class="{focused:typing}">
          <p ref="promptTarget"><span>{{ prompt }}</span><i v-if="typing" class="typing-caret"/><span v-if="typing&&!prompt" class="placeholder">{{ videoMode?'Describe what happens next…':'Type to envision…' }}</span></p>
          <div class="prompt-footer"><span>{{ videoMode?'Custom motion':'Image · 4:3' }}</span><span ref="generateTarget" class="render-button" :class="{pressed:current.click&&elapsed>750&&current.target==='generate'}">{{ videoMode?'Render video ▷':'Generate image ↑' }}</span></div>
        </div>
        <div v-if="!reduced" class="demo-pointer" :style="{transform:`translate(${pointer.x}px,${pointer.y}px)`,opacity:current.target==='rest'?.25:1}"><img :src="withBase('/demo/cursor.svg')" width="22" height="28" alt="" draggable="false"/><i v-if="current.click" :key="step" class="click-ring"/></div>
      </div>
      <div class="demo-bottom"><span>Actual Frok outputs · demo timing condensed</span><div><i v-for="n in 3" :key="n" :class="{active:n===(step<3?1:step<7?2:3)}"/></div></div>
    </div>
  </div>
</template>

<style scoped>
.workflow-demo,.workflow-demo *{pointer-events:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-user-drag:none}
.workflow-demo{padding:0 16px 12px;color:#eee}.demo-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:13px 0;font-size:9px;letter-spacing:.06em;color:#ccc}.mode-detail{color:#929b94}.local-status{display:flex;align-items:center;gap:5px;color:#b8c8bb;font-size:8px;letter-spacing:0}.local-status i{width:4px;height:4px;background:#9dcca8;border-radius:50%}.interaction-area{position:relative}.canvas{position:relative;aspect-ratio:16/10;overflow:hidden;border-radius:9px;background:radial-gradient(ellipse at center,#17221b,#101310);border:1px solid #2d3830}.result-image,.result-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}.result-video{opacity:0;transition:opacity .25s}.result-video.show{opacity:1}.empty-scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column}.empty-scene>span{font-size:25px;color:#98bba2;margin-bottom:8px}.empty-scene strong{font-size:clamp(18px,2vw,27px);letter-spacing:-.04em}.empty-scene p{font-size:10px;color:#8c998f;margin-top:7px}.render-status{position:absolute;bottom:12px;left:12px;right:12px;background:#0b120ded;border:1px solid #ffffff1a;padding:10px 12px;border-radius:7px;font-size:10px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}.progress{height:3px;width:100%;background:#3a483e;border-radius:3px;overflow:hidden}.progress i{display:block;height:100%;background:#a5cfad}.animate-action,.result-tag{position:absolute;bottom:12px;right:12px;padding:7px 10px;border-radius:20px;background:#edf1eb;color:#19261d;font-size:10px;box-shadow:0 2px 12px #0003}.animate-action span,.result-tag span{margin-left:6px}.result-tag{background:#0b120ddd;color:#d9edde;font-size:9px}.playback-track{position:absolute;bottom:0;height:3px;left:0;right:0;background:#0004}.playback-track i{height:100%;display:block;background:#c1e0c6}.prompt{margin-top:12px;border:1px solid #303630;border-radius:9px;background:#141614;padding:12px;transition:border-color .25s,box-shadow .25s}.prompt.focused{border-color:#758c7b;box-shadow:0 0 0 2px #9bcca712}.prompt p{font-size:11px;line-height:1.65;height:55px;margin:0;position:relative}.placeholder{color:#7b877d}.typing-caret{display:inline-block;width:1px;height:12px;margin-left:1px;background:#d4e7d8;vertical-align:-2px;animation:blink .8s steps(1) infinite}.prompt-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;font-size:9px;color:#a3afa6}.render-button{border-radius:20px;background:#e6e8e5;padding:7px 10px;color:#1a211b;white-space:nowrap}.pressed{background:#a2bba6;transform:scale(.96)}.demo-bottom{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:8px;color:#929d95;margin-top:12px}.demo-bottom>div{display:flex;gap:5px}.demo-bottom i{width:4px;height:4px;border-radius:50%;background:#465148}.demo-bottom i.active{background:#b7dcbf}.demo-pointer{position:absolute;left:0;top:0;z-index:5;width:22px;height:28px;transition:transform .65s cubic-bezier(.25,.75,.25,1),opacity .35s;filter:drop-shadow(0 2px 3px #0008)}.demo-pointer img{display:block}.click-ring{position:absolute;left:-8px;top:-8px;width:18px;height:18px;border:2px solid #e7f6dd;border-radius:50%;opacity:0;animation:click .45s .7s ease-out}.inactive .typing-caret,.inactive .click-ring{animation-play-state:paused}@keyframes blink{50%{opacity:0}}@keyframes click{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(2)}}@media(prefers-reduced-motion:reduce){.demo-pointer,.typing-caret{display:none}.prompt{transition:none}}@media(max-width:380px){.workflow-demo{padding-inline:12px}.demo-top{font-size:8px}.mode-detail{display:none}.prompt{padding:10px}.prompt p{font-size:10px;height:66px}.prompt-footer{font-size:8px;gap:4px}.render-button{padding:6px 8px}.demo-bottom{font-size:7px}}
</style>
