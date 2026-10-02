export function parseCoachScore(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('//'));
  let bpm = 120;
  if (/^BPM\s*=/i.test(lines[0] || '')) {
    bpm = Number(lines.shift().split('=')[1].trim());
  }
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('BPM 必须在 40–240 之间');
  const tokens = lines.join(' ').split(/[\s,，|]+/).filter(Boolean);
  if (!tokens.length) throw new Error('曲谱不能为空');
  if (tokens.length > 1000) throw new Error('最多导入 1000 个音符');
  let totalBeats = 0;
  const notes = tokens.map((token, index) => {
    const parts = token.split(':');
    if (parts.length > 2) throw new Error(`第 ${index + 1} 个音符格式无效：${token}`);
    const symbol = parts[0];
    const bracketed = symbol.match(/^(【+)(#?[1-7])(】+)$/);
    const parenthesized = symbol.match(/^(\(+)(#?[1-7])(\)+)$/);
    const valid = /^#?[1-7]$|^0$/.test(symbol)
      || (bracketed && bracketed[1].length === bracketed[3].length)
      || (parenthesized && parenthesized[1].length === parenthesized[3].length);
    if (!valid) throw new Error(`第 ${index + 1} 个音符格式无效：${token}`);
    const beats = parts.length === 2 ? Number(parts[1]) : 1;
    if (!Number.isFinite(beats) || beats < 0.25 || beats > 16) {
      throw new Error(`第 ${index + 1} 个音符时值应为 0.25–16 拍`);
    }
    const note = { symbol, beats, startBeat: totalBeats };
    totalBeats += beats;
    return note;
  });
  return { bpm, notes, totalBeats };
}

export class CoachSession {
  constructor(score) {
    this.score = score;
    this.mode = 'auto';
    this.speed = 1;
    this.reset();
  }

  reset() {
    this.running = false;
    this.index = 0;
    this.elapsedMs = 0;
    this.startedAt = 0;
  }

  pause(now) {
    if (!this.running) return;
    if (this.mode === 'auto') this.elapsedMs += Math.max(0, now - this.startedAt);
    this.running = false;
  }

  play(now) {
    if (this.running) return;
    if (this.index >= this.score.notes.length) this.reset();
    this.startedAt = now;
    this.running = true;
  }

  setSpeed(speed, now) {
    const wasRunning = this.running;
    if (wasRunning && this.mode === 'auto') this.pause(now);
    const nextSpeed = Math.max(0.5, Math.min(2, speed));
    this.elapsedMs *= this.speed / nextSpeed;
    this.speed = nextSpeed;
    if (wasRunning && this.mode === 'auto' && this.index < this.score.notes.length) this.play(now);
  }

  setMode(mode, now) {
    this.pause(now);
    this.mode = mode === 'wait' ? 'wait' : 'auto';
    this.reset();
  }

  advance() {
    if (this.mode !== 'wait' || !this.running) return false;
    this.index = Math.min(this.score.notes.length, this.index + 1);
    if (this.index >= this.score.notes.length) this.running = false;
    return true;
  }

  tick(now) {
    let progress = this.index / this.score.notes.length;
    if (this.mode === 'auto') {
      const elapsed = this.elapsedMs + (this.running ? Math.max(0, now - this.startedAt) : 0);
      const beat = elapsed * this.score.bpm * this.speed / 60000;
      progress = Math.min(1, beat / this.score.totalBeats);
      while (this.index < this.score.notes.length
        && beat >= this.score.notes[this.index].startBeat + this.score.notes[this.index].beats) this.index++;
      if (this.index >= this.score.notes.length) {
        this.elapsedMs = this.score.totalBeats * 60000 / (this.score.bpm * this.speed);
        this.running = false;
      }
    }
    return {
      index: this.index,
      running: this.running,
      finished: this.index >= this.score.notes.length,
      progress,
    };
  }
}
