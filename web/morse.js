import { decodeDigit } from './morse-codec.js';
import { MorseToneDetector } from './morse-detector.js';
import { MorseGameCueDecoder } from './morse-game-cue.js';
import { RollingMorseDecoder } from './morse-rolling.js';
import { spectrumDb } from './morse-spectrum.js';
import { initThemeSwitcher } from './theme.js';

const $ = selector => document.querySelector(selector);
const source = $('#source');
const power = $('#powerBtn');
const fileInput = $('#audioFile');

window.dev ??= false;
$('#diagnosticRow').hidden = window.dev === false;

initThemeSwitcher();
let themeGlitchTimer;
window.addEventListener('delta-theme-change', () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const machine = $('.machine');
  machine.classList.remove('theme-glitch');
  void machine.offsetWidth;
  machine.classList.add('theme-glitch');
  clearTimeout(themeGlitchTimer);
  themeGlitchTimer = setTimeout(() => machine.classList.remove('theme-glitch'), 650);
});
let audio = null;
let context = null;
let analyser = null;
let stream = null;
let objectUrl = null;
let bins = null;
let worklet = null;
let recordingStream = null;
let diagnostic = null;
const detector = new MorseToneDetector();
const gameCue = new MorseGameCueDecoder();
const rolling = new RollingMorseDecoder();
let symbols = '';
let morseGroups = [];
let digits = '';
let history = [];

function status(message, live = false) {
  $('#status').textContent = message;
  $('#lamp').classList.toggle('live', live);
}

function hint(message) { $('#hint').textContent = message; }

function recordAction(action) {
  if (diagnostic) diagnostic.log.events.push({ t: Math.round(performance.now() - diagnostic.started), type: 'action', action });
}

function downloadDiagnostic(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function stopDiagnostic() {
  if (!diagnostic) return;
  const session = diagnostic;
  diagnostic = null;
  clearTimeout(session.timer);
  $('#diagnosticBtn').textContent = '● 开始诊断录制';
  $('#diagnosticNote').textContent = '诊断录制已结束，音频与日志将下载到本机。';
  session.log.finishedAt = new Date().toISOString();
  session.log.durationMs = Math.round(performance.now() - session.started);
  if (session.recorder.state !== 'inactive') session.recorder.stop();
}

function startDiagnostic() {
  if (!analyser || !recordingStream || diagnostic) return;
  if (typeof MediaRecorder === 'undefined') {
    hint('当前浏览器不支持音频诊断录制，请换用支持 MediaRecorder 的浏览器。');
    return;
  }
  try {
    const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus']
      .find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(recordingStream, options ? { mimeType: options } : undefined);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const chunks = [];
    const log = {
      version: 1,
      startedAt: new Date().toISOString(),
      source: source.value,
      sampleRate: context.sampleRate,
      fftSize: analyser.fftSize,
      audioTrackCount: recordingStream.getAudioTracks().length,
      observations: [],
      events: [],
    };
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || options || 'audio/webm';
      const extension = type.includes('ogg') ? 'ogg' : 'webm';
      downloadDiagnostic(new Blob(chunks, { type }), `morse-diagnostic-${stamp}.${extension}`);
      downloadDiagnostic(new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }), `morse-diagnostic-${stamp}.json`);
    };
    recorder.onerror = () => { hint('诊断录制发生错误，请重新尝试。'); stopDiagnostic(); };
    recorder.start(1000);
    diagnostic = { recorder, log, started: performance.now(), lastSample: -Infinity,
      timer: setTimeout(stopDiagnostic, 120000) };
    $('#diagnosticBtn').textContent = '■ 停止并下载诊断';
    $('#diagnosticNote').textContent = '正在录制当前输入音频和识别日志，最长 2 分钟；停止后下载到本机。';
  } catch (error) {
    hint(`无法开始诊断录制：${error.message}`);
  }
}

