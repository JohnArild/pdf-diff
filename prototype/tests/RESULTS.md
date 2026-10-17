# Synthetic test results: moved / resized / rotated geometry

Generated with `make_synthetic.py` and scored with `run_tests.py` (2026-10-17).

- Cases 01–09 are self-drawn A4-landscape sheets with a border grid. ISO = columns 1→8 left to right, rows A→F top to bottom. ASME = columns 8→1, rows F→A, with A at the bottom.
- Cases 10–12 are built from the OpenHornet OHC0003 rev A sheets (CC BY-NC-SA 4.0). These derived PDFs are generated on the fly and are not committed.
- **Before** = prototype at commit `cc99b63`. **After** = the current `pdfdiff.py`.
- ✅ = detected, classified as expected, and the grid ref contains the expected cell (centre of the changed shape). ⚠️ class = found but classified as a generic Modified/Removed/Added. A false positive (❌) is a reported change with no matching ground-truth entry.

```bash
cd prototype && ./fetch_samples.sh            # only needed for cases 10-12
.venv/bin/python tests/make_synthetic.py tests/out
.venv/bin/python tests/run_tests.py tests/out [--before old_pdfdiff.py] [--render tests/renders]
```

| Case | Change | Expected | Before | After |
|---|---|---|---|---|
| 01_move_large (iso) | Bracket moved +50 pt in x | moved B3 (dx=+50) | Modified B2–C3 ⚠️ class | Moved B2>B3 ✅ |
| 02a_move_0.5pt (asme) | Circle moved +0.5 pt in x and y | none (below 1 pt tolerance: not expected to be detected) | no changes ✅ | no changes ✅ |
| 02b_move_2pt (asme) | Circle moved +2 pt in x and y | moved C4 (dx=dy=+2) | Modified C3–D4 ⚠️ class | Moved C4 ✅ |
| 02c_move_5pt (asme) | Circle moved +5 pt in x and y | moved C4 (dx=dy=+5) | Modified C3–D4 ⚠️ class | Moved C4 ✅ |
| 03_resize (iso) | Circle radius +10 %, rectangle scaled 1.2x about centre | resized D5 (x1.10); resized B7 (x1.20) | Modified C5–D6 ⚠️ class; Modified B6–C7 ⚠️ class | Resized D5 ✅; Resized B7 ✅ |
| 04_dimension (asme) | Dimension 100.0 -> 120.0 with extension line moved | text B4 (text 100.0 -> 120.0); geometry B3 (extension line + arrow moved +20) | Modified B4 ✅; Modified A3–B4 ✅ | Modified B4 ✅; Moved B4>B3 ✅ |
| 05_text_moved (iso) | Notes block moved +60 pt down | moved B1 (text dy=+60) | Removed A1–A2 ⚠️ class; 1 false pos ❌ | Moved A1>B1 ✅ |
| 06_rotated (asme) | Hexagon rotated 15 deg, bracket rotated 90 deg | rotated B5 (15 deg (hexagon: 6-fold symmetric, 15 == -45)); rotated E7 (90 deg) | Modified B5–B6 ⚠️ class; Modified D6–E7 ⚠️ class; 1 false pos ❌ | Rotated B5 ✅; Rotated E7 ✅ |
| 07_sheet_shift (iso) | Whole sheet (frame, grid, all content) shifted by (+3, -2) pt | none (should be compensated by page alignment) | 1 false pos ❌ | no changes ✅ |
| 08_style_only (asme) | Line 1 colour black->red, line 2 width 0.5->1.5, line 3 dash pattern changed | style F4 (colour); style E4 (width); style E4 (dash) | Modified F3–F5 ⚠️ class; missed ❌; missed ❌ | Modified F4 ✅; Modified E4 ✅; Modified E4 ✅ |
| 09_negative_resegmented (iso) | Identical geometry, every edge split in two, circles as 96-gons instead of Beziers | none (negative control) | no changes ✅ | no changes ✅ |
| 10_oh_view_moved (-) | OHC0003 sheet 22: top view "VIEW A-A" (geometry + text) moved +60 pt right | moved  (dx=+60, no grid on sheet) | Added - ⚠️ class; 16 false pos ❌ | Moved - ✅ |
| 11_oh_sheet_shift (oh) | OHC0003 sheet 1 (D-size, ASME grid) re-placed with (+4, +3) pt offset | none (should be compensated by page alignment) | 1 false pos ❌ | no changes ✅ |
| 12_oh_negative_rewrapped (oh) | OHC0003 sheet 1 re-wrapped as a Form XObject (different content stream, same geometry) | none (negative control) | no changes ✅ | no changes ✅ |

