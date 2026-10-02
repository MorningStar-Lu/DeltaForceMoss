import { classifyPulses, describePulses } from './morse-codec.js';

// Receives audio-clocked spectral observations. A frequency is only
// accepted after five separated, similarly pitched and rhythmically plausible
// pulses form a valid numeric Morse group.
export class MorseToneDetector {
  constructor() { this.reset(); }

  reset() {
    this.lockedHz = 0;
    this.toneHz = 0;
    this.onCount = 0;
    this.offCount = 0;
    this.toneStarted = 0;
    this.firstToneFrame = 0;
    this.firstOffFrame = 0;
    this.lastToneEnded = 0;
    this.pulses = [];
    this.lastObservation = 0;
    this.awaitingBoundary = false;
    this.boundaryMs = 0;
  }

  process({ time, frequency, peakDb, contrastDb }) {
    if (this.lastObservation && time - this.lastObservation > 180) {
      this.onCount = this.offCount = this.toneStarted = this.firstToneFrame = this.firstOffFrame = 0;
      this.pulses = [];
    }
    this.lastObservation = time;
    if (this.awaitingBoundary) {
      if (time - this.lastToneEnded < this.boundaryMs) return null;
      this.awaitingBoundary = false;
      this.toneHz = 0;
    }
    const nearLocked = !this.lockedHz || Math.abs(frequency - this.lockedHz) <= 70;
    const present = nearLocked && frequency > 0 && peakDb > (this.lockedHz ? -70 : -60)
      && contrastDb > (this.lockedHz ? 14 : 19);
    const nearTone = !this.toneHz || Math.abs(frequency - this.toneHz) <= 70;

    if (present && nearTone) {
      if (!this.toneHz) this.toneHz = frequency;
      if (!this.onCount) this.firstToneFrame = time;
      this.onCount++;
      this.offCount = 0;
      this.firstOffFrame = 0;
      if (!this.toneStarted && this.onCount >= 2) {
        this.toneStarted = this.firstToneFrame;
        this.toneHz = frequency;
      }
      return null;
    }

    this.onCount = 0;
    if (!this.toneStarted) {
      this.toneHz = present ? frequency : 0;
      this.firstToneFrame = 0;
      return null;
    }
    if (!this.offCount) this.firstOffFrame = time;
    if (++this.offCount < 2) return null;

    const duration = this.firstOffFrame - this.toneStarted;
    const gapBefore = this.lastToneEnded ? this.toneStarted - this.lastToneEnded : null;
    const toneHz = this.toneHz;
    this.toneStarted = 0;
    this.toneHz = 0;
    this.firstToneFrame = 0;
    this.firstOffFrame = 0;
    this.offCount = 0;

    if (duration < 35 || duration > 1500) {
      this.pulses = [];
      return { type: 'discard', reason: 'pulse-duration', duration: Math.round(duration), frequency: Math.round(toneHz) };
    }
    const previous = this.pulses;
    const previousGaps = previous.slice(1).map(pulse => pulse.gapBefore).filter(Number.isFinite);
    const estimatedUnit = previousGaps.length
      ? [...previousGaps].sort((a, b) => a - b)[Math.floor(previousGaps.length / 2)]
      : Math.max(35, Math.min(250, (previous[0]?.duration ?? 150) / 2));
    if (previous.length && gapBefore > Math.max(120, estimatedUnit * 2.2)) {
      this.pulses = [];
      this.pulses.push({ duration, gapBefore: null, frequency: toneHz });
      this.lastToneEnded = time;
      return { type: 'uncertain', reason: 'incomplete-group', symbols: describePulses(previous), count: previous.length };
    }
    if (previous.length && Math.abs(toneHz - previous[0].frequency) > 70) {
      this.pulses = [];
      this.pulses.push({ duration, gapBefore: null, frequency: toneHz });
      this.lastToneEnded = time;
      return { type: 'uncertain', reason: 'frequency-jump', symbols: describePulses(previous), count: previous.length };
    }
    this.pulses.push({ duration, gapBefore: this.pulses.length ? gapBefore : null, frequency: toneHz });
    this.lastToneEnded = time;
    if (this.pulses.length < 5) return {
      type: 'progress', count: this.pulses.length, symbols: describePulses(this.pulses),
    };

    const group = this.pulses;
    this.pulses = [];
    const gaps = group.slice(1).map(pulse => pulse.gapBefore);
    const unit = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    this.boundaryMs = Math.max(120, Math.min(600, unit * 2.2));
    this.awaitingBoundary = true;
    const regular = gaps.every(gap => gap >= 25 && gap <= 500)
      && Math.max(...gaps) / Math.min(...gaps) <= 2.4;
    const result = regular ? classifyPulses(group) : null;
    if (!result?.digit) return {
      type: 'uncertain', reason: regular ? 'non-numeric-pattern' : 'irregular-gaps',
      symbols: result?.symbols ?? describePulses(group),
      durations: group.map(pulse => Math.round(pulse.duration)), gaps: gaps.map(Math.round),
    };

    const meanHz = Math.round(group.reduce((sum, pulse) => sum + pulse.frequency, 0) / 5);
    if (!this.lockedHz) this.lockedHz = meanHz;
    return { type: 'digit', digit: result.digit, symbols: result.symbols, frequency: this.lockedHz };
  }
}