function render() {
  const displayDigits = (digits + '───').slice(0, 3);
  $('#digits').textContent = displayDigits;
  if ($('#compactDigits')) $('#compactDigits').textContent = displayDigits;
  
  const trace = [...morseGroups, ...(symbols ? [symbols] : [])].join(' / ');
  const displayTrace = trace || '等待信号';
  $('#symbols').textContent = displayTrace;
  if ($('#compactCandidate')) $('#compactCandidate').textContent = trace ? trace : '/ / / (等待信号)';
  
  if (pipWindow && pipWindow.document) {
    const pipDigits = pipWindow.document.getElementById('pipDigits');
    const pipCandidate = pipWindow.document.getElementById('pipCandidate');
    if (pipDigits) pipDigits.textContent = displayDigits;
    if (pipCandidate) pipCandidate.textContent = trace ? trace : '/ / / (等待信号)';
  }
  
  $('#pulseProgress').textContent = `${symbols.length}/5`;
  $('#currentResult').textContent = digits || '—';
  $('#historyCount').textContent = String(history.length);
  $('#historyList').replaceChildren();
  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有解码记录';
    $('#historyList').append(empty);
    return;
  }
  for (const item of history) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const time = document.createElement('span');
    time.textContent = item.time;
    const code = document.createElement('strong');
    code.textContent = item.code;
    row.append(time, code);
    $('#historyList').append(row);
  }
}

let autoResetTimer = null;
let autoResetCountdown = 0;

function clearAutoResetTimer() {
  if (autoResetTimer) {
    clearInterval(autoResetTimer);
    autoResetTimer = null;
  }
  autoResetCountdown = 0;
}

function startAutoResetTimer() {
  clearAutoResetTimer();
  const check = $('#autoResetCheck');
  if (check && !check.checked) return;

  autoResetCountdown = 10;
  $('#rollingStatus').textContent = `破译成功 · 10 秒后自动重置准备下一轮`;

  autoResetTimer = setInterval(() => {
    autoResetCountdown--;
    if (autoResetCountdown > 0) {
      $('#rollingStatus').textContent = `破译成功 · ${autoResetCountdown} 秒后自动重置准备下一轮`;
      if ($('#compactCandidate')) $('#compactCandidate').textContent = `破译成功 · ${autoResetCountdown}s 后重置准备下一轮`;
      if (pipWindow && pipWindow.document) {
        const pipCandidate = pipWindow.document.getElementById('pipCandidate');
        if (pipCandidate) pipCandidate.textContent = `破译成功 · ${autoResetCountdown}s 后重置准备下一轮`;
      }
    } else {
      clearAutoResetTimer();
      clearRound();
      status('已自动重置 · 准备捕获下一个密码门', true);
      hint('自动重置已完成，随时开始下一轮密码提示音捕获。');
    }
  }, 1000);
}

