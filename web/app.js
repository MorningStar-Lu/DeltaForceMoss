import { detectPitch, toJianpu } from './pitch.js';
import { initThemeSwitcher } from './theme.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#visualizer');
const context2d = canvas.getContext('2d');
const button = $('#listenBtn');
let current = null;
let frame = 0;
let candidate = null;
let stableFrames = 0;
let lastNote = null;
let lastCheck = 0;
let toastTimer = 0;
let lastCapture = [];

initThemeSwitcher();

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2600);
}
function resize() {
  const ratio = devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  context2d.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener('resize', resize);
resize();
function activity(message) {
  const list = $('#activityList');
  if (list.querySelector('.activity-empty')) list.replaceChildren();
  const row = document.createElement('div');
  row.className = 'activity-row';
  const icon = document.createElement('b');
  icon.textContent = '◉';
  const label = document.createElement('span');
  label.textContent = message;
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  row.append(icon, label, time);
  list.prepend(row);
  while (list.children.length > 8) list.lastElementChild.remove();
}
function updateScore() {
  const notes = current?.notes || lastCapture;
  $('#noteCount').textContent = `${notes.length} 个音符`;
  $('#noteOutput').textContent = notes.length
    ? notes.map(note => toJianpu(note.midi)).join(' ')
    : '开始监听后，识别出的单音旋律会显示在这里。';
  $('#exportBtn').disabled = notes.length === 0;
}
function setActive(active, label = '监听中') {
  $('#emptyState').classList.toggle('hidden', active);
  $('#status').classList.toggle('live', active);
  $('#status').innerHTML = active ? `<i></i>${label}` : '<i></i>待机';
  button.classList.toggle('listening', active);
  button.innerHTML = active ? '<span>■</span> 停止监听' : '<span>▶</span> 开始监听';
}
function draw() {
  if (!current) return;
  const { analyser, audioContext, startedAt } = current;
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  context2d.clearRect(0, 0, width, height);

  // 动态读取当前赛博液态主题的色彩
  const computed = getComputedStyle(document.documentElement);
  const priColor = computed.getPropertyValue('--accent-primary').trim() || '#00f0ff';
  const secColor = computed.getPropertyValue('--accent-secondary').trim() || '#ff007f';

  // 绘制中心细准线
  context2d.beginPath();
  context2d.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  context2d.lineWidth = 1;
  context2d.moveTo(0, height / 2);
  context2d.lineTo(width, height / 2);
  context2d.stroke();

  // 赛博液态渐变波形
  const gradient = context2d.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, priColor);
  gradient.addColorStop(0.5, secColor);
  gradient.addColorStop(1, priColor);

  context2d.beginPath();
  context2d.strokeStyle = gradient;
  context2d.lineWidth = 2.2;
  context2d.shadowBlur = 14;
  context2d.shadowColor = priColor;
  samples.forEach((value, index) => {
    const x = index / (samples.length - 1) * width;
    const y = (1 - value) * height / 2;
    if (index) context2d.lineTo(x, y); else context2d.moveTo(x, y);
  });
  context2d.stroke();
  context2d.shadowBlur = 0;
  const elapsed = Math.floor((performance.now() - startedAt) / 1000);
  $('#timecode').textContent = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor(elapsed / 60) % 60).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  if (performance.now() - lastCheck >= 100) {
    lastCheck = performance.now();
    const pitch = detectPitch(samples, audioContext.sampleRate);
    const midi = pitch?.midi ?? null;
    $('#currentNote').textContent = midi === null ? '—' : toJianpu(midi);
    $('#frequency').textContent = pitch ? `${Math.round(pitch.frequency)} Hz` : '等待稳定音高';
    if (midi === candidate) stableFrames++; else { candidate = midi; stableFrames = 1; }
    if (midi !== null && stableFrames >= 3 && midi !== lastNote) {
      lastNote = midi;
      current.notes.push({ midi, at: performance.now() - startedAt });
      updateScore();
      activity(`识别到 ${toJianpu(midi)}`);
    }
    if (midi === null && stableFrames >= 3) lastNote = null;
  }
  frame = requestAnimationFrame(draw);
}
async function stop() {
  if (!current) return;
  const ended = current;
  current = null;
  lastCapture = ended.notes;
  cancelAnimationFrame(frame);
  ended.stream?.getTracks().forEach(track => track.stop());
  if (ended.audio) { ended.audio.pause(); ended.audio.removeAttribute('src'); ended.audio.load(); }
  if (ended.url) URL.revokeObjectURL(ended.url);
  await ended.audioContext.close();
  setActive(false);
  $('#currentNote').textContent = '—';
  $('#frequency').textContent = '等待稳定音高';
  $('#latency').textContent = '-- MS';
  $('#sampleRate').textContent = '-- KHZ';
  $('#timecode').textContent = '00:00:00';
  candidate = lastNote = null;
  stableFrames = 0;
  activity('监听已停止');
}
async function start({ stream = null, file = null, label }) {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  let audio = null, url = null;
  try {
    if (file) {
      url = URL.createObjectURL(file);
      audio = new Audio(url);
      const source = audioContext.createMediaElementSource(audio);
      source.connect(analyser);
      source.connect(audioContext.destination);
      await audio.play();
    } else audioContext.createMediaStreamSource(stream).connect(analyser);
    lastCapture = [];
    current = { audioContext, analyser, stream, audio, url, label, notes: [], startedAt: performance.now() };
    if (audio) audio.addEventListener('ended', stop, { once: true });
    stream?.getAudioTracks().forEach(track => track.addEventListener('ended', stop, { once: true }));
    setActive(true, audio ? '播放中' : '监听中');
    $('#sampleRate').textContent = `${(audioContext.sampleRate / 1000).toFixed(1)} KHZ`;
    $('#latency').textContent = audioContext.baseLatency ? `${Math.round(audioContext.baseLatency * 1000)} MS` : '-- MS';
    updateScore();
    activity(`已连接 ${label}`);
    draw();
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    audio?.pause();
    if (url) URL.revokeObjectURL(url);
    await audioContext.close();
    throw error;
  }
}
async function toggle() {
  if (current) { await stop(); return; }
  const kind = $('#source').value;
  if (kind === 'file') { $('#fileInput').click(); return; }
  try {
    const stream = kind === 'mic'
      ? await navigator.mediaDevices.getUserMedia({ audio: true })
      : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('所选来源没有音轨；分享时请勾选“共享音频”');
    }
    await start({ stream, label: kind === 'mic' ? '麦克风' : '系统 / 应用声音' });
  } catch (error) { notify(error.message || '无法访问音频源'); }
}
button.addEventListener('click', toggle);
$('#source').addEventListener('change', () => { if (current) stop(); });
$('#fileInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try { await start({ file, label: file.name }); }
  catch (error) { notify(error.message || '无法播放此音频文件'); }
});
$('#exportBtn').addEventListener('click', () => {
  const notes = current?.notes || lastCapture;
  if (!notes.length) return;
  const gaps = notes.slice(1).map((note, index) => note.at - notes[index].at).filter(ms => ms > 150 && ms < 2000);
  const median = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 500;
  const bpm = Math.max(40, Math.min(200, Math.round(60000 / median)));
  const content = `BPM=${bpm}\n${notes.map(note => toJianpu(note.midi)).join(' ')}\n`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `delta-jianpu-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#clearBtn').addEventListener('click', () => {
  $('#activityList').innerHTML = '<div class="activity-empty"><span>⌁</span><p>还没有监听记录</p><small>识别到的音符和事件会出现在这里</small></div>';
  notify('活动记录已清空');
});
$('#connectBtn').addEventListener('click', () => notify('桌面客户端桥接尚未实现，请先选择浏览器音频源'));
document.querySelectorAll('.nav-item[data-view]').forEach(item => item.addEventListener('click', () => {
  if (item.dataset.view === 'morse') { window.location.assign('morse.html'); return; }
  if (item.dataset.view === 'coach') { window.location.assign('coach.html'); return; }
  if (item.dataset.view !== 'monitor') notify('此模块将在后续版本开放');
}));
