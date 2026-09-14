# GTFO Datablock Studio

A desktop tool for people who build GTFO rundowns with MTFO. It opens your rundown folder, lists every datablock by type with its **name** instead of a bare number, finds the mistakes that silently break levels, and lets you edit values in typed forms. It saves your files back **exactly as you wrote them**, apart from the value you changed: comments, indentation and key order stay put, so it plays nicely with LiveEdit and with editing the same files in VS Code.

Free and open source. If it saves you time, you can [buy the developer a coffee on Ko-fi](https://ko-fi.com/tazzdarkwood).

## For rundown developers

1. Download `GTFO-Datablock-Studio-<version>-portable.exe` from the [releases page](https://github.com/Tazz-Darkwood/GTFO_Mod_Tool/releases) and run it. Windows SmartScreen will warn because the exe is not signed: click **More info → Run anyway**.
2. Click **Open rundown folder…** and pick the folder that contains your `GameData_*.json` files and `PartialData\`, for example
   `…\BepInEx\plugins\<You> - <Rundown>\<Rundown>` (in r2modman: _Settings → Browse profile folder_).
3. Left side: types and their blocks. Bottom: **Problems**. Click a problem to jump to the field.

### What the problems mean

| Code            | Meaning                                                                                                            | What to do                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **B001**        | A PartialData block has no `"datablock": "<Type>"` field, so MTFO skips it. Anything pointing at it is broken too. | Click **Fix**; the tool adds the type it can infer from the file.                                              |
| **D001**        | Two blocks of the same type share a persistentID. Only one loads.                                                  | Give one of them a new ID and update whatever referenced it.                                                   |
| **R001**        | A field points at an ID that no block has (project or vanilla).                                                    | Pick the right block with the picker. If the message says _swapped fields?_, the ID exists under another type. |
| **E001**        | Not a named value of that enum. Strings are errors; numbers are warnings because the game reads the raw int.       | Check the spelling, or leave a number you know the game accepts.                                               |
| **E002**        | Enum name is right except for letter case.                                                                         | Click **Fix**.                                                                                                 |
| **T001 / T002** | Wrong JSON type (e.g. `"5"` instead of `5`).                                                                       | Click **Fix** for quoted numbers.                                                                              |
| **T003**        | The game does not know this field on this type; it is ignored.                                                     | Usually a typo or a field on the wrong object (e.g. `WardenIntel` inside a wave entry).                        |
| **T004**        | Field name differs only by letter case.                                                                            | Cosmetic in most cases.                                                                                        |
| **D002**        | Your partial block replaces a vanilla block with the same ID.                                                      | Fine if intended.                                                                                              |
| **W001**        | A wrapper file's `LastPersistentID` is lower than its highest block ID.                                            | Click **Fix**.                                                                                                 |
| **P001**        | The file is not valid JSON.                                                                                        | Open it in a text editor; the location is in the message.                                                      |

Badges in the type list: **FILE** means a `GameData_<Type>DataBlock_bin.json` in your folder replaces the vanilla blocks of that type; **VANILLA** means the game's own blocks are the baseline and your PartialData blocks are added on top.

Keyboard: `Ctrl+S` save file, `Ctrl+Shift+S` save all, `Ctrl+Z` / `Ctrl+Y` undo / redo, `Ctrl+F` find in the source view.

### Rundown tab

The first tab shows your rundown the way the game sees it: tiers → expeditions → main / secondary / third layer → layout (with every zone), objective (with its alarms and waves) and dimensions. Problem counts roll up so a level with a broken reference shows a red badge all the way up to the tier. Click anything to open it; click a zone to land on that zone in the layout form. Hover a row for actions: **+** on a tier adds an expedition, **⧉** duplicates, **⇄** moves to another tier, **✕** deletes, the checkbox enables or disables. On any link (layout, objective, alarm, wave): **pick** an existing block, **new** creates one and links it in one step, **✕** unlinks. **+ zone** appends a zone; each zone row has **alarm**, **⧉** and **✕**. Everything here is undoable with Ctrl+Z until you save.

### Editing

- **Form** shows a block as typed fields. **Source** is a real editor for the whole file: type freely, problems update about half a second after you stop, and JSON syntax errors are underlined immediately. Broken JSON is never applied or saved; fix the underline first.
- **Files** tab (left): every file in the rundown, including plugin config under `Custom\` (EOS, AWO, LGTuner, …). Plugin files open in a generic form (every value editable by its JSON type, known keys such as `MainLevelLayout` shown as pickers) with a Source toggle. **+ file** creates a new PartialData list or a wrapper file.
- **Collapse all / Expand all** in the Source view fold every object and list so a long file can be scanned; Ctrl+F searches and opens folds at matches.
- **Update**: when a newer release exists on GitHub, an **⬆ Update to x.y.z** button appears top-right. It downloads the new portable exe next to the current one, starts it, and closes this one; delete the old exe afterwards.
- **+ New** (above the block list) creates a block: blank from the schema, a copy of a vanilla block, a copy of one of yours, or from clipboard JSON. It suggests the next free ID and warns if the ID clashes.
- **Duplicate** / **Delete** on a block (header buttons, or hover a row). Delete lists everything that references the block first. Deleting a block is undoable; deleting a file is not.
- **used by N** on the block header lists the blocks that point at this one.
- In forms: **copy** / **paste** on objects and lists, **⧉** duplicates a list item (comments included), **paste** on a list appends an object or an array of them.

IDs from `Custom\PuzzleTypes.json` are understood so references to custom scans resolve. String GUID persistentIDs (a PartialData feature) are not checked yet.

## For developers

Requirements: Node 20+, git.

```bash
npm install
npm run schema:build          # compiles the community TypeList into packages/schema/dist (needs network once)
npm test                      # unit tests; the corpus tests skip unless the sample rundown folder exists
npm run validate -- "<rundown folder>"      # CLI validator
npm run dev -w packages/app   # desktop app with hot reload
npm run build -w packages/app && npx electron packages/app
npm run dist -w packages/app  # portable exe into packages/app/release
```

Layout: `packages/core` (parse, index, validate, edit — no Electron), `packages/schema` (TypeList compiler + generated bundle + curated overrides), `packages/cli`, `packages/app` (electron-vite, React). Design notes and the validator's suppression rules are in `docs/build-log.md`.

The corpus tests look for a sample rundown at `../Time - Copy/BepInEx/plugins/Mathiast - Time/Time` next to the repo (or `GTFO_CORPUS`); they skip when it is absent and never write to it.

Releasing: bump the version in the `package.json` files, commit, then `git tag v<version> && git push --follow-tags`. The Release workflow builds the Windows portable exe and attaches it to a GitHub release.

Unattended checks: `GTFO_OPEN=<folder> GTFO_NAV_CODE=R001 GTFO_AUTO_FIX=B001 GTFO_AUTO_EDIT="old=>new" GTFO_SCREENSHOT=out.png npx electron packages/app` opens a project, applies a fix, jumps to a problem (or `GTFO_NAV_CODE=file:<path>` opens a file), types a replacement into the source editor and writes a screenshot.

Schema data comes from [UntiIted/OriginalDataBlocks](https://github.com/UntiIted/OriginalDataBlocks). Thanks to the GTFO modding community for MTFO, PartialData and the wiki.
