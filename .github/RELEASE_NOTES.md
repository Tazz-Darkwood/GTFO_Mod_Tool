## GTFO Datablock Studio

Download **GTFO-Datablock-Studio-<version>-portable.exe** below and run it. No installer. Windows SmartScreen will warn because the exe is not signed: click **More info → Run anyway**. Then **Open rundown folder…** and pick the folder with your `GameData_*.json` files and `PartialData\`.

### New in this release

- **Tiles view.** A LevelLayout has a fourth view, **Tiles**: the level as a top-down grid (east right, north up, (0,0) the start). The ground layer is the level as the game actually built it the last time you loaded it, read from LGTuner's per-tile lines in `BepInEx\LogOutput.log` and matched to your expedition. On top: the layout's LGTuner tile overrides. Click a cell to add, edit or remove its override, with pickers for geomorph and plug prefabs (the game's own plus paths already used in your mod); zone overrides are edited below; **+ LGTuner file** creates one. Undoable until you save; comments survive.
- **LGTuner checks.** Five new rules on `Custom\LGTuner` files: a tile overridden twice (LGTuner drops one), a `LevelLayoutID` that is no layout, a zone override for a zone the layout lacks, two files for one layout, and misspelt options (with a Fix). `Rotation` and `Direction` get dropdowns in the plugin form.
- **Credits.** Thanks to LGTuner by hirnukuono (based on Flowaria's LGTuner) for the format and the log line that make the Tiles view possible; the README has a full Thanks section.

### From 0.4.0

- **Zone graph.** A LevelLayout now has a **Graph** view beside Form and Source: every zone is a box hanging off the zone it builds from, in its StartExpansion direction, sized by coverage, with alias, subcomplex, alarm, enemy groups, events and problem badges. Missing parents and build loops are drawn dashed red. Click a zone to edit it in the panel on the right (the full form for that zone), **+ zone from here** with a direction picker, duplicate, delete (with the list of zones that depend on it), pick the alarm. **Drag a zone onto another** to change what it builds from; drop it on empty space to change its direction. Wheel zooms, drag pans. Layouts opened from the Rundown tab start in Graph mode. It is a schematic of the build order, not the generated map.
- **Back / Forward.** ◀ ▶ at the left of the header, Alt+←/→ or the mouse back button return you to where you were before a click moved you, including which zone or field was focused.
- **Collapse all / Expand all work.** They folded only the root before; now every object and list folds, with the top-level keys left visible.
- New zones get `AliasOverride: -1` (the game's default) instead of 0, so they no longer show up as "Z0".

### From 0.3.2

- **Trailing commas are caught.** A comma before a closing `]` or `}` is legal JSONC, so the tool used to accept it silently, but the game's JSON reader throws `The JSON object contains a trailing comma` and skips the whole block. They are now a red **P003** problem with a one-click **Fix**, the Source view underlines them as you type, and no edit made through a form or the Rundown tab can leave one behind.
- **Plugin forms are fully editable.** Under `Custom\`: double-click a key to rename it, type a reference id directly beside the picker, remove any field or list item.

### From 0.3.1

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
