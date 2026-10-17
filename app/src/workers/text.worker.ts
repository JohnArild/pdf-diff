/// <reference lib="webworker" />
import { textStage } from '../lib/engine-core';
import type { DocData } from '../lib/types';

self.onmessage = (e: MessageEvent<{ a: DocData; b: DocData }>) => {
  try {
    self.postMessage({ ok: true, result: textStage(e.data.a, e.data.b) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
