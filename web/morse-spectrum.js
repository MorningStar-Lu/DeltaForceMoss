const SIZE = 1024;
const WINDOW = Float32Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1)));

// Hann-windowed FFT, normalized so a full-scale sine is approximately 0 dB.
export function spectrumDb(pcm) {
  if (pcm.length !== SIZE) throw new RangeError(`Expected ${SIZE} audio samples`);
  const real = new Float32Array(SIZE);
  const imag = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) real[i] = pcm[i] * WINDOW[i];
  for (let i = 1, j = 0; i < SIZE; i++) {
    let bit = SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const value = real[i]; real[i] = real[j]; real[j] = value;
    }
  }
  for (let size = 2; size <= SIZE; size <<= 1) {
    const half = size >> 1;
    for (let start = 0; start < SIZE; start += size) {
      for (let offset = 0; offset < half; offset++) {
        const angle = -2 * Math.PI * offset / size;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const even = start + offset, odd = even + half;
        const re = real[odd] * cos - imag[odd] * sin;
        const im = real[odd] * sin + imag[odd] * cos;
        real[odd] = real[even] - re;
        imag[odd] = imag[even] - im;
        real[even] += re;
        imag[even] += im;
      }
    }
  }
  const db = new Float32Array(SIZE / 2);
  for (let i = 0; i < db.length; i++) {
    const magnitude = Math.hypot(real[i], imag[i]) / (SIZE / 4);
    db[i] = Math.max(-160, 20 * Math.log10(Math.max(magnitude, 1e-8)));
  }
  return db;
}
