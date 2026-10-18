# PDF Diff — Development Plan

A web app that compares two revisions of the same PDF and highlights what changed, in both **text** and **vector graphics** (drawings, plans, schematics).

---

## 1. Core user flow

1. **Upload** Rev A (old) and Rev B (new) via drag-and-drop. Show file name, page count, size, and an editable revision label (e.g. "Rev 3" / "Rev 4").
2. **Page alignment.** Automatically pair pages A↔B in this order:
   1. Pair by **sheet identity read from the title block**: sheet number (`2/26`, `Sheet 3 of 6`) and/or drawing number (§5.6). This is cheap and very reliable for drawing sets (it paired all 26 sheets in the prototype test, §11).
   2. For pages left over, use a per-page fingerprint (text shingles + low-res thumbnail hash) and a sequence alignment (Needleman–Wunsch style) to find inserted / deleted pages.
   3. If neither works, fall back to page order.

   The user can override pairs manually in a page strip.
3. **Compare.** Per page pair, run text diff and vector diff (plus raster fallback). Results stream in page by page with progress.
4. **View modes**
   - *Side by side* — synchronized pan/zoom, removed items marked on A, added on B.
   - *Overlay* — B drawn over A with colorized differences (classic "red/green" drawing compare).
   - *Slider* — a draggable wipe between A and B.
5. **Change list sidebar** — every change as a row ("Page 2 · Text changed 'Rev 3' → 'Rev 4'"), grouped by page, with counts. **Changes that repeat on many sheets** (typically the REV letter, date or approver in every title block) are **folded into one row** ("All sheets · REV - → A · 26 sheets") that can be expanded (§4.8). Clicking a row zooms to it. Filters: **Text / Graphics / Images**, and **Added / Removed / Modified**. Rows can be marked *reviewed* or *ignored*.
6. **Export**
   - **Export list** button above the change list → **plain-text report (.txt)** with sheet number and grid reference per change (see §6). Copy to clipboard or download.
   - Annotated diff report PDF (summary + marked-up pages); CSV/JSON of the change list as secondary formats.

## 2. Architecture

**Recommendation: React + TypeScript frontend, PDF.js for rendering, with a hybrid processing model.**

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React, TypeScript, Vite, Zustand (state), Tailwind or CSS modules | Canvas for page raster, SVG/Canvas overlay layer for highlights |
| Rendering | **PDF.js** (Apache-2.0) | Proven, renders vector content accurately; tile rendering at zoom |
| Diff engine (MVP) | **Client-side, in Web Workers**, using `pdf.js` `getTextContent()` and `getOperatorList()` | Files never leave the browser — a strong privacy selling point for engineering drawings |
| Diff engine (scale-up) | Optional **Python worker** (FastAPI + job queue) for very large drawings, batch jobs, OCR | Engine choice: pdfium (`pypdfium2`, BSD/Apache) or `pdfminer`/`pikepdf`; PyMuPDF only if AGPL/commercial license is acceptable |
| Report export | `pdf-lib` (MIT) on the client: copy pages, draw annotation rectangles/paths, add summary pages | |

Keep the diff engine a pure module with a stable JSON result schema (`Change { id, page, sheet?, gridRef?, kind: text|vector|image, op: added|removed|modified, bboxA?, bboxB?, before?, after? }`) so it can run in a worker or on a server unchanged.

## 3. Text diffing

1. **Extract words with geometry.** From PDF.js text items, split into words; compute each word's bbox in page user space (apply text matrix × CTM). Keep font name/size for "formatting changed" detection.
2. **Reading order.** Group into lines (baseline clustering) and blocks (XY-cut). This normalizes order so the diff doesn't depend on content-stream order.
3. **Diff the token sequence** per page pair with **Myers diff** on words, then refine replaced spans with a **character-level** diff (shows "Rev 3 → Rev 4" precisely).
4. **Map back to boxes.** Deleted tokens → boxes on A, inserted → boxes on B, replacements → amber on both. Merge adjacent boxes into one highlight per change.
5. **Reflow handling.** Because we diff the token stream (not positions), text that merely re-wraps or moves is not reported as changed. Optionally flag "moved" when an identical block's position shifts > threshold. For drawings, also run a **position-aware pass**: isolated labels (dimensions, tags) are matched by text + proximity, since order is meaningless there.
6. Normalize ligatures, Unicode (NFKC), hyphenation, and whitespace before diffing.

