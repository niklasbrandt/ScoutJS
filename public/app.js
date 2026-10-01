// Derived from the page's own URL, not hardcoded to "/" — a host serving this behind a
// stripped path prefix (Traefik's stripprefix middleware, found live: every /api/... call
// below 404'd, or worse, silently got an HTML error page back and threw on `.json()`) still
// needs these requests to carry that prefix so the proxy can route them back here.
const API_BASE = new URL('.', window.location.href).pathname;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- State ---
let isCollapsed = false;
let currentTarget = 'default';
let currentFilter = 'pending';
let currentSort = 'recent';
let items = []; // current page of TargetedItem, for currentTarget/currentFilter/currentSort
let counts = { pending: 0, accepted: 0, rejected: 0 };
let nextCursor = undefined;
let selectedIds = new Set();
let lastClickedId = null;
let focusedIndex = -1;
let lastUndoTimer = null;
let lastAction = null; // array of previous Decisions to restore on undo

// --- Data loading ---

async function loadTargets() {
  const res = await fetch(`${API_BASE}api/targets`);
  const targets = await res.json();
  const sel = document.getElementById('target-switcher');
  sel.innerHTML = targets.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join('');
  if (!targets.some((t) => t.id === currentTarget)) currentTarget = targets[0]?.id ?? 'default';
  sel.value = currentTarget;
}

async function refreshCounts() {
  const [pending, accepted, rejected] = await Promise.all(
    ['pending', 'accepted', 'rejected'].map((status) =>
      fetch(`${API_BASE}api/items?target=${encodeURIComponent(currentTarget)}&status=${status}&limit=1`).then((r) => r.json()),
    ),
  );
  counts = { pending: pending.total, accepted: accepted.total, rejected: rejected.total };
  updateTabStyling();
}

async function loadItems({ append = false } = {}) {
  const params = new URLSearchParams({ target: currentTarget, status: currentFilter, sort: currentSort, limit: '30' });
  if (append && nextCursor) params.set('cursor', nextCursor);
  const res = await fetch(`${API_BASE}api/items?${params}`);
  const data = await res.json();
  items = append ? items.concat(data.items) : data.items;
  nextCursor = data.nextCursor;
  if (!append) {
    selectedIds.clear();
    focusedIndex = items.length ? 0 : -1;
  }
  renderList();
}

function resetAndLoad() {
  nextCursor = undefined;
  loadItems({ append: false });
  refreshCounts();
}

function loadMore() {
  loadItems({ append: true });
}

/** Scopes the bulk toolbar to the same transitions the single-item card already offers for
 *  this tab (see defaultCardHtml) — accepting an already-accepted item, or rejecting an
 *  already-rejected one, is a no-op nobody should be offered in the first place. */
function updateBulkToolbarForFilter() {
  const show = (id, visible) => document.getElementById(id).classList.toggle('hidden', !visible);
  show('bulk-accept-btn', currentFilter === 'pending');
  show('bulk-reject-btn', currentFilter === 'pending' || currentFilter === 'accepted');
  show('bulk-restore-btn', currentFilter === 'rejected');
  show('bulk-rank-group', currentFilter === 'pending');
}

function setFilter(filter) {
  currentFilter = filter;
  // Clear first, synchronously, so the toolbar (and any selection from the previous tab) is
  // gone at the exact moment the tab switches — otherwise it lingers, showing the old tab's
  // selected items with the new tab's button set, until the async refetch below catches up.
  clearSelection();
  updateBulkToolbarForFilter();
  resetAndLoad();
}

// --- Decisions ---

/** @returns {string|null|undefined} note text, or null if the user cancelled (caller should abort) */
function promptRejectNote(count) {
  return window.prompt(count > 1 ? `Reason for rejecting ${count} item(s) (optional):` : 'Reason for rejecting (optional):', '');
}

