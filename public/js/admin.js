// public/js/admin.js - Manus AI Admin Management

let adminUsersList = [];
let activeEditUserId = null;

export function initAdmin() {
  bindAdminEvents();
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
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-zinc-500 text-xs"><span class="inline-block animate-spin mr-1">◌</span> Cargando usuarios...</td></tr>`;
  }

  try {
    const res = await fetch('/api/admin/users');
    if (!res.ok) throw new Error('No autorizado o error del servidor');
    adminUsersList = await res.json();
    renderAdminUsersTable();
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-red-400 text-xs">Error: ${err.message}</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-zinc-500 text-xs">No se encontraron usuarios registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const isSuspended = !!u.is_suspended;
    const roleBadge = u.role === 'admin' 
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white text-zinc-950">Admin</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300">Usuario</span>`;
    
    const statusBadge = isSuspended
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] bg-red-500/10 text-red-400 border border-red-500/30">Suspendido</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Activo</span>`;

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
          <button class="btn-edit-user p-1.5 rounded-lg bg-[#282828] hover:bg-[#323232] text-zinc-300 hover:text-white transition-colors" data-id="${u.id}" title="Editar permisos">
            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
          </button>
          <button class="btn-toggle-suspend p-1.5 rounded-lg ${isSuspended ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/15 text-red-400'} hover:opacity-80 transition-colors" data-id="${u.id}" title="${isSuspended ? 'Reactivar' : 'Suspender'}">
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
      const action = user && user.is_suspended ? 'reactivar' : 'suspender';
      if (confirm(`¿Estás seguro de que deseas ${action} la cuenta de ${user?.username}?`)) {
        try {
          const res = await fetch(`/api/admin/users/${id}/suspend`, { method: 'POST' });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al modificar usuario');
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

  document.getElementById('admin-edit-title').textContent = `Editar Usuario: ${user.username}`;
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
      throw new Error(err.error || 'Error al guardar cambios');
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
    if (!res.ok) throw new Error('No autorizado');
    const data = await res.json();

    document.getElementById('stat-total-users').textContent = data.total_users || 0;
    document.getElementById('stat-active-convs').textContent = data.total_conversations || 0;
    document.getElementById('stat-total-messages').textContent = data.total_messages || 0;
    document.getElementById('stat-total-tokens').textContent = (data.total_tokens || 0).toLocaleString();
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
    if (!res.ok) throw new Error('No autorizado');
    const data = await res.json();
    const leaderboard = data.leaderboard || [];

    if (leaderboard.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-zinc-500 text-xs">Sin evaluaciones de modelos registradas aún.</td></tr>`;
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
      tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-red-400 text-xs">Error: ${err.message}</td></tr>`;
    }
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
