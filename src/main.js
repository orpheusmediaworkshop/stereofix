import { FFmpeg } from '@ffmpeg/ffmpeg';
import './style.css';

const $ = (id) => document.getElementById(id);
const modes = {
  mix: {
    suffix: 'mono-both',
    filter: 'pan=mono|c0=0.5*c0+0.5*c1',
    description: 'Обидва сигнали буде змішано з однаковою гучністю. Результат: один моноаудіоканал у відео.'
  },
  left: {
    suffix: 'mono-left',
    filter: 'pan=mono|c0=c0',
    description: 'Залишиться лише лівий канал (MIC 1). Його буде чути по центру, в обох навушниках.'
  },
  right: {
    suffix: 'mono-right',
    filter: 'pan=mono|c0=c1',
    description: 'Залишиться лише правий канал (MIC 2). Його буде чути по центру, в обох навушниках.'
  },
  split: {
    suffix: 'split',
    description: 'Створяться два незалежні моноаудіофайли M4A, які можна імпортувати в CapCut окремими доріжками.'
  }
};

let inputFile = null;
let ffmpeg = null;
let processing = false;
let canceled = false;
let importedPreviewURL = null;
let resultURLs = [];
let lastEngineLog = [];
let runGeneration = 0;

function isVideo(file) {
  return /^video\//.test(file.type) || /\.(mp4|mov|m4v|avi|webm)$/i.test(file.name);
}
function fileExtension(file) {
  const extension = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['mov','mp4','m4v','m4a','mp3','wav','aac','webm','avi'].includes(extension)
    ? extension : (isVideo(file) ? 'mov' : 'm4a');
}
function displaySize(bytes) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let unit = 0, result = bytes;
  while (result >= 1024 && unit < units.length - 1) { result /= 1024; unit++; }
  return `${result.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function cleanName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 65) || 'StereoFix';
}
function setProgress(label, amount, help = 'Під час обробки не закривай Safari.') {
  $('progress-panel').hidden = false;
  $('progress-label').textContent = label;
  const percent = Math.max(0, Math.min(100, Math.round(amount)));
  $('progress-percent').textContent = `${percent}%`;
  $('progress-fill').style.width = `${percent}%`;
  $('progress-help').textContent = help;
}
function clearError() {
  $('error-panel').hidden = true;
  $('error-panel').textContent = '';
}
function showError(message) {
  $('error-panel').textContent = message;
  $('error-panel').hidden = false;
}
function clearResults() {
  for (const url of resultURLs) URL.revokeObjectURL(url);
  resultURLs = [];
  $('result-list').replaceChildren();
  $('results').hidden = true;
}
function activeMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || 'mix';
}
function syncModes() {
  const mode = activeMode();
  for (const label of document.querySelectorAll('.mode-option')) {
    label.classList.toggle('active', label.dataset.mode === mode);
  }
  $('mode-note').textContent = modes[mode].description;
  $('process-button').querySelector('span').textContent = mode === 'split' ? 'Розділити аудіоканали' : 'Обробити відео';
  clearResults(); clearError();
}
function setFile(file) {
  if (!file || processing) return;
  const supported = /\.(mov|mp4|m4v|m4a|mp3|wav|aac|webm|avi)$/i.test(file.name) || /^(video|audio)\//.test(file.type);
  if (!supported) { showError('Вибери MOV, MP4, M4A або інший підтримуваний аудіо/відеофайл.'); return; }
  if (importedPreviewURL) URL.revokeObjectURL(importedPreviewURL);
  clearResults(); clearError();
  inputFile = file;
  $('selected-file').hidden = false;
  $('selected-name').textContent = file.name;
  $('selected-info').textContent = `${displaySize(file.size)} · ${isVideo(file) ? 'Відео' : 'Аудіо'} · оригінал не змінюється`;
  $('file-status').classList.add('is-ready');
  $('file-status').lastChild.textContent = ' Файл вибрано';
  $('dropzone').hidden = true;
  $('process-button').disabled = false;
  if (isVideo(file)) {
    importedPreviewURL = URL.createObjectURL(file);
    $('input-preview').src = importedPreviewURL;
    $('input-preview').hidden = false;
  } else {
    $('input-preview').pause();
    $('input-preview').removeAttribute('src');
    $('input-preview').hidden = true;
  }
  if (file.size > 150 * 1024 * 1024) {
    showError(`Великий файл (${displaySize(file.size)}). Safari може завершити обробку через обмеження памʼяті. Рекомендуємо для першого тесту відео до 100 МБ.`);
  }
}

function setBusy(busy) {
  processing = busy;
  $('process-button').disabled = busy || !inputFile;
  $('cancel-button').hidden = !busy;
  $('file-input').disabled = busy;
  for (const input of document.querySelectorAll('input[name="mode"]')) input.disabled = busy;
  $('change-file').disabled = busy;
}

async function engineReady() {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({message}) => {
      lastEngineLog.push(String(message));
      if (lastEngineLog.length > 25) lastEngineLog.shift();
    });
    ffmpeg.on('progress', ({progress}) => {
      if (!processing || !Number.isFinite(progress)) return;
      const p = Math.max(0, Math.min(1, progress));
      const target = activeMode() === 'split' ? 33 + p * 29 : 36 + p * 60;
      // Keep progress monotonic while two channel files are generated.
      const current = parseInt($('progress-percent').textContent, 10) || 0;
      setProgress('Обробляю аудіо…', Math.max(current, target));
    });
  }
  if (ffmpeg.loaded) return ffmpeg;
  setProgress('Завантажую аудіодвигун…', 6, 'Перший запуск завантажує приблизно 30 МБ. Надалі компонент може братися з кешу.');
  const baseURL = new URL(`${import.meta.env.BASE_URL}vendor/ffmpeg/`, document.baseURI).href;
  await ffmpeg.load({
    coreURL: `${baseURL}ffmpeg-core.js`,
    wasmURL: `${baseURL}ffmpeg-core.wasm`
  });
  return ffmpeg;
}

async function safeDelete(engine, path) {
  try { await engine.deleteFile(path); } catch { /* The file may not exist */ }
}

function addResult(filename, data, mime) {
  const bytes = new Uint8Array(data); // Give Blob its own typed-array backing.
  const blob = new Blob([bytes], {type: mime});
  const url = URL.createObjectURL(blob);
  resultURLs.push(url);

  const item = document.createElement('div');
  item.className = 'result-item';
  const info = document.createElement('div');
  info.className = 'result-info';
  const strong = document.createElement('strong');
  strong.textContent = filename;
  const small = document.createElement('small');
  small.textContent = displaySize(blob.size);
  info.append(strong, small);
  const actions = document.createElement('div');
  actions.className = 'result-actions';
  const download = document.createElement('a');
  download.href = url;
  download.download = filename;
  download.className = 'result-action';
  download.textContent = 'Завантажити ↓';
  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'result-action';
  share.textContent = 'Поділитися ↗';
  share.addEventListener('click', async () => {
    try {
      const file = new File([blob], filename, { type: mime });
      if (!navigator.canShare?.({files: [file]})) {
        showError('Цей браузер не підтримує поширення файлів. Натисни «Завантажити», а потім збережи через меню Safari.');
        return;
      }
      await navigator.share({files: [file], title: filename});
    } catch (error) {
      if (error?.name !== 'AbortError') showError(`Не вдалося відкрити меню поширення: ${error.message || error}`);
    }
  });
  actions.append(download, share);
  item.append(info, actions);
  $('result-list').append(item);
  $('results').hidden = false;
}

async function executeChecked(engine, args) {
  lastEngineLog = [];
  const code = await engine.exec(['-hide_banner', '-nostdin', '-y', ...args]);
  if (code !== 0) {
    const diagnosis = lastEngineLog.slice(-7).join(' ');
    if (/matches no streams|Stream map/i.test(diagnosis)) throw new Error('У файлі не знайдено потрібний аудіо- або відеопотік.');
    if (/Channel .*does not exist|Invalid channel/i.test(diagnosis)) throw new Error('У файлі немає двох незалежних каналів. Потрібен стереозапис.');
    throw new Error(`FFmpeg завершився з кодом ${code}. ${diagnosis.slice(-340)}`);
  }
}

async function processFile() {
  if (!inputFile || processing) return;
  clearResults(); clearError();
  setBusy(true);
  canceled = false;
  const currentGeneration = ++runGeneration;
  let engine;
  const ext = fileExtension(inputFile);
  const inputName = `source.${ext}`;
  const sourceIsVideo = isVideo(inputFile);
  const createdPaths = [inputName];
  let success = false;

  try {
    engine = await engineReady();
    if (canceled) return;
    setProgress('Імпортую файл у памʼять…', 15);
    const contents = new Uint8Array(await inputFile.arrayBuffer());
    if (canceled) return;
    await safeDelete(engine, inputName);
    await engine.writeFile(inputName, contents);
    setProgress('Аналізую аудіодоріжку…', 30);
    const baseName = cleanName(inputFile.name);
    const mode = activeMode();
    if (mode === 'split') {
      const channels = [
        {name: `${baseName}_MIC1_left.m4a`, internal: 'stereo_left.m4a', filter: 'pan=mono|c0=c0'},
        {name: `${baseName}_MIC2_right.m4a`, internal: 'stereo_right.m4a', filter: 'pan=mono|c0=c1'}
      ];
      for (let i=0; i<channels.length; i++) {
        if (canceled) return;
        const ch = channels[i];
        createdPaths.push(ch.internal);
        setProgress(`Обробляю MIC ${i+1}…`, i === 0 ? 33 : 66);
        await executeChecked(engine, ['-i', inputName, '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', ch.filter, '-c:a', 'aac', '-b:a', '160k', '-ac', '1', ch.internal]);
        const bytes = await engine.readFile(ch.internal);
        addResult(ch.name, bytes, 'audio/mp4');
        await safeDelete(engine, ch.internal);
        setProgress(`MIC ${i+1} готовий`, i === 0 ? 65 : 95);
      }
    } else {
      const outExt = sourceIsVideo ? ((ext === 'mov') ? 'mov' : 'mp4') : 'm4a';
      const outInternal = `processed.${outExt}`;
      const outName = `${baseName}_${modes[mode].suffix}.${outExt}`;
      createdPaths.push(outInternal);
      const outputParams = sourceIsVideo
        ? ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-sn', '-dn']
        : ['-map', '0:a:0', '-vn', '-sn', '-dn'];
      await executeChecked(engine, [
        '-i', inputName,
        ...outputParams,
        '-af', modes[mode].filter,
        '-c:a', 'aac', '-b:a', '160k', '-ac', '1',
        ...(sourceIsVideo ? ['-movflags', '+faststart'] : []),
        outInternal
      ]);
      setProgress('Готую готовий файл…', 96);
      const bytes = await engine.readFile(outInternal);
      addResult(outName, bytes, sourceIsVideo ? (outExt === 'mov' ? 'video/quicktime' : 'video/mp4') : 'audio/mp4');
      await safeDelete(engine, outInternal);
    }
    success = true;
    setProgress('Готово', 100, 'Результат готовий. Скористайся кнопками нижче.');
    $('results').scrollIntoView({behavior: 'smooth', block: 'center'});
  } catch (error) {
    if (!canceled) {
      const message = String(error?.message || error || 'Невідома помилка');
      showError(/out of memory|allocation|memory|OOM/i.test(message)
        ? 'iPhone не вистачило памʼяті для цього файлу. Спробуй коротший ролик або оброби відео на компʼютері.'
        : `Не вдалося обробити файл: ${message}. Для першого тесту спробуй короткий MOV/MP4 зі стереозвуком.`);
    }
  } finally {
    if (!success) {
      clearResults();
      $('progress-panel').hidden = true;
    }
    if (engine && !canceled) {
      for (const path of createdPaths) await safeDelete(engine, path);
    }
    if (currentGeneration === runGeneration) setBusy(false);
  }
}

$('file-input').addEventListener('change', (event) => {
  setFile(event.currentTarget.files?.[0]);
});
$('change-file').addEventListener('click', () => { $('file-input').value = ''; $('file-input').click(); });
$('dropzone').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file-input').click(); }
});
$('dropzone').addEventListener('dragover', e => {e.preventDefault(); $('dropzone').classList.add('is-dragging');});
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('is-dragging'));
$('dropzone').addEventListener('drop', e => {
  e.preventDefault(); $('dropzone').classList.remove('is-dragging'); setFile(e.dataTransfer?.files?.[0]);
});
for (const input of document.querySelectorAll('input[name="mode"]')) input.addEventListener('change', syncModes);
$('process-button').addEventListener('click', processFile);
$('cancel-button').addEventListener('click', () => {
  ++runGeneration;
  canceled = true;
  if (ffmpeg) { ffmpeg.terminate(); ffmpeg = null; }
  showError('Обробку зупинено. Можеш запустити її знову.');
  $('progress-panel').hidden = true;
  clearResults();
  setBusy(false);
});

syncModes();
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swURL = new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI);
    navigator.serviceWorker.register(swURL).catch(() => {});
  });
}
