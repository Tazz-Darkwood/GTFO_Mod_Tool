# GTFO Datablock Studio — build log

Design decisions, validator suppressions and per-milestone notes. Keep this current when changing rule behaviour.

## M1 done (2026-09-13): schema build + CLI validator
- `npm run schema:build` compiles TypeList -> `packages/schema/dist/schema-bundle.json` (97 types, 114 nested classes, 101 enums) and a vanilla index (93 types; full blocks for 90 types, index-only for Text/LevelLayout/WardenObjective).
- `npm run validate -- "<rundown folder>"` runs all rules over a folder in ~1 s.
- Noise-reduction decisions that matter for anyone touching the rules:
  - Wrapper file replaces vanilla for that type; partial blocks add on top (TypeResolution.baseline).
  - Findings on values identical to the vanilla block with the same (type,id) are suppressed (vanilla itself has dangling refs, e.g. GearCategory -> Archetype 46/47/52).
  - Schema is augmented at build time with fields present in vanilla dumps but missing from the TypeList (13 fields, e.g. MarkerDataCommon.FunctionComponentLinks).
  - Event objects whose `Type` is not a vanilla enum member are plugin (AWO/EOS) events: no unknown-field or enum errors.
  - Flag enums (MaterialType, AnimatorControllerHandleName, DialogCharFilter) accept any integer. eLocalZoneIndex / eDimensionIndex are "open" enums (any int).
  - Unknown enum NUMBERS are warnings; unknown enum STRINGS are errors.
  - Disabled layers (SecondaryLayerEnabled/ThirdLayerEnabled false) and disabled expeditions are not validated (gates.ts).
  - Custom/PuzzleTypes.json (ExtraChainedPuzzleCustomization) contributes ChainedPuzzleType IDs (Scans + Clusters) as plugin blocks.
  - Gear.baseItemID and GearArchetypeData.archetypeID are NOT Item/Archetype references (vanilla values don't resolve).
- Additional real findings in the friend's rundown (beyond the audit above):
  - Rundown_DB.json expedition at ~line 1398: ScoutWaveSettings=8776 and ScoutWavePopulation=9013 are swapped (8776 is a population, 9013 is a settings block).
  - Text refs that don't exist: L1X1 Main Layout CustomSubObjectiveHeader 70003; L1X1 Main Objective Header 4567892.
  - "WardenIntel" placed inside GenericEnemyWaveData (wave entries) in several objectives/layouts: the game ignores it there.
  - 6 enum names with wrong letter case ("Directional_right", "apex", "directional_Forward") - may or may not load; tool offers a fix.

## M2 done (2026-09-13): edit engine + atomic save
- `EditSession` (core/edit) applies `set | setProperty | insert | remove` ops as minimal text edits: scalar sets replace exactly the value token (keeps `1.0` style, enum string-vs-int, trailing comments); inserts copy the neighbours' indentation; removes tidy the comma without touching comments. Own implementation; jsonc-parser is used only for parsing.
- Internal text is always LF without BOM; `writeAtomic` restores the file's EOL/BOM and writes via temp+rename.
- `saveFile` refuses to overwrite a file whose on-disk content changed since load (mtime+size, then content compare) unless forced; `reloadFromDisk` discards local edits.
- CLI: `npx tsx packages/cli/src/tool.ts set <folder> <file> <pointer> <value>` and `fix <folder> [--code ..] [--dry-run]`. In Git Bash use MSYS_NO_PATHCONV=1 or omit the pointer's leading slash.
- Verified on a scratch copy of the corpus: changing one zone's LightSettings produced a one-line diff; applying all quick fixes (B001, E002, W001) left every file parseable.

## M3 done (2026-09-13): Electron shell
- `packages/app` (electron-vite, React 19, zustand, CodeMirror 6). `npm run build -w packages/app` then `npx electron packages/app`; dev: `npm run dev -w packages/app`.
- Unattended-check hooks in main: `GTFO_OPEN=<folder>` auto-opens a project, `GTFO_NAV_CODE=R001` jumps to the first problem with that rule, `GTFO_SCREENSHOT=<png>` (+ `GTFO_SCREENSHOT_DELAY` ms) captures the window and quits. Used for visual verification without a mouse.
- Verified on the corpus: type tree with baseline badges (FILE = wrapper replaces vanilla, VANILLA = partial adds on top), block list with problem counts, problems panel with Fix buttons, source view scrolled to the offending token.
- Gotchas hit: electron-vite needs a `packages/app/tsconfig.json` with `"jsx": "react-jsx"` (else "React is not defined"); ambient `declare module '*.css'` must live in a file without imports; two vite versions in the tree make the electron.vite.config.ts typecheck noisy, so it is excluded from tsc.

## M4 done (2026-09-13): typed editor
- Renderer `editor/` renders a block from a schema closure (`schema:closure` IPC: root class + all reachable classes/enums). Field kinds: scalar (commit on blur/Enter), enum (select with member names; "raw" mode for unnamed ints; badge shows str/int representation which the engine preserves), ref (button showing "id name [project|vanilla]", searchable picker, go-to arrow, red when missing), LocalizedText (Text ID or literal, toggle), object/list (collapsible; list items summarised), Vector/Color (inline components + swatch), unknown fields (raw JSON textarea, kept as-is), "Add missing field" from the schema.
- Problem navigation opens the block, expands the containing list item/object, scrolls to and flashes the field, and shows the messages under it. Block-level problems fall back to the source view.
- Quick fixes, undo/redo (Ctrl+Z/Y), save (Ctrl+S) with conflict prompt, save all (Ctrl+Shift+S), revert are wired through the store to core via IPC. Unattended hook `GTFO_AUTO_FIX=<code>` applies the first fix of that rule for screenshots.
- `packages/app/test/projectHost.test.ts` exercises the main-process façade (list/search/detail/refs/closure/edit/undo/fix) against the corpus without Electron.

## M5 (2026-09-13): hardening + packaging
- electron-vite bundles everything (workspace packages, chokidar, fuzzysort) into out/main; the app has no runtime `dependencies`, so electron-builder ships no node_modules. `electron-builder.yml` copies `packages/schema/dist` into `resources/schema`; `schemaLocator.ts` finds it via `process.resourcesPath` when packaged.
- Close guard: closing the window with unsaved files asks Save all / Close without saving / Cancel. Window title shows "● <rundown>" when dirty.
- ErrorBoundary around the main pane so a rendering failure on one block never blanks the window.
- README.md (friend-facing: install, SmartScreen, what each rule means) and CLAUDE.md (dev orientation) added.
- Not done / follow-ups: keyboard navigation in lists, string GUID persistentIDs, editing plugin JSON (read-only), zone graph, app icon, code signing, Playwright smoke test, per-file incremental validation (full re-validate runs in ~150 ms so it was not needed).
- Packaging gotchas: electron-builder needs `electronVersion` pinned in electron-builder.yml (workspace install gives it a range); run it from the repo root (`npx electron-builder --win portable --config electron-builder.yml --projectDir packages/app`), never with a shell cwd inside `release/win-unpacked` (EBUSY); a transient EPERM while extracting NSIS into the electron-builder cache just needs a retry. Output: `packages/app/release/GTFO-Datablock-Studio-0.1.0-portable.exe` (~100 MB) and a zip of the unpacked app.

## v1.1 (2026-09-14): CRUD + editable source
Friend's feedback after v1: Form→Source switching was awkward, nothing could be added or deleted, and Custom/ plugin files "didn't load" (they were validated but had no UI). Built:
- core: `index/references.ts` (reverse reference index via schema walk, gates ignored; `pluginMentions` regex for ids ≥ 1000 in Custom/ files), `project/blockOps.ts` (`suggestPersistentId`: project max+1 → wrapper LastPersistentID+1 → vanilla max+1 ignoring hashed ids ≥ 1e6, skipping collisions; `eligibleTargetFiles`; `materializeBlock` blank/vanilla/project(raw text, comments kept)/clipboard; `createBlockOps`, `deleteBlockOps`), `project/fileOps.ts` (create/delete files, wrapper uniqueness), `schema/defaults.ts`, new EditOps `insertRaw`/`setRaw` with `reindentSnippet`, `EditSession.applyMany` (one undo step), `replaceText` (refuses unparseable text; coalesces undo by `undoGroup`), `locateBlock`.
- host/IPC: `file:setText`, `edit:applyMany`, `blocks:references|locate|create|delete`, `project:nextId|targetFiles`, `files:create|delete|references`; `FileDto.types/canHoldBlocks`, `TypeSummaryDto.hasFullVanilla`, `BlockDetailDto.tokenRanges`. `recentWrites` guards the watcher for file create/delete too. `ProjectHost({fs, watch:false})` for tests; `projectHost.write.test.ts` runs on a temp copy.
- renderer: `SourceEditor` (CodeMirror, editable; local parse → lint markers; commit 500 ms after typing / on blur / before any other action via `editorRegistry.flush()`; incoming text applied only when in sync; new undo group after every external replacement; Ctrl+Z inside the editor = CodeMirror history, toolbar Undo delegates to it in source mode). Files tab (`FilesView`) with folder tree incl. Custom/. Dialogs: NewBlock, DeleteBlock (lists referrers + plugin mentions), NewFile, DeleteFile. Block list: + New, hover Duplicate/Delete. Form: copy/paste on objects+lists, per-item duplicate/copy, paste sanity check (<50 % key match asks).
- Policy: an unparseable draft is never committed, so navigating away drops it (Save refuses with a toast). External change while a draft is pending keeps the draft; the save guard prompts on the next save.
- Vanilla full blocks are not shipped for Text/LevelLayout/WardenObjective, so "copy of vanilla" is disabled for those.