function commitDigit(digit, rawSymbols = symbols) {
  if (digits.length === 3) {
    digits = '';
    morseGroups = [];
    clearAutoResetTimer();
  }
  digits += digit;
  if (rawSymbols) morseGroups.push(rawSymbols);
  symbols = '';
  if (digits.length === 3) {
    if (digits.includes('?')) {
      status(`三位中存在未识别项：${digits}`, !!analyser);
      hint('未识别的位保留为 ?，不会将后面的数字前移。');
    } else {
      if (history[0]?.code !== digits) {
        history.unshift({ code: digits, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
        history = history.slice(0, 12);
      }
      status(`已识别三位密码：${digits}`, !!analyser);
      hint('请在游戏内核对结果；将在 10 秒后自动重置准备下一轮。');
      startAutoResetTimer();
    }
  }
  render();
}

function commitUnknown(rawSymbols) {
  if (digits.length === 3) {
    digits = '';
    morseGroups = [];
    clearAutoResetTimer();
  }
  digits += '?';
  morseGroups.push(rawSymbols || '?');
  symbols = '';
  status(`第 ${digits.length} 位暂无法识别`, !!analyser);
  hint('这一位保留为 ?，等待下一组提示音或第二遍滚动复核。');
  render();
}

function commitRollingCode(code, frequency) {
  digits = code;
  symbols = '';
  if (history[0]?.code !== code) {
    history.unshift({ code, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
    history = history.slice(0, 12);
  }
  $('#rollingStatus').textContent = `滚动复核：两次播放一致 · ${code} · 约 ${frequency} Hz`;
  status(`滚动复核得到三位密码：${code}`, true);
  hint('两次完整播放的节奏一致；10 秒后自动重置准备下一轮。');
  startAutoResetTimer();
  render();
}

function manualSymbol(symbol) {
  recordAction(symbol === '.' ? 'manual-dot' : 'manual-dash');
  if (!/^[.-]*$/.test(symbols)) symbols = '';
  detector.reset();
  gameCue.reset();
  rolling.reset();
  $('#frequency').textContent = '自动搜索中';
  symbols += symbol;
  if (symbols.length === 5) {
    const digit = decodeDigit(symbols);
    if (digit === null) {
      hint('这组符号不是数字摩斯码，请撤销后重试。');
    } else {
      commitDigit(digit);
    }
  }
  render();
}

function clearRound() {
  recordAction('clear-round');
  digits = '';
  symbols = '';
  morseGroups = [];
  detector.reset();
  gameCue.reset();
  rolling.reset();
  $('#rollingStatus').textContent = analyser ? '滚动复核：正在积累音频' : '滚动复核：待机';
  $('#frequency').textContent = analyser ? '自动搜索中' : '未锁定';
  render();
  hint('已清空本轮识别。');
}

function peakNear(data, bin) {
  let peak = -160;
  for (let i = Math.max(0, bin - 2); i <= Math.min(data.length - 1, bin + 2); i++) peak = Math.max(peak, data[i]);
  let sum = 0;
  let count = 0;
  for (let offset = -28; offset <= 28; offset++) {
    if (Math.abs(offset) < 8) continue;
    const i = bin + offset;
    if (i >= 0 && i < data.length) { sum += data[i]; count++; }
  }
  return { peak, contrast: peak - sum / Math.max(1, count) };
}

function detectTone(now) {
  const hzPerBin = context.sampleRate / analyser.fftSize;
  const rollingEvent = rolling.observe(now, bins, hzPerBin);
  const wasGameCueAcquired = gameCue.acquired;
  const gameEvent = gameCue.observe(now, bins, hzPerBin);
  if (gameCue.acquired) {
    if (!wasGameCueAcquired) {
      detector.reset();
      digits = '';
      symbols = '';
      morseGroups = [];
    }
    if (diagnostic && gameEvent) diagnostic.log.events.push({ t: Math.round(performance.now() - diagnostic.started), channel: 'game-cue', ...gameEvent });
    if (gameEvent?.type === 'progress') {
      if (digits.length === 3) {
        $('#rollingStatus').textContent = '滚动复核：正在核对第二次播放';
      } else {
        symbols = gameEvent.symbols;
        render();
      }
    } else if (gameEvent?.type === 'digit') {
      $('#frequency').textContent = `${gameEvent.frequency} Hz`;
      if (digits.length === 3) {
        if (gameEvent.code && gameEvent.repeated) commitRollingCode(gameEvent.code, gameEvent.frequency);
        else if (gameEvent.code) {
          $('#rollingStatus').textContent = `滚动复核：两次结果不一致（${digits} / ${gameEvent.code}）`;
          status('两次提示音不一致，请核对或重录', true);
          hint('保留第一轮结果；第二轮与它不同，暂不自动覆盖。');
        } else $('#rollingStatus').textContent = '滚动复核：正在核对第二次播放';
      } else commitDigit(gameEvent.digit, gameEvent.symbols);
    } else if (gameEvent?.type === 'uncertain') commitUnknown(gameEvent.symbols);
    return;
  }
  const low = Math.ceil(350 / hzPerBin);
  const high = Math.min(Math.floor(5000 / hzPerBin), bins.length - 1);
  const trackedHz = detector.lockedHz || detector.toneHz;
  let bin = trackedHz ? Math.round(trackedHz / hzPerBin) : low;
  if (trackedHz) {
    const from = Math.max(low, bin - 2);
    const to = Math.min(high, bin + 2);
    bin = from;
    for (let i = from + 1; i <= to; i++) if (bins[i] > bins[bin]) bin = i;
  } else {
    for (let i = low + 1; i <= high; i++) if (bins[i] > bins[bin]) bin = i;
  }
  const tone = peakNear(bins, bin);
  if (diagnostic && now - diagnostic.lastSample >= 50) {
    diagnostic.lastSample = now;
    diagnostic.log.observations.push({
      t: Math.round(performance.now() - diagnostic.started),
      frequencyHz: Math.round(bin * hzPerBin),
      peakDb: Number.isFinite(tone.peak) ? Math.round(tone.peak) : null,
      contrastDb: Number.isFinite(tone.contrast) ? Math.round(tone.contrast) : null,
      lockedHz: detector.lockedHz,
    });
  }
  const event = detector.process({
    time: now,
    frequency: bin * hzPerBin,
    peakDb: tone.peak,
    contrastDb: tone.contrast,
  });
  if (diagnostic && event) diagnostic.log.events.push({ t: Math.round(performance.now() - diagnostic.started), ...event });
  if (diagnostic && rollingEvent) diagnostic.log.events.push({ t: Math.round(performance.now() - diagnostic.started), channel: 'rolling', ...rollingEvent });
  const level = Number.isFinite(tone.contrast) && tone.peak > -100
    ? Math.max(0, Math.min(100, Math.round(tone.contrast * 3))) : 0;
  $('#signalLevel').textContent = `窄带 ${level}%`;
  if (event?.type === 'progress') {
    symbols = event.symbols;
    render();
  } else if (event?.type === 'digit') {
    $('#frequency').textContent = `${event.frequency} Hz`;
    commitDigit(event.digit, event.symbols);
    if (digits.length < 3) status(`已确认提示音频率 · 当前 ${digits.length}/3 位`, true);
  } else if (event?.type === 'uncertain') {
    if (!event.count || event.count >= 3) commitUnknown(event.symbols);
    else {
      symbols = event.symbols || '?';
      status('短候选未成组 · 继续搜索', true);
      render();
    }
  } else if (event?.type === 'discard') {
    symbols = '';
    render();
  }
  if (rollingEvent?.type === 'candidate' && !rolling.lastConfirmed) {
    $('#rollingStatus').textContent = '滚动复核：发现候选节奏，等待重复播放确认';
  } else if (rollingEvent?.type === 'confirmed') {
    commitRollingCode(rollingEvent.code, rollingEvent.frequency);
  }
}

let wsBridge = null;

async function stop() {
  stopDiagnostic();
  if (wsBridge) {
    wsBridge.onopen = wsBridge.onmessage = wsBridge.onerror = wsBridge.onclose = null;
    try { wsBridge.close(); } catch {}
    wsBridge = null;
  }
  if (worklet) {
    worklet.port.onmessage = null;
    worklet.disconnect();
    worklet = null;
  }
  analyser = null;
  bins = null;
  recordingStream = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  const endedContext = context;
  context = null;
  detector.reset();
  gameCue.reset();
  rolling.reset();
  power.setAttribute('aria-pressed', 'false');
  power.setAttribute('aria-label', '开始监听');
  $('#frequency').textContent = '未锁定';
  $('#searchBtn').disabled = true;
  $('#diagnosticBtn').disabled = true;
  $('#signalLevel').textContent = '信号 —';
  $('#rollingStatus').textContent = '滚动复核：待机';
  status('待机 · 点击电源开始');
  if (endedContext && endedContext.state !== 'closed') await endedContext.close();
}

async function startWasapiBridge() {
  status('正在连接免弹窗全局声音服务 (ws://127.0.0.1:9999)...');
  hint('免弹窗模式需后台运行 Windows 客户端 `DeltaForceMoss.exe`。正在建立通信...');

  try {
    context = new AudioContext();
    detector.reset();
    gameCue.reset();
    rolling.reset();

    wsBridge = new WebSocket('ws://127.0.0.1:9999/audio/');
    wsBridge.binaryType = 'arraybuffer';

    wsBridge.onopen = () => {
      power.setAttribute('aria-pressed', 'true');
      power.setAttribute('aria-label', '停止监听');
      $('#searchBtn').disabled = false;
      $('#frequency').textContent = '自动搜索中';
      status('● 已连接免弹窗全局声音监听 (WASAPI)', true);
      hint('正在直接监听 Windows 系统声音，无需分享窗口。');
    };

    wsBridge.onmessage = event => {
      if (!wsBridge || !context) return;
      const pcm = new Float32Array(event.data);
      bins = spectrumDb(pcm);
      detectTone(performance.now());
    };

    wsBridge.onerror = () => {
      status('无法连接免弹窗音频桥接 (ws://127.0.0.1:9999)');
      hint('请确保后台已运行 DeltaForceMoss.exe。若未运行，可在下拉菜单选择“系统 / 游戏共享音频 (浏览器弹窗)”。');
      stop();
    };

    wsBridge.onclose = () => {
      if (wsBridge) {
        status('免弹窗音频连接已断开');
        stop();
      }
    };
  } catch (err) {
    status(err.message || '免弹窗连接异常');
    stop();
  }
}

async function start(file = null) {
  try {
    if (!file && source.value === 'wasapi') {
      return startWasapiBridge();
    }
    if (!file) {
      stream = source.value === 'mic'
        ? await navigator.mediaDevices.getUserMedia({ audio: true })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!stream.getAudioTracks().length) throw new Error('没有获取到音轨，请在分享时启用共享音频。');
    }
    context = new AudioContext();
    await context.audioWorklet.addModule(new URL('./morse-capture-worklet.js', import.meta.url));
    detector.reset();
    gameCue.reset();
    rolling.reset();
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    bins = new Float32Array(analyser.frequencyBinCount);
    worklet = new AudioWorkletNode(context, 'morse-capture');
    worklet.port.onmessage = event => {
      if (!analyser || !context) return;
      bins = spectrumDb(event.data.pcm);
      detectTone(event.data.time);
    };
    analyser.connect(worklet);
    worklet.connect(context.destination);
    if (file) {
      objectUrl = URL.createObjectURL(file);
      audio = new Audio(objectUrl);
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(context.destination);
      const recorderOutput = context.createMediaStreamDestination();
      analyser.connect(recorderOutput);
      recordingStream = recorderOutput.stream;
      audio.addEventListener('ended', () => { stop(); }, { once: true });
      await audio.play();
    } else {
      context.createMediaStreamSource(stream).connect(analyser);
      recordingStream = new MediaStream(stream.getAudioTracks());
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { stop(); }, { once: true }));
    }
    power.setAttribute('aria-pressed', 'true');
    power.setAttribute('aria-label', '停止监听');
    $('#searchBtn').disabled = false;
    $('#diagnosticBtn').disabled = false;
    $('#diagnosticNote').textContent = '仅在点击后录制当前输入的音频及识别日志；停止时下载到本机，不会上传。可能录到语音，分享前请检查。最长 2 分钟。';
    $('#frequency').textContent = '自动搜索中';
    status('自动搜索完整提示音组', true);
    $('#rollingStatus').textContent = '滚动复核：正在积累音频';
    hint('检测到同频、时序合理的五段提示音后才会确认一位数字。');
  } catch (error) {
    await stop();
    status(error.message || '无法启动音频监听');
  }
}

power.addEventListener('click', () => {
  if (analyser || wsBridge) { stop(); return; }
  if (source.value === 'file') { fileInput.click(); return; }
  start();
});
$('#searchBtn').addEventListener('click', () => {
  if (!analyser) return;
  recordAction('restart-search');
  detector.reset();
  gameCue.reset();
  rolling.reset();
  digits = '';
  symbols = '';
  morseGroups = [];
  $('#frequency').textContent = '自动搜索中';
  status('已重新搜索提示音', true);
  $('#rollingStatus').textContent = '滚动复核：正在积累音频';
  hint('等待完整的五段提示音；未组成有效数字时不会确认结果。');
  render();
});
$('#diagnosticBtn').addEventListener('click', () => {
  if (diagnostic) stopDiagnostic();
  else startDiagnostic();
});
source.addEventListener('change', () => { if (analyser) stop(); });
fileInput.addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) start(file);
});
$('#dotBtn').addEventListener('click', () => manualSymbol('.'));
$('#dashBtn').addEventListener('click', () => manualSymbol('-'));
$('#undoBtn').addEventListener('click', () => {
  recordAction('undo');
  if (symbols) symbols = symbols.slice(0, -1);
  else if (digits) {
    digits = digits.slice(0, -1);
    morseGroups.pop();
  } else morseGroups.pop();
  detector.reset();
  gameCue.reset();
  rolling.reset();
  $('#frequency').textContent = analyser ? '自动搜索中' : '未锁定';
  render();
});
$('#resetBtn').addEventListener('click', clearRound);
$('#historyBtn').addEventListener('click', () => { $('#historyPanel').hidden = !$('#historyPanel').hidden; });
$('#clearHistoryBtn').addEventListener('click', () => { history = []; render(); });

