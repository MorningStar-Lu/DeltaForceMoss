import { CoachSession, parseCoachScore } from './coach-core.js';

let pipWindow = null;
const $ = selector => document.querySelector(selector) || pipWindow?.document.querySelector(selector);
const panel = $('#coachPanel');
let session = null;
let lastRenderedIndex = -1;

function showError(message) {
  $('#parseStatus').textContent = message;
  $('#parseStatus').classList.add('error');
}

function showInfo(message) {
  $('#parseStatus').textContent = message;
  $('#parseStatus').classList.remove('error');
}

function loadScore() {
  try {
    const score = parseCoachScore($('#scoreInput').value);
    session = new CoachSession(score);
    session.setMode($('#mode').value, performance.now());
    session.setSpeed(Number($('#speed').value), performance.now());
    lastRenderedIndex = -1;
    $('#coachBpm').textContent = `${score.bpm} BPM`;
    showInfo(`已载入 ${score.notes.length} 个音符，共 ${score.totalBeats} 拍。`);
    panel.hidden = false;
    render();
  } catch (error) { showError(error.message); }
}

function render() {
  if (!session) return;
  const state = session.tick(performance.now());
  const { notes } = session.score;
  const current = notes[state.index];
  const next = notes[state.index + 1];
  $('#currentNote').textContent = current?.symbol ?? '✓';
  $('#nextNote').textContent = next?.symbol ?? '—';
  $('#coachState').textContent = state.finished ? '已完成'
    : state.running ? (session.mode === 'wait' ? '等待按键' : '演奏中')
      : state.index === 0 && session.elapsedMs === 0 ? '待机' : '已暂停';
  $('#coachPrompt').textContent = state.finished ? '已完成本轮'
    : session.mode === 'wait' ? '空格 / → 下一音' : state.running ? `${session.speed.toFixed(2)}× 走谱中` : '点击开始';
  $('#progressText').textContent = `${Math.min(state.index + 1, notes.length)} / ${notes.length}`;
  $('#progressFill').style.width = `${(state.progress * 100).toFixed(1)}%`;
  $('#playBtn').textContent = state.running ? '暂停' : state.finished ? '重播' : '开始';
  if (lastRenderedIndex !== state.index) {
    lastRenderedIndex = state.index;
    const cells = notes.slice(state.index, state.index + 7).map((note, index) => {
      const cell = document.createElement('span');
      cell.textContent = note.symbol;
      if (!index) cell.classList.add('active');
      return cell;
    });
    $('#timeline').replaceChildren(...cells);
  }
}

function updateAppearance() {
  const opacity = Number($('#opacity').value);
  const scale = Number($('#scale').value);
  $('#opacityValue').textContent = `${opacity}%`;
  $('#scaleValue').textContent = `${scale}%`;
  panel.style.opacity = String(opacity / 100);
  panel.style.transform = `scale(${scale / 100})`;
}

function togglePanel() { panel.hidden = !panel.hidden; }

$('#loadBtn').addEventListener('click', loadScore);
$('#importBtn').addEventListener('click', () => $('#scoreFile').click());
$('#scoreFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 100_000) { showError('TXT 曲谱不能超过 100 KB'); return; }
  $('#scoreInput').value = await file.text();
  loadScore();
});
$('#playBtn').addEventListener('click', () => {
  if (!session) return;
  if (session.running) session.pause(performance.now());
  else session.play(performance.now());
  render();
});
$('#resetBtn').addEventListener('click', () => { session?.reset(); lastRenderedIndex = -1; render(); });
$('#mode').addEventListener('change', event => {
  session?.setMode(event.target.value, performance.now());
  lastRenderedIndex = -1;
  render();
});
$('#speed').addEventListener('input', event => {
  const speed = Number(event.target.value);
  $('#speedValue').textContent = `${speed.toFixed(2)}×`;
  session?.setSpeed(speed, performance.now());
  render();
});
$('#opacity').addEventListener('input', updateAppearance);
$('#scale').addEventListener('input', updateAppearance);
$('#hideBtn').addEventListener('click', togglePanel);
$('#showBtn').addEventListener('click', () => { panel.hidden = false; });

function handleKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target?.tagName || '')) return;
  if (event.key.toLowerCase() === 'h') { togglePanel(); return; }
  if (event.code === 'Space' || event.key === 'ArrowRight') {
    if (session?.mode !== 'wait') return;
    event.preventDefault();
    session.advance();
    render();
  }
}
document.addEventListener('keydown', handleKey);

const handle = $('#dragHandle');
let drag = null;
handle.addEventListener('pointerdown', event => {
  if (pipWindow || event.target.closest('button')) return;
  const rect = panel.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.left = `${rect.left}px`;
  panel.style.top = `${rect.top}px`;
  panel.style.zIndex = '100';
  drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  handle.setPointerCapture(event.pointerId);
});
handle.addEventListener('pointermove', event => {
  if (!drag) return;
  panel.style.left = `${Math.max(0, Math.min(innerWidth - 80, event.clientX - drag.x))}px`;
  panel.style.top = `${Math.max(0, Math.min(innerHeight - 50, event.clientY - drag.y))}px`;
});
handle.addEventListener('pointerup', () => { drag = null; });
handle.addEventListener('pointercancel', () => { drag = null; });

if (!('documentPictureInPicture' in window)) {
  $('#pipBtn').disabled = true;
  $('#pipBtn').title = '当前浏览器不支持文档画中画';
}
$('#pipBtn').addEventListener('click', async () => {
  if (pipWindow) { pipWindow.close(); return; }
  try {
    pipWindow = await documentPictureInPicture.requestWindow({ width: 560, height: 330 });
    const stylesheet = pipWindow.document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./coach.css', import.meta.url).href;
    pipWindow.document.head.append(stylesheet);
    pipWindow.document.body.className = 'pip';
    pipWindow.document.body.append(panel);
    pipWindow.document.addEventListener('keydown', handleKey);
    $('#pipBtn').textContent = '关闭画中画';
    pipWindow.addEventListener('pagehide', () => {
      $('#panelDock').append(panel);
      panel.style.position = '';
      panel.style.left = '';
      panel.style.top = '';
      panel.style.zIndex = '';
      pipWindow = null;
      $('#pipBtn').textContent = '画中画小窗';
    }, { once: true });
  } catch (error) { showError(`无法打开画中画：${error.message}`); }
});

loadScore();
updateAppearance();
setInterval(render, 50);