async function decide(item, status) {
  let note;
  if (status === 'rejected') {
    note = promptRejectNote(1);
    if (note === null) return; // cancelled
  }
  const previous = [{ itemId: item.id, targetId: currentTarget, status: item.status, note: item.note, decidedAt: item.decidedAt }];
  await fetch(`${API_BASE}api/decisions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId: item.id, targetId: currentTarget, status, note: note || undefined }),
  });
  const verb = status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Restored';
  showUndoToast(`${verb} "${item.title}"`, previous);
  resetAndLoad();
}

/** Backward-compat shim: earlier ScoutJS/plugin.js versions call `updateStatus(id, status)`
 *  directly (no target). Kept so a plugin.js written before Targets existed keeps working. */
function updateStatus(id, status) {
  const item = items.find((i) => i.id === id);
  if (!item) return console.warn(`updateStatus: item ${id} not in the current view`);
  return decide(item, status);
}

async function bulkDecide(status) {
  const targets = items.filter((i) => selectedIds.has(i.id));
  if (targets.length === 0) return;
  let note;
  if (status === 'rejected') {
    note = promptRejectNote(targets.length);
    if (note === null) return;
  }
  const previous = targets.map((i) => ({ itemId: i.id, targetId: currentTarget, status: i.status, note: i.note, decidedAt: i.decidedAt }));
  const decisions = targets.map((i) => ({ itemId: i.id, targetId: currentTarget, status, note: note || undefined }));
  await fetch(`${API_BASE}api/decisions/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisions }),
  });
  const verb = status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Restored';
  showUndoToast(`${verb} ${targets.length} item(s)`, previous);
  clearSelection();
  resetAndLoad();
}

function approveVisibleAboveRank() {
  const threshold = Number(document.getElementById('rank-threshold').value);
  if (Number.isNaN(threshold)) return;
  const matching = items.filter((i) => (i.rank ?? -Infinity) >= threshold);
  if (matching.length === 0) {
    alert('No currently visible items meet that rank threshold.');
    return;
  }
  selectedIds = new Set(matching.map((i) => i.id));
  updateSelectionUI();
  bulkDecide('accepted');
}

function showUndoToast(message, previousDecisions) {
  lastAction = previousDecisions;
  document.getElementById('undo-message').textContent = message;
  const toast = document.getElementById('undo-toast');
  toast.classList.remove('hidden');
  clearTimeout(lastUndoTimer);
  lastUndoTimer = setTimeout(() => toast.classList.add('hidden'), 8000);
}

async function undo() {
  if (!lastAction) return;
  const decisions = lastAction;
  lastAction = null;
  document.getElementById('undo-toast').classList.add('hidden');
  await fetch(`${API_BASE}api/decisions/batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisions: decisions.map((d) => ({ itemId: d.itemId, targetId: d.targetId, status: d.status, note: d.note })) }),
  });
  resetAndLoad();
}

// --- Selection ---

function clearSelection() {
  selectedIds.clear();
  updateSelectionUI();
}

function selectRange(fromId, toId) {
  const fromIdx = items.findIndex((i) => i.id === fromId);
  const toIdx = items.findIndex((i) => i.id === toId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  for (let i = start; i <= end; i++) selectedIds.add(items[i].id);
}

function onCheckboxToggle(evt, id) {
  if (evt.shiftKey && lastClickedId) {
    selectRange(lastClickedId, id);
  } else if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  lastClickedId = id;
  updateSelectionUI();
}

function updateSelectionUI() {
  document.querySelectorAll('.item-card').forEach((el) => {
    const id = el.dataset.itemId;
    const cb = el.querySelector('input[type=checkbox]');
    if (cb) cb.checked = selectedIds.has(id);
    el.classList.toggle('is-selected', selectedIds.has(id));
  });
  const toolbar = document.getElementById('bulk-toolbar');
  const countEl = document.getElementById('bulk-count');
  countEl.textContent = `${selectedIds.size} selected`;
  toolbar.classList.toggle('hidden', selectedIds.size === 0);
}

// --- Detail panel (renderDetail plugin hook) ---

function openDetail(id) {
  const item = items.find((i) => i.id === id);
  const panel = document.getElementById('detail-panel');
  const plugin = window.ScoutUIPlugin;
  if (!item || !plugin || !plugin.renderDetail) {
    panel.classList.add('hidden');
    return;
  }
  const html = plugin.renderDetail(item, currentTarget);
  if (!html) {
    panel.classList.add('hidden');
    return;
  }
  panel.innerHTML = html;
  panel.classList.remove('hidden');
}

// --- Actions / scraping (unchanged contract) ---

async function triggerScrape() {
  try {
    const res = await fetch(`${API_BASE}api/scrape`, { method: 'POST' });
    const data = await res.json();
    alert(`Scraping complete. ${data.newItemsCount} new items found.`);
    await loadTargets();
    resetAndLoad();
  } catch (err) {
    console.error('Scrape failed', err);
  }
}

async function executeAction(actionName, itemId) {
  try {
    const res = await fetch(`${API_BASE}api/action/${actionName}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId }),
    });
    const data = await res.json();
    if (data.success) alert(`Action Result: ${JSON.stringify(data.result, null, 2)}`);
    else alert(`Action Failed: ${data.error}`);
  } catch (err) {
    console.error('Action failed', err);
  }
}

