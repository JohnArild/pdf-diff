# PDF Diff: handover

This is the single entry point for resuming work on this project without any earlier conversation context.
It documents the state as of **2026-10-18** (Europe/Oslo). The app is considered **MVP-ready for field testing**.

Contents:
1. [Goal and user](#1-goal-and-user)
2. [Status against the milestones](#2-status-against-the-milestones-planmd-9)
3. [History: decisions, feedback, commits](#3-history-decisions-user-feedback-commits)
4. [Architecture of `app/src`](#4-architecture-of-appsrc)
5. [How to run](#5-how-to-run)
6. [Test corpus](#6-test-corpus)
7. [The Python prototype](#7-the-python-prototype)
8. [Known limits and risks](#8-known-limits-and-risks)
9. [Backlog (prioritised)](#9-backlog-prioritised)
10. [Field testing: deployment and bug reports](#10-field-testing-deployment-and-bug-reports)
11. [Working conventions for the bot](#11-working-conventions-for-the-bot)
12. [Production deployment (pdfdiff.lb1oi.com)](#12-production-deployment-pdfdifflb1oicom)

Other documents: [`PLAN.md`](../PLAN.md) (the original technical plan, milestone table in §9 now carries status markers),
[`README.md`](../README.md) (short overview and commands), [`prototype/tests/RESULTS.md`](../prototype/tests/RESULTS.md)
(prototype synthetic results), [`app/e2e/fixtures/README.md`](../app/e2e/fixtures/README.md) (synthetic fixtures).

---

## 1. Goal and user

**Goal:** a web app that takes two revisions of the same PDF (Rev A = old, Rev B = new) and shows what changed, for
both **text** and **vector graphics**, aimed at technical drawings (multi-sheet drawing sets with title blocks, border
zone grids, BOMs and revision-history tables). All processing runs **in the browser**; no server, no upload.

**User:**
- GitHub account **JohnArild**; repository **`JohnArild/pdf-diff`** (private).
- Lives in **Europe/Oslo** (UTC+1 / UTC+2 in summer). Report times in that zone.
- Runs the app **locally in a Fedora distrobox** (see §5.2).
- GitHub access: prefers a **personal access token** over OAuth. On the bot's box the token is in the
  `GH_TOKEN` environment variable and used through the `gh` CLI. It is never written into git config or a remote URL.
- Prefers **plain-text reports** (the `.txt` export, fixed columns, ≤ 80 characters per line).
- Cares about **grid references** in the list, in the style `Sheet 1  D3  Removed  Line`: sheet number from the
  title block, then the border-zone cell, then the operation and a short description.
- Licence constraint: **no AGPL dependencies in the app** (this is why the prototype's PyMuPDF is not used in the app).
- Test drawings are mostly from the public **OpenHornet** project (CC BY-NC-SA 4.0). They must **not** be committed.

## 2. Status against the milestones (PLAN.md §9)

| Phase | Status |
|---|---|
| 0. Spike (Python prototype) | ✅ done (`cc99b63`, `282669e`) |
| 1. MVP | ✅ done (`3e0edca`, extended in `d963f29`, `cf6bf05`) |
| 2. True vector diff | 🟡 partly done (details below) |
| 3. Documents at scale | ⬜ not started (a few pieces exist: workers, inserted/deleted pages listed) |
| 4. Polish & pro | ⬜ not started |

**Phase 1 (MVP), all done:** upload of two PDFs (drag-drop or picker, swap), page pairing by title-block sheet number
then page order, title-block sheet/drawing/rev extraction, folding of repeated changes, word + character text diff,
raster pixel diff for graphics, side-by-side view with synced zoom/pan and click-to-jump, change list with
All/Text/Graphics filter, red/green/amber colours, plain-text export (copy and `.txt` download).

**Phase 2, done in the app:**
- Vector layer from PDF.js operator lists (`constructPath` with CTM, form XObjects, fill/stroke colour, line width).
- Shape pairing into **moved** (with coherence rules), **resized** (incl. groups such as a table outline growing) and
  **style-modified** (fill, stroke colour, **line width**: a width-only change on an otherwise identical shape is
  reported, e.g. `Line (..) width 0.36 -> 0.72 pt`).
- Every vector change must be confirmed by differing pixels.
- Global page-offset alignment (estimated from unique words, verified on pixels).
- Large coherent moves (a whole view shifted) with a re-diff inside the moved area.
- **Border-grid detection** (either label direction, ISO and ASME), grid refs in the sidebar and the `.txt` export,
  grid coverage line in the report header.
- Moved/resized highlights in violet with ghost box and arrow on Rev B.

**Phase 2, missing in the app:**
- **Sampled-geometry matching**: the app's vector layer matches shapes by **bounding box + style + a signature of
  the first 32 points**, not by sampling outlines with a tolerance (KD-tree) as the prototype does. Re-tessellated
  paths therefore cancel only through the pixel check, not geometrically.
- **Rotation** detection (prototype has it, app does not).
- **Dash-pattern** changes: dash is not read from the operator list (`setDash` is ignored), so a dash-only change is
  found only if the pixels differ, as an anonymous graphics region.
- **Clip-aware** extraction (prototype has it; the app ignores clipping paths).
- **Overlay and slider views**: the buttons exist in the top bar but are disabled ("Coming in phase 2").
- **Structural grids** (grid lines / bubbles inside the drawing, e.g. building axes) are not detected; only border
  zone labels.
- **Manual grid calibration** (user-defined grid when detection fails) does not exist.
- Primitive-based descriptions are basic (`Line`, `Filled box`, `Box outline`, `Shape`, `N shapes`).

## 3. History: decisions, user feedback, commits

All times Europe/Oslo. Commit hashes refer to `main`.

1. **Setup.** The user named the bot "Grok Bot", asked to connect to GitHub, and chose a **personal access token
   instead of OAuth** (token in `GH_TOKEN`, used per command, never stored in git config).
2. **Plan and mockup** — `cc99b63` (2026-10-17 10:22) *"Initial plan, UI mockups and diff-engine prototype"*.
   The user asked: "take two revisions of the same pdf and highlight the differences … work for both text and vector
   graphics … make a plan and a render". Delivered `PLAN.md`, UI mockups (`docs/mockups/`), and a first Python
   prototype run on OpenHornet OHC0003 rev - → rev A. Decisions: client-side PDF.js app; plain-text report format
   (PLAN.md §6); pair sheets by title-block number; fold repeated title-block changes; grid detection direction-agnostic
   with a page-relative band (the prototype first missed ASME row letters with a fixed band).
   User feedback on the export and grid refs (plain text, `Sheet n  Cell  Op  Description`) shaped §5–§6.
3. **Prototype hardening + synthetic tests** — `282669e` (10:36) *"Prototype: shape pairing
   (moved/resized/rotated/style), page alignment, clip-aware vectors; synthetic test suite"*. The real pair had no
   moved geometry, so 14 synthetic pairs with ground truth were built (`prototype/tests/`): 2/14 right and 20 false
   positives before, **14/14 right, 0 false positives** after (see `prototype/tests/RESULTS.md`).
   Decision: OpenHornet-derived test PDFs are generated on the fly, never committed.
4. **App skeleton / first browser increment** — `3e0edca` (10:59) *"App: first browser increment (Vite + React + TS +
   PDF.js)"*: upload, pairing, thumbnails, side-by-side viewer, text diff worker, 150 DPI raster diff worker, folding,
   sidebar with the `gridRef` slot (`-`), `.txt` export, 36 unit tests, Playwright e2e on OHC0003 + self-vs-self.
5. **User bug report: the Hello/box test** — fixed in `d963f29` (11:36) *"App: moved text, vector layer with
   moved/resized/modified shapes"*. The user tested a simple pair (text "Hello" moved, a box resized). The app did not
   recognise the move or the resize (it had no moved/resized concept, and text pixels could also show up as Graphics).
   Fixes: position anchoring + "Text moved"; **all** word boxes masked from the pixel diff (text never appears as
   Graphics); vector layer from operator lists with Moved / Resized / style Modified; pixel confirmation; synthetic
   fixtures in `app/e2e/fixtures/` (incl. `hello_box`, `hello_box_bare`) with e2e expectations; screenshots 06–08.
6. **User test: OpenHornet OH2A2A1-1 "ASSY, LEFT LIP MODULE" rev - (v6) → rev A (v7)** — fixed in `cf6bf05`
   (12:12) *"Border grid refs, coherent vector moves, context-checked text moves; OH2A2A1-1 e2e"*. The user reported
   suspicious rows and asked for grid refs:
   - (a) `ABSIS HID B… moved dy=-920`: identical BOM text quoted in the new revision note was paired as a move.
     Fix: a text move is rejected when its old line neighbours were deleted or its new ones inserted.
   - (b) `Graphics modified 296x199 mm`: the isometric view was regenerated 14.8 pt lower; vector pairing had been
     skipped (all-pairs limit) and the pixels formed one huge region. Fix: bucketed pairing, outline signatures,
     coherent-displacement voting, churn filter, and a re-diff inside the moved view, which keeps the one real change
     (a new connector, `B7 Added Graphics`).
   - (c) `ABSIS003` removed + `ABSIS011` added at the same spot: the halves sat in different Myers runs. Fix: removed +
     added on the same line and close together → one Modified, across runs.
   - (d) Three added revision-history cells: a side effect of (a); now one Added row.
   - Grid detection ported from the prototype (PLAN.md §5); grid refs in the sidebar and export; "phase 2" texts
     removed. Long modified text drops shared leading words (`"...HID BUS MASTER" -> "...BUS MASTER"`).
   - Note from that test: the attachment sizes in the request were swapped (rev A is 710 KB, rev - 666 KB).
     The bot can only read **text** from chat attachments, so the PDFs were fetched from the public OpenHornet repo.
7. **Handover** — the commit that adds this file (`git log -- docs/HANDOVER.md`): this document, PLAN.md §9 status
   markers, README link. The user considers the app MVP-ready for field testing.

The first two commits have one-line messages; their content is described above (history was not rewritten because
that would need a force push).

## 4. Architecture of `app/src`

Stack: **Vite 8 + React 19 + TypeScript 5.9**, **pdfjs-dist 5.6** (Apache-2.0), **vitest 4**, **Playwright 1.64**.
No other runtime dependencies. All coordinates are **PDF points in the page's top-left-origin space** (PDF.js viewport
at scale 1): +x right, **+y down**.

### 4.1 Files

| File | Responsibility |
|---|---|
| `main.tsx` | React entry point. |
| `App.tsx` | App state (docs, result, current pair, view, selection, filter, export dialog); runs `loadDoc` and `compare`; builds the report with `formatReport`; exposes `window.__pdfdiff = { result, report }` (used by e2e tests). |
| `styles.css` | All styling (dark UI; colours: removed red, added green, modified amber, moved/resized violet `#6E56CF`/`#8e7cf0`, ghost `#b9adff`). |
| `components/Upload.tsx` | Start screen: two drop zones / file pickers, progress, errors. |
| `components/TopBar.tsx` | File chips with rev letters, swap, view-mode buttons (Side by side active; **Overlay / Slider disabled**), New comparison, Export report. |
| `components/PageNav.tsx` | Thumbnail strip, previous/next, change badge per pair, pairing info ("A p.1 ↔ B p.1 · paired by sheet number"). |
| `components/Viewer.tsx` | Two synced panes (wheel zoom around the cursor, drag pan, `focus` box for jump-to-change); renders pages with PDF.js (canvas capped at `MAX_CANVAS_PX = 5000`); SVG highlight overlay per change (moved/resized: ghost box + arrow on B). |
| `components/Sidebar.tsx` | Change list: counts (added/removed/modified/moved = moved+resized), All/Text/Graphics filter, folded "Repeated on many sheets" rows, per-sheet rows with `sheet · gridRef`; click jumps. |
| `components/ExportDialog.tsx` | Report preview, Copy, Download `.txt` (`pdf-diff_<A>_vs_<B>.txt`). |
| `lib/types.ts` | Shared data model (below). |
| `lib/engine.ts` | **Main-thread orchestration**: `loadDoc` (PDF.js load, text content → words), `renderPage`, `pageShapes` (operator list → shapes), `compare` (text worker, then per pair: render A and B candidates, extract shapes, raster worker, vector → changes, pixel regions → changes, grid refinement), constants `RASTER_DPI`, `RASTER_MAX_PX`. |
| `lib/engine-core.ts` | Pure, worker-safe pipeline parts: `textStage` (sheet info, pairing, offset estimate, `diffWords`, first grid from words), `graphicsChanges` (raster regions → changes, removed+added overlap → modified), `vectorChanges` (vector pairs → changes, move grouping, resize grouping), `assignGridRefs`, `finalize` (grid refs, then folding). |
| `lib/words.ts` | PDF.js text items → word boxes; `readingOrder`; box helpers (`unionBox`, `boxesNear`, `cx`, `cy`). |
| `lib/pairing.ts` | `sheetInfo` (title-block SHEET n/m or "SHEET n OF m", DWG number, REV letter preferring the REV label nearest to SHEET) and `pairPages` (by sheet number without total when unique on both sides, else page order; unpaired pages kept as inserted/deleted). |
| `lib/myers.ts` | Myers O(ND) diff and `charRefine` (character-level changed middle). |
| `lib/textdiff.ts` | `estimateOffset`, `diffWords` (anchoring, Myers, move-context rejection, clustering, `pairMovedClusters`, `pairModified`, `mergeNearby`, `groupMoves`), `MOVE_TOL`, `newId`, `opLabel`. |
| `lib/vector.ts` | `Shape` type, `extractShapes` (operator list walker), `classify` (rect/line/path), `sigClose`, `shapeName`. |
| `lib/vecdiff.ts` | `diffShapes`: exact cancel → style-only → moved (coherent) → resized → churn filter; returns `changes`, `removed`, `added`. |
| `lib/raster.ts` | `rgbaToGray`, tolerant `diffMask` (3×3 neighbourhood, threshold 60 grey levels, isolated pixels dropped), `regions` (dilate ×3, connected components, darkA/darkB counts). |
| `lib/grid.ts` | `GridInfo`, `detectGrid`, `cellAt`, `gridRef`, `gridSortKey`, `gridSummary`. |
| `lib/folding.ts` | `foldKey`, `foldRepeated`. |
| `lib/report.ts` | `describe` (one-line description, 49-column budget), `elideCommon`, `sheetLabel`, `sortKey`, `formatReport` (plain-text report, 72-column rules). |
| `lib/testutil.ts` | Small helpers for unit tests. |
| `workers/text.worker.ts` | Runs `textStage` off the main thread. |
| `workers/raster.worker.ts` | Per pair: picks the alignment candidate, masks text, runs `diffShapes`, validates vector changes by pixel evidence, re-diffs inside large moves, clears explained pixels, returns regions + validated vector changes. |
| `*.test.ts` (next to each lib module) | vitest unit tests (62 tests in 9 files). |

### 4.2 Data model (`lib/types.ts`)

- `Word { text, bbox }`, `PageData { index, width, height, words }`, `DocData { name, pages }`.
- `SheetInfo { sheet ("22/26"), dwg, rev }` per page.
- `PagePair { a, b (null = page missing on that side), key, by: 'sheet' | 'order', label }`.
- `Change`:
  - `id`, `kind: 'text' | 'graphics' | 'page'`, `op: 'added' | 'removed' | 'modified' | 'moved' | 'resized'`,
    `pair` (index into `pairs`).
  - `bboxA`, `bboxB` (location on each side; null when absent).
  - `before`, `after` (text), `detail` (char refinement or style change, e.g. `fill #000000 -> #e61a1a`).
  - `pixels` (graphics regions: differing pixel count; its presence marks a raster region).
  - `move [dx, dy]` (pt, page offset removed, +dy = down), `sizeA`, `sizeB`, `scale` (resized), `shape` (vector
    name such as `Line`, `Filled box`, `2458 shapes`).
  - **`gridRef: string | null`**: `"D3"`, a range `"B5–C8"` (en dash), or `"A4>B7"` for moves/resizes that change
    cell; null on sheets without a detected grid (printed as `-`).
  - `foldKey` (set when the change is folded into a repeated row).
- `FoldedChange { key, kind, op, before, after, pairs, members }`.
- `PairResult { pair, offset, changes, grid?: GridInfo | null }`.
- `GridInfo { cols, xedges, rows, yedges, confidence: 'high' | 'medium', edges: 'ticks' | 'labels' }`.
- `DiffResult { pairs, sheetsA, sheetsB, perPair, folded }`.

### 4.3 Pipeline order (as implemented)

1. **Load** (main thread, `loadDoc`): PDF.js text content → words (split on whitespace, boxes interpolated along
   the text direction).
2. **Text stage** (text worker, `textStage`): sheet info → **pairing** → per pair: **offset estimate** from words →
   **text diff** (`diffWords`) → first grid guess from words.
3. **Per pair, graphics** (main thread renders, raster worker computes):
   1. Render A, and B at offset `[0,0]` plus the text-estimated offset if non-zero (**alignment candidates**).
   2. Extract shapes of both pages (`pageShapes`).
   3. Raster worker: pick the candidate with the fewest differing pixels (a non-zero offset must win by > 10 %) →
      mask all word boxes → **vector diff** (`diffShapes`) → keep vector changes with enough pixel evidence →
      for large coherent moves (≥ 20 shapes), re-diff that area with B shifted back → clear pixels explained by
      vector changes → **pixel regions** (fallback) → in moved views keep only significant one-sided clusters.
   4. Main thread: refine the grid with tick marks from the shapes; `vectorChanges` (grouping moved shapes, grouping
      resized shapes) → `graphicsChanges` (regions not explained by text; removed + added overlap → modified) → drop
      style-only vector changes lying inside a reported region.
4. **Finalize** (`finalize`): **grid-ref assignment** for every change, then **folding** of repeated changes.
5. **Report** (`formatReport`) on demand in the app; per-sheet rows sorted by grid ref (row, numeric column), then
   position.

Note: grid refs are assigned **before** folding (folding does not use them).

### 4.4 Worker boundaries

- `text.worker.ts`: receives both `DocData` (words only), returns `TextStageResult` (pairs, sheets, per-pair text
  changes, grid guesses, offset candidates).
- `raster.worker.ts`: receives one pair at a time: A RGBA, B RGBA per offset candidate (buffers transferred), word
  boxes, shapes; returns chosen offset, regions, validated vector changes.
- PDF.js rendering, operator lists and all UI stay on the main thread; PDF.js has its own worker for parsing.

### 4.5 Thresholds and tolerances (current values)

| Where | Value | Why |
|---|---|---|
| `textdiff.ts` `MOVE_TOL` | **1 pt** | A word at the same place within 1 pt (after page offset) is unchanged; smaller moves are invisible by design (export jitter). |
| `textdiff.ts` `estimateOffset` | unique words ≥ 2 chars, ≥ 5 matches, ≥ 60 % within 0.5 pt of the median, \|offset\| ≥ 0.25 pt | Robust global shift; ignores noise. |
| `textdiff.ts` move-context rule (`lineNeighbour`) | same line = vertical overlap ≥ 0.5 × height, gap ≤ max(2 pt, height) | A text "move" whose old neighbours were deleted or new neighbours inserted is new text in a new context (BOM text quoted in a revision note), not a move. Applied iteratively. |
| `textdiff.ts` `pairModified` | same line, boxes within max(6 pt, height) | Removed + added at the same spot = Modified, even across Myers runs. |
| `textdiff.ts` `clusters` / `groupMoves` | 12 pt or 1.5 × height; moves grouped when displacement within 2 pt and boxes within 1.5 × height | Split one edit run into separate places; join words moved together. |
| `textdiff.ts` `mergeNearby` / `sameRow` | touching within 6 pt; same row with gap < max(30 pt, 4 × height); up to 8 passes | Merge cells of one table row (revision history) and multi-line notes. |
| `vecdiff.ts` exact cancel / `tol` | **1 pt** box tolerance, same style | Identical shapes cancel. |
| `vecdiff.ts` moved | same style, point count, size ±1 pt and outline signature; displacement bins of 2 pt; a move needs **≥ 3 shapes** with the same displacement within 20 pt of each other, or a single unambiguous copy (not for plain lines); buckets > 300 candidates skipped | Identical primitives (lines, screws) otherwise pair by coincidence across the sheet. |
| `vecdiff.ts` resized | same style/type, signature within 0.03 for paths, overlapping or within half the larger size, scale 0.25–4 per axis, orientation unchanged; shapes covering > 400 cells of 128 pt (frames) skipped | Same object, other size. |
| `vecdiff.ts` churn filter | moves/resizes of clusters < 20 shapes next to unpaired geometry (20 pt; resized needs ≥ 3 unpaired shapes) are released | A redrawn area is a modification, not many small moves. |
| `engine.ts` `RASTER_DPI` / `RASTER_MAX_PX` | **150 DPI**, long side ≤ **4200 px** | Enough for 1 px strokes; caps memory (a D-size sheet is 2448 pt → about 1.7 px/pt). |
| `raster.ts` `diffMask` | 3×3 neighbourhood, threshold 60 grey levels, isolated pixels dropped | Absorbs anti-aliasing and 1 px shifts. |
| `raster.worker.ts` `minPix` | max(6, ⌈10 × scale⌉) px ≈ **10 pt of 1 px stroke** (≈ 3.5 mm) | Noise floor for regions and vector evidence (curve re-tessellation specks). |
| `raster.worker.ts` large moves | ≥ 20 shapes with one displacement (±3 pt); re-diff with 5×5 tolerance; residual clusters (30 pt) need ≥ 5 × `minPix` and must be one-sided (3:1) | Regenerated views jitter edges by 1–2 pt; real edits inside them are clearly added or removed. |
| `engine-core.ts` `graphicsChanges` | region > 80 % inside a text change (pad 3 pt) is dropped; op by dark pixels 3:1 | Text is reported by the text layer only. |
| `engine-core.ts` `vectorChanges` | moved groups: displacement ≤ 1 pt and within 20 pt; small groups absorbed into a ≥ 20-shape group within 3 pt; resized grouped when touching within 2 pt | One row per moved view / grown table. |
| `grid.ts` band | **max(40 pt, 5 % of the shorter page side)** | A fixed band missed ASME row letters in the prototype. |
| `grid.ts` labels | 1–2 digit numbers or a single uppercase letter; ≥ 3 labels, consecutive, monotonic either way, gap spread ≤ 0.15 | Even spacing rejects notes and table numbers. |
| `grid.ts` edges | ticks = stroked shapes in the band, < 0.6 pt thick, 3–60 pt long, within 0.3 × step of a label midpoint; `'ticks'` if ≥ 80 % found, else midpoints | Cell borders as printed. |
| `grid.ts` confidence | high when both opposite edges have ≥ 3 candidate labels for both axes | Reported in the header. |
| `folding.ts` | fold when a change appears on **≥ max(2, ⌈n/2⌉)** paired sheets; text key = op + before + after (+ rounded move); graphics key = op + box on a 5 pt grid | Title-block REV letter changes are listed once. |
| `report.ts` | rules 72 columns; description budget 49 characters | Plain text ≤ 80 columns. |
| `vector.ts` | ≤ 250 000 shapes per page; signature = first 32 points | Memory bound. |

The prototype's `1.5 × TOL` (1.5 pt) "same spot" tolerance for shape pairing (`pdfdiff.py`) has no direct
counterpart in the app; the app uses the 1 pt `tol` plus the rules above.

## 5. How to run

### 5.1 Commands (repo root = `pdf-diff/`)

Node.js **20.19+** (Vite 8 requirement; 22 recommended).

```bash
cd app
npm install
npm run dev            # http://localhost:5173 (strictPort)
npm run build          # tsc -b + vite build -> app/dist/ (a chunk-size warning from pdf.js is expected)
npm run preview        # serves app/dist/ at http://localhost:4173
npm test               # vitest unit tests (src/**/*.test.ts), node environment
npm run test:e2e       # Playwright, all e2e specs; starts `npm run dev` itself (reuses a running server)
npm run screenshots    # only e2e/screenshots.spec.ts -> docs/screenshots/*.png
npm run fixtures       # regenerate app/e2e/fixtures/*_a.pdf / *_b.pdf (make-fixtures.mjs, no deps)
```

Samples for e2e (third-party, not committed): `(cd prototype && ./fetch_samples.sh)` downloads into
`prototype/samples/` (gitignored) from `github.com/jrsteensen/OpenHornet` (CC BY-NC-SA 4.0):

| File | Source commit | Notes |
|---|---|---|
| `OHC0003_rev-_v28.pdf` | `02316bfbb4` "Initial commit of WIP Release Package" | OHC0003 "ASSY, KNOBS" rev -, 26 sheets; blob `980ca947…` |
| `OHC0003_revA_v29.pdf` | `c0f62eed89` "OHC0003-A-4RUDGB3: UPDATED INDICA AND FINISH (#1080)" | rev A; blob `d8a68b64…` |
| `OH2A2A1-1_rev-_v6.pdf` | `d5fc02c103` "Added missing FN 5 balloon" (removed again in `272988fdbc`) | OH2A2A1-1 "ASSY, LEFT LIP MODULE" rev -, 3 sheets, 681 522 bytes; blob `c1fb69b0…` |
| `OH2A2A1-1_revA_v7.pdf` | `272988fdbc` "Revert to Mega Rev 3 based ABSIS Bus Master (#1110)" | rev A, 727 255 bytes; blob `dd09d82f…`; poppler warns about a metadata stream length (harmless) |

e2e specs skip themselves when the samples are missing. Playwright uses `/usr/bin/google-chrome` or `$CHROME_PATH`
if present, else its bundled Chromium (`npx playwright install chromium`). Viewport 1600×960, one worker,
timeouts 240 s per test.

### 5.2 In the user's Fedora distrobox

```bash
distrobox create --name pdfdiff --image registry.fedoraproject.org/fedora-toolbox:42
distrobox enter pdfdiff
sudo dnf install -y nodejs git gh
gh auth login                      # or: export GH_TOKEN=<personal access token>
gh repo clone JohnArild/pdf-diff
cd pdf-diff/app
npm install
npm run dev                        # open http://localhost:5173 on the host (distrobox shares the network)
npm run build && npm run preview   # production build at http://localhost:4173
```

For e2e tests in the distrobox: `npx playwright install --with-deps chromium`. Playwright's `--with-deps` installs
system libraries with apt and is only supported on Debian/Ubuntu; on Fedora run `npx playwright install chromium`
and install missing libraries with `dnf` if Chromium fails to start, or install Google Chrome
(`/usr/bin/google-chrome` is picked up automatically) or set `CHROME_PATH`.

### 5.3 Python prototype

Python 3.11+ and `curl`.

```bash
cd prototype
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # pymupdf, numpy, scipy, pillow
./fetch_samples.sh
.venv/bin/python pdfdiff.py samples/OHC0003_rev-_v28.pdf samples/OHC0003_revA_v29.pdf --label-a - --label-b A --out out
.venv/bin/python tests/make_synthetic.py tests/out && .venv/bin/python tests/run_tests.py tests/out
```

## 6. Test corpus

### 6.1 Synthetic fixtures (`app/e2e/fixtures/`, our own, committed)

Generated by `make-fixtures.mjs` (US Letter, single page). Expected rows (`app/e2e/fixtures.spec.ts`, exactly these
rows and nothing else; no grid → `-`):

| Pair | Change | Expected report rows |
|---|---|---|
| `hello_box` | "Hello" moved, box 100×60 → 160×90 (corner fixed), with page border | `Moved Text "Hello" moved dx=+120.0 dy=+40.0 pt`; `Resized Filled box 100x60 -> 160x90 pt` |
| `hello_box_bare` | same, no border | same + `(x1.60 x1.50)`; sidebar shows 2 moved, ghost highlights |
| `text_move_50` | "Hello" right 50 pt | `Moved Text "Hello" moved dx=+50.0 dy=+0.0 pt` |
| `text_move_150` | "Hello" (+150, −100 PDF y) | `Moved Text "Hello" moved dx=+150.0 dy=+100.0 pt` |
| `box_resize_corner` / `_center` / `_path` / `_cm` | box 100×60 → 160×90 (corner anchored / centre fixed / m-l-h path / placed with `cm`) | `Resized Filled box 100x60 -> 160x90 pt` |
| `box_move` | box moved (+200, −100 PDF y) | `Moved Filled box moved dx=+200.0 dy=+100.0 pt` |
| `box_color` | fill black → red | `Modified Filled box (100x60 pt) fill #000000 -> #e61a1a` |
| `combo` | Hello moved, World unchanged, box resized about centre, path box moved down 80, new 50×50 box | `Moved Text "Hello" … dx=+60.0 dy=-50.0`; `Resized Filled box 100x60 -> 160x90`; `Moved Filled box … dx=+0.0 dy=+80.0`; `Added Graphics` |
| `combo_b` vs itself | — | 0 changes |

### 6.2 Real pairs (OpenHornet, downloaded, not committed)

**OHC0003 rev - → rev A** (`app/e2e/compare.spec.ts`): totals `30 changes: 3 added, 0 removed, 26 modified,
1 resized`; header `Grid  Border zone on 1/26 sheets, rows A-D, columns 1-8 (high confidence)`;
`All sheets  -  Modified  Text "-" -> "A" (26/26 sheets)`; sheet 1/26: `D1–D3 Resized 4 shapes 557x56 -> 557x88 pt`
and `D1–D2 Added Text "A FN 21: EXTENDED INDICA…"`; sheet 22/26 (no grid): `Added Text "PAINT INSIDE OF RING…"`
and `Added Graphics (10x43 mm region)` (leader line); `No other changes on 24 sheet(s)`; self vs self = 0.

**OH2A2A1-1 rev - → rev A** (`app/e2e/lip.spec.ts`; refs checked visually against the sheet's zone labels,
columns 8..1 left to right, rows D..A top down):
```
Grid       Border zone on 3/3 sheets, rows A-D, columns 1-8 (high confidence)
Totals     10 changes: 2 added, 0 removed, 6 modified, 1 moved, 1 resized
All sheets   -       Modified  Text "-" -> "A" (3/3 sheets)
Sheet 1/3    A4–A5   Modified  Graphics (55x35 mm region)            new board, exploded view
Sheet 1/3    B2      Modified  Text "...HID BUS MASTER" -> "...BUS MASTER"   BOM row 14 description
Sheet 1/3    B3      Modified  Text "ABSIS003" -> "ABSIS011"          BOM row 14 part number
Sheet 1/3    B5–C8   Moved     2458 shapes moved dx=+0.0 dy=-14.8 pt  isometric view regenerated lower
Sheet 1/3    B7      Added     Graphics (10x7 mm region)              new connector inside that view
Sheet 1/3    D1–D3   Resized   4 shapes 557x56 -> 557x88 pt ...       revision table grows one row
Sheet 1/3    D1–D2   Added     Text "A FN 14: REPLACED ABSIS HID BUS MASTER ..."
No other changes on 2 sheet(s): 2/3, 3/3
```
Also: no `Moved Text` row; sidebar row for ABSIS011 shows `B3`; self vs self = 0.

### 6.3 e2e spec files (21 tests)

- `e2e/compare.spec.ts`: OHC0003 expectations + self-vs-self (2).
- `e2e/lip.spec.ts`: OH2A2A1-1 expectations + self-vs-self (2).
- `e2e/fixtures.spec.ts`: one test per fixture pair (11), fixture self-vs-self, sidebar checks for `hello_box_bare` (13).
- `e2e/screenshots.spec.ts`: writes `docs/screenshots/01`–`10` (4): upload screen; OHC0003 sheet 22, sheet 1,
  revision row, export dialog; Hello/box, its resize, its export; OH2A2A1-1 sheet 1 and export.
- `e2e/helpers.ts`: sample paths, `loadPair` (uploads both files, waits for `window.__pdfdiff`), `section`.

Unit tests: `src/lib/*.test.ts` (62): folding, grid (ISO/ASME, no grid), Myers, pairing, raster, report
(formatting, elision, moved/resized), textdiff (anchoring, moves, context rejection, modified, row merge), vecdiff
(coherent moves, scattered lines, churn), vector (fixture extraction and pairing).

### 6.4 Prototype corpus

`prototype/tests/make_synthetic.py`: 14 synthetic pairs (moves 50/5/2/0.5 pt, resize, dimension edit, moved text,
sheet shift, rotation, style-only incl. width and dash, re-segmented negative control, OpenHornet-derived cases
10–12 generated on the fly). Results in `prototype/tests/RESULTS.md`.

## 7. The Python prototype

`prototype/` (Python, **PyMuPDF = AGPL**, plus NumPy/SciPy/Pillow; **not for shipping**, reference only):

- `pdfdiff.py`: complete reference pipeline: page pairing, border-grid detection, sheet numbers, text diff,
  **sampled-geometry vector diff** (paths sampled every `STEP = 1 pt`, KD-tree per style, `TOL = 1 pt`),
  **clip-aware** vectors, page-offset alignment, shape pairing into **moved / resized / rotated / style-only**
  (including dash and width), raster fallback, region merging (`MERGE = 6 pt`), grid refs, `.txt` report and
  side-by-side PNG renders.
- `fetch_samples.sh`: downloads the OpenHornet samples (§5.1).
- `examples/`: report and renders of OHC0003 sheets 1, 2, 22 (CC BY-NC-SA, attribution in README).
- `tests/`: synthetic suite (`make_synthetic.py`, `run_tests.py`, `RESULTS.md`, `renders/`).

Relation to the app: the app ports the pipeline to PDF.js in the browser. Ported: pairing, title block, text diff,
raster fallback, folding, report format, offset alignment, grid detection, moved/resized/style pairing (by box +
signature). **Still only in the prototype:** sampled-geometry matching with tolerance, rotation, dash-pattern changes,
clip awareness. Use it as the reference when porting those (PLAN.md §4).

## 8. Known limits and risks

Diff engine:
- **Moves below 1 pt are invisible** by design (text `MOVE_TOL`, vector `tol`).
- **Vector matching is box + style + 32-point signature**, not sampled outlines; re-exported, re-tessellated paths
  pass only because the pixel check finds no difference. Very fine real changes (< ~10 pt of stroke, `minPix`) are
  below the pixel noise floor.
- No rotation detection; dash-only changes appear only as anonymous graphics regions; clipping paths are ignored.
- Only RGB fill/stroke colour operators are read (`setFillRGBColor`/`setStrokeRGBColor`); patterns and shadings are
  not shapes (raster fallback covers them).
- The move/churn/residual thresholds were tuned on **two real pairs** (OHC0003, OH2A2A1-1) plus synthetic fixtures.
  Expect false positives/negatives on other CAD exporters.
- Inside a moved view, small edits or edits that both add and remove ink (two-sided) are dropped as jitter.
- A moved view is labelled `N shapes`, not by a view name.
- A fallback-paired modified region's A box covers only the removed part (e.g. A4–A5 board on OH2A2A1-1).
- Dimension edits come out as two rows (text + geometry); the revision-table resize is a separate row from the
  revision text row.
- Text drawn as outlines (common in CAD) is treated as graphics; no OCR for scanned PDFs.
- Alignment is a single global translation estimated from text; no scale/rotation; pages with different sizes or
  offset media boxes are cropped to the common size and are untested; `/Rotate` pages untested.
- Folding threshold `max(2, ⌈n/2⌉)`: in a 2- or 3-sheet document anything identical on 2 sheets folds.
  Totals count the folded members individually (OH2A2A1-1: 3 REV changes counted as 3).

Grid:
- Only border zone labels (1–2 digits, single capital letters); no structural grids, no manual calibration.
- Confidence counts candidate labels on opposite edges, not only the chosen sequence.
- A range comes from the change's bounding box (incl. stroke extents), so it can include a neighbouring cell by a
  few points (OH2A2A1-1 iso view `B5–C8` reaches 9 pt into column 5).
- Numbered notes or table numbers inside the 5 % band could, in theory, form a false sequence.

App and operations:
- Overlay and slider views are disabled.
- Performance: pairs are processed one after another; each pair renders A and up to two B images at 150 DPI
  (≈ 45 MB RGBA each on a D-size sheet) and walks full operator lists on the main thread. Heavy sheets
  (hundreds of thousands of paths) are untested. Measured on the bot's box (e2e, incl. loading):
  OHC0003 (26 sheets, mostly letter size) ≈ 15 s, OH2A2A1-1 (3 D-size sheets) ≈ 19 s.
- The production bundle is large (pdf.js), so Vite prints a chunk-size warning.
- The `Generated` time in the report uses the browser's time zone.
- The bot can only read **text** from chat attachments, not the PDF bytes (see §10.2).

## 9. Backlog (prioritised)

1. **Field-test feedback loop**: deploy (§10.1), collect real pairs and reports, turn every confirmed bug into an
   e2e expectation (real pair, not committed if third-party) or a synthetic fixture (committed).
2. **Collect more real drawing pairs**, especially from other CAD tools and with moved geometry, as the noise
   baseline; add them to `fetch_samples.sh` when public.
3. Finish phase 2:
   1. Sampled-geometry matching with tolerance (port `pdfdiff.py`), incl. width/dash in the style key and
      clip awareness.
   2. Rotation pairing.
   3. Overlay and slider views.
   4. Structural grids and manual grid calibration (user clicks the frame/labels when detection fails).
4. Report quality: fold the revision-table resize into the revision row; merge dimension text + geometry rows;
   name moved views (nearest view label such as `-1 ASSY` / `VIEW A-A`).
5. Alignment: offset media boxes, different page sizes, rotated pages; scale differences.
6. Performance on heavy sheets: move operator-list parsing into a worker, tile the raster diff, cache renders,
   progress per stage, cancel.
7. Phase 3: manual page-pairing override, export a report PDF.
8. Phase 4 items as in PLAN.md §9 (dimension objects, precision mode, change-log cross-check, review states, OCR).

## 10. Field testing: deployment and bug reports

### 10.1 Deployment options

All processing is client-side, so the app is a **static site** (`npm run build` → `app/dist/`):
- **Local**: `npm run build && npm run preview` (port 4173), or serve `app/dist/` with any static server.
- **GitHub Pages**: needs a **public repository or a paid plan** for a private repo. The site lives under
  `/<repo>/`, so set `base: '/pdf-diff/'` in `vite.config.ts` (not done yet).
- **Netlify / Cloudflare Pages**: connect the repo, build command `npm run build` in `app/`, publish directory
  `app/dist`. Works with a private repo.
- Drawings never leave the browser on any of these hosts.
- **Production (in use)**: Docker container on the user's VPS behind Caddy at https://pdfdiff.lb1oi.com, see §12.

### 10.2 How to report a bug

- Attach **both PDFs** (Rev A and Rev B) and the exported `.txt` report, and name the sheet, grid cell and the
  row that is wrong, plus what you expected.
- The bot can only read the **text** of chat attachments, not the PDF itself. So:
  - for **public drawings** (e.g. OpenHornet), say where they come from (repository, path, commit or version); the
    bot downloads them;
  - for **private drawings**, commit the pair to a private fixtures folder in this repo (e.g.
    `app/e2e/private-fixtures/`, only if you are allowed to share them with the bot) or otherwise share them via
    the repo, and say which files.
- A screenshot of the app view helps with highlight and grid-ref problems.

## 11. Working conventions for the bot

- **Pull first**, work, then **one commit and one push per change set** to `main` with a descriptive message
  (summary line + bullet list of what changed and why).
- **Never commit third-party PDFs** (OpenHornet is CC BY-NC-SA) or PDFs derived from them; generate derived test
  files on the fly. Our own synthetic fixtures in `app/e2e/fixtures/` are fine.
- **Never commit secrets.** Use the token only per command, e.g.
  `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main`; the remote stays
  `https://github.com/JohnArild/pdf-diff.git` and git config holds no credential. If the token lacks permission,
  stop and report the exact error.
- No AGPL (or other copyleft) dependencies in the app.
- No force pushes or history rewrites without the user's explicit confirmation.
- Before pushing: `npx tsc --noEmit -p .`, `npm test`, `npm run build`, and the **full** `npx playwright test`
  (samples fetched), all green.
- **Verify grid refs visually**: render the sheet, draw the change boxes and compare with the printed zone labels.
- **Check screenshots** after regenerating them (open the PNGs and look at them).
- Report times to the user in Europe/Oslo; send, post or share nothing outside the repo without approval.

## 12. Production deployment (pdfdiff.lb1oi.com)

The field-test instance runs on the user's VPS (Hetzner, Ubuntu 26.04, hostname `ubuntu-8gb-hel1-2`).

**Access.** Only over Tailscale: `ssh -i ~/.ssh/id_ed25519_pdfdiff john@100.112.237.12` from the bot's box (the
MagicDNS name does not resolve there; use the IP). User `john` is in the `docker` group but has **no passwordless
sudo**. Anything needing root goes to the user as a one-liner, or as a script in `/tmp` on the server that the user
reviews and runs with `sudo`. The public firewall (UFW and the Hetzner firewall) only opens TCP 80/443.

**Layout.**
- `/home/john/pdfdiff`: a plain clone of this public repo (`https://github.com/JohnArild/pdf-diff.git`, no
  credentials on the server).
- `deploy/Dockerfile`: multi-stage build. `node:22-alpine` runs `npm ci && npm run build` in `app/`, then
  `nginxinc/nginx-unprivileged:1.28-alpine` serves `dist/` as uid 101 on port 8080. The context is the repo root,
  and `deploy/Dockerfile.dockerignore` limits it to `app/` and `deploy/nginx.conf`.
- `deploy/nginx.conf`: SPA fallback to `index.html`, `.mjs` (pdf.js worker) served as `text/javascript`, gzip,
  `/assets/*` and `*.mjs` cached for 1 year (immutable, hashed names), everything else `Cache-Control: no-cache`,
  and `/healthz` for the healthcheck.
- `deploy/docker-compose.yml`: project `pdfdiff`, container `pdfdiff`, image `pdfdiff:latest`, published **only**
  on `127.0.0.1:8095`. It has `restart: unless-stopped`, a read-only root fs with tmpfs `/tmp`, `cap_drop: ALL`,
  `no-new-privileges`, `mem_limit: 128m`, and json-file log rotation (10m x 3) for this container only.
- Host Caddy (`caddy.service`, v2.6.2, Ubuntu package) has a `pdfdiff.lb1oi.com` block in `/etc/caddy/Caddyfile`
  with `encode gzip zstd`, HSTS, nosniff and Referrer-Policy headers, and `reverse_proxy 127.0.0.1:8095`. TLS comes
  from Caddy's automatic HTTPS. The block was added by a reviewed script
  (`pdfdiff-caddy.sh`: back up to `Caddyfile.bak-pdfdiff-<timestamp>`, append if missing, `caddy validate`, restore
  on failure, `systemctl reload caddy`). Do **not** use the Caddy admin API (`127.0.0.1:2019`).
- Vite `base` is the default `/`, which is correct for serving at the domain root.

**Update to the latest `main`** (no sudo):
```bash
ssh -i ~/.ssh/id_ed25519_pdfdiff john@100.112.237.12 '~/pdfdiff/deploy/update.sh'
```
`update.sh` runs `git pull --ff-only` and `docker compose -f deploy/docker-compose.yml up -d --build`. It then
removes only the previous `pdfdiff` image, waits for the healthcheck and curls `http://127.0.0.1:8095/`.

**Checks:** `docker ps --filter name=^pdfdiff$`, `docker logs pdfdiff`,
`curl -sI http://127.0.0.1:8095/assets/<pdf.worker...>.mjs` (expect `text/javascript`), and from outside
`curl -sI https://pdfdiff.lb1oi.com/`.

**Leave alone.** The server also runs the user's other services: Caddy sites `odysseus.lb1oi.com`,
`hermes.lb1oi.com` and `hermes-test.lb1oi.com`, compose projects `hermes-docker`, `odysseus` and `openbrain` in
`/home/john`, and ports 127.0.0.1:3000/7000/8080/8091/8100/8788/2019, plus 9119/8443 on the Tailscale IP. Known
security findings on the server are accepted risks owned by the user. Change nothing outside the `pdfdiff` project
and its Caddy block. Never prune Docker images, volumes or build cache globally.