// 极简浮窗 (Compact Overlay) 模式控制与拖拽
let isCompact = false;
function toggleCompactMode(enable = !isCompact) {
  isCompact = enable;
  document.body.classList.toggle('is-compact', isCompact);
  const overlay = $('#compactOverlay');
  if (overlay) overlay.hidden = !isCompact;
}

$('#compactToggleBtn')?.addEventListener('click', () => toggleCompactMode(true));
$('#exitCompactBtn')?.addEventListener('click', () => toggleCompactMode(false));

let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let overlayInitialLeft = 0, overlayInitialTop = 0;
const dragHandle = $('.compact-drag-handle');
const compactOverlay = $('#compactOverlay');

dragHandle?.addEventListener('mousedown', e => {
  if (e.target.closest('#exitCompactBtn')) return;
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const rect = compactOverlay.getBoundingClientRect();
  overlayInitialLeft = rect.left;
  overlayInitialTop = rect.top;
  compactOverlay.style.right = 'auto';
  compactOverlay.style.left = overlayInitialLeft + 'px';
  compactOverlay.style.top = overlayInitialTop + 'px';
});

window.addEventListener('mousemove', e => {
  if (!isDragging || !compactOverlay) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  compactOverlay.style.left = Math.max(0, Math.min(window.innerWidth - compactOverlay.offsetWidth, overlayInitialLeft + dx)) + 'px';
  compactOverlay.style.top = Math.max(0, Math.min(window.innerHeight - compactOverlay.offsetHeight, overlayInitialTop + dy)) + 'px';
});

