# Task 2 implementation report

## Implemented

- Added public DTOs, event unions, and API input interfaces in `packages/contracts/src/domain.ts` and `events.ts`, exported from the contracts entry point.
- Implemented the pure, replay-safe `reduceChat` in contracts and made the browser reducer module re-export it.
- Added reducer coverage for duplicate/stale delivery, alien chat/run events, preserving an existing fuller message on repeated start, authoritative completion replacement, independent tool calls and result replacement, todos replacement, and terminal interruption while preserving completed results.
- Contracts contain no pi or runtime AI SDK imports.

## TDD evidence

- RED: `pnpm build:packages && pnpm test -- apps/web/test/chat-reducer.test.ts` failed with `Cannot find module '../src/chat/reducer.js' imported from .../chat-reducer.test.ts` (one failed suite, zero tests run). This was the expected missing implementation entry point.
- GREEN: `pnpm test -- apps/web/test/chat-reducer.test.ts` passed: 2 test files, 7 tests.

## Final verification

- `pnpm typecheck` passed for web, server, contracts, and agent.
- `pnpm test` passed: 2 test files, 7 tests.
- `git diff --check` passed.

## Files changed

- `packages/contracts/src/index.ts`
- `packages/contracts/src/domain.ts`
- `packages/contracts/src/events.ts`
- `packages/contracts/src/reducer.ts`
- `apps/web/src/chat/reducer.ts`
- `apps/web/test/chat-reducer.test.ts`

## Self-review and concerns

- Reducer returns the same snapshot for stale/duplicate events and mismatched chat/run IDs; valid events clone before applying changes.
- Repeated starts retain an existing message when it has at least as much text and tool data, while completion replaces the whole message view.
- Missing prerequisite messages for delta/tool events throw, allowing the caller to recover from a fresh snapshot as specified.
- No unresolved concerns.

## Fix round 1 (base `1b3a892`)

- Added regression coverage for a repeated start whose incoming view has shorter text but more tools, and for `tool.completed` arriving without a matching `tool.started` entry.
- RED: `pnpm test -- apps/web/test/chat-reducer.test.ts` failed exactly those two cases: expected existing streamed text `streamed answer` but received `x`; expected missing tool completion to throw but it did not. The remaining 7 tests passed.
- GREEN: `pnpm test -- apps/web/test/chat-reducer.test.ts` passed: 2 test files, 9 tests.
- Typecheck: `pnpm typecheck` passed for web, server, contracts, and agent.
- Changed repeated `message.started` to retain any existing view for that message ID. Split tool event handling so `tool.started` may insert/update, while `tool.completed` requires an existing tool ID and throws `Missing tool <id> for completion` otherwise.
- Self-review: successful tool completion still replaces the existing result, independent tool IDs remain covered, and terminal handling still retains completed messages/tools. No unresolved concerns.
