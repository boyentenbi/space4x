// Threshold-based background removal for sprite PNGs.
//
// The generator prompts all star/planet/icon sprites against a "pure black
// space background". This pass converts dark pixels to transparent so the
// sprites composite cleanly on the game canvas, with a narrow feather band
// at the edges so glow/haloes don't cut off abruptly.

import { PNG } from "pngjs";

const DEFAULTS = {
  fullTransparentBelow: 16,  // luminance <= this → alpha 0
  fullOpaqueAbove: 48,       // luminance >= this → alpha unchanged
  // Between the thresholds we linearly ramp alpha so glows feather out.
};

// Apply to a Buffer of PNG bytes; returns a new Buffer.
export function alphaMaskBuffer(inputBuffer, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const png = PNG.sync.read(inputBuffer);
  const { data, width, height } = png;
  const result = new PNG({ width, height });
  const out = result.data;
  const lo = cfg.fullTransparentBelow;
  const hi = cfg.fullOpaqueAbove;
  const range = hi - lo;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    // Perceptual-ish luminance.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    let alpha;
    if (lum <= lo) alpha = 0;
    else if (lum >= hi) alpha = a;
    else alpha = Math.round((a * (lum - lo)) / range);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = alpha;
  }
  return PNG.sync.write(result);
}
