// Audio-clocked capture. The UI may be hidden while the game is foreground;
// requestAnimationFrame is therefore not a reliable source of audio frames.
class MorseCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1024);
    this.filled = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const count = channels[0].length;
    for (let i = 0; i < count; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.buffer[this.filled++] = sample / channels.length;
      if (this.filled === this.buffer.length) {
        const pcm = this.buffer.slice();
        this.port.postMessage({ time: (currentFrame + i + 1) / sampleRate * 1000, pcm }, [pcm.buffer]);
        this.buffer.copyWithin(0, 512);
        this.filled -= 512;
      }
    }
    return true;
  }
}

registerProcessor('morse-capture', MorseCaptureProcessor);