## 4. Vector graphics diffing

> **Lesson from the prototype (§11):** two exports of the *same, unchanged* drawing from different CAD/plot driver versions had 2–3.6× different path segment counts (curves tessellated differently). Matching operators/primitives 1:1 is therefore not viable as the primary method. The core matcher compares **sampled geometry within a tolerance** (step 3); primitive-level matching is only used to label and describe changes.

1. **Parse the operator list** (`getOperatorList()` in PDF.js, or content stream server-side): track the graphics state stack (`q/Q`, `cm`), paths (`m l c v y h re`), paint ops (`S f B n`, stroke/fill colors, line width, dash) and **clip paths (`W n`)**. Geometry outside the active clip must be dropped: CAD viewports and placed Form XObjects rely on clipping, and ignoring it produced 16 false positives in a synthetic test (§11).
2. **Normalize into primitives** in page space with the CTM applied: `Line`, `Bezier`, `Rect`, `Polygon/Path`, each with style (stroke/fill color, width). Split polylines into segments; canonicalize direction (A→B and B→A are equal); round coordinates to a tolerance (e.g. 0.1 pt). Expand Form XObjects; treat images as `ImagePrimitive(bbox, hash)`.
3. **Match by sampled geometry with tolerance.** Flatten every path (curves into short polylines) and sample points along it at a fixed step (≈1 pt). Index B's samples in a KD-tree / spatial hash per **style key** (stroke/fill colour, paint type, **line width and dash pattern**; without width and dash, width-only and dash-only changes go unseen). A sample in A is matched if a same-style sample in B lies within ε (≈1 pt, tunable per drawing scale), and vice versa. Unmatched samples in A are **removed**, unmatched in B are **added**. Overlapping removed + added regions, or geometry that matches only when style is ignored, become **modified**. This holds up when paths are re-segmented, reordered or re-tessellated. As a fast path, exact canonical-hash matches of whole primitives can be removed first when both files come from the same exporter.
4. **Cluster** unmatched samples into regions (rasterise to a mask, dilate by a few pt, label connected components) so the UI shows "Wall added" as one change instead of 40 segments. Then describe each region from the primitives it touches.
5. **Pair removed and added shapes** before reporting them (validated in the prototype, §11):
   - Split paths into connected **sub-paths**, since one PDF path object often holds many shapes.
   - Group the sub-paths that are mostly unmatched.
   - Fit each removed group against each added group with a **similarity transform**: scale from the RMS radius, a coarse-then-fine rotation search (smallest angle wins for symmetric shapes), and ICP translation.
   - Accept the pair at ≥85 % two-way sample agreement and classify it as **Moved (dx, dy)**, **Resized (×s)**, **Rotated (θ about pivot)** or **Style only** (colour/width/dash, identity transform).
   - Removed and added words with the same text vote on a common offset, which becomes **Moved text**.
   - Grid refs for moved items read `old>new` (e.g. `B2>B3`).
6. **Raster fallback.** Render both pages at high DPI (e.g. 200–300) in tiles, compute a pixel diff (with 1–2 px dilation tolerance for anti-aliasing), and surface regions not explained by the vector/text diff. This catches images, shadings, odd operators, and parser gaps — a safety net that keeps the tool trustworthy.
7. **Page offset alignment.** Before matching, estimate a global translation (and optionally scale) between A and B — e.g. from matched text anchors or phase correlation of thumbnails — so a re-plotted sheet that shifted 2 mm isn't "everything changed". **Verify the candidate against the geometry** and accept it only if it clearly raises the vector match rate. A text-only estimate is fooled when most text has moved (e.g. a relocated notes block). Report the compensated offset in the report header.
8. **Title block detection and repeated changes.** Detect the title block region on each sheet: the dense ruled box with labels such as `DWG NO`, `SHEET`, `REV`, `SCALE`, usually bottom-right and the same layout across the set. Tag changes inside it as *title block* changes. When an identical change (same op, same before/after text, same relative position in the title block) occurs on many sheets, fold it into **one document-level change** listing the affected sheets. A revision bump otherwise produces one noise row per sheet (26 of 28 changes in the prototype test). Revision tables are treated as normal content, since a new row there is a real change.
9. **Change-log vs. drawing cross-check (candidate feature, phase 4).** Parse the revision table (`REV / DESCRIPTION / DATE`) and any referenced find numbers or zones. For a new revision entry, check whether the cited sheet or item actually has geometry or text changes, and flag mismatches both ways: "Rev A says FN 21 indica extended, but no geometry changed on sheet 22", or "geometry changed on sheet 7, no revision entry mentions it". The prototype found exactly such a case (§11).

