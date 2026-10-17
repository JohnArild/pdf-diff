#!/usr/bin/env python3
"""Run the prototype on the synthetic pairs and score it against the ground truth.

usage: run_tests.py <cases_dir> [--before path/to/old_pdfdiff.py] [--render <dir>]
Prints a markdown table and writes <cases_dir>/results.json.
"""
import sys, os, json, argparse, importlib.util, re

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m); return m

def cells_of(ref):
    """'C4' | 'C4–D5' | 'B2>B3' | 'B2–C3>B3–C4' -> list of (rowset, colset) predicates"""
    out = []
    for part in ref.split('>'):
        m = re.fullmatch(r'([A-Z])(\d+)(?:–([A-Z])(\d+))?', part)
        if not m: continue
        r0, c0 = m.group(1), int(m.group(2)); r1, c1 = (m.group(3) or r0), int(m.group(4) or c0)
        out.append((min(r0, r1), max(r0, r1), min(c0, c1), max(c0, c1)))
    return out

def contains(ref, cell):
    if not cell: return True
    r, c = cell[0], int(cell[1:])
    return any(a <= r <= b and x <= c <= y for a, b, x, y in cells_of(ref))

KIND = {'moved': lambda ch: ch['op'] == 'Moved',
        'resized': lambda ch: ch['op'] == 'Resized',
        'rotated': lambda ch: ch['op'] == 'Rotated',
        'style': lambda ch: ch['desc'].startswith('Style only'),
        'text': lambda ch: 'Text' in ch['desc'] and ch['op'] == 'Modified',
        'geometry': lambda ch: ch['desc'].startswith('Geometry'),
        'modified': lambda ch: True}

def evaluate(mod, case, d):
    da, db, sheets = mod.compare(os.path.join(d, 'A.pdf'), os.path.join(d, 'B.pdf'), 'A', 'B')
    chs = [c for s in sheets for c in s['changes']]
    used, res = set(), []
    for e in case['expect']:
        hit = None
        for i, c in enumerate(chs):
            if i in used: continue
            if (contains(c['ref'], e.get('cellB')) or contains(c['ref'], e.get('cellA'))) if e.get('cellB') else True:
                if hit is None or (KIND[e['kind']](c) and not KIND[e['kind']](chs[hit])): hit = i
        if hit is not None:
            used.add(hit); c = chs[hit]
            res.append(dict(expect=e, got=f"{c['op']} {c['ref']}: {c['desc']}", detected=True,
                            classified=KIND[e['kind']](c), grid_ok=(contains(c['ref'], e.get('cellB')) or contains(c['ref'], e.get('cellA')))))
        else:
            res.append(dict(expect=e, got=None, detected=False, classified=False, grid_ok=False))
    fps = [f"{c['op']} {c['ref']}: {c['desc']}" for i, c in enumerate(chs) if i not in used]
    off = [s.get('offset') for s in sheets if s.get('offset') and s['offset'] != (0.0, 0.0)]
    return dict(results=res, false_pos=fps, n=len(chs), offset=off[0] if off else None), (da, db, sheets)

def summarize(r):
    if not r['results'] and not r['false_pos']: return 'no changes ✅'
    parts = []
    for x in r['results']:
        if not x['detected']: parts.append('missed ❌')
        else:
            g = x['got'].split(':')[0]
            parts.append(f"{g} {'✅' if x['classified'] and x['grid_ok'] else ('⚠️ class' if not x['classified'] else '⚠️ grid')}")
    if r['false_pos']: parts.append(f"{len(r['false_pos'])} false pos ❌")
    if r.get('offset'): parts.append(f"offset ({r['offset'][0]:+.1f}, {r['offset'][1]:+.1f}) compensated")
    return '; '.join(parts)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('cases'); ap.add_argument('--before'); ap.add_argument('--render')
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    after = load(os.path.join(here, '..', 'pdfdiff.py'), 'pdfdiff_after')
    before = load(a.before, 'pdfdiff_before') if a.before else None
    cases = json.load(open(os.path.join(a.cases, 'cases.json')))
    out = []
    print('| Case | Change | Expected | Before | After |\n|---|---|---|---|---|')
    for c in cases:
        d = os.path.join(a.cases, c['name'])
        exp = '; '.join(f"{e['kind']} {e.get('cellB') or ''} {('(' + e['note'] + ')') if e.get('note') else ''}".strip() for e in c['expect']) or ('none' + (f" ({c['note']})" if c.get('note') else ''))
        rb = evaluate(before, c, d)[0] if before else None
        ra, (da, db, sheets) = evaluate(after, c, d)
        out.append(dict(case=c['name'], desc=c['desc'], grid=c['grid'], expected=exp, before=rb, after=ra))
        print(f"| {c['name']} ({c['grid'] or '-'}) | {c['desc']} | {exp} | {summarize(rb) if rb else ''} | {summarize(ra)} |")
        if a.render:
            os.makedirs(a.render, exist_ok=True)
            for s in sheets:
                if s['changes'] and s['ia'] is not None and s['ib'] is not None:
                    after.render(da, db, s, os.path.join(a.render, f"{c['name']}.png"), target_w=900 if da[0].rect.width < 1000 else 1500)
    json.dump(out, open(os.path.join(a.cases, 'results.json'), 'w'), indent=1, default=str)
