const DIGITS = new Map([
  ['-----', '0'], ['.----', '1'], ['..---', '2'], ['...--', '3'],
  ['....-', '4'], ['.....', '5'], ['-....', '6'], ['--...', '7'],
  ['---..', '8'], ['----.', '9'],
]);

export function decodeDigit(symbols) {
  return DIGITS.get(symbols) ?? null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Display a best-effort dot/dash trace even when a group is incomplete or
// cannot be decoded. Question marks are genuinely undecidable pulses.
export function describePulses(pulses) {
  const gaps = pulses.slice(1).map(pulse => pulse.gapBefore)
    .filter(gap => Number.isFinite(gap) && gap >= 25 && gap <= 900);
  if (!gaps.length) return '?'.repeat(pulses.length);
  const unit = median(gaps);
  return pulses.map(pulse => {
    const ratio = pulse.duration / unit;
    if (ratio >= 0.45 && ratio <= 1.65) return '.';
    if (ratio >= 2.15 && ratio <= 4.8) return '-';
    return '?';
  }).join('');
}

// Morse timing is relative: a dash is about three units, while the gap
// between symbols is about one unit. Unclear timing is left undecoded.
export function classifyPulses(pulses) {
  if (pulses.length !== 5) return null;
  const gaps = pulses.slice(1).map(pulse => pulse.gapBefore)
    .filter(gap => Number.isFinite(gap) && gap >= 25 && gap <= 900);
  if (gaps.length !== 4) return null;
  const candidates = [];
  for (const [symbols, digit] of DIGITS) {
    // FFT windows smear a tone's boundaries: observed pulse = Morse duration
    // + smear, observed silence = one unit - smear. Fit both together instead
    // of treating the shortened silence as the unit itself.
    let aa = 0, ab = 0, bb = 0, ay = 0, by = 0;
    for (let i = 0; i < 5; i++) {
      const factor = symbols[i] === '-' ? 3 : 1;
      aa += factor * factor; ab += factor; bb++;
      ay += factor * pulses[i].duration; by += pulses[i].duration;
    }
    for (const gap of gaps) {
      aa++; ab--; bb++;
      ay += gap; by -= gap;
    }
    const determinant = aa * bb - ab * ab;
    const unit = (ay * bb - ab * by) / determinant;
    const smear = (aa * by - ab * ay) / determinant;
    // An all-dash group can otherwise fit the all-dot model exactly by
    // inventing an implausibly large FFT boundary smear. The 1024-sample
    // analysis window is about 21 ms at 48 kHz, so leave some headroom for
    // gating but reject a 50+ ms offset.
    if (unit < 25 || unit > 350 || smear < -10 || smear > 45) continue;
    let squaredError = 0;
    for (let i = 0; i < 5; i++) {
      const factor = symbols[i] === '-' ? 3 : 1;
      squaredError += (pulses[i].duration - factor * unit - smear) ** 2;
    }
    for (const gap of gaps) squaredError += (gap - unit + smear) ** 2;
    candidates.push({ symbols, digit, error: Math.sqrt(squaredError / 9) / unit });
  }
  candidates.sort((a, b) => a.error - b.error);
  const best = candidates[0], runnerUp = candidates[1];
  if (!best || best.error > 0.55 || (runnerUp && runnerUp.error - best.error < 0.15)) {
    return { symbols: describePulses(pulses), digit: null };
  }
  return { symbols: best.symbols, digit: best.digit };
}
