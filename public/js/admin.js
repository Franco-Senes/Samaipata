// public/js/admin.js - Samaipata Admin Management & First-time Setup

let adminUsersList = [];
let activeEditUserId = null;

export function initAdmin() {
  bindAdminEvents();
  bindWelcomeModalEvents();
}

export function checkAdminAccess(user) {
  const isAdmin = user && (user.role === 'admin' || user.isAdmin);
  const adminDropdownBtns = document.querySelectorAll('.admin-only-btn');
  adminDropdownBtns.forEach(btn => {
    if (isAdmin) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  });
}

function bindAdminEvents() {
  const adminBackdrop = document.getElementById('admin-modal-backdrop');
  const btnClose = document.getElementById('btn-close-admin-modal');
  const adminDropdownBtn = document.getElementById('btn-dropdown-admin');
  const adminDropdownBtnMarket = document.getElementById('btn-dropdown-admin-marketplace');

  if (adminDropdownBtn) {
    adminDropdownBtn.addEventListener('click', () => {
      document.getElementById('user-popup-menu')?.classList.add('hidden');
      openAdminModal();
    });
  }

  if (adminDropdownBtnMarket) {
    adminDropdownBtnMarket.addEventListener('click', () => {
      document.getElementById('user-popup-menu-marketplace')?.classList.add('hidden');
      openAdminModal();
    });
  }

  if (btnClose) btnClose.addEventListener('click', closeAdminModal);
  if (adminBackdrop) {
    adminBackdrop.addEventListener('click', (e) => {
      if (e.target === adminBackdrop) closeAdminModal();
    });
  }

  // Admin Tab Switcher
  const tabBtns = document.querySelectorAll('.admin-tab-btn');
  const tabContents = document.querySelectorAll('.admin-tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-admin-tab');

      tabBtns.forEach(b => {
        b.className = 'admin-tab-btn px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#242424] transition-all';
      });

      btn.className = 'admin-tab-btn px-4 py-2 rounded-xl text-xs font-medium bg-[#2A2A2A] text-zinc-100 border border-zinc-500 shadow-sm transition-all';

      tabContents.forEach(tc => {
        if (tc.id === `admin-tab-${target}`) {
          tc.classList.remove('hidden');
        } else {
          tc.classList.add('hidden');
        }
      });

      if (target === 'users') loadAdminUsers();
      if (target === 'analytics') loadAdminAnalytics();
      if (target === 'evaluations') loadAdminEvaluations();
      if (target === 'setup') loadAdminSetup();
    });
  });

  // User search input
  const searchInput = document.getElementById('admin-users-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderAdminUsersTable();
    });
  }

  // Save User Edit Form
  const btnSaveUser = document.getElementById('btn-admin-save-user');
  if (btnSaveUser) {
    btnSaveUser.addEventListener('click', saveAdminUser);
  }

  const btnCancelUser = document.getElementById('btn-admin-cancel-user');
  if (btnCancelUser) {
    btnCancelUser.addEventListener('click', hideAdminUserDrawer);
  }

  // Admin Setup Tab actions
  const btnSaveHackClub = document.getElementById('btn-admin-save-hackclub');
  if (btnSaveHackClub) {
    btnSaveHackClub.addEventListener('click', saveAdminHackClubKey);
  }

  const btnRefreshOllama = document.getElementById('btn-admin-refresh-ollama');
  if (btnRefreshOllama) {
    btnRefreshOllama.addEventListener('click', checkAdminOllamaStatus);
  }
}

export function openAdminModal(tab = 'users') {
  const modal = document.getElementById('admin-modal-backdrop');
  if (!modal) return;

  modal.classList.remove('hidden');
  void modal.offsetWidth;
  modal.classList.add('active');

  const tabBtn = document.querySelector(`.admin-tab-btn[data-admin-tab="${tab}"]`);
  if (tabBtn) tabBtn.click();
}

