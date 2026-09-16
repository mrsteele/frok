<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design collaboration

For changes to visual design, user-facing wording, navigation or interaction flows, involve a design-focused agent before implementation. Have the designer review the affected journeys, recommend concrete improvements and review the result. Preserve the existing component library and validate keyboard behavior, small screens and synthetic error/loading states. Avoid running model inference or downloading models for design checks.
