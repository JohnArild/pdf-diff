/** Myers O(ND) diff. Returns an edit script of equal / delete / insert runs. */
export type Op = { type: 'equal' | 'delete' | 'insert'; aIndex: number; bIndex: number };

export function myers<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Op[] {
  const n = a.length, m = b.length, max = n + m;
  if (max === 0) return [];
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(a[x], b[y])) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }
  trace.push(v.slice());
  // backtrack
  const ops: Op[] = [];
  let x = n, y = m;
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vv[offset + k - 1] < vv[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = d === 0 ? 0 : vv[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ type: 'equal', aIndex: x, bIndex: y }); }
    if (d === 0) break;
    if (x === prevX) { y--; ops.push({ type: 'insert', aIndex: x, bIndex: y }); }
    else { x--; ops.push({ type: 'delete', aIndex: x, bIndex: y }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ type: 'equal', aIndex: x, bIndex: y }); }
  return ops.reverse();
}

/** Character-level refinement: returns the changed middle of two strings ("REV 3" vs "REV 4" -> "3"/"4"). */
export function charRefine(a: string, b: string): { before: string; after: string; common: number } {
  const ops = myers([...a], [...b]);
  let before = '', after = '', common = 0;
  for (const o of ops) {
    if (o.type === 'equal') common++;
    else if (o.type === 'delete') before += a[o.aIndex];
    else after += b[o.bIndex];
  }
  return { before, after, common };
}