// --- Rendering ---

function toggleCollapse() {
  isCollapsed = !isCollapsed;
  const icon = document.getElementById('collapse-icon');
  const text = document.getElementById('collapse-text');
  icon.className = isCollapsed ? 'fa-solid fa-expand text-slate-400' : 'fa-solid fa-compress text-slate-400';
  text.innerText = isCollapsed ? 'Expand Results' : 'Collapse Results';
  renderList();
}

function updateTabStyling() {
  ['pending', 'accepted', 'rejected'].forEach((t) => {
    const el = document.getElementById(`tab-${t}`);
    const countEl = document.getElementById(`count-${t}`);
    if (countEl) countEl.innerText = counts[t] ?? 0;
    if (t === currentFilter) {
      el.className = 'px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-md flex items-center gap-2 transition-all';
      if (countEl) countEl.className = 'px-2 py-0.5 rounded-full bg-white/20 text-white text-[11px] font-mono';
    } else {
      el.className = 'px-4 py-2 rounded-xl text-xs font-bold text-slate-200 hover:text-white hover:bg-[#1b2029] flex items-center gap-2 transition-all';
      if (countEl) {
        if (t === 'pending') countEl.className = 'px-2 py-0.5 rounded-full bg-[#1b2029] text-indigo-300 text-[11px] font-mono border border-[#566276]';
        else if (t === 'accepted') countEl.className = 'px-2 py-0.5 rounded-full bg-[#1b2029] text-emerald-300 text-[11px] font-mono border border-[#566276]';
        else countEl.className = 'px-2 py-0.5 rounded-full bg-[#1b2029] text-rose-300 text-[11px] font-mono border border-[#566276]';
      }
    }
  });
}

function defaultCardHtml(item) {
  let html = `
    <div class="bg-[#262c37] border border-[#566276] rounded-2xl p-5 pl-10 flex flex-col justify-between card-shadow transition hover:border-indigo-500/50 h-full">
      <div>
        <div class="flex justify-between items-start gap-3 mb-2">
          <h3 class="text-base font-bold text-white">${escapeHtml(item.title) || 'Untitled'}</h3>
  `;
  if (item.url) {
    html += `<a href="${escapeHtml(item.url)}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1b2029] hover:bg-[#2b313d] border border-[#566276] text-slate-200 text-[10px] font-bold transition-all shrink-0 mt-0.5"><i class="fa-solid fa-arrow-up-right-from-square"></i> Visit</a>`;
  }
  html += `
        </div>
        ${!isCollapsed ? `<p class="text-xs text-slate-300 mb-4 leading-relaxed">${escapeHtml(item.description)}</p>` : ''}
        ${!isCollapsed ? `<div class="bg-[#1b2029] border border-[#566276] p-3 text-[11px] text-slate-300 rounded-xl overflow-x-auto mb-4 custom-scrollbar font-mono">
          <pre>${escapeHtml(JSON.stringify(item.metadata || {}, null, 2))}</pre>
        </div>` : ''}
      </div>
      <div class="flex items-center justify-between gap-2 mt-4 border-t border-[#566276] pt-4">
  `;
  if (currentFilter === 'pending') {
    html += `<button data-action="reject" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1b2029] hover:bg-rose-900/30 text-rose-400 border border-[#566276] text-xs font-bold transition-all"><i class="fa-solid fa-xmark"></i> Reject</button>`;
    html += `<button data-action="accept" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md shadow-emerald-600/30 transition-all ml-auto"><i class="fa-solid fa-check"></i> Accept</button>`;
  } else if (currentFilter === 'accepted') {
    html += `<button data-action="reject" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1b2029] hover:bg-rose-900/30 text-rose-400 border border-[#566276] text-xs font-bold transition-all"><i class="fa-solid fa-xmark"></i> Reject</button>`;
    html += `<button data-action="test-action" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white shadow-md shadow-sky-600/30 transition-all ml-auto"><i class="fa-solid fa-bolt"></i> Test Action</button>`;
  } else {
    html += `<button data-action="restore" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1b2029] hover:bg-indigo-900/30 text-indigo-300 border border-[#566276] text-xs font-bold transition-all"><i class="fa-solid fa-rotate-left"></i> Restore</button>`;
  }
  html += `</div></div>`;
  return html;
}

