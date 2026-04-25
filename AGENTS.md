# QA Agent Platform — Agent Instructions

> Read this file if you are an AI agent (Codex, Gemini, or similar) operating on this repo.
> Claude Code users: CLAUDE.md is the primary instruction file — read that instead.

---

## Project Identity

- **Name:** qa-agent-platform-dev (active development instance)
- **Port:** 3003
- **Prod instance:** `e:/AI Agent/qa-agent-platform` on port 3000 — DO NOT TOUCH unless told to promote

## Stack

Node.js / TypeScript · Express.js · Playwright · Vanilla JS frontend · JSON file storage

## Critical Rules

1. **Never edit `src/utils/specGenerator.ts`** — dead code, locked.
2. **Never modify passing test scripts** in `tests/codegen/`.
3. **Never touch prod** (`e:/AI Agent/qa-agent-platform`) during normal dev work.
4. **Always run `npm run build`** after any `src/` TypeScript change before restarting.
5. **Never pre-load large files** — use graph tools first, read files only when needed.
6. **`keywords.json`** is the source of truth for keyword definitions — extend there, not in generator.
7. **`ui-reference-lookup.json`** is the selector reference for the target application.

## Key Entry Points

| Concern | File |
|---|---|
| Express server + all API routes | `src/ui/server.ts` |
| Spec generation engine | `src/utils/codegenGenerator.ts` |
| All frontend module logic | `src/ui/public/modules.js` |
| Bootstrap + tab switching | `src/ui/public/app.js` |
| Auth middleware | `src/auth/middleware.ts` |
| License feature gates | `src/utils/licenseManager.ts` |
| Self-healing engine | `src/utils/healingEngine.ts` |
| Recorder event parsing | `src/utils/recorderParser.ts` |
| TypeScript interfaces | `src/data/types.ts` |
| JSON read/write helpers | `src/data/store.ts` |

## Data Storage

All runtime data in `data/*.json` (git-ignored). Run results in `results/run-<uuid>.json`.

## Build & Run

```bash
npm run build        # compile TypeScript
npm run ui           # start server (port 3003)
npm run build && npm run ui   # standard restart sequence
```

## Graph Tools

This project has a code-review-graph knowledge graph at `.code-review-graph/graph.db`.
Use MCP graph tools (`semantic_search_nodes`, `get_architecture_overview`, `detect_changes`, etc.)
BEFORE using grep/glob/read to explore code. The graph is faster and gives structural context.

## Architecture (brief)

```
Browser UI → REST API → Express Server → data/*.json
                                      → codegenGenerator.ts → Playwright → results/
Auth: src/auth/ (middleware, audit, crypto)
Utils: codegenGenerator, healingEngine, licenseManager, recorderParser,
       pageModelManager, visualRegression, nlProvider, notifier, logger
```

## Known Architectural Issues (from graph analysis 2026-04-24)

- `auth` community calls directly into `store.ts` — tight coupling
- `utils-license` ↔ `tests-when`: 48 cross-community edges — refactor candidate
- `public-script` (545 nodes): monolithic frontend community, intentional
