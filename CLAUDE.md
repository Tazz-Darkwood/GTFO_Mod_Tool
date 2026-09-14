# CLAUDE.md

GTFO Datablock Studio: validator + typed editor for MTFO datablock JSON. npm workspaces monorepo, TypeScript, Electron.

## Commands

- `npm test` — vitest over all packages (corpus tests need `F:\GTFO Mod tool\Time - Copy\...\Time` or `GTFO_CORPUS`; they never write to it)
- `npm run typecheck` — core, schema, cli; app: `npm run typecheck -w packages/app`
- `npm run schema:build -- --no-fetch` — regenerate `packages/schema/dist` from the cached OriginalDataBlocks clone (omit `--no-fetch` to pull)
- `npm run validate -- "<folder>"` — CLI validator; `npx tsx packages/cli/src/tool.ts fix|set …`
- `npm run build -w packages/app && npx electron packages/app` — run the desktop app; `npm run dist -w packages/app` — portable exe
- Visual check without a mouse: `GTFO_OPEN=… GTFO_NAV_CODE=R001|file:<path> GTFO_AUTO_FIX=B001 GTFO_AUTO_EDIT="old=>new" GTFO_SCREENSHOT=x.png npx electron packages/app`

## Releasing

- CI (`.github/workflows/ci.yml`) typechecks, tests and builds on every push/PR.
- To publish: bump the version in every `packages/*/package.json` and the root (`npm version` does not cover workspaces; use sed), commit, then `git tag v<version> && git push --follow-tags`. `release.yml` builds the portable exe on Windows and attaches it to a GitHub release; it fails if the tag does not match `packages/app/package.json`.
- Icon: `python packages/app/build/make-icon.py` regenerates `build/icon.png` + `build/icon.ico` (stdlib only).

## Where things live

- `packages/core/src`: `text/` JSONC parsing + style; `project/` shapes, block extraction, loader; `index/` block index + baseline resolution; `schema/`; `validate/` rules (`ruleCodes.ts` is the list); `edit/` span-exact text edits + `EditSession`; `io/` fs abstraction, atomic write, save guard
- `packages/schema/build`: TypeList compiler; `overrides/*.json` are hand-curated corrections (reference targets, sound fields, open/flag enums)
- `packages/app/src`: `main/projectHost.ts` (façade + DTOs), `shared/ipc.ts` (typed contract), `renderer/src/store.ts` (zustand), `renderer/src/editor/` (form fields)

## Rules of the road

- `Time - Copy/` is the friend's real mod: test data, gitignored, read-only. Use a scratch copy for anything that writes.
- Text is LF/no-BOM internally; `writeAtomic` restores the file's style. Never regex-strip comments: use jsonc-parser.
- A wrapper file (`GameData_<T>DataBlock_bin.json`) replaces vanilla for that type; PartialData adds on top. Keep `TypeResolution.baseline` semantics intact when touching rules.
- Suppressions that keep the validator quiet on real data (vanilla-identical values, plugin events, gates, open enums) are documented in `docs/build-log.md`. Read it before changing rule behaviour.
- Do not commit unless asked.
