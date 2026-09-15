import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.FROK_BUILD_DIR || ".next",
  output: process.env.FROK_DESKTOP_BUILD === '1' ? 'standalone' : undefined,
  serverExternalPackages: ['sharp'],
  poweredByHeader: false,
  redirects() {
    return ['/history', '/history/images', '/history/videos'].map(source => ({source, destination:'/', permanent:true}));
  },
  async rewrites() {
    return [{source:'/docs',destination:'/docs/index.html'}];
  },
  outputFileTracingExcludes: {'/*':['./docs/**/*','./.data/**/*','./.desktop/**/*','./release/**/*','./resources/pipelines/**/*','./.env','./.env.*','**/*.sqlite','**/*.sqlite-*','**/*.safetensors','**/*.gguf']},
  async headers() {
    return [{source:'/:path*',headers:[
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'Referrer-Policy',value:'no-referrer'},
      {key:'Cross-Origin-Resource-Policy',value:'same-origin'},
      {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
      {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"},
    ]}, {source:'/docs/welcome-demo.html',headers:[
      {key:'X-Frame-Options',value:'SAMEORIGIN'},
      {key:'Content-Security-Policy',value:"frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'"},
    ]}];
  },
};
export default config;