window.addEventListener('mouseup', () => { isDragging = false; });

// 系统级画中画 (Document Picture-in-Picture) 悬浮窗
let pipWindow = null;

async function togglePipWindow() {
  if (pipWindow) {
    pipWindow.close();
    pipWindow = null;
    updatePipButton();
    return;
  }

  if (!('documentPictureInPicture' in window)) {
    alert('当前浏览器暂不支持 Document Picture-in-Picture (系统级画中画悬浮窗)。\n推荐使用最新版 Chrome 111+ 或 Edge 111+ 浏览器。\n\n在其他浏览器中，您可以点击【页面内浮窗】进行体验。');
    return;
  }

  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 330,
      height: 220,
    });

    [...document.styleSheets].forEach(sheet => {
      try {
        const cssRules = [...sheet.cssRules].map(rule => rule.cssText).join('');
        const style = document.createElement('style');
        style.textContent = cssRules;
        pipWindow.document.head.appendChild(style);
      } catch (e) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = sheet.type;
        link.href = sheet.href;
        pipWindow.document.head.appendChild(link);
      }
    });

    pipWindow.document.body.style.margin = '0';
    pipWindow.document.body.style.background = '#060a14';
    pipWindow.document.body.style.overflow = 'hidden';

    pipWindow.document.body.innerHTML = `
      <div class="compact-overlay" style="display:block !important; position:relative; top:0; left:0; width:100%; height:100%; box-sizing:border-box; border:none; backdrop-filter:none; padding:12px 14px; background:#060a14;">
        <div class="compact-drag-handle" style="cursor:default; margin-bottom:6px;">
          <span class="compact-title">密码门破译 · 画中画浮窗</span>
        </div>
        <div class="compact-body">
          <div class="compact-digits-wrapper">
            <span class="compact-label">解码密码</span>
            <div id="pipDigits" class="compact-digits" style="font-size: 44px; line-height: 1.1;">${(digits + '───').slice(0, 3)}</div>
          </div>
          <div class="compact-divider" style="margin: 4px 0;"></div>
          <div class="compact-readout">
            <span class="compact-label">候选斜杠 / 点划</span>
            <div id="pipCandidate" class="compact-candidate" style="font-size:12px; padding:4px 8px;">${[...morseGroups, ...(symbols ? [symbols] : [])].join(' / ') || '/ / / (等待信号)'}</div>
          </div>
          <div class="pip-actions" style="display:flex; gap:6px; margin-top:8px;">
            <button id="pipResetBtn" class="compact-btn" style="flex:1; padding:4px; font-size:11px;" type="button">⌁ 清空重置</button>
            <button id="pipSearchBtn" class="compact-btn" style="flex:1; padding:4px; font-size:11px;" type="button">↻ 重新搜索</button>
          </div>
        </div>
      </div>
    `;

    pipWindow.document.getElementById('pipResetBtn')?.addEventListener('click', () => {
      clearAutoResetTimer();
      clearRound();
    });

    pipWindow.document.getElementById('pipSearchBtn')?.addEventListener('click', () => {
      clearAutoResetTimer();
      detector.reset();
      gameCue.reset();
      rolling.reset();
      digits = '';
      symbols = '';
      morseGroups = [];
      $('#frequency').textContent = '自动搜索中';
      status('已重新搜索提示音', true);
      render();
    });

    pipWindow.addEventListener('pagehide', () => {
      pipWindow = null;
      updatePipButton();
    });

    updatePipButton();
  } catch (err) {
    console.error('打开画中画浮窗失败:', err);
  }
}

function updatePipButton() {
  const btn = $('#pipToggleBtn');
  if (!btn) return;
  btn.textContent = pipWindow ? '✕ 关闭画中画' : '📺 画中画悬浮窗';
}

$('#pipToggleBtn')?.addEventListener('click', togglePipWindow);

render();