## 5. Grid detection & sheet references

Goal: every change carries a location a human can find on paper, e.g. `Sheet A-102  D3  Removed  Line (wall segment)`.

**5.1 Two kinds of grid**
- **Border zone grid** (ISO 5457 / ASME Y14.1 style): numbers along the top/bottom margins, letters along the left/right, separated by short tick marks in the space between the outer and inner frame. **Direction varies by standard:** ISO numbers columns left→right with A at the top; ASME numbers columns **right→left** with **A at the bottom** (as in the OHC0003 test drawing). Detection must not assume either direction.
- **Structural grid**: grid "bubbles" (circles or hexagons containing `A, B, C…` / `1, 2, 3…`) with long thin (often dash-dot) lines running across the plan.

**5.2 Finding grid labels** (uses the positioned text from §3 and the primitives from §4)
1. Candidate tokens: single letters (`A`–`Z`, skipping I/O as ISO does, but accepting them if present) or 1–2 digit numbers, in small isolated text runs.
2. *Border zone:* keep candidates in a band near each page edge (outside the inner frame rectangle, found as the largest closed rectangle). They must form an **arithmetic sequence** (A, B, C… / 1, 2, 3…) with roughly **even spacing**, ideally the same sequence on opposite edges. The sequence may run in **either direction** along an axis. Labels are sorted by value and their positions only need to be monotonic, and the cell mapping uses the actual label positions. The band width must be relative to the page size (≈5% of the short side): a fixed 30–40 pt band missed the row letters on a D-size sheet in the prototype. Short ticks perpendicular to the frame, between labels, add confidence.
3. *Structural grid:* candidates whose bbox centre lies inside a small circle/hexagon primitive (bubble), each attached to a long line through the drawing. Lines with letter bubbles form one axis and lines with number bubbles the other, so they can sit at any angle.
4. Score each hypothesis on sequence completeness, spacing regularity, whether opposite edges agree, and supporting ticks or lines.

**5.3 Cell boundaries**
- If border ticks were found, use them as boundaries. Otherwise use the **midpoints between neighbouring label centres**, extended half a step beyond the first and last label (clamped to the frame).
- For a structural grid, cells are the bays *between grid lines*; a reference is given as the bay (`C–D/2–3`), or as the nearest line intersection (`C/2`) for things lying on a line.
- Apply the page rotation and the Rev A↔B alignment offset (§4.7), so a change gets the same reference on both revisions.

**5.4 Which grid to use**
- When both exist (common on plans), default to the **border grid** for report references, since it covers the whole sheet including the title block and notes, and offer the structural grid as an option ("Grid: Border | Structural | None").
- **Sheets without a grid are normal, not an error.** Small-format sheets (letter/A4/A3) often carry only centring marks. In the test set, 25 of 26 sheets had no grid. They get `-` silently, with no warning per sheet.
- Below a confidence threshold, no grid is applied and the reference is `-`. The detected grid can be overlaid on the page for verification, and the user can override the choice per sheet or for the whole document.

**5.5 Mapping a change to a cell**
- Take the change's bbox in page space. Small changes get the cell containing the **bbox centre**. When the bbox spans several cells, the report gives a **range** from top-left to bottom-right cell, e.g. `C2–C3` or `D3–E4`.
- Large clustered changes beyond a few cells (configurable) are summarised as a range plus "multiple".

