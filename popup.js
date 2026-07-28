/* Popup controller: validates the JSON, injects/pings the content script, drives the run. */
const $ = (id) => document.getElementById(id);
const els = {
  json: $('json'), err: $('jsonErr'), count: $('count'), log: $('log'), stats: $('stats'),
  start: $('start'), stop: $('stop'), pageState: $('pageState'),
  skip: $('skipExisting'), speed: $('speed'), suggestWait: $('suggestWait')
};

let pollTimer = null;

/* ---------------- storage ---------------- */
async function loadPrefs() {
  const p = await chrome.storage.local.get(['json', 'skipExisting', 'speed', 'suggestWait']);
  els.json.value = p.json || JSON.stringify(NKP_DEFAULT_PROJECTS, null, 2);
  els.skip.checked = p.skipExisting !== false;
  els.speed.value = p.speed || '1';
  els.suggestWait.value = p.suggestWait || '9000';
  validate();
}
function savePrefs() {
  chrome.storage.local.set({
    json: els.json.value,
    skipExisting: els.skip.checked,
    speed: els.speed.value,
    suggestWait: els.suggestWait.value
  });
}

/* ---------------- json ---------------- */
function parsed() {
  const raw = els.json.value.trim();
  if (!raw) return { list: [], error: 'Paste your projects JSON.' };
  let data;
  try { data = JSON.parse(raw); } catch (e) { return { list: [], error: `Invalid JSON: ${e.message}` }; }
  if (!Array.isArray(data)) data = [data];
  const problems = [];
  data.forEach((p, i) => {
    if (!p || typeof p !== 'object') { problems.push(`#${i + 1}: not an object`); return; }
    if (!p.project_name) problems.push(`#${i + 1}: missing project_name`);
    if (!p.duration && !(p.start_month && p.end_month)) problems.push(`#${i + 1}: missing duration`);
    if (!p.description || String(p.description).trim().length < 10) problems.push(`#${i + 1}: description too short`);
    if (p.description && String(p.description).length > 1000) problems.push(`#${i + 1}: description >1000 chars (will be trimmed)`);
    if (p.project_name && String(p.project_name).length > 100) problems.push(`#${i + 1}: name >100 chars (will be trimmed)`);
  });
  return { list: data, error: problems.join(' • ') };
}

function validate() {
  const { list, error } = parsed();
  els.count.textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;
  els.err.textContent = error || '';
  const fatal = /Invalid JSON|not an object|missing|too short/.test(error || '');
  els.start.disabled = fatal || !list.length;
  return !fatal;
}

/* ---------------- tab / content script ---------------- */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tab) {
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'NKP_PING' });
    if (r && r.ok) return r;
  } catch (_) { /* not injected yet */ }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await new Promise((r) => setTimeout(r, 250));
  return chrome.tabs.sendMessage(tab.id, { type: 'NKP_PING' });
}

async function refreshPageState() {
  const tab = await activeTab();
  const url = tab?.url || '';
  if (!/naukri\.com/.test(url)) {
    els.pageState.textContent = 'not on naukri.com';
    els.pageState.className = 'pill bad';
    return false;
  }
  try {
    const r = await ensureContentScript(tab);
    if (r?.onProfile) {
      els.pageState.textContent = 'profile page ready';
      els.pageState.className = 'pill ok';
      return true;
    }
    els.pageState.textContent = 'open View & Edit profile';
    els.pageState.className = 'pill bad';
  } catch (e) {
    els.pageState.textContent = 'reload the page';
    els.pageState.className = 'pill bad';
  }
  return false;
}

/* ---------------- run ---------------- */
async function start() {
  if (!validate()) return;
  const { list } = parsed();
  const tab = await activeTab();
  try {
    await ensureContentScript(tab);
    await chrome.tabs.sendMessage(tab.id, {
      type: 'NKP_RUN',
      projects: list,
      options: {
        skipExisting: els.skip.checked,
        speed: parseFloat(els.speed.value) || 1,
        suggestWait: parseInt(els.suggestWait.value, 10) || 9000
      }
    });
    els.start.disabled = true;
    els.stop.disabled = false;
    startPolling();
  } catch (e) {
    renderLog([{ msg: `Could not start: ${e.message}. Reload the Naukri tab and try again.`, kind: 'error' }]);
  }
}

async function stop() {
  const tab = await activeTab();
  try { await chrome.tabs.sendMessage(tab.id, { type: 'NKP_STOP' }); } catch (_) {}
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(pollStatus, 700);
  pollStatus();
}

async function pollStatus() {
  const tab = await activeTab();
  if (!tab) return;
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'NKP_STATUS' });
    if (r?.state) applyState(r.state);
  } catch (_) { /* page navigating */ }
}

function applyState(s) {
  els.stats.textContent = s.total
    ? `${s.done}/${s.total} • ✅${s.added} ⏭${s.skipped} ❌${s.failed}`
    : '';
  renderLog(s.log || []);
  els.start.disabled = s.running;
  els.stop.disabled = !s.running;
  if (!s.running) { clearInterval(pollTimer); pollTimer = null; validate(); }
}

function renderLog(lines) {
  if (!lines.length) return;
  els.log.innerHTML = lines
    .map((l) => `<div class="${l.kind || ''}">${escapeHtml(l.msg)}</div>`)
    .join('');
  els.log.scrollTop = els.log.scrollHeight;
}

const escapeHtml = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/* ---------------- wiring ---------------- */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'NKP_PROGRESS' || msg?.type === 'NKP_DONE') applyState(msg.state);
});

els.json.addEventListener('input', () => { validate(); savePrefs(); });
els.skip.addEventListener('change', savePrefs);
els.speed.addEventListener('change', savePrefs);
els.suggestWait.addEventListener('change', savePrefs);
els.start.addEventListener('click', start);
els.stop.addEventListener('click', stop);
$('loadDefault').addEventListener('click', () => {
  els.json.value = JSON.stringify(NKP_DEFAULT_PROJECTS, null, 2);
  validate(); savePrefs();
});
$('format').addEventListener('click', () => {
  try {
    els.json.value = JSON.stringify(JSON.parse(els.json.value), null, 2);
    validate(); savePrefs();
  } catch (_) { /* validate() already shows the error */ }
});

loadPrefs();
refreshPageState();
pollStatus();
