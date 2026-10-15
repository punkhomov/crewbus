# Implementation notes — 2026-10-15

These decisions preserve the approved implementation context before ignored task scratch files are removed. Read them in order: a superseding ruling replaces the earlier policy explicitly. The reason and cost of revisiting each decision are preserved verbatim below.

## Decision ledger

1. Ruling: preserve existing fuller message on repeated message.started with a newer cursor — spec requires replay-safe transcript and task prose supersedes illustrative unconditional upsert — cost if wrong: reducer correction.

2. Ruling: expose internal transaction-aware operations for append/save/finish while preserving public synchronous transactions — nested BEGIN examples are illustrative and SQLite forbids them — cost if wrong: repository adjustment.

3. Ruling: copy non-executable SDD helpers into ignored workspace and chmod copies — installed plugin scripts lack executable bits — cost if wrong: scratch artifact cleanup only.

4. Ruling: bootstrap pnpm12.6.0 from official pinned @pnpm/exe platform package instead of npm wrapper — verified wrapper has 14 optional external dependencies, contradicting plan dependency-free assumption; verified linux-x64 platform artifact has only executable, manifest and licenses with no deps/scripts — use independent SHA512/platform/age descriptors, allowlisted tar entries, no lifecycle execution, direct extraction/copy, executable version check, fail closed on unsupported platform/libc; cost if wrong: bootstrap portability rework.

5. Ruling: Task5 illustrative maxLength500 on untrimmed tool title must yield to spec trimmed-length validation — surrounding whitespace must not invalidate an otherwise valid 1–500 title; schemas should validate string shape and service applies trimmed business bound — cost if wrong: parameter-schema adjustment. Carry into Task5 dispatch and Task7 schema review.

6. Ruling: disable pnpm manager auto-loading via manage-package-manager-versions=false and enforce package-manager-strict-version=true — exact verified binary already bootstrapped; pnpm automatic wrapper dependency graph unnecessary — cost if wrong: alternate manually installed manager rejected until matching pinned version.

7. Superseding ruling: use supported pnpm12 workspace pmOnFail:error instead of removed managePackageManagerVersions/packageManagerStrictVersion — official docs and actual config probe reported old .npmrc policy keys ineffective since11; pmOnFail prevents automatic manager switching — cost if wrong: bootstrap/manager mismatch fails closed. Reviewer must verify current settings and frozen lock.

8. Ruling: Task3 accept stores run.systemPrompt snapshot and reserves user ordinal>=1; actual initial canonical system (ordinal0) is saved by Task6 from newly created Agent before prompt, not manufactured prompt-only inside accept — pi0.87.1 agent.ts82–86 includes toolsAdded in generated leading system; a preexisting prompt-only system suppresses generation and agent-loop.ts326–363 inserts a second tool-declaration system, violating exactly-one-system spec — cost if wrong: initialization/storage tests need adjustment. Existing saved system must be replayed exactly once without replacement. Carry into Tasks3/5/6.

9. Ruling: tool.completed must require an existing ToolView instead of illustrative combined tool upsert — task prose requires result updates by existing ID and missing prerequisite triggers fresh snapshot; spec forbids guessing missing state — cost if wrong: Task6/9 event production adjusted to introduce ToolView before completion. Carry into recovery.

10. Ruling: define ProviderView/ModelView public types in contracts during Task4, catalog may reexport them — Task8 typed frontend cannot depend on server module; shared DTO source preserves architecture — cost if wrong: move type definitions/reexports.

11. Ruling: add readonly RunManager.broker and app.runs typed decorator for Task7 SSE — plan requires SSE to consume broker but omits an access seam in manager interface; one manager owns broker and API uses it without duplicate ownership — cost if wrong: property/decorator rename and route callsite adjustment. Keep broker observer notifications isolated; browser backpressure remains separate bounded writer.

12. Ruling: Task8 may seed interrupted-tool state only in isolated test harness to verify renderer, alongside real streaming abort after committed tool — TodoPort synchronous operations make pausing mid-tool in browser artificial; seeded state tests presentation, real abort tests retention — cost if wrong: add delayed injectable tool seam/browser scenario. Production remains no faux/debug routes.

## Remaining limits and verification boundaries

- Live provider compatibility is untested: no real key was supplied. Automated tests use pi fauxProvider; no real external provider call is claimed.
- One local owner, one server process per SQLite database. API keys are stored in that database without encryption; protect data directories and backups. No public authentication or multi-user isolation is supplied.
- No automatic model/tool replay after failure. Recovery restores committed journal output and marks interrupted runs; an explicit next message is required.
- Chromium desktop and 390×844 mobile are exercised. Other browsers, Windows runtime and unpinned platforms are not verified. Browser harness deliberately uses one isolated worker and fixed ports.
- Markdown/Shiki/Mermaid generate large bundles (main JS about 1.6 MB / gzip 500 kB). The build warning remains visible; no arbitrary warning-limit suppression or blanket refactor was applied.
- Some repository validation/scope/conflict assertions are generic toThrow; stronger exact-code checks remain a testing improvement, not an observed runtime fault. They were not changed by packaging.
- A deterministic pending-auth admission-versus-close regression and additional subscribe/replay/listener-cleanup seam tests remain useful follow-ups. Existing manager/SSE/integration coverage passes; packaging does not rewrite those lifecycle modules.
- HTTP/SSE schema and lifecycle code is compressed in places. A focused readability cleanup can be reviewed separately without broad changes in packaging.
- Task4 coverage was expanded after implementation; its report distinguishes timing rather than claiming every added assertion was initial TDD.
- Registry source licenses and hashes remain versioned; test screenshots/logs and task reports are ignored scratch artifacts. CI is defined locally; hosted GitHub Actions execution is not claimed.

See [context index](../README.md) and [runtime instructions](../../README.md).
