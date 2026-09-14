## GTFO Datablock Studio

Download **GTFO-Datablock-Studio-<version>-portable.exe** below and run it. No installer. Windows SmartScreen will warn because the exe is not signed: click **More info → Run anyway**. Then **Open rundown folder…** and pick the folder with your `GameData_*.json` files and `PartialData\`.

### New in this release

- **Plugin config gets a form.** Files under `Custom\` (EOS, AWO, LGTuner, …) open in a generic form: every value editable by its JSON type, add/remove fields and list items, and known keys like `MainLevelLayout` shown as datablock pickers. Source view is one click away.
- **Collapse all / Expand all** in the Source view, so long files can be scanned and searched (Ctrl+F opens folds at matches).
- **Update button.** From this version on, when a newer release exists an **⬆ Update** button appears top-right. It downloads the new exe next to this one, starts it and closes this window; delete the old exe afterwards.

### From 0.3.0

- **Rundown tab**: your rundown as tiers → expeditions → layouts, objectives, zones, with problem counts rolled up per level. Click a zone to land on it in the form.
- **Build levels from the tree**: add / duplicate / move / delete expeditions, enable or disable layers, add / duplicate / delete zones, and on every link (layout, objective, alarm, wave) **pick** an existing block, **new** to create and link in one step, or unlink.

### From 0.2.0

- Editable **Source** view with live validation; JSON syntax errors are underlined and never saved.
- **Files** tab lists every file, including plugin config under `Custom\`.
- New / Duplicate / Delete for blocks and files; "used by" references; clipboard copy/paste in forms.

Nothing is written until you press **Save** (Ctrl+S) or **Save all**. Block edits are undoable with Ctrl+Z until you save; creating or deleting a *file* is immediate.

Feedback that helps most: a problem the tool reports that you think is wrong, a real problem it missed, or a file it changed in a way you did not expect. If it saves you time: https://ko-fi.com/tazzdarkwood