**Summary:**
- Before: 2 of 14 expected changes fully right, 3 of 5 no-change cases clean, 20 false positives.
- After: **14 of 14 right, all 5 no-change cases clean (0.5 pt move, re-segmented, re-wrapped, two sheet shifts), 0 false positives.**
- The real OHC0003 rev -→A pair gives the same report as before (1 repeated title-block change + 2 real changes).

## What the "after" prototype reports (verbatim)

| Case | Reported |
|---|---|
| 01 | `Moved  B2>B3  Geometry moved dx=+50.0 dy=+0.0 pt` |
| 02b / 02c | `Moved  C4  Geometry moved dx=+2.0 dy=+2.0 pt` / `dx=+5.0 dy=+5.0 pt` |
| 03 | `Resized  D5  Geometry resized x1.10`, `Resized  B7  Geometry resized x1.20` |
| 04 | `Modified  B4  Text "100.0" -> "120.0"`, `Moved  B4>B3  Geometry moved dx=+20.0 dy=+0.0 pt + other edits` |
| 05 | `Moved  A1>B1  Text "NOTES: 1. DEBURR ALL EDGES...." moved dx=+0.0 dy=+60.0 pt` |
| 06 | `Rotated  B5  Geometry rotated +15 deg about (330, 420)`, `Rotated  E7  Geometry rotated +90 deg about (190, 190)` |
| 07 / 11 | no changes; header: `Alignment  sheet 1/1: B offset dx=+3.0 dy=-2.0 pt (compensated)` (11: `+4.0, +3.0`) |
| 08 | `Style only: colour (0,0,0) -> (0.85,0.1,0.1)`, `width 0.5 -> 1.5`, `dash [ 4 2 ] 0 -> [ 8 3 ] 0` |
| 10 | `Moved  -  Geometry moved dx=+60.0 dy=+0.0 pt, with text "Ø.1345 .14 8-32 UNC -..." + other edits` |

## Changes to the prototype

1. **Clip-aware vector extraction.** Scissor clips from `get_drawings(extended=True)` are honoured, and samples outside the active clip are dropped. Before, case 10 (content placed through clipped Form XObjects, like CAD viewports) produced 16 false positives from geometry that is not visible.
2. **Style key includes line width and dash pattern.** Before, width-only and dash-only changes were invisible (case 08).
3. **Sub-path granularity.** Each drawing is split into connected sub-paths. One PDF path object often holds many shapes (all shapes drawn in one `finish()`, or Fusion's large compound paths).
4. **Shape pairing.** Sub-paths that are mostly unmatched are clustered into groups, and each removed group is fitted against each added group with a similarity transform:
   - scale from the RMS radius
   - rotation by a coarse 3° search, then a 0.25° refinement on the mean distance; among near-equal fits the smallest angle wins (for symmetric shapes)
   - translation by ICP (median)

   A pair is accepted when at least 85 % of the samples match within 1.5 pt both ways. It is classified as **Moved (dx, dy)**, **Resized (×s)**, **Rotated (θ about pivot)** or **Style only (colour / width / dash)**. Unmatched leftovers (e.g. a longer centre line) are reported as "+ other edits".
5. **Moved text.** Removed and added words with the same text vote on a common offset, and the winning offset becomes one "Text … moved" change.
6. **Page alignment.** A global offset is estimated from the median displacement of words that are unique on both pages, then **verified against the geometry**: it is only accepted if it raises the vector match rate by ≥10 points. It is compensated in the text, vector and raster comparison and in the renders. Without the verification, case 05 was mis-aligned, because most unique words were in the moved notes block.
7. **Grid refs for moved items** use the centre cell on each side, `old>new` (e.g. `B2>B3`).
8. **Report:** an `Alignment` header line, and totals include moved/resized/rotated.

## Known limits

- **Tolerance floor:** moves below the 1 pt match tolerance (case 02a, 0.5 pt) are not reported, by design. Sub-tolerance changes need an explicit "precision" mode with a smaller tolerance and a denser sampling step.
- **Dimensions are not treated as one object.** In case 04 the text change and the moved extension line/arrow come out as two rows. Linking a dimension value to its geometry (by proximity and leader/arrow topology) is future work.
- Pairing is greedy and O(n·m) over changed groups. That is fine for a handful of changes per sheet, but would need a spatial pre-filter for heavy rework.
- The text-based offset needs ≥5 unique words; sheets without text fall back to no alignment (a vector or raster phase correlation would cover them).
- Case 10's "+ other edits" comes from the generator: the clip boundary cuts through "SCALE 2:1", leaving half of it in place.

## Renders (`renders/`)

`01_move_large.png`, `06_rotated.png`, `08_style_only.png`, `10_oh_view_moved.png`. Rev A (old) is on the left and Rev B (new) on the right. Violet = moved/resized/rotated, amber = modified. The renders in this folder show derived OpenHornet sheets (case 10) and are shared under CC BY-NC-SA 4.0 with attribution, as described in the README.
