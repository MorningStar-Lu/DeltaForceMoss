/**
 * Delta Force Audio - 赛博液态主题管理器 (Cyber Liquid Theme Engine)
 */

export const THEMES = [
  { id: 'cyber-neon', name: '电光新东京', colorA: '#00f0ff', colorB: '#ff007f' },
  { id: 'acid-matrix', name: '战术矩阵', colorA: '#25f48b', colorB: '#00f0ff' },
  { id: 'night-city', name: '夜之城', colorA: '#ffe600', colorB: '#ff3366' },
];

const STORAGE_KEY = 'delta_cyber_theme';

export function getInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && THEMES.some(t => t.id === saved)) {
    return saved;
  }
  return 'cyber-neon'; // 默认主推：电光青 + 霓虹洋红
}

export function applyTheme(themeId) {
  const validTheme = THEMES.some(t => t.id === themeId) ? themeId : 'cyber-neon';
  document.documentElement.dataset.theme = validTheme;
  localStorage.setItem(STORAGE_KEY, validTheme);

  // 同步更新页面中的主题切换按钮高亮状态
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === validTheme);
  });

  const nameEl = document.getElementById('currentThemeName');
  if (nameEl) {
    const cur = THEMES.find(t => t.id === validTheme);
    nameEl.textContent = cur ? cur.name : '';
  }

  // 触发全局自定义事件，方便如 Canvas 波形等组件自适应重绘配色
  window.dispatchEvent(new CustomEvent('delta-theme-change', { detail: { theme: validTheme } }));
}

export function initThemeSwitcher() {
  const currentTheme = getInitialTheme();
  applyTheme(currentTheme);

  document.querySelectorAll('[data-theme-switcher]').forEach(container => {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-btn');
      if (btn && btn.dataset.theme) {
        applyTheme(btn.dataset.theme);
      }
    });
  });

  // 支持循环切换快捷触发器
  const cycleBtn = document.getElementById('cycleThemeBtn');
  if (cycleBtn) {
    cycleBtn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || 'cyber-neon';
      const idx = THEMES.findIndex(t => t.id === cur);
      const next = THEMES[(idx + 1) % THEMES.length].id;
      applyTheme(next);
    });
  }
}

// 立即在模块加载时根据本地存储初始化属性，避免页面闪烁
(function preinit() {
  const saved = localStorage.getItem(STORAGE_KEY) || 'cyber-neon';
  document.documentElement.dataset.theme = saved;
})();