**5.6 Sheet number**
- Look in the title block (the dense box of text and lines, usually bottom-right) for a value next to labels like `Drawing No.`, `Dwg No.`, `Sheet`, `Sheet No.`, `Tegn.nr.` and `Blad` (localised label list). Prefer the drawing number (`A-102`) and fall back to `Sheet n of m`.
- Check that the value looks like a sheet number and is consistent across revisions (the same sheet in A and B). If nothing is found, use **`Page n`** (B's page number, or A's for deleted pages).
- The user can correct the value per sheet, and corrections are remembered per file hash.

**5.7 Manual calibration fallback**
When detection fails or is wrong: in a "Calibrate grid" mode the user clicks the first and last cell (or two grid lines) on each axis, then enters the labels (e.g. A→F, 1→4) and whether spacing is even. Optionally they drag individual boundaries. The calibration is saved and reused for every sheet with the same frame size/layout (common across a drawing set).

## 6. Plain-text change list export

- **Export list** button (with `.txt ▾` dropdown for CSV/JSON later) next to the change list header. It exports *all changes* or *the current filter*, grouped by sheet, in UTF-8 with LF line endings and fixed-width columns (≤ 80 cols), so it pastes cleanly into email, tickets or RFI logs.
- The header reports **grid coverage**, e.g. `Grid  Border zone on 1/26 sheets, rows A-D, columns 1-8`, so a reader knows why most refs are `-`.
- Changes folded across sheets (§4.8) are listed once in a **"Repeated on many sheets"** block before the per-sheet groups. Sheets with nothing else are summarised in one line at the end ("No other changes on 24 sheets: …").
- Columns: `Sheet`, `Grid` (`-` if none; `old>new` for moved items), `Type` (Added / Removed / Modified / Moved / Resized / Rotated) and `Description` (object kind + detail; text shown as `"old" -> "new"`, long text truncated with `...`).
- The order within a sheet follows the grid (row, then column) so the list reads like the drawing. Rows marked *ignored* are excluded; *reviewed* rows can optionally get a `[x]` marker.

Example:

```
PDF DIFF REPORT
==============================================================
Rev A      A-102_Ground_Floor.pdf      Rev 3   6 pages
Rev B      A-102_Ground_Floor_v2.pdf   Rev 4   7 pages
Generated  2026-10-17 09:30 (Europe/Oslo)
Grid       Border zone on 6/6 sheets, rows A-F, columns 1-4 (high confidence)
Totals     23 changes: 9 added, 5 removed, 9 modified
==============================================================

Sheet A-102 (Rev A p.2 / Rev B p.2) - 9 changes
--------------------------------------------------------------
Sheet A-102  A2–B2   Added     Wall (partition, 14 segments)
Sheet A-102  B2      Added     Door swing (arc)
Sheet A-102  B3      Modified  Text "OFFICE" -> "MEETING"
Sheet A-102  C2      Removed   Column (160x160 solid fill)
Sheet A-102  C2–D2   Removed   Wall (storage partition, 4 segments)
Sheet A-102  D3      Modified  Text "4800" -> "5100"
Sheet A-102  E1–E3   Added     Text "NOTE 7: New partition wall EI30..."
Sheet A-102  F3      Modified  Text "2026-08-14" -> "2026-10-02"
Sheet A-102  F4      Modified  Text "REV 3" -> "REV 4"

Page 4 (Rev B only, no sheet number found) - 1 change
--------------------------------------------------------------
Page 4       -       Added     Page (inserted in Rev B)

Sheet A-104 (Rev A p.4 / Rev B p.5) - 13 changes
--------------------------------------------------------------
Sheet A-104  B3      Removed   Line (wall segment)
...
```

## 7. Highlight color scheme

| Meaning | Color | Usage |
|---|---|---|
| Removed (only in A) | **Red** `#E5484D` | Box/outline on A; red ink in overlay |
| Added (only in B) | **Green** `#30A46C` | Box/outline on B; green ink in overlay |
| Modified | **Amber** `#F5A524` | Both sides |
| Moved | **Blue/violet** `#6E56CF` (optional) | Dashed outline + arrow |
| Unchanged in overlay | Neutral gray, 40% opacity | |

