#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Frok Envision needs Node.js 24 or later. Install it from https://nodejs.org, then open this file again.'
  read -r -p 'Press Enter to close.'
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<24){console.error("Install Node.js 24+ from https://nodejs.org");process.exit(1)}'
if [ ! -f .env.local ]; then cp .env.example .env.local; fi
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
export NEXT_TELEMETRY_DISABLED=1
npm run build
printf '\nOpen http://127.0.0.1:3000 in your browser. Stop with Ctrl+C.\n\n'
npm start
