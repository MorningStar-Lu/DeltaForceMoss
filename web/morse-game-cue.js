import { decodeDigit } from './morse-codec.js';

// Game recordings show a narrow 4 kHz-range cue with ~50 ms dots and ~140 ms
// dashes. Its between-symbol silence is much longer than textbook Morse, so
// use an independent cadence decoder instead of the conventional timing fit.
export class MorseGameCueDecoder {
  constructor() { this.reset(); }

  reset() {
    this.onCount = this.offCount = 0;
    this.firstOn = this.firstOff = 0;
    this.toneStarted = this.toneHz = 0;
    this.lastToneEnded = this.lastObservation = 0;
    this.pulses = [];
    this.digits = '';
    this.sequenceStarted = 0;
    this.previousCode = '';
    this.previousEnd = 0;
    this.acquired = false;
  }

  observe(time, bins, hzPerBin) {
    if (this.lastObservation && time - this.lastObservation > 180) {
      this.onCount = this.offCount = this.toneStarted = 0;
      this.pulses = [];
    }
    this.lastObservation = time;
    const low = Math.ceil(4100 / hzPerBin);
    const high = Math.min(Math.floor(4400 / hzPerBin), bins.length - 1);
    if (high < low) return null;
    let bin = low;
    for (let i = low + 1; i <= high; i++) if (bins[i] > bins[bin]) bin = i;
    const peak = bins[bin];
    let noise = 0, count = 0;
    for (let offset = -28; offset <= 28; offset++) {
      if (Math.abs(offset) < 8) continue;
      const i = bin + offset;
      if (i >= 0 && i < bins.length) { noise += bins[i]; count++; }
    }
    const frequency = bin * hzPerBin;
    const present = peak > -50 && peak - noise / Math.max(1, count) > 30
      && (!this.toneHz || Math.abs(frequency - this.toneHz) <= 120);
    if (present) {
      if (!this.onCount) this.firstOn = time;
      this.onCount++;
      this.offCount = 0;
      if (!this.toneStarted && this.onCount >= 2) {
        this.toneStarted = this.firstOn;
        this.toneHz = frequency;
      }
      return null;
    }
    this.onCount = 0;
    if (!this.toneStarted) { this.toneHz = 0; return null; }
    if (!this.offCount) this.firstOff = time;
    if (++this.offCount < 2) return null;
    const duration = this.firstOff - this.toneStarted;
    const start = this.toneStarted;
    this.toneStarted = this.toneHz = this.offCount = 0;
    if (duration < 30 || duration > 230) return null;

    const gap = this.lastToneEnded ? start - this.lastToneEnded : Infinity;
    this.lastToneEnded = this.firstOff;
    if (gap > 440) {
      this.pulses = [];
      if (gap > 1200) { this.digits = ''; this.sequenceStarted = 0; }
    }
    if (!this.pulses.length && !this.sequenceStarted) this.sequenceStarted = start;
    const symbol = duration < 95 ? '.' : duration >= 110 ? '-' : '?';
    this.pulses.push({ symbol, duration, start, frequency });
    if (this.pulses.length === 3) {
      const starts = this.pulses.map(pulse => pulse.start);
      const cadence = starts[1] - starts[0] >= 180 && starts[1] - starts[0] <= 520
        && starts[2] - starts[1] >= 180 && starts[2] - starts[1] <= 520;
      if (!cadence) { this.pulses = []; return null; }
      this.acquired = true;
    }
    if (this.pulses.length < 5) return this.acquired
      ? { type: 'progress', symbols: this.pulses.map(pulse => pulse.symbol).join(''), frequency: Math.round(frequency) }
      : null;

    const symbols = this.pulses.map(pulse => pulse.symbol).join('');
    const digit = decodeDigit(symbols);
    this.pulses = [];
    if (!digit) {
      this.digits = '';
      this.sequenceStarted = 0;
      return { type: 'uncertain', symbols, reason: 'game-cue-ambiguous' };
    }
    this.digits += digit;
    const event = { type: 'digit', digit, symbols, frequency: Math.round(frequency) };
    if (this.digits.length === 3) {
      const repeated = this.previousCode === this.digits
        && this.sequenceStarted - this.previousEnd >= 1200
        && this.sequenceStarted - this.previousEnd <= 3500;
      event.code = this.digits;
      event.repeated = repeated;
      this.previousCode = this.digits;
      this.previousEnd = this.firstOff;
      this.digits = '';
      this.sequenceStarted = 0;
    }
    return event;
  }
}
