# Security

Frok is a local, single-user desktop studio. Its API binds to loopback; it is not designed to be a public or multi-tenant server. Keep the local-origin, request-validation, desktop-token and filesystem-boundary checks intact.

Pipeline files and their preparation steps are trusted executable configuration. Only install workflows from sources you trust, and review custom preparation commands before running them.

## Reporting a vulnerability

Please avoid posting exploit details, credentials or private library data in public issues. Use **Security → Report a vulnerability** on the GitHub repository when private reporting is enabled. If that option is unavailable, use the support link in the app or documentation navigation to arrange a private reporting channel before sending sensitive details.

Include the affected version, platform, reproduction steps and expected impact. Use synthetic inputs and redact local paths, tokens and prompts.

Security fixes target the latest published release; update before reporting a problem already fixed in a newer version.
