import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachSession, parseCoachScore } from './coach-core.js';

test('reads exported TXT and optional note duration', () => {
  const score = parseCoachScore('BPM=100\n1 #2 【3】 (4) 0:0.5');
  assert.equal(score.bpm, 100);
  assert.deepEqual(score.notes.map(note => note.symbol), ['1', '#2', '【3】', '(4)', '0']);
  assert.equal(score.totalBeats, 4.5);
  assert.equal(score.notes[4].startBeat, 4);
});

test('rejects malformed scores without silently changing notes', () => {
  assert.throws(() => parseCoachScore('BPM=900\n1 2'), /BPM/);
  assert.throws(() => parseCoachScore('BPM=120\n1 X 3'), /第 2 个音符/);
  assert.throws(() => parseCoachScore('BPM=120\n1:0'), /时值/);
});

test('automatic timing preserves position across pause and speed changes', () => {
  const session = new CoachSession(parseCoachScore('BPM=120\n1 2 3 4'));
  session.play(0);
  assert.equal(session.tick(500).index, 1);
  session.pause(750);
  assert.equal(session.tick(1750).index, 1);
  session.setSpeed(2, 1750);
  session.play(1750);
  assert.equal(session.tick(1875).index, 2);
  assert.equal(session.tick(2375).finished, true);
});

test('wait mode moves only on explicit advancement', () => {
  const session = new CoachSession(parseCoachScore('BPM=120\n1 2'));
  session.setMode('wait', 0);
  session.play(0);
  assert.equal(session.tick(90000).index, 0);
  assert.equal(session.advance(), true);
  assert.equal(session.tick(90001).index, 1);
  assert.equal(session.advance(), true);
  assert.equal(session.tick(90002).finished, true);
});
