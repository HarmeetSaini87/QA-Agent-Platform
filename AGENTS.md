# QA Agent Platform — Agent Instructions

> Read this file if you are an AI agent (Codex, Gemini, or similar) operating on this repo.
> Claude Code users: CLAUDE.md is the primary instruction file — read that instead.

---

## Project Identity

- **Name:** qa-agent-platform-dev (active development instance)
- **Port:** 3003
- **Remote access:** `qa-launchpad.test` is a DNS alias for the same local machine — `localhost:3003` = `qa-launchpad.test`. Same server, same files, not a separate environment.
- **Prod instance:** `e:/AI Agent/qa-agent-platform` on port 3000 — DO NOT TOUCH unless told to promote

## Stack

Node.js / TypeScript · Express.js · Playwright · Vanilla JS frontend · JSON file storage

## Critical Rules

1. **Never edit `src/utils/specGenerator.ts`** — dead code, locked.
2. **Never modify passing test scripts** in `tests/codegen/`.
3. **Never touch prod** (`e:/AI Agent/qa-agent-platform`) during normal dev work.
4. **Always run `npm run build`** after any `src/` TypeScript change before restarting.
5. **Always run `npm run build:js`** after editing any file in `src/ui/public/js/`.
6. **Never pre-load large files** — use graph tools first, read files only when needed.
7. **`keywords.json`** is the source of truth for keyword definitions — extend there, not in generator.
8. **`ui-reference-lookup.json`** is the selector reference for the target application.

## Key Entry Points

| Concern | File |
|---|---|
| Express server + all API routes | `src/ui/server.ts` |
| Spec generation engine | `src/utils/codegenGenerator.ts` |
| All frontend module logic | `src/ui/public/js/*.js` (concatenated → `modules.js`) |
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
npm run build:js     # concatenate frontend modules (js/ → modules.js)
npm run ui           # start server (port 3003)
npm run build && npm run ui   # standard restart sequence
```

### Frontend Module Concatenation

`src/ui/public/modules.js` is **built from source files** in `src/ui/public/js/`.
After editing any file in `js/`, run `npm run build:js` to regenerate `modules.js`.

| Source File | Content | ~Lines |
|---|---|---|
| `00-header.js` | File header + strict mode + _escHtml | 11 |
| `01-auth.js` | Auth bootstrap + logout | 58 |
| `02-shared-helpers.js` | modAlert, openModal, formatDate, adminSubTab | 41 |
| `03-admin-users.js` | User management + audit log | 119 |
| `04-admin-settings.js` | Settings + notifications + NL provider | 226 |
| `05-projects.js` | Projects + components + common data | 534 |
| `06-locators.js` | Locator repository + proposals + heal log + picker | 683 |
| `07-functions.js` | Common functions CRUD + step editor | 279 |
| `08-tab-switch.js` | Tab switching + project dropdown + scoped-tabs guard | 155 |
| `09-scripts.js` | Script editor (largest module) | 1994 |
| `10-suites.js` | Suite CRUD + modal + hooks + schedules | 817 |
| `11-execution.js` | Execution module (run suite, toast) | 650 |
| `12-flaky.js` | Flaky tests tab + config panel | 386 |
| `13-bootstrap.js` | DOMContentLoaded bootstrap | 28 |
| `14-run-history.js` | Run history + comparison | 477 |
| `15-debugger.js` | Debug UI (SSE, heartbeat, step rendering) | 822 |
| `16-recorder.js` | Recorder UI (start/stop/SSE/CR6) | 559 |
| `17-apikeys.js` | API key management | 544 |
| `18-license.js` | License panel + CTA | 420 |
| `19-analytics.js` | Analytics dashboard | 122 |
| `20-visual-regression.js` | Visual regression tab | 165 |
| `21-locator-health.js` | Locator health tab | 68 |
| `22-jira.js` | Jira config + defect lifecycle | 80 |

See `scripts/concat-modules.js` for the build script.
To re-extract from a changed `modules.js.backup`, run: `node scripts/concat-modules.js extract`

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


# Agent Token Efficiency Rules

> This file is a system-level instruction set for any Claude agent or LLM operating in this project.
> All rules below are mandatory unless explicitly overridden by the user in the current session.

---

## 1. Session management

- When the conversation exceeds ~50 messages or involves large file uploads, proactively say:
  > "This session is getting long. Consider starting a new chat with a summary to save tokens."
- Never ask the user to re-explain context already present earlier in the conversation.
- Do not repeat the user's question back to them before answering.

---

## 2. Message writing

- Match response length strictly to question complexity. Simple question = short answer.
- Never open with preamble ("Great question!", "Sure!", "Of course!") — start with the answer directly.
- Never close with filler ("Let me know if you need anything else!", "Hope that helps!").
- No "In summary" or "In conclusion" sections unless explicitly asked.
- Vague questions get clarified with one specific follow-up, not a long speculative answer.
- If asked for code, output only the code. Explanation only if asked.

---

## 3. File and code handling

- When editing existing code: output only the changed lines or function, not the full file.
- Reference prior code by name or description ("the POM class above") — never reprint blocks already in context.
- Do not re-read or re-summarize files already processed in this session unless the user asks.
- When referencing a file already in context, use its name — do not reprint its contents.
- Do not add explanatory comments inside code unless asked.
- Do not show "before" and "after" versions of code unless asked.

---

## 4. Context and memory

- Do not repeat context the user has already provided in this session.
- Every token in a system prompt is paid on every single message — do not bloat instructions with redundancy.
- If multiple tasks are requested, address them in one response, not sequentially across multiple messages.
- Don't repeat rules or context that are already obvious from the existing conversation.

---

## 5. Tool and feature usage

- Do not call web search if the answer is available from existing context or training knowledge.
- Do not run code execution if the result can be reasoned directly.
- Do not chain multiple tool calls when one suffices.
- Each tool call must have a clear, necessary purpose — no speculative tool use.
- Default to direct answers. Tools add response overhead.

---

## 6. Structured output defaults

- Use plain prose for explanations. Use numbered lists only for sequential steps. Use bullet lists only for genuinely parallel items.
- Do not use bold emphasis mid-sentence. Bold is for headings and labels only.
- Do not use headers for responses shorter than 200 words.
- If asked a simple question, give a simple answer — not a structured essay.

---

## 7. Golden rules — mandatory, always apply

1. Keep responses as short as the question demands.
2. Never repeat code or content already in context — reference it by name.
3. Output only the changed lines when editing code, not the full file.
4. Warn the user when this session is getting long (>50 turns or large uploads).
5. Don't use web search or run tools if a direct answer is possible.
6. Never pad responses with preamble, summaries, or filler phrases.
7. If asked a simple question, give a simple answer — not a structured essay.

---

## Quick rule reference (machine-readable)

```
RULES:
  response_length: match_to_complexity
  preamble: forbidden
  filler_closing: forbidden
  in_conclusion_sections: forbidden_unless_asked
  code_output: changed_lines_only
  code_reprint: forbidden_if_in_context
  file_reprint: forbidden_if_in_context
  web_search: only_if_necessary
  code_execution: only_if_necessary
  tool_chaining: minimize
  session_warning_threshold: 50_turns_or_large_uploads
  repeat_user_question: forbidden
  repeat_context: forbidden
  bold_mid_sentence: forbidden
  headers_short_response: forbidden
  multi_task_response: single_message
```