Use semi-transparent fill + solid 1.5 px outline; add patterns/icons for color-blind accessibility, and allow a custom palette.

## 8. Performance for large drawings

- Run parsing and diffing in **Web Workers** (one per page pair, pooled); transfer typed arrays (`Float32Array` coordinates) instead of objects.
- **Tiled rendering** with a zoom-level pyramid; render only visible tiles; offscreen canvas in workers.
- **Spatial index** (flatbush / R-tree) for both matching and hit-testing hover/click on highlights.
- **Caching**: per-file content hash → cached primitives and results in IndexedDB; re-comparing Rev B vs Rev C reuses Rev B's parse.
- Progressive results: first pages first; cap primitive counts and fall back to raster-only for pathological pages (>1M segments), with a notice.
- Server worker path for files above a size threshold (if enabled).

## 9. Milestones

Status (2026-10-18, details in [`docs/HANDOVER.md`](docs/HANDOVER.md) §2): ✅ done · 🟡 partly done · ⬜ not started.

| Phase | Scope | Est. | Status |
|---|---|---|---|
| **0. Spike** ✅ (Python prototype done, §11) | Prove text diff, sampled-geometry vector matching, grid detection and the .txt report on a real drawing set. Next: port the core to PDF.js `getOperatorList()` in a worker and confirm parity on the same files | 1 wk | ✅ done (`cc99b63`, `282669e`) |
| **1. MVP** | Upload 2 PDFs, page pairing **by title-block sheet number, then page order**, title block detection with **folding of repeated changes**, text diff (word + char), raster pixel-diff for graphics, side-by-side view with synced zoom, change list with Text/Graphics filter, red/green/amber, **plain-text change list export** (sheet number from title block or `Page n`; grid column `-`) | 3–4 wks | ✅ done (`3e0edca`; extended in `d963f29`, `cf6bf05`) |
| **2. True vector diff** | **Sampled-geometry matching with tolerance** (KD-tree per style incl. width/dash, clip-aware) + region clustering + **shape pairing into moved/resized/rotated/style-only** + primitive-based descriptions, overlay and slider views, global offset alignment, **grid detection** (border + structural, either label direction, grid coverage in report header), grid refs in the list and the .txt export, manual grid calibration | 4–5 wks | 🟡 partly: **done** in the app: vector layer (box + style + point signature), moved/resized/style-only (fill, stroke, width) pairing with pixel confirmation, offset alignment, border-grid detection (either direction), grid refs in list and export, grid coverage header. **Missing**: sampled-geometry matching with tolerance (prototype only), rotation, dash, clip awareness, overlay/slider views, structural grids, manual grid calibration |
| **3. Documents at scale** | Inserted/deleted page alignment + manual override, workers/tiling/caching, export report PDF | 2–3 wks | ⬜ not started (diffing already runs in workers; inserted/deleted pages are listed) |
| **4. Polish & pro** | Dimension objects (link a dimension value to its extension lines and arrows), precision mode below 1 pt, **change-log vs. drawing cross-check** (§4.9), review/ignore states, shareable sessions, optional server worker, OCR for scans, auth if hosted | ongoing | ⬜ not started |

**Why grid detection goes in phase 2:** it needs the parsed vector primitives (frame, ticks, bubbles, grid lines) and the page alignment, both built in phase 2. The MVP export already has the `Grid` column, filled with `-`, so the format doesn't change when grid detection arrives. It also comes before the scale work in phase 3 because it makes the report much more useful for drawing review.

**Test corpus** (built in phase 0–1, grown continuously):
- **Real revision pairs** (e.g. OpenHornet OHC0003 rev - / A / B / C), including pairs **exported by different CAD/plot versions**, as the noise baseline.
- **Self-compare** (file vs. itself and vs. a re-export with no changes) must give zero changes.
- **Synthetic edits** with known ground truth and known grid cells: added/removed lines, circles and text, style-only changes, and above all **moved geometry** (translated parts, shifted views, moved dimensions). The real test pair had no moved geometry, so that path has not been tested yet.
- Grids in both directions (ISO and ASME), sheets without grids, mixed page sizes, rotated pages.
- Golden-file snapshot tests of the change JSON and the .txt report, plus visual regression of rendered highlights.

