import { product } from '../../desktop/product.mjs';
import { defineConfig } from 'vitepress';
import { existsSync } from 'node:fs';
import { syncExamples } from '../scripts/sync-examples.mjs';

await syncExamples();

const base=process.env.DOCS_BASE || '/';
if(!base.startsWith('/')||!base.endsWith('/'))throw Error('DOCS_BASE must start and end with /.');
const site=process.env.DOCS_SITE_URL;
export default defineConfig({
  lang:'en-US', title:'Frok', description:'Your local image and video studio. Setup, tutorials and pipeline guides for Frok.',
  base, cleanUrls:false,
  head:[['link',{rel:'icon',type:'image/svg+xml',href:`${base}icon.svg`}],['meta',{name:'theme-color',content:'#267449'}]],
  ...(site?{sitemap:{hostname:site}}:{}),
  markdown:{config(md){
    const link=md.renderer.rules.link_open;
    md.renderer.rules.link_open=(tokens,index,options,env,self)=>{
      const token=tokens[index],href=token.attrGet('href');
      if(href&&/^\/examples\/[a-z-]+\/(?:(?:run|prepare|meta)\.(?:vpipeline|json)|(?:VPIPE-LICENSE|NOTICE)\.txt)$/.test(href)){
        if(!existsSync(new URL(`../public${href}`,import.meta.url)))throw Error(`Missing example download: ${href}`);
        token.attrSet('download','');
        token.attrSet('href',`${base}${href.slice(1)}`);
      }
      return link?link(tokens,index,options,env,self):self.renderToken(tokens,index,options);
    };
  }},
  themeConfig:{
    logo:{light:'/mark.svg',dark:'/mark-light.svg'}, siteTitle:'Frok',
    nav:[{text:'Download',link:product.releasesUrl},{text:'Documentation',link:'/documentation'},{text:'Get started',link:'/guide/getting-started'},{text:'GitHub',link:product.githubUrl}],
    sidebar:[
      {text:'Start here',items:[{text:'Documentation',link:'/documentation'},{text:'Welcome',link:'/about'},{text:'Quick setup',link:'/guide/getting-started'},{text:'Connections',link:'/guide/connections'},{text:'Install models',link:'/guide/model-setup'}]},
      {text:'Create',items:[{text:'Your first creation',link:'/tutorials/first-creation'},{text:'Images & variations',link:'/guide/images'},{text:'Videos & references',link:'/guide/videos'},{text:'Build a reusable recipe',link:'/tutorials/recipes'},{text:'Compare SD & HD',link:'/tutorials/upscaling'}]},
      {text:'Your studio',items:[{text:'Library & asset links',link:'/guide/library'},{text:'Queue & progress',link:'/guide/queue'},{text:'Storage & backups',link:'/storage'},{text:'Troubleshooting',link:'/guide/troubleshooting'}]},
      {text:'Legal',items:[{text:'Legal & responsible use',link:'/legal'},{text:'Software license',link:'/license'}]},
      {text:'Pipelines',items:[{text:'Folders & metadata',link:'/pipelines'},{text:'Krea / Vpipe example',link:'/examples/krea'},{text:'ComfyUI example',link:'/examples/comfyui'},{text:'MiniMax video examples',link:'/examples/minimax'},{text:'Import your workflow',link:'/tutorials/custom-pipeline'}]},
      {text:'Development',collapsed:true,items:[{text:'Contributing',link:'/development'},{text:'Desktop & packaging',link:'/desktop'},{text:'Release versions',link:'/releasing'},{text:'Build & host these docs',link:'/hosting'}]},
    ],
    search:{provider:'local'}, outline:{level:[2,3]},
    socialLinks:[{icon:'x',link:product.supportUrl}],
    footer:{message:`An open-source studio. Made for your machine. · <a href="${base}legal.html">Legal &amp; responsible use</a>`,copyright:`<a href="${base}license.html">License &amp; attribution</a>`},
    docFooter:{prev:'Previous guide',next:'Next guide'},
  },
});
