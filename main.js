(() => {
  'use strict';

  // Elements
  const $ = (sel) => document.querySelector(sel);
  const titleScreen = $('#title-screen');
  const gameScreen = $('#game-screen');
  const settingsScreen = $('#settings-screen');
  const endingScreen = $('#ending-screen');
  const btnNew = $('#btn-new');
  const btnContinue = $('#btn-continue');
  const btnSettings = $('#btn-settings');
  const btnSettingsBack = $('#btn-settings-back');
  const btnTitle = $('#btn-title');
  const btnEndingTitle = $('#btn-ending-title');
  const volumeRange = $('#volume');
  const volumeValue = $('#volume-value');
  const speedRange = $('#speed');
  const speedValue = $('#speed-value');
  const textBox = $('#textbox');
  const textEl = $('#text');
  const choicesEl = $('#choices');
  const skipBtn = $('#skip-btn');
  const sceneEl = $('#scene');
  const fadeOverlay = $('#fade-overlay');
  const bgm = $('#bgm');
  // Typewriter SFX pool
  const TYPE_SFX_PATH = 'sounds/type.mp3';
  const typePoolSize = 6;
  const typePool = Array.from({ length: typePoolSize }, () => new Audio(TYPE_SFX_PATH));
  let typeIndex = 0;
  let lastTypeAt = 0;

  // State
  const SAVE_KEY = 'novel_save_v1';
  const SETTINGS_KEY = 'novel_settings_v1';
  let story = null; // loaded JSON
  let currentNodeId = null;
  let state = {}; // flags
  let typing = false;
  let typeSkip = false;
  let typeTimer = null;
  let settings = {
    volume: 0.5,
    speed: 30, // ms per char
  };

  // Utilities
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fadeOverlayTo(show, duration = 250) {
    fadeOverlay.style.transitionDuration = duration + 'ms';
    return new Promise((resolve) => {
      const onEnd = () => {
        fadeOverlay.removeEventListener('transitionend', onEnd);
        resolve();
      };
      fadeOverlay.addEventListener('transitionend', onEnd);
      if (show) fadeOverlay.classList.add('show');
      else fadeOverlay.classList.remove('show');
      // fallback in case transitionend doesn't fire
      setTimeout(onEnd, duration + 50);
    });
  }

  function fadeAudioTo(target, duration = 300) {
    target = Math.max(0, Math.min(1, target));
    const start = bgm.volume;
    const diff = target - start;
    if (duration <= 0 || Math.abs(diff) < 0.001) {
      bgm.volume = target;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const startT = performance.now();
      function step(t) {
        const p = Math.min(1, (t - startT) / duration);
        bgm.volume = start + diff * p;
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  // Persistence
  function saveGame() {
    if (!currentNodeId) return;
    const data = { nodeId: currentNodeId, state };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (_) {}
  }
  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data;
    } catch (_) {
      return null;
    }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.volume === 'number') settings.volume = s.volume;
      if (typeof s.speed === 'number') settings.speed = s.speed;
    } catch (_) {}
  }

  function updateSettingsUI() {
    volumeRange.value = String(settings.volume);
    volumeValue.textContent = Math.round(settings.volume * 100) + '%';
    speedRange.value = String(settings.speed);
    speedValue.textContent = settings.speed + 'ms';
    // apply now
    bgm.volume = settings.volume;
  }

  // Story helpers
  function meetsNeed(needObj) {
    if (!needObj) return true;
    return Object.keys(needObj).every((k) => {
      const v = needObj[k];
      if (typeof v === 'boolean') return !!state[k] === v;
      return state[k] === v;
    });
  }

  function applySet(setObj) {
    if (!setObj) return;
    Object.keys(setObj).forEach((k) => {
      state[k] = setObj[k];
    });
  }

  // Typewriter
  async function typeText(text) {
    typing = true;
    textBox.classList.add('typing');
    typeSkip = false;
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    textEl.textContent = '';
    const chars = [...String(text)];
    let i = 0;
    await new Promise((resolve) => {
      const tick = () => {
        if (typeSkip) {
          textEl.textContent = text;
          clearInterval(typeTimer);
          typeTimer = null;
          resolve();
          return;
        }
        const ch = chars[i++];
        textEl.textContent += ch;
        // Play type SFX for non-whitespace, throttled
        const now = performance.now();
        if (ch && !/\s/.test(ch) && now - lastTypeAt > Math.max(20, settings.speed * 0.6)) {
          const a = typePool[typeIndex];
          try {
            a.currentTime = 0;
            a.volume = Math.min(1, settings.volume * 0.8);
            a.play().catch(() => {});
          } catch (_) {}
          typeIndex = (typeIndex + 1) % typePool.length;
          lastTypeAt = now;
        }
        if (i >= chars.length) {
          clearInterval(typeTimer);
          typeTimer = null;
          resolve();
        }
      };
      typeTimer = setInterval(tick, Math.max(5, settings.speed));
    });
    typing = false;
    textBox.classList.remove('typing');
  }

  // Rendering
  async function showNode(id) {
    const node = story.nodes[id];
    if (!node) return;

    currentNodeId = id;
    saveGame();

    // Scene background from node.bg
    sceneEl.className = 'scene';
    if (node.bg) sceneEl.classList.add('bg-' + String(node.bg));

    // Audio dip on node transition
    await fadeAudioTo(Math.min(settings.volume, 0.2), 200);

    // 転換時のみ白フェード。タイピング中は白背景のまま。
    await fadeOverlayTo(true, 120);
    choicesEl.innerHTML = '';
    textEl.textContent = '';
    await fadeOverlayTo(false, 120);
    await typeText(node.text || '');

    // Build choices (filter by need)
    const available = (node.choices || []).filter((c) => meetsNeed(c.need));
    if (available.length === 0 && !node.end) {
      // Fallback: if no choices and not end, show a continue button to start
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = 'つづける';
      b.addEventListener('click', () => showNode(story.start));
      li.appendChild(b);
      choicesEl.appendChild(li);
    } else {
      available.forEach((c) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.textContent = c.text;
        b.addEventListener('click', async () => {
          applySet(c.set);
          saveGame();
          await showNode(c.to);
        });
        li.appendChild(b);
        choicesEl.appendChild(li);
      });
    }

    await fadeAudioTo(settings.volume, 200);

    if (node.end) {
      // slight pause then show ending screen
      await sleep(400);
      switchScreen(endingScreen);
    }
  }

  function switchScreen(el) {
    [titleScreen, gameScreen, settingsScreen, endingScreen].forEach((s) => s.classList.remove('active'));
    el.classList.add('active');
  }

  function startNewGame() {
    state = {};
    currentNodeId = story.start;
    clearSave();
    saveGame();
    if (bgm.paused) bgm.play().catch(() => {});
    switchScreen(gameScreen);
    showNode(currentNodeId);
  }

  function continueGame() {
    const data = loadGame();
    if (!data) return;
    state = data.state || {};
    currentNodeId = data.nodeId || story.start;
    if (bgm.paused) bgm.play().catch(() => {});
    switchScreen(gameScreen);
    showNode(currentNodeId);
  }

  // UI bindings
  btnNew.addEventListener('click', startNewGame);
  btnContinue.addEventListener('click', continueGame);
  btnSettings.addEventListener('click', () => { switchScreen(settingsScreen); });
  btnSettingsBack.addEventListener('click', () => { switchScreen(titleScreen); });
  btnTitle.addEventListener('click', async () => {
    await fadeOverlayTo(true, 200);
    switchScreen(titleScreen);
    await fadeOverlayTo(false, 200);
  });
  btnEndingTitle.addEventListener('click', () => {
    switchScreen(titleScreen);
  });

  // Skip behavior: clicking text area or button fills instantly
  textBox.addEventListener('click', () => { if (typing) typeSkip = true; });
  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); if (typing) typeSkip = true; });

  // Settings bindings
  volumeRange.addEventListener('input', () => {
    settings.volume = Number(volumeRange.value);
    updateSettingsUI();
    saveSettings();
  });
  speedRange.addEventListener('input', () => {
    settings.speed = Number(speedRange.value);
    updateSettingsUI();
    saveSettings();
  });

  // Init
  async function loadStory() {
    // Try fetch story.json first
    try {
      const res = await fetch('story.json', { cache: 'no-cache' });
      if (res.ok) {
        return await res.json();
      }
      throw new Error('HTTP ' + res.status);
    } catch (_) {
      // Fallback to embedded script tag
      const tag = document.getElementById('story-data');
      if (tag && tag.textContent.trim()) {
        try { return JSON.parse(tag.textContent); } catch (e) {}
      }
      return null;
    }
  }

  async function init() {
    loadSettings();
    updateSettingsUI();

    // Load story with fallback
    story = await loadStory();
    if (!story) {
      console.error('Failed to obtain story data');
      alert('ストーリーデータが見つかりません。story.json か 埋め込みJSON を確認してください。');
      return;
    }

    // continue availability
    const save = loadGame();
    if (save && save.nodeId) btnContinue.disabled = false;
    else btnContinue.disabled = true;

    // Ensure BGM volume aligned
    bgm.volume = settings.volume;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