## 10. Risks & open questions

- **Scanned PDFs** have no text/vectors → need OCR (Tesseract / cloud) and raster-only diff. In scope for v1?
- **Page shifts / scale** between plots, different page sizes, rotated pages — alignment must be robust or results are noise.
- **Fonts & encodings**: missing ToUnicode maps, Type 3 fonts, text drawn as outlines (CAD exports often do this) → text appears as vectors; may need glyph-shape matching or OCR.
- **CAD export variability** (confirmed in the prototype): the same drawing re-exported reorders and re-tessellates paths (2–3.6× segment count differences). Sampled-geometry matching handled it with zero false positives on 26 sheets. The tolerance may need tuning for very fine detail, where 1 pt could hide a real small change.
- **Licensing**: PDF.js (Apache-2.0), pdf-lib (MIT), pdfium (BSD) are permissive. **PyMuPDF/MuPDF is AGPL** (or commercial license) — avoid in a closed-source hosted product unless licensed. Decide early: open source vs. commercial.
- **Grid detection false positives**: numbered notes, revision tables or schedules can look like label sequences. Mitigate by requiring even spacing and placement near the frame or inside bubbles, showing the detected grid as an overlay, and calibrating manually when needed. Sheets with a scale-dependent or non-uniform grid need the manual fallback.
- **Privacy**: client-side processing by default; if a server path exists, define retention.
- Open: target users (architecture/engineering drawings vs. contracts)? Max file sizes? Hosted SaaS vs. desktop (Tauri/Electron)? Need for annotations/collaboration?

## 11. Prototype findings (OpenHornet OHC0003 test)

A Python prototype (`prototype/pdfdiff.py`, PyMuPDF + SciPy, about 12 s for 26 sheets) was run on two public revisions of the OpenHornet drawing set **OHC0003 "ASSY, KNOBS"**: rev `-` (initial release, Fusion 360 24.2 export) and rev `A` (FN 21 indica/ring change, Fusion 360 25.0 export). Both have 26 sheets: one D-size assembly sheet with a border grid and 25 letter-size part sheets.

| Finding | Consequence for the plan |
|---|---|
| Unchanged views had **2–3.6× different segment counts** between the two exports | Sampled-geometry matching with tolerance is the primary vector method (§4.3) |
| **26 of 28** changes were the REV letter `-` → `A` in every title block | Title block detection + folding of repeated changes (§4.8, §6) |
| Grid columns numbered **right→left**, rows **A at the bottom** (ASME); a fixed edge band missed the row letters | Direction-agnostic labels, band relative to page size (§5.1–5.2) |
| **25 of 26 sheets have no grid** | No-grid is normal; header reports grid coverage (§5.4, §6) |
| Sheet numbers `n/26` paired all pages correctly | Pair by title-block sheet number first (§1.2) |
| Rev A's change log describes an indica change on sheet 22, but only a note + leader were added; the views are identical at 300 dpi | Candidate feature: change-log vs. drawing cross-check (§4.9) |
| Real pair had **no moved geometry**; synthetic added shapes were found in the right cells (C6, B4–B5), self-compare gave 0 changes | Test corpus needs moved-geometry cases (§9) |

Result after folding: 1 repeated title-block change and 2 real changes (sheet 1 `D1–D3` new revision-history row; sheet 22 new paint note), with no false positives.

**Synthetic follow-up** (`prototype/tests/`, 14 pairs, 14 expected changes):
- Coverage: moved (50 / 5 / 2 / 0.5 pt), resized, rotated, dimension edit, moved text, whole-sheet shift, style-only, re-segmented and re-wrapped negative controls, and a view moved on an OpenHornet sheet.
- Before the changes in §4.1, 4.3, 4.5 and 4.7: 2 of 14 right and 20 false positives. After: **14 of 14 right, 0 false positives, all no-change cases clean**.
- Remaining gaps: moves below the 1 pt tolerance are invisible by design, and a dimension's text and geometry come out as two rows. Details are in `prototype/tests/RESULTS.md`.
