/* Naukri Campus – Projects Auto Filler (content script)
 * Drives the real UI: Add -> modal -> fields -> custom dropdowns -> skill suggestor -> Save.
 * Never posts to any API directly; everything goes through the page's own form + validation.
 */
(() => {
  if (window.__nkProjFiller) return;

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  const state = {
    running: false,
    stopRequested: false,
    total: 0,
    done: 0,
    added: 0,
    skipped: 0,
    failed: 0,
    current: '',
    log: [],
    finished: false
  };

  const cfg = {
    speed: 1,            // multiplier on every wait (1 = normal, 2 = slower/safer)
    skipExisting: true,
    typeDelay: 70,       // ms per character in the skills suggestor
    settleDelay: 700,    // pause after the last keystroke, before we start looking (debounce)
    suggestWait: 9000    // how long to wait for the suggestor API to answer
  };

  /* ------------------------------------------------------------------ *
   * Small utils
   * ------------------------------------------------------------------ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * cfg.speed)));

  function checkStop() {
    if (state.stopRequested) throw new StopError('Stopped by user');
  }

  class StopError extends Error {}

  async function waitFor(fn, timeout = 10000, interval = 120, label = '') {
    const deadline = Date.now() + timeout * cfg.speed; // "safe / slow" is genuinely more patient
    for (;;) {
      checkStop();
      let val;
      try { val = fn(); } catch (_) { val = null; }
      if (val) return val;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label || 'condition'}`);
      await sleep(interval / cfg.speed); // interval itself should not be scaled twice
    }
  }

  const norm = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const words = (s) => (s || '').toString().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  function isVisible(el) {
    if (!el) return false;
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  }

  function log(msg, kind = 'info') {
    const line = { t: new Date().toLocaleTimeString(), msg: String(msg), kind };
    state.log.push(line);
    if (state.log.length > 400) state.log.shift();
    // eslint-disable-next-line no-console
    console.log('[NaukriProjects]', msg);
    paintOverlay();
    notify({ type: 'NKP_PROGRESS', state: snapshot() });
  }

  const snapshot = () => ({ ...state, log: state.log.slice(-120) });

  // Fire-and-forget message to the popup; swallow "no receiver" noise when it is closed.
  function notify(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (_) { /* extension context invalidated */ }
  }

  /* ------------------------------------------------------------------ *
   * Native value setting + event firing (works with MNJ / React / jQuery)
   * ------------------------------------------------------------------ */
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fire(el, type, init = {}) {
    let ev;
    if (['keydown', 'keyup', 'keypress'].includes(type)) {
      ev = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    } else if (['click', 'mousedown', 'mouseup', 'mouseover'].includes(type)) {
      ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...init });
    } else {
      ev = new Event(type, { bubbles: true, cancelable: true, ...init });
    }
    el.dispatchEvent(ev);
  }

  async function fillField(el, value) {
    if (!el) throw new Error('Field not found');
    el.focus();
    fire(el, 'focus');
    setNativeValue(el, '');
    fire(el, 'input');
    await sleep(40);
    setNativeValue(el, value);
    fire(el, 'input');
    fire(el, 'keyup', { key: 'a', keyCode: 65, which: 65 });
    fire(el, 'change');
    await sleep(60);
    el.blur();
    fire(el, 'blur');
    fire(el, 'focusout');
    await sleep(120);
  }

  // One realistic keystroke: keydown -> keypress -> InputEvent(insertText) -> keyup.
  function keystroke(el, ch, value) {
    const code = ch.toUpperCase().charCodeAt(0);
    const init = { key: ch, code: `Key${ch.toUpperCase()}`, keyCode: code, which: code, charCode: code };
    fire(el, 'keydown', init);
    fire(el, 'keypress', init);
    setNativeValue(el, value);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, data: ch, inputType: 'insertText'
    }));
    fire(el, 'keyup', init);
  }

  async function typeInto(el, value) {
    el.focus();
    fire(el, 'focus');
    setNativeValue(el, '');
    fire(el, 'input');
    let acc = '';
    for (const ch of value) {
      checkStop();
      acc += ch;
      keystroke(el, ch, acc);
      await sleep(cfg.typeDelay);
    }
    fire(el, 'change');
  }

  // Delete the last character and retype it – re-arms a debounced suggestor that missed the burst.
  async function nudge(el) {
    const v = el.value;
    if (!v) return;
    const last = v.slice(-1);
    fire(el, 'keydown', { key: 'Backspace', keyCode: 8, which: 8 });
    setNativeValue(el, v.slice(0, -1));
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'deleteContentBackward'
    }));
    fire(el, 'keyup', { key: 'Backspace', keyCode: 8, which: 8 });
    await sleep(300);
    keystroke(el, last, v);
  }

  function clickEl(el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    fire(el, 'mouseover');
    fire(el, 'mousedown');
    fire(el, 'mouseup');
    el.click();
  }

  /* ------------------------------------------------------------------ *
   * Page structure helpers
   * ------------------------------------------------------------------ */
  function projectsSection() {
    return document.querySelector('.projectsDetails')
      || document.querySelector('.project-details.section')
      || [...document.querySelectorAll('.section')].find((s) =>
        /^projects$/i.test((s.querySelector('.section-heading') || {}).textContent?.trim() || ''));
  }

  function addButton() {
    const sec = projectsSection();
    if (!sec) return null;
    return sec.querySelector('.add-more') || sec.querySelector('[class*="add"]');
  }

  function existingProjectNames() {
    const sec = projectsSection();
    if (!sec) return [];
    return [...sec.querySelectorAll('.card-heading')].map((n) => n.textContent.trim());
  }

  function looksLikeSame(a, b) {
    const na = norm(a); const nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.startsWith(nb) || nb.startsWith(na)) return true;
    const wa = new Set(words(a)); const wb = new Set(words(b));
    if (!wa.size || !wb.size) return false;
    let inter = 0;
    wa.forEach((w) => { if (wb.has(w)) inter++; });
    const union = new Set([...wa, ...wb]).size;
    return inter / union >= 0.6;
  }

  function openModal() {
    const m = document.querySelector('#projectsDetails_Modal');
    return isVisible(m) ? m : null;
  }

  const q = (root, ...sels) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  function formErrors(form) {
    return [...form.querySelectorAll('.erLbl')]
      .map((e) => e.textContent.trim())
      .filter(Boolean);
  }

  /* ------------------------------------------------------------------ *
   * Custom dropdown (month / year)
   * ------------------------------------------------------------------ */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function monthIndex(token) {
    if (!token) return -1;
    const t = token.toString().trim().toLowerCase();
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      return n >= 1 && n <= 12 ? n - 1 : -1;
    }
    return MONTHS.findIndex((m) => m.toLowerCase().startsWith(t.slice(0, 3)));
  }

  async function selectDropdown(input, wanted, kind) {
    if (!input) throw new Error(`Dropdown (${kind}) not found`);
    if (kind === 'month' && monthIndex(wanted) < 0) throw new Error(`Unrecognised month "${wanted}"`);
    if (kind === 'year' && !/^\d{4}$/.test(String(wanted).trim())) throw new Error(`Unrecognised year "${wanted}"`);
    const container = input.closest('.dropdownMainContainer') || input.parentElement;

    // Already correct? leave it alone.
    if (norm(input.value) && (norm(input.value) === norm(wanted)
      || (kind === 'month' && monthIndex(input.value) === monthIndex(wanted)))) return;

    input.focus();
    fire(input, 'focus');
    clickEl(input);
    await sleep(180);

    let list = container.querySelector('.dropdownPrimary');
    if (!list || !list.children.length) {
      // some builds render the list lazily / elsewhere
      clickEl(input);
      await sleep(250);
      list = container.querySelector('.dropdownPrimary')
        || [...document.querySelectorAll('.dropdownPrimary')].find((l) => l.children.length && isVisible(l));
    }

    let picked = null;
    if (list) {
      try {
        await waitFor(() => list.querySelectorAll('*').length > 0, 3500, 100, `${kind} options`);
      } catch (_) { /* fall through to manual set */ }

      const leaves = [...list.querySelectorAll('*')]
        .filter((el) => el.children.length === 0 && el.textContent.trim());

      const target = kind === 'month' ? MONTHS[monthIndex(wanted)] : String(wanted).trim();
      const t3 = kind === 'month' ? target.slice(0, 3).toLowerCase() : '';

      picked = leaves.find((el) => norm(el.textContent) === norm(target))
        || (kind === 'month'
          ? leaves.find((el) => el.textContent.trim().toLowerCase().startsWith(t3))
          : leaves.find((el) => el.textContent.trim() === String(wanted).trim()));

      if (picked) {
        clickEl(picked);
        await sleep(200);
      }
    }

    if (!picked) {
      // Fallback: write the visible input + its hidden id twin directly.
      const display = kind === 'month' ? MONTHS[monthIndex(wanted)].slice(0, 3) : String(wanted).trim();
      const idVal = kind === 'month' ? String(monthIndex(wanted) + 1) : String(wanted).trim();
      setNativeValue(input, display);
      fire(input, 'input'); fire(input, 'change');
      const hidden = document.getElementById(`${input.id}Id`);
      if (hidden) {
        setNativeValue(hidden, idVal);
        fire(hidden, 'input'); fire(hidden, 'change'); fire(hidden, 'blur');
      }
      log(`  ↳ dropdown "${kind}" set directly (${display})`, 'warn');
    }

    input.blur();
    fire(input, 'blur');
    fire(input, 'focusout');
    await sleep(150);
  }

  /* ------------------------------------------------------------------ *
   * Key-skills suggestor
   * ------------------------------------------------------------------ */
  function chipTitles(form) {
    const box = form.querySelector('.chipsContainer');
    if (!box) return [];
    return [...box.querySelectorAll('.chip')].map((c) => (c.getAttribute('title') || c.textContent).trim());
  }

  // Suggestions from the *previous* skill can still be in the DOM. Only trust a list whose
  // items actually relate to what we just typed (first 3 chars is enough to tell them apart).
  function relevantItems(drop, skill) {
    if (!drop || !isVisible(drop)) return [];
    const stem = norm(skill).slice(0, Math.min(3, norm(skill).length));
    return [...drop.querySelectorAll('li.sugTouple')]
      .filter((li) => li.textContent.trim() && norm(li.textContent).startsWith(stem));
  }

  // Click a harmless spot inside the modal so the suggestor's blur handler runs.
  async function clickOutOf(form, input) {
    // the skills label itself: no `for` target exists, so clicking it steals focus without side effects
    const neutral = q(form, 'label[for^="skills"]', '.from-sub-heading', '.fields-container') || form;
    input.blur();
    fire(input, 'blur');
    fire(input, 'focusout');
    fire(document, 'mousedown');
    clickEl(neutral);
    fire(document, 'click');
    await sleep(500);
  }

  async function addSkill(form, skill) {
    const input = q(form, '#keySkillSugg', 'input[name="suggestor"]', '.sugInp');
    if (!input) { log(`  ↳ skills input not found, skipping "${skill}"`, 'warn'); return false; }

    if (chipTitles(form).some((c) => norm(c) === norm(skill))) return true;

    const before = chipTitles(form).length;
    const drop = q(form, '#sugDrp_keySkillSugg', '.sugCont');
    const gotChip = () => chipTitles(form).length > before;

    await typeInto(input, skill);

    // 1. let the debounce fire and the API answer, then poll for *relevant* options
    await sleep(cfg.settleDelay);
    let items = [];
    try {
      items = await waitFor(() => {
        const li = relevantItems(drop, skill);
        return li.length ? li : null;
      }, cfg.suggestWait, 200, `suggestions for "${skill}"`);
    } catch (_) {
      // 2. nothing yet – re-arm the suggestor once and give it another (shorter) chance
      log(`  ↳ no suggestions for "${skill}" yet, retrying…`, 'warn');
      await nudge(input);
      await sleep(cfg.settleDelay);
      try {
        items = await waitFor(() => {
          const li = relevantItems(drop, skill);
          return li.length ? li : null;
        }, Math.round(cfg.suggestWait * 0.6), 200, `suggestions for "${skill}"`);
      } catch (__) { items = []; }
    }

    // 3. pick from the list: exact match > prefix match > first relevant
    if (items.length) {
      const choice = items.find((li) => norm(li.textContent) === norm(skill))
        || items.find((li) => norm(li.textContent).startsWith(norm(skill)))
        || items[0];
      const picked = choice.textContent.trim();
      clickEl(choice.querySelector('.Sbtn') || choice);
      try {
        await waitFor(gotChip, 3000, 150, `chip for "${skill}"`);
        if (norm(picked) !== norm(skill)) log(`  ↳ "${skill}" → picked "${picked}"`);
        return true;
      } catch (_) { /* fall through to the blur path */ }
    }

    // 4. no usable suggestion – unfocus and let Naukri commit the typed text itself
    if (input.value.trim() !== skill) { setNativeValue(input, skill); fire(input, 'input'); }
    await clickOutOf(form, input);
    if (gotChip()) { log(`  ↳ "${skill}" added on blur (no suggestion)`); return true; }

    // 5. last resort: Enter
    ['keydown', 'keypress', 'keyup'].forEach((t) =>
      fire(input, t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    await sleep(600);
    if (gotChip()) { log(`  ↳ "${skill}" added via Enter`); return true; }

    setNativeValue(input, '');
    fire(input, 'input');
    await clickOutOf(form, input);
    log(`  ↳ skill "${skill}" not accepted – skipped`, 'warn');
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Duration parsing
   * ------------------------------------------------------------------ */
  function parseDuration(p) {
    if (p.start_month && p.start_year && p.end_month && p.end_year) {
      return {
        sm: p.start_month, sy: String(p.start_year),
        em: p.end_month, ey: String(p.end_year)
      };
    }
    const s = (p.duration || '').replace(/[’']/g, '');
    const re = /([A-Za-z]{3,9})\s*[',\s]*\s*(\d{2,4})/g;
    const hits = [...s.matchAll(re)].map((m) => ({ mon: m[1], yr: m[2] }));
    if (hits.length < 2) throw new Error(`Cannot parse duration "${p.duration}"`);
    const yr = (y) => (y.length === 2 ? (parseInt(y, 10) > 70 ? `19${y}` : `20${y}`) : y);
    return {
      sm: hits[0].mon, sy: yr(hits[0].yr),
      em: hits[1].mon, ey: yr(hits[1].yr)
    };
  }

  /* ------------------------------------------------------------------ *
   * One project
   * ------------------------------------------------------------------ */
  async function addProject(p) {
    const d = parseDuration(p);

    // 1. open the modal
    const btn = addButton();
    if (!btn) throw new Error('Projects "Add" button not found – are you on the profile page?');
    clickEl(btn);

    const modal = await waitFor(openModal, 12000, 150, 'Projects modal');
    const form = modal.querySelector('form') || modal;
    await sleep(400);

    // 2. project name
    const title = q(form, 'input[id^="title"]', '.project-title input');
    await fillField(title, (p.project_name || '').slice(0, 100));

    // 3. duration
    const sm = q(form, 'input[name$="_start_month"]');
    const sy = q(form, 'input[name$="_start_year"]');
    const em = q(form, 'input[name$="_end_month"]');
    const ey = q(form, 'input[name$="_end_year"]');
    await selectDropdown(sm, d.sm, 'month');
    await selectDropdown(sy, d.sy, 'year');
    await selectDropdown(em, d.em, 'month');
    await selectDropdown(ey, d.ey, 'year');

    // 4. description
    const details = q(form, 'textarea[id^="details"]', 'textarea');
    const desc = (p.description || '').slice(0, 1000);
    await fillField(details, desc);

    // 5. key skills
    const skills = Array.isArray(p.key_skills)
      ? p.key_skills
      : String(p.key_skills || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of skills) {
      checkStop();
      await addSkill(form, s);
      await sleep(450); // let the suggestor drop the previous result set before the next skill
    }

    // 6. url
    if (p.project_url) {
      const url = q(form, 'input[id^="url"]', '.project-url input');
      if (url) await fillField(url, p.project_url.slice(0, 500));
    }

    // 7. save
    const save = q(form, '#submit-btn', 'button.btn-blue', 'button[type="submit"]');
    if (!save) throw new Error('Save button not found');

    try {
      await waitFor(() => !save.disabled, 6000, 150, 'Save button to enable');
    } catch (_) {
      // nudge validation once more, then re-check
      [title, details].forEach((el) => { if (el) { fire(el, 'blur'); fire(el, 'focusout'); } });
      await sleep(600);
      if (save.disabled) {
        const errs = formErrors(form);
        throw new Error(`Save stayed disabled${errs.length ? ` – ${errs.join('; ')}` : ''}`);
      }
    }

    clickEl(save);

    try {
      await waitFor(() => !openModal(), 15000, 250, 'modal to close');
    } catch (_) {
      const errs = formErrors(form);
      throw new Error(`Modal did not close after Save${errs.length ? ` – ${errs.join('; ')}` : ''}`);
    }
    await sleep(1200);
  }

  function closeModalIfOpen() {
    const m = openModal();
    if (!m) return;
    const close = m.querySelector('.fn-modal-close-btn') || m.querySelector('.cancel-form');
    if (close) clickEl(close);
  }

  /* ------------------------------------------------------------------ *
   * Runner
   * ------------------------------------------------------------------ */
  async function run(projects, options) {
    if (state.running) return { ok: false, error: 'Already running' };
    Object.assign(cfg, options || {});
    Object.assign(state, {
      running: true, stopRequested: false, finished: false,
      total: projects.length, done: 0, added: 0, skipped: 0, failed: 0,
      current: '', log: []
    });
    showOverlay();
    log(`Starting – ${projects.length} project(s) queued.`);

    if (!projectsSection()) {
      state.running = false;
      log('Projects section not found on this page. Open your Naukri profile (View & Edit) first.', 'error');
      return { ok: false, error: 'Projects section not found' };
    }

    for (const p of projects) {
      if (state.stopRequested) break;
      state.current = p.project_name || '(unnamed)';
      try {
        if (cfg.skipExisting && existingProjectNames().some((n) => looksLikeSame(n, p.project_name))) {
          state.skipped++;
          log(`⏭  Already on profile – skipped: ${state.current}`, 'warn');
        } else {
          log(`▶  Adding: ${state.current}`);
          await addProject(p);
          state.added++;
          log(`✅ Added: ${state.current}`, 'ok');
        }
      } catch (e) {
        if (e instanceof StopError) { log('⏹ Stopped.', 'warn'); break; }
        state.failed++;
        log(`❌ Failed: ${state.current} – ${e.message}`, 'error');
        closeModalIfOpen();
        await sleep(1200);
      }
      state.done++;
    }

    state.running = false;
    state.finished = true;
    state.current = '';
    log(`Done. Added ${state.added}, skipped ${state.skipped}, failed ${state.failed}.`,
      state.failed ? 'warn' : 'ok');
    return { ok: true, state: snapshot() };
  }

  /* ------------------------------------------------------------------ *
   * On-page overlay
   * ------------------------------------------------------------------ */
  let overlay = null;
  function showOverlay() {
    if (overlay) { overlay.style.display = 'flex'; return; }
    const style = document.createElement('style');
    style.textContent = `
      #nkp-overlay{position:fixed;right:16px;bottom:16px;width:340px;max-height:60vh;z-index:2147483647;
        display:flex;flex-direction:column;background:#0f172a;color:#e2e8f0;border-radius:12px;
        box-shadow:0 12px 36px rgba(0,0,0,.35);font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
      #nkp-overlay .nkp-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1e293b;font-weight:600}
      #nkp-overlay .nkp-hd .nkp-sp{flex:1}
      #nkp-overlay button{background:#334155;color:#e2e8f0;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
      #nkp-overlay button:hover{background:#475569}
      #nkp-overlay .nkp-stop{background:#b91c1c}
      #nkp-overlay .nkp-body{padding:8px 12px;overflow:auto}
      #nkp-overlay .nkp-line{padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05);word-break:break-word}
      #nkp-overlay .ok{color:#4ade80}#nkp-overlay .warn{color:#fbbf24}#nkp-overlay .error{color:#f87171}
      #nkp-overlay .nkp-bar{height:4px;background:#1e293b}
      #nkp-overlay .nkp-bar i{display:block;height:100%;background:#38bdf8;width:0;transition:width .3s}`;
    document.documentElement.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'nkp-overlay';
    overlay.innerHTML = `
      <div class="nkp-hd"><span>Naukri Projects Auto Filler</span><span class="nkp-sp"></span>
        <button class="nkp-stop">Stop</button><button class="nkp-hide">×</button></div>
      <div class="nkp-bar"><i></i></div>
      <div class="nkp-body"></div>`;
    document.documentElement.appendChild(overlay);
    overlay.querySelector('.nkp-stop').onclick = () => { state.stopRequested = true; log('Stop requested…', 'warn'); };
    overlay.querySelector('.nkp-hide').onclick = () => { overlay.style.display = 'none'; };
    paintOverlay();
  }

  function paintOverlay() {
    if (!overlay) return;
    const body = overlay.querySelector('.nkp-body');
    body.innerHTML = state.log.slice(-60)
      .map((l) => `<div class="nkp-line ${l.kind}">${l.msg.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</div>`)
      .join('');
    body.scrollTop = body.scrollHeight;
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
    overlay.querySelector('.nkp-bar i').style.width = `${pct}%`;
  }

  /* ------------------------------------------------------------------ *
   * Messaging
   * ------------------------------------------------------------------ */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'NKP_PING') { sendResponse({ ok: true, onProfile: !!projectsSection() }); return; }
    if (msg.type === 'NKP_STATUS') { sendResponse({ ok: true, state: snapshot(), onProfile: !!projectsSection() }); return; }
    if (msg.type === 'NKP_EXISTING') { sendResponse({ ok: true, names: existingProjectNames() }); return; }
    if (msg.type === 'NKP_STOP') { state.stopRequested = true; sendResponse({ ok: true }); return; }
    if (msg.type === 'NKP_RUN') {
      run(msg.projects || [], msg.options || {}).then(() => notify({ type: 'NKP_DONE', state: snapshot() }));
      sendResponse({ ok: true, started: true });
      return true;
    }
    return undefined;
  });

  window.__nkProjFiller = { run, state };
  console.log('[NaukriProjects] content script ready');
})();