export function closeAdminModal() {
  const modal = document.getElementById('admin-modal-backdrop');
  if (!modal) return;

  modal.classList.remove('active');
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 200);
}

// 1. Users Management
export async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-zinc-500 text-xs"><span class="inline-block animate-spin mr-1">◌</span> Loading users...</td></tr>`;
  }

  try {
    const res = await fetch('/api/admin/users');
    if (!res.ok) throw new Error('Unauthorized or server error');
    adminUsersList = await res.json();
    renderAdminUsersTable();
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-red-400 text-xs">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('admin-users-tbody');
  const searchVal = (document.getElementById('admin-users-search')?.value || '').toLowerCase().trim();
  if (!tbody) return;

  let filtered = adminUsersList;
  if (searchVal) {
    filtered = filtered.filter(u =>
      (u.username && u.username.toLowerCase().includes(searchVal)) ||
      (u.email && u.email.toLowerCase().includes(searchVal)) ||
      (u.role && u.role.toLowerCase().includes(searchVal))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-zinc-500 text-xs">No registered users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const isSuspended = !!u.is_suspended;
    const roleBadge = u.role === 'admin' 
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white text-zinc-950">Admin</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300">User</span>`;
    
    const statusBadge = isSuspended
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] bg-red-500/10 text-red-400 border border-red-500/30">Suspended</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Active</span>`;

    const initials = (u.username || 'U').slice(0, 2).toUpperCase();

    return `
      <tr class="border-b border-[#282828] hover:bg-[#222222]/50 text-xs transition-colors">
        <td class="py-3 px-3">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 text-[10px] font-semibold text-zinc-200 flex items-center justify-center">
              ${initials}
            </div>
            <div>
              <p class="font-medium text-zinc-200">${escapeHtml(u.username)}</p>
              <p class="text-[10px] text-zinc-500">ID: ${u.id}</p>
            </div>
          </div>
        </td>
        <td class="py-3 px-3 text-zinc-400">${escapeHtml(u.email || 'N/A')}</td>
        <td class="py-3 px-3">${roleBadge}</td>
        <td class="py-3 px-3">${statusBadge}</td>
        <td class="py-3 px-3 text-right space-x-1.5">
          <button class="btn-edit-user p-1.5 rounded-lg bg-[#282828] hover:bg-[#323232] text-zinc-300 hover:text-white transition-colors" data-id="${u.id}" title="Edit permissions">
            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
          </button>
          <button class="btn-toggle-suspend p-1.5 rounded-lg ${isSuspended ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/15 text-red-400'} hover:opacity-80 transition-colors" data-id="${u.id}" title="${isSuspended ? 'Reactivate' : 'Suspend'}">
            <i data-lucide="${isSuspended ? 'user-check' : 'user-x'}" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();

  // Attach table actions
  tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      showAdminUserDrawer(id);
    });
  });

  tbody.querySelectorAll('.btn-toggle-suspend').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const user = adminUsersList.find(u => u.id === id);
      const action = user && user.is_suspended ? 'reactivate' : 'suspend';
      if (confirm(`Are you sure you want to ${action} the account of ${user?.username}?`)) {
        try {
          const res = await fetch(`/api/admin/users/${id}/suspend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_suspended: !user.is_suspended })
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error modifying user');
          }
          loadAdminUsers();
        } catch (e) {
          alert(`Error: ${e.message}`);
        }
      }
    });
  });
}

function showAdminUserDrawer(userId) {
  const user = adminUsersList.find(u => u.id === userId);
  if (!user) return;
  activeEditUserId = userId;

  const drawer = document.getElementById('admin-user-drawer');
  if (!drawer) return;

  document.getElementById('admin-edit-title').textContent = `Edit User: ${user.username}`;
  document.getElementById('admin-edit-role').value = user.role || 'user';
  document.getElementById('admin-edit-limit-msgs').value = user.rate_limit_messages || '';
  document.getElementById('admin-edit-limit-tokens').value = user.rate_limit_tokens || '';
  document.getElementById('admin-edit-allowed-models').value = user.allowed_models || '';

  drawer.classList.remove('hidden');
}

