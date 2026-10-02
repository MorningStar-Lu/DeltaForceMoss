export function detectPitch(samples, sampleRate) {
  let sum = 0;
  for (const value of samples) sum += value * value;
  if (Math.sqrt(sum / samples.length) < 0.015) return null;
  const minLag = Math.floor(sampleRate / 1047);
  const maxLag = Math.min(Math.floor(sampleRate / 82), samples.length / 2);
  let bestLag = 0, bestScore = 0;
  let previous = 0, beforePrevious = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0, left = 0, right = 0;
    for (let index = 0; index < samples.length - lag; index++) {
      const a = samples[index], b = samples[index + lag];
      dot += a * b; left += a * a; right += b * b;
    }
    const score = dot / Math.sqrt(left * right || 1);
    if (previous > 0.90 && previous >= beforePrevious && previous > score) {
      bestLag = lag - 1;
      bestScore = previous;
      break;
    }
    if (score > bestScore) { bestScore = score; bestLag = lag; }
    beforePrevious = previous;
    previous = score;
  }
  if (bestScore < 0.85) return null;
  const frequency = sampleRate / bestLag;
  return { frequency, midi: Math.round(69 + 12 * Math.log2(frequency / 440)) };
}

const degrees = ['1', '#1', '2', '#2', '3', '4', '#4', '5', '#5', '6', '#6', '7'];
export function toJianpu(midi) {
  const relative = midi - 60;
  const octave = Math.floor(relative / 12);
  const note = degrees[((relative % 12) + 12) % 12];
  if (octave > 0) return `${'【'.repeat(octave)}${note}${'】'.repeat(octave)}`;
  if (octave < 0) return `${'('.repeat(-octave)}${note}${')'.repeat(-octave)}`;
  return note;
}