function buildCardWrapper(item, innerHtml, focused) {
  const wrapper = document.createElement('div');
  wrapper.className = `item-card relative ${selectedIds.has(item.id) ? 'is-selected' : ''} ${focused ? 'is-focused' : ''}`;
  wrapper.dataset.itemId = item.id;
  wrapper.innerHTML = `
    <label class="absolute top-3 left-3 z-10 cursor-pointer">
      <input type="checkbox" ${selectedIds.has(item.id) ? 'checked' : ''} class="w-4 h-4 accent-indigo-500">
    </label>
    ${innerHtml}
  `;
  wrapper.querySelector('input[type=checkbox]').addEventListener('click', (e) => e.stopPropagation());
  wrapper.querySelector('input[type=checkbox]').addEventListener('change', (e) => onCheckboxToggle(e, item.id));
  wrapper.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('button[data-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === 'accept') decide(item, 'accepted');
      else if (action === 'reject') decide(item, 'rejected');
      else if (action === 'restore') decide(item, 'pending');
      else if (action === 'test-action') executeAction('generate_message', item.id);
      return;
    }
    if (e.target.closest('button, a, input, label')) return;
    openDetail(item.id);
  });
  return wrapper;
}

function renderList() {
  const plugin = window.ScoutUIPlugin;

  if (plugin && plugin.renderCustomFilters && !document.getElementById('injected-filters')) {
    const filtersHtml = plugin.renderCustomFilters();
    if (filtersHtml) {
      const tabsContainer = document.querySelector('.flex.flex-wrap.items-center.gap-2');
      if (tabsContainer && tabsContainer.parentElement) {
        const customDiv = document.createElement('div');
        customDiv.id = 'injected-filters';
        customDiv.innerHTML = filtersHtml;
        tabsContainer.parentElement.appendChild(customDiv);
      }
    }
  }

  updateTabStyling();

  const container = document.getElementById('items-container');
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = `<p class="text-slate-400 font-medium col-span-full">No items in ${currentFilter}.</p>`;
    document.getElementById('load-more-btn').classList.add('hidden');
    return;
  }

  items.forEach((item, idx) => {
    const innerHtml = (plugin && plugin.renderCard && plugin.renderCard(item, currentFilter)) || defaultCardHtml(item);
    container.appendChild(buildCardWrapper(item, innerHtml, idx === focusedIndex));
  });

  document.getElementById('load-more-btn').classList.toggle('hidden', !nextCursor);

  if (plugin && plugin.onRenderEnd) plugin.onRenderEnd(items, container);
}

function scrollFocusedIntoView() {
  const el = document.querySelector('.item-card.is-focused');
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// --- Keyboard shortcuts ---

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  // 'u' (undo) doesn't depend on the current list — it must still fire even when the current
  // filter is empty (e.g. right after accepting the only pending item leaves "No items in
  // pending" on screen, exactly when someone would reach for undo).
  if (e.key === 'u') {
    undo();
    return;
  }
  if (items.length === 0) return;

  switch (e.key) {
    case 'j':
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      renderList();
      scrollFocusedIntoView();
      break;
    case 'k':
      focusedIndex = Math.max(focusedIndex - 1, 0);
      renderList();
      scrollFocusedIntoView();
      break;
    case 'a':
      if (focusedIndex >= 0) decide(items[focusedIndex], 'accepted');
      break;
    case 'r':
      if (focusedIndex >= 0) decide(items[focusedIndex], 'rejected');
      break;
    case 'x':
      if (focusedIndex >= 0) {
        const id = items[focusedIndex].id;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        lastClickedId = id;
        updateSelectionUI();
      }
      break;
  }
});

// --- Init ---

async function init() {
  const params = new URLSearchParams(location.search);
  currentTarget = params.get('target') || 'default';
  await loadTargets();
  document.getElementById('target-switcher').onchange = (e) => {
    currentTarget = e.target.value;
    resetAndLoad();
  };
  document.getElementById('sort-switcher').onchange = (e) => {
    currentSort = e.target.value;
    resetAndLoad();
  };
  updateBulkToolbarForFilter(); // currentFilter defaults to 'pending' before any tab switch
  resetAndLoad();
}

init();