function hideAdminUserDrawer() {
  const drawer = document.getElementById('admin-user-drawer');
  if (drawer) drawer.classList.add('hidden');
  activeEditUserId = null;
}

async function saveAdminUser() {
  if (!activeEditUserId) return;

  const role = document.getElementById('admin-edit-role').value;
  const limitMsgs = document.getElementById('admin-edit-limit-msgs').value;
  const limitTokens = document.getElementById('admin-edit-limit-tokens').value;
  const allowedModels = document.getElementById('admin-edit-allowed-models').value.trim();

  try {
    const res = await fetch(`/api/admin/users/${activeEditUserId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role,
        rate_limit_messages: limitMsgs ? parseInt(limitMsgs, 10) : null,
        rate_limit_tokens: limitTokens ? parseInt(limitTokens, 10) : null,
        allowed_models: allowedModels || null
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error saving changes');
    }

    hideAdminUserDrawer();
    loadAdminUsers();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

// 2. Analytics
export async function loadAdminAnalytics() {
  const container = document.getElementById('admin-analytics-container');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/analytics');
    if (!res.ok) throw new Error('Unauthorized');
    const data = await res.json();

    document.getElementById('stat-total-users').textContent = data.stats?.users || data.total_users || 0;
    document.getElementById('stat-active-convs').textContent = data.stats?.conversations || data.total_conversations || 0;
    document.getElementById('stat-total-messages').textContent = data.stats?.messages || data.total_messages || 0;
    document.getElementById('stat-total-tokens').textContent = ((data.stats?.tokens || data.total_tokens) || 0).toLocaleString();
  } catch (err) {
    console.error('Error analytics:', err);
  }
}

// 3. Evaluations (ELO Leaderboard)
export async function loadAdminEvaluations() {
  const tbody = document.getElementById('admin-evals-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/evaluations');
    if (!res.ok) throw new Error('Unauthorized');
    const data = await res.json();
    const leaderboard = data.leaderboard || [];

    if (leaderboard.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-zinc-500 text-xs">No model evaluations recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = leaderboard.map((item, idx) => `
      <tr class="border-b border-[#282828] text-xs">
        <td class="py-2.5 px-3 font-semibold text-zinc-400">#${idx + 1}</td>
        <td class="py-2.5 px-3 font-medium text-zinc-200">${escapeHtml(item.model_name)}</td>
        <td class="py-2.5 px-3 font-mono text-zinc-300">${item.elo || 1200} ELO</td>
        <td class="py-2.5 px-3 text-right text-emerald-400 font-medium">+${item.wins || 0} / -${item.losses || 0}</td>
      </tr>
    `).join('');
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-red-400 text-xs">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

// 4. Admin Setup & AI Services Tab
export async function loadAdminSetup() {
  const token = localStorage.getItem('samaipata_hackclub_token') || localStorage.getItem('samaipata_hackclub_api_key') || '';
  const inputEl = document.getElementById('admin-hackclub-token-input');
  if (inputEl) inputEl.value = token;

  updateHackClubBadge(!!token);
  await checkAdminOllamaStatus();
}

function updateHackClubBadge(hasKey) {
  const badge = document.getElementById('admin-hackclub-status-badge');
  if (!badge) return;

  if (hasKey) {
    badge.className = 'px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
    badge.textContent = 'Configured';
  } else {
    badge.className = 'px-2.5 py-1 rounded-full text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700';
    badge.textContent = 'Not Configured';
  }
}

async function saveAdminHackClubKey() {
  const inputEl = document.getElementById('admin-hackclub-token-input');
  const token = inputEl ? inputEl.value.trim() : '';

  localStorage.setItem('samaipata_hackclub_token', token);
  localStorage.setItem('samaipata_hackclub_api_key', token);

  try {
    await fetch('/api/user/hackclub-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: token })
    });
  } catch (e) {}

  updateHackClubBadge(!!token);
  if (window.loadModels) window.loadModels();

  const btn = document.getElementById('btn-admin-save-hackclub');
  if (btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-600"></i><span>Saved!</span>`;
    setTimeout(() => {
      btn.innerHTML = originalText;
      if (window.lucide) window.lucide.createIcons();
    }, 2000);
  }
}

export async function checkAdminOllamaStatus() {
  const installedEl = document.getElementById('admin-ollama-installed-val');
  const runningEl = document.getElementById('admin-ollama-running-val');
  const modelsEl = document.getElementById('admin-ollama-models-val');
  const listBox = document.getElementById('admin-ollama-models-list-box');
  const tagsContainer = document.getElementById('admin-ollama-models-tags');

  if (installedEl) installedEl.textContent = 'Checking...';
  if (runningEl) runningEl.textContent = 'Checking...';

  try {
    const res = await fetch('/api/system/ollama-status');
    if (!res.ok) throw new Error('Status request failed');
    const data = await res.json();

    if (installedEl) {
      installedEl.textContent = data.installed ? 'Yes (Installed)' : 'Not Found';
      installedEl.className = `text-xs font-semibold mt-1 ${data.installed ? 'text-emerald-400' : 'text-amber-400'}`;
    }

    if (runningEl) {
      runningEl.textContent = data.running ? 'Yes (Online)' : 'No (Offline)';
      runningEl.className = `text-xs font-semibold mt-1 ${data.running ? 'text-emerald-400' : 'text-red-400'}`;
    }

    if (modelsEl) {
      modelsEl.textContent = data.modelsCount || 0;
      modelsEl.className = `text-xs font-semibold mt-1 ${data.modelsCount > 0 ? 'text-emerald-400' : 'text-zinc-400'}`;
    }

    if (listBox && tagsContainer) {
      if (data.models && data.models.length > 0) {
        tagsContainer.innerHTML = data.models.map(m => `
          <span class="px-2 py-0.5 bg-[#2A2A2A] border border-[#3A3A3A] rounded-lg text-zinc-300 font-mono text-[11px]">${escapeHtml(m)}</span>
        `).join('');
        listBox.classList.remove('hidden');
      } else {
        listBox.classList.add('hidden');
      }
    }
  } catch (err) {
    if (installedEl) installedEl.textContent = 'Error';
    if (runningEl) runningEl.textContent = 'Error';
  }
}

// 5. First-Time Admin Welcome & Setup Modal
function bindWelcomeModalEvents() {
  const modal = document.getElementById('admin-welcome-modal');
  const btnSkip = document.getElementById('btn-welcome-skip');
  const btnComplete = document.getElementById('btn-welcome-complete');
  const btnSaveHackClub = document.getElementById('btn-welcome-save-hackclub');
  const btnRefreshOllama = document.getElementById('btn-welcome-refresh-ollama');

  if (btnSkip) {
    btnSkip.addEventListener('click', () => {
      markSetupDone();
      closeAdminWelcomeModal();
    });
  }

  if (btnComplete) {
    btnComplete.addEventListener('click', async () => {
      const input = document.getElementById('welcome-hackclub-input');
      if (input && input.value.trim()) {
        const val = input.value.trim();
        localStorage.setItem('samaipata_hackclub_token', val);
        localStorage.setItem('samaipata_hackclub_api_key', val);
        try {
          await fetch('/api/user/hackclub-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: val })
          });
        } catch (e) {}
      }

      await markSetupDone();
      if (window.loadModels) window.loadModels();
      closeAdminWelcomeModal();
    });
  }

  if (btnSaveHackClub) {
    btnSaveHackClub.addEventListener('click', async () => {
      const input = document.getElementById('welcome-hackclub-input');
      const val = input ? input.value.trim() : '';
      localStorage.setItem('samaipata_hackclub_token', val);
      localStorage.setItem('samaipata_hackclub_api_key', val);
      try {
        await fetch('/api/user/hackclub-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: val })
        });
      } catch (e) {}

      const statusEl = document.getElementById('welcome-hackclub-status');
      if (statusEl) {
        statusEl.textContent = val ? 'Status: Key saved!' : 'Status: Cleared';
        statusEl.className = `text-xs ${val ? 'text-emerald-400' : 'text-zinc-400'}`;
      }
      if (window.loadModels) window.loadModels();
    });
  }

  if (btnRefreshOllama) {
    btnRefreshOllama.addEventListener('click', checkWelcomeOllamaStatus);
  }

  // Welcome modal tabs
  const tabBtns = document.querySelectorAll('.welcome-tab-btn');
  const panes = document.querySelectorAll('.welcome-tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-welcome-tab');

      tabBtns.forEach(b => {
        b.className = 'welcome-tab-btn flex-1 py-1.5 px-3 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#242424] transition-all';
      });

      btn.className = 'welcome-tab-btn flex-1 py-1.5 px-3 rounded-xl text-xs font-medium bg-[#2A2A2A] text-zinc-100 border border-zinc-500 shadow-sm transition-all';

      panes.forEach(pane => {
        if (pane.id === `welcome-tab-${target}`) {
          pane.classList.remove('hidden');
        } else {
          pane.classList.add('hidden');
        }
      });
    });
  });
}

