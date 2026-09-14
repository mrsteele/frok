import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssetVideoControls } from '../src/components/assets/asset-video-controls';
import type { Media,Generation } from '../src/lib/types';

const image:Media={id:'image',kind:'image',origin:'generated',filename:'image.jpg',prompt:'A paper boat',enhancedPrompt:'A blue paper boat',seed:7,width:640,height:480,favorite:false,createdAt:'2026-01-01'};
const generation:Generation={mode:'video',prompt:'Sail slowly',aspect:'4:3',duration:6,quality:'preview',count:1,referenceIds:[],enhance:false};
const video:Media={...image,id:'video',kind:'video',prompt:generation.prompt,generation};
const noop=()=>{};
function render(root:Media,selected:Media){return renderToStaticMarkup(createElement(AssetVideoControls,{root,selected,prompt:'Edited motion',onPromptChange:noop,onGenerate:noop,onRedo:noop,onUpscale:noop,disabled:false,busy:false,upscaleDisabled:false,upscalerName:'Real-ESRGAN'}));}

test('the same action row gracefully exposes the five requested asset feature sets',()=>{
  const uploaded={...image,origin:'upload' as const,prompt:'',enhancedPrompt:''};
  const reference={...video,generation:{...generation,mode:'reference' as const,referenceIds:['ref']}};
  for(const [root,selected,expected] of [
    [uploaded,uploaded,{generate:true,redo:false,upscale:false,readonly:false,imagePrompt:false}],
    [image,image,{generate:true,redo:false,upscale:false,readonly:false,imagePrompt:true}],
    [image,video,{generate:true,redo:true,upscale:true,readonly:false,imagePrompt:false}],
    [reference,reference,{generate:true,redo:true,upscale:true,readonly:false,imagePrompt:false}],
    [video,video,{generate:false,redo:true,upscale:true,readonly:true,imagePrompt:false}],
  ] as const){
    const html=render(root,selected);
    assert.equal(html.includes('>Generate video</button>'),expected.generate);
    assert.equal(html.includes('Redo <small>New seed</small>'),expected.redo);
    assert.equal(html.includes('>Upscale</button>'),expected.upscale);
    assert.equal(html.includes('readOnly=""'),expected.readonly);
    assert.equal(html.includes('Image prompt'),expected.imagePrompt);
    assert.ok(html.includes('aria-label="Video actions"'));assert.ok(html.includes('>Video prompt</label>'));
  }
});

test('HD selections omit Upscale while retaining the same prompt and redo controls',()=>{
  for(const root of [image,video,{...video,generation:{...generation,mode:'reference' as const}}]){
    const html=render(root,{...video,width:960,height:720});
    assert.equal(html.includes('>Upscale</button>'),false);assert.ok(html.includes('Redo <small>New seed</small>'));
  }
});
