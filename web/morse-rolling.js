import { classifyPulses } from './morse-codec.js';

const FREQUENCIES = Array.from({ length: 62 }, (_, index) => 400 + index * 75);
const MAX_WINDOW_MS = 30000;

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function extractPulses(frames, channel, threshold) {
  const active = frames.map(frame => frame.levels[channel] > threshold);
  // A single dropped frame should not split a short game cue in two.
  for (let i = 1; i < active.length - 1; i++) {
    if (!active[i] && active[i - 1] && active[i + 1]) active[i] = true;
  }
  const pulses = [];
  let start = -1;
  for (let i = 0; i <= active.length; i++) {
    if (active[i] && start < 0) start = i;
    if ((!active[i] || i === active.length) && start >= 0) {
      const end = i < frames.length ? frames[i].time : frames.at(-1).time + 20;
      const duration = end - frames[start].time;
      if (duration >= 35 && duration <= 900) {
        pulses.push({
          start: frames[start].time,
          end,
          duration,
          gapBefore: pulses.length ? frames[start].time - pulses.at(-1).end : null,
        });
      }
      start = -1;
    }
  }
  return pulses;
}

function decodeSequence(pulses, start) {
  const groups = [0, 5, 10].map(offset => pulses.slice(start + offset, start + offset + 5));
  if (groups.some(group => group.length !== 5)) return null;
  const decoded = groups.map(group => classifyPulses(group));
  if (decoded.some(result => !result?.digit)) return null;
  const insideGaps = groups.flatMap(group => group.slice(1).map(pulse => pulse.gapBefore));
  if (insideGaps.some(gap => !Number.isFinite(gap) || gap < 25 || gap > 500)) return null;
  const sortedGaps = [...insideGaps].sort((a, b) => a - b);
  const unit = percentile(sortedGaps, 0.5);
  if (sortedGaps.at(-1) > unit * 2.5) return null;
  const boundaries = [pulses[start + 5].gapBefore, pulses[start + 10].gapBefore];
  if (boundaries.some(gap => gap < unit * 1.4 || gap > Math.max(850, unit * 8))) return null;
  return {
    code: decoded.map(result => result.digit).join(''),
    start: groups[0][0].start,
    end: groups[2][4].end,
  };
}

export class RollingMorseDecoder {
  constructor() { this.reset(); }

  reset() {
    this.frames = [];
    this.lastFrame = -Infinity;
    this.lastAnalysis = -Infinity;
    this.lastCandidate = '';
    this.lastConfirmed = '';
    this.lastConfirmedEnd = -Infinity;
  }

  observe(time, bins, hzPerBin) {
    if (time - this.lastFrame < 20) return null;
    this.lastFrame = time;
    const levels = FREQUENCIES.map(hz => {
      const center = Math.round(hz / hzPerBin);
      let peak = -160;
      for (let bin = Math.max(0, center - 2); bin <= Math.min(bins.length - 1, center + 2); bin++) {
        peak = Math.max(peak, bins[bin]);
      }
      return Number.isFinite(peak) ? peak : -160;
    });
    this.frames.push({ time, levels });
    while (this.frames.length && time - this.frames[0].time > MAX_WINDOW_MS) this.frames.shift();
    if (this.frames.length < 120 || time - this.lastAnalysis < 1000) return null;
    this.lastAnalysis = time;
    return this.analyze();
  }

  analyze() {
    const candidates = [];
    for (let channel = 0; channel < FREQUENCIES.length; channel++) {
      // Keep digital silence as the off-state; removing it makes a clean
      // Morse recording look like a constant tone with no dynamic range.
      const sorted = this.frames.map(frame => frame.levels[channel]).sort((a, b) => a - b);
      if (sorted.length < 80) continue;
      const floor = percentile(sorted, 0.2);
      const ceiling = percentile(sorted, 0.9);
      if (ceiling - floor < 12 || ceiling < -75) continue;
      for (const fraction of [0.42, 0.55, 0.68]) {
        const threshold = floor + (ceiling - floor) * fraction;
        const pulses = extractPulses(this.frames, channel, threshold);
        if (pulses.length < 15) continue;
        for (let start = 0; start <= pulses.length - 15; start++) {
          const candidate = decodeSequence(pulses, start);
          if (candidate) candidates.push({ ...candidate, frequency: FREQUENCIES[channel] });
        }
      }
    }
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const first = candidates[i], second = candidates[j];
        const firstDuration = first.end - first.start;
        const secondDuration = second.end - second.start;
        if (first.code !== second.code || first.frequency !== second.frequency
          || second.start - first.end < 1200
          || second.start - first.end > 3000
          || Math.abs(firstDuration - secondDuration) > firstDuration * 0.2) continue;
        if (this.lastConfirmed === first.code && second.end - this.lastConfirmedEnd < 5000) continue;
        this.lastConfirmed = first.code;
        this.lastConfirmedEnd = second.end;
        return { type: 'confirmed', code: first.code, frequency: first.frequency };
      }
    }
    const recent = candidates.at(-1);
    if (recent && recent.code !== this.lastCandidate) {
      this.lastCandidate = recent.code;
      return { type: 'candidate', code: recent.code, frequency: recent.frequency };
    }
    return null;
  }
}