export async function openAdminWelcomeModal() {
  const modal = document.getElementById('admin-welcome-modal');
  if (!modal) return;

  const token = localStorage.getItem('samaipata_hackclub_token') || localStorage.getItem('samaipata_hackclub_api_key') || '';
  const input = document.getElementById('welcome-hackclub-input');
  if (input) input.value = token;

  const statusEl = document.getElementById('welcome-hackclub-status');
  if (statusEl) {
    statusEl.textContent = token ? 'Status: Key saved' : 'Status: Not configured';
    statusEl.className = `text-xs ${token ? 'text-emerald-400' : 'text-zinc-400'}`;
  }

  modal.classList.remove('hidden');
  void modal.offsetWidth;
  modal.classList.add('active');

  await checkWelcomeOllamaStatus();
  if (window.lucide) window.lucide.createIcons();
}

export function closeAdminWelcomeModal() {
  const modal = document.getElementById('admin-welcome-modal');
  if (!modal) return;

  modal.classList.remove('active');
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 200);
}

async function markSetupDone() {
  localStorage.setItem('samaipata_admin_setup_done', 'true');
  try {
    await fetch('/api/admin/complete-setup', { method: 'POST' });
  } catch (e) {}
}

async function checkWelcomeOllamaStatus() {
  const installedBadge = document.getElementById('welcome-ollama-installed-badge');
  const runningBadge = document.getElementById('welcome-ollama-running-badge');
  const modelsCount = document.getElementById('welcome-ollama-models-count');

  if (installedBadge) installedBadge.textContent = 'Checking...';
  if (runningBadge) runningBadge.textContent = 'Checking...';

  try {
    const res = await fetch('/api/system/ollama-status');
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();

    if (installedBadge) {
      installedBadge.textContent = data.installed ? 'Yes' : 'Not found in PATH';
      installedBadge.className = `font-medium ${data.installed ? 'text-emerald-400' : 'text-amber-400'}`;
    }

    if (runningBadge) {
      runningBadge.textContent = data.running ? 'Running' : 'Offline';
      runningBadge.className = `font-medium ${data.running ? 'text-emerald-400' : 'text-red-400'}`;
    }

    if (modelsCount) {
      modelsCount.textContent = `${data.modelsCount || 0} local model(s)`;
      modelsCount.className = `font-medium ${(data.modelsCount || 0) > 0 ? 'text-emerald-400' : 'text-zinc-400'}`;
    }
  } catch (err) {
    if (installedBadge) installedBadge.textContent = 'Unknown';
    if (runningBadge) runningBadge.textContent = 'Offline';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
