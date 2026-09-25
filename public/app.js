
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let isCollapsed = false;

function toggleCollapse() {
  isCollapsed = !isCollapsed;
  const btn = document.getElementById('collapse-btn');
  const icon = document.getElementById('collapse-icon');
  const text = document.getElementById('collapse-text');
  
  if (isCollapsed) {
    icon.className = 'fa-solid fa-expand text-slate-400';
    text.innerText = 'Expand Results';
  } else {
    icon.className = 'fa-solid fa-compress text-slate-400';
    text.innerText = 'Collapse Results';
  }
  render();
}

let currentFilter = 'pending';
let allItems = { pending: [], accepted: [], rejected: [] };

async function loadData() {
  try {
    const res = await fetch('/api/items');
    allItems = await res.json();
    render();
  } catch (err) {
    console.error('Failed to load items', err);
  }
}

async function updateStatus(id, status) {
  try {
    await fetch(`/api/items/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    loadData();
  } catch (err) {
    console.error('Failed to update status', err);
  }
}

async function triggerScrape() {
  try {
    const res = await fetch('/api/scrape', { method: 'POST' });
    const data = await res.json();
    alert(`Scraping complete. ${data.newItemsCount} new items found.`);
    loadData();
  } catch (err) {
    console.error('Scrape failed', err);
  }
}

async function executeAction(actionName, itemId) {
  try {
    const res = await fetch(`/api/action/${actionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId })
    });
    const data = await res.json();
    if (data.success) {
      alert(`Action Result: ${JSON.stringify(data.result, null, 2)}`);
    } else {
      alert(`Action Failed: ${data.error}`);
    }
  } catch (err) {
    console.error('Action failed', err);
  }
}

function setFilter(filter) {
  currentFilter = filter;
  render();
}

function render() {
  const plugin = window.ScoutUIPlugin;

  // Inject custom filters if plugin provides them
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

  const container = document.getElementById('items-container');
  container.innerHTML = '';
  
  // Update Tab Styling & Counts
  const tabs = ['pending', 'accepted', 'rejected'];
  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const countEl = document.getElementById(`count-${t}`);
    const count = (allItems[t] || []).length;
    
    if (countEl) countEl.innerText = count;
    
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

  const items = allItems[currentFilter] || [];
  
  if (items.length === 0) {
    container.innerHTML = `<p class="text-slate-400 font-medium col-span-full">No items in ${currentFilter}.</p>`;
    return;
  }
  
  
  items.forEach(item => {
    if (plugin && plugin.renderCard) {
      const customHtml = plugin.renderCard(item, currentFilter);
      if (customHtml) {
        const div = document.createElement('div');
        div.innerHTML = customHtml.trim();
        container.appendChild(div.firstChild);
        return;
      }
    }
    
    const card = document.createElement('div');
    card.className = 'bg-[#262c37] border border-[#566276] rounded-2xl p-5 flex flex-col justify-between card-shadow transition hover:border-indigo-500/50';

    
    let html = `
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
      html += `<button onclick="updateStatus('${item.id}', 'rejected')" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1b2029] hover:bg-rose-900/30 text-rose-400 border border-[#566276] text-xs font-bold transition-all"><i class="fa-solid fa-xmark"></i> Reject</button>`;
      html += `<button onclick="updateStatus('${item.id}', 'accepted')" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md shadow-emerald-600/30 transition-all ml-auto"><i class="fa-solid fa-check"></i> Accept</button>`;
    } else if (currentFilter === 'accepted') {
      html += `<button onclick="updateStatus('${item.id}', 'rejected')" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1b2029] hover:bg-rose-900/30 text-rose-400 border border-[#566276] text-xs font-bold transition-all"><i class="fa-solid fa-xmark"></i> Reject</button>`;
      html += `<button onclick="executeAction('generate_message', '${item.id}')" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white shadow-md shadow-sky-600/30 transition-all ml-auto"><i class="fa-solid fa-bolt"></i> Test Action</button>`;
    } else {
       html += `<button onclick="updateStatus('${item.id}', 'pending')" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1b2029] hover:bg-indigo-900/30 text-indigo-300 border border-[#566276] text-xs font-bold transition-all"><i class="fa-solid fa-rotate-left"></i> Restore</button>`;
    }
    
    html += `</div>`;
    card.innerHTML = html;
    container.appendChild(card);
  });

  if (plugin && plugin.onRenderEnd) {
    plugin.onRenderEnd(items, container);
  }

}

// Init
loadData();
