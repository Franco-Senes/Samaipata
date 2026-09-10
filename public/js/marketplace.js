// public/js/marketplace.js

// Global Fetch Interceptor
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  const token = localStorage.getItem('samaipata_token');
  if (token) {
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      options.headers.set('Authorization', `Bearer ${token}`);
    } else if (Array.isArray(options.headers)) {
      const authIdx = options.headers.findIndex(h => h[0].toLowerCase() === 'authorization');
      if (authIdx !== -1) options.headers[authIdx][1] = `Bearer ${token}`;
      else options.headers.push(['Authorization', `Bearer ${token}`]);
    } else {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return originalFetch(url, options);
};

let installedModels = [];
let marketplaceModels = [];
let activeFilter = 'all';
let selectedModelVariants = {};
let currentPullingModel = null;

const OLLAMA_CATALOG = [
  {
    name: 'gemini-2.5-flash',
    title: 'Gemini 2.5 Flash',
    desc: 'Google - Flagship multimodal model offering cutting-edge speed, reasoning, and multimodal capabilities.',
    downloads: '15M',
    updated: 'Just now',
    category: 'Vision',
    variants: [
      { tag: 'flash', size: 'Cloud API', context: '1M' }
    ]
  },
  {
    name: 'gemini-2.5-pro',
    title: 'Gemini 2.5 Pro',
    desc: 'Google - Premier frontier model for deep reasoning, advanced programming, and massive context recall.',
    downloads: '11M',
    updated: 'Just now',
    category: 'Reasoning',
    variants: [
      { tag: 'pro', size: 'Cloud API', context: '2M' }
    ]
  },
  {
    name: 'gemini-2.0-flash',
    title: 'Gemini 2.0 Flash',
    desc: 'Google - Next-generation multimodal model with ultra-low latency and superior tool calling.',
    downloads: '14.2M',
    updated: '1 week ago',
    category: 'Vision',
    variants: [
      { tag: 'flash', size: 'Cloud API', context: '1M' }
    ]
  },
  {
    name: 'gemma3',
    title: 'Gemma 3',
    desc: 'Google - Next-generation open model family built using the same research and technology behind Gemini models.',
    downloads: '1.2M',
    updated: '1 week ago',
    category: 'General',
    variants: [
      { tag: '270m', size: '162MB', context: '128K' },
      { tag: '4b', size: '2.8GB', context: '128K' },
      { tag: '12b', size: '7.8GB', context: '128K' },
      { tag: '27b', size: '16GB', context: '128K' }
    ]
  },
  {
    name: 'gemma2',
    title: 'Gemma 2',
    desc: 'Google - High-efficiency open model family featuring an advanced architecture for superior reasoning.',
    downloads: '5.6M',
    updated: '4 months ago',
    category: 'General',
    variants: [
      { tag: '2b', size: '1.6GB', context: '8K' },
      { tag: '9b', size: '5.4GB', context: '8K' },
      { tag: '27b', size: '16GB', context: '8K' }
    ]
  },
  {
    name: 'codegemma',
    title: 'CodeGemma',
    desc: 'Google - Specialized open model for code completion, generation, and code understanding.',
    downloads: '3.8M',
    updated: '5 months ago',
    category: 'Coding',
    variants: [
      { tag: '2b', size: '1.6GB', context: '8K' },
      { tag: '7b', size: '5.0GB', context: '8K' }
    ]
  },
  {
    name: 'deepseek-r1',
    title: 'DeepSeek-R1',
    desc: 'DeepSeek - Advanced first-tier reasoning models capable of solving complex math, coding, and logical tasks.',
    downloads: '8.4M',
    updated: '2 weeks ago',
    category: 'Reasoning',
    variants: [
      { tag: '1.5b', size: '1.1GB', context: '128K' },
      { tag: '7b', size: '4.7GB', context: '128K' },
      { tag: '8b', size: '4.9GB', context: '128K' },
      { tag: '14b', size: '9.0GB', context: '128K' },
      { tag: '32b', size: '20GB', context: '128K' },
      { tag: '70b', size: '43GB', context: '128K' }
    ]
  },
  {
    name: 'llama3.2',
    title: 'Llama 3.2',
    desc: 'Meta - Lightweight models optimized for fast local inference with minimal resource consumption.',
    downloads: '6.1M',
    updated: '3 weeks ago',
    category: 'General',
    variants: [
      { tag: '1b', size: '1.3GB', context: '128K' },
      { tag: '3b', size: '2.0GB', context: '128K' }
    ]
  },
  {
    name: 'llama3.2-vision',
    title: 'Llama 3.2 Vision',
    desc: 'Meta - Multimodal models optimized for visual analysis and combined reasoning over images and text.',
    downloads: '2.9M',
    updated: '1 month ago',
    category: 'Vision',
    variants: [
      { tag: '11b', size: '7.9GB', context: '128K' },
      { tag: '90b', size: '55GB', context: '128K' }
    ]
  },
  {
    name: 'qwen2.5-coder',
    title: 'Qwen 2.5 Coder',
    desc: 'Alibaba - Specialized in code generation and refactoring with support for up to 128k context tokens.',
    downloads: '5.2M',
    updated: '1 week ago',
    category: 'Coding',
    variants: [
      { tag: '1.5b', size: '986MB', context: '128K' },
      { tag: '7b', size: '4.7GB', context: '128K' },
      { tag: '14b', size: '9.0GB', context: '128K' },
      { tag: '32b', size: '20GB', context: '128K' }
    ]
  },
  {
    name: 'mistral',
    title: 'Mistral 7B',
    desc: 'Mistral AI - Compact 7B parameter model with high performance in language understanding and analytical tasks.',
    downloads: '4.5M',
    updated: '1 month ago',
    category: 'General',
    variants: [
      { tag: '7b', size: '4.1GB', context: '32K' }
    ]
  },
  {
    name: 'phi4',
    title: 'Phi-4',
    desc: 'Microsoft - 14B model focused on high-precision synthetic reasoning and advanced mathematics.',
    downloads: '3.1M',
    updated: '2 weeks ago',
    category: 'Reasoning',
    variants: [
      { tag: '14b', size: '9.1GB', context: '128K' }
    ]
  }
];

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initLucide();
  initSidebar();
  initFilters();
  initSearch();
  initPromptsManager();
  initUserSession();
  fetchModels();
});

function initTheme() {
  const savedTheme = localStorage.getItem('samaipata_theme') || 'dark';
  if (savedTheme === 'dark' || (savedTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  const btnTheme = document.getElementById('btn-theme-toggle');
  const btnThemeStrip = document.getElementById('btn-theme-toggle-strip');
  const toggle = () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('samaipata_theme', isDark ? 'dark' : 'light');
  };

  if (btnTheme) btnTheme.addEventListener('click', toggle);
  if (btnThemeStrip) btnThemeStrip.addEventListener('click', toggle);
}

function initLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function initSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const btnExpand = document.getElementById('btn-expand-sidebar');
  const btnCollapse = document.getElementById('btn-collapse-sidebar');

  const savedState = localStorage.getItem('samaipata_sidebar_state') || 'open';

  const setSidebarState = (state) => {
    if (!sidebar) return;
    if (state === 'closed') {
      sidebar.classList.remove('sidebar-expanded');
      sidebar.classList.add('sidebar-collapsed');
      localStorage.setItem('samaipata_sidebar_state', 'closed');
    } else {
      sidebar.classList.remove('sidebar-collapsed');
      sidebar.classList.add('sidebar-expanded');
      localStorage.setItem('samaipata_sidebar_state', 'open');
    }
  };

  setSidebarState(savedState);

  if (btnExpand) btnExpand.addEventListener('click', () => setSidebarState('open'));
  if (btnCollapse) btnCollapse.addEventListener('click', () => setSidebarState('closed'));
}

function initUserSession() {
  const userJson = localStorage.getItem('samaipata_user');
  const avatarEl = document.getElementById('sidebar-user-avatar');
  const avatarStripEl = document.getElementById('sidebar-user-avatar-strip');
  const userNameEl = document.getElementById('sidebar-user-name');
  const dropdownAvatarEl = document.getElementById('dropdown-user-avatar');
  const dropdownNameEl = document.getElementById('dropdown-user-name');
  const btnOpenUserMenu = document.getElementById('btn-open-user-menu');
  const userPopupMenu = document.getElementById('user-popup-menu-marketplace');
  const btnMarketplaceLogout = document.getElementById('btn-marketplace-logout');

  if (userJson) {
    try {
      const user = JSON.parse(userJson);
      const initials = (user.username || 'FS').slice(0, 2).toUpperCase();
      if (avatarEl) avatarEl.textContent = initials;
      if (avatarStripEl) avatarStripEl.textContent = initials;
      if (userNameEl) userNameEl.textContent = user.username || 'Franco';
      if (dropdownAvatarEl) dropdownAvatarEl.textContent = initials;
      if (dropdownNameEl) dropdownNameEl.textContent = user.username || 'Franco';
    } catch (e) {}
  }

  if (btnOpenUserMenu && userPopupMenu) {
    btnOpenUserMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      userPopupMenu.classList.toggle('hidden');
    });
  }

  document.addEventListener('click', (e) => {
    if (userPopupMenu && !userPopupMenu.contains(e.target) && e.target !== btnOpenUserMenu) {
      userPopupMenu.classList.add('hidden');
    }
  });

  if (btnMarketplaceLogout) {
    btnMarketplaceLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {}
      localStorage.removeItem('samaipata_token');
      localStorage.removeItem('samaipata_user');
      document.cookie = 'samaipata_session=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      window.location.href = 'login.html';
    });
  }
}

function initFilters() {
  const filterButtons = document.querySelectorAll('.filter-btn');
  const btnNewPrompt = document.getElementById('btn-new-prompt');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter');

      const promptsSection = document.getElementById('prompts-section');
      const modelsGrid = document.getElementById('models-grid');

      if (activeFilter === 'prompts') {
        if (promptsSection) promptsSection.classList.remove('hidden');
        if (modelsGrid) modelsGrid.classList.add('hidden');
        if (btnNewPrompt) btnNewPrompt.classList.remove('hidden');
        renderPrompts();
      } else {
        if (promptsSection) promptsSection.classList.add('hidden');
        if (modelsGrid) modelsGrid.classList.remove('hidden');
        if (btnNewPrompt) btnNewPrompt.classList.add('hidden');
        renderModels();
      }
    });
  });
}

function initSearch() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (activeFilter === 'prompts') {
        renderPrompts();
      } else {
        renderModels();
      }
    });
  }
}

async function fetchModels() {
  const grid = document.getElementById('models-grid');
  if (grid) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        Loading models...
      </div>
    `;
  }

  try {
    const resLocal = await fetch('/api/models');
    if (resLocal.ok) {
      const dataLocal = await resLocal.json();
      const raw = Array.isArray(dataLocal) ? dataLocal : (dataLocal.models || []);
      installedModels = raw.map(m => ({
        ...m,
        isInstalled: true,
        source: 'local'
      }));
    }

    const resMarket = await fetch('/api/marketplace/models');
    if (resMarket.ok) {
      const dataMarket = await resMarket.json();
      const rawM = Array.isArray(dataMarket) ? dataMarket : (dataMarket.models || []);
      marketplaceModels = rawM.map(m => ({
        ...m,
        isInstalled: installedModels.some(im => im.name.toLowerCase().startsWith(m.name.toLowerCase()) || m.name.toLowerCase().startsWith(im.name.toLowerCase())),
        source: m.source || 'local'
      }));
    }
  } catch (err) {
    console.error('Error loading models:', err);
  } finally {
    renderModels();
  }
}

function renderModels() {
  const grid = document.getElementById('models-grid');
  const countBadge = document.getElementById('models-count-badge');
  const searchVal = (document.getElementById('search-input')?.value || '').toLowerCase();
  if (!grid) return;

  const catalogMap = new Map();

  // 1. Add all marketplace models from API
  marketplaceModels.forEach(m => {
    const key = m.name.toLowerCase();
    const isInstalled = installedModels.some(im => im.name.toLowerCase().startsWith(key) || key.startsWith(im.name.toLowerCase()));
    
    let variants = [];
    if (Array.isArray(m.variants) && m.variants.length > 0) {
      variants = m.variants.map(v => typeof v === 'string' ? { tag: v, size: 'Auto', context: '128K' } : v);
    } else if (Array.isArray(m.labels) && m.labels.length > 0) {
      variants = m.labels.map(l => ({ tag: l, size: 'Auto', context: '128K' }));
    } else {
      variants = [{ tag: 'latest', size: 'Auto', context: '128K' }];
    }

    catalogMap.set(key, {
      name: m.name || m.model_identifier,
      title: m.title || m.model_name || m.name,
      description: m.description || m.desc || 'Advanced language model for local inference.',
      category: m.category || 'General',
      downloads: m.downloads ? `${m.downloads}` : (m.pulls ? `${Math.round(m.pulls / 1000)}k` : 'N/A'),
      variants,
      isInstalled,
      source: m.source || 'local'
    });
  });

  // 2. Complement with curated OLLAMA_CATALOG metadata
  OLLAMA_CATALOG.forEach(catItem => {
    const key = catItem.name.toLowerCase();
    const isInstalled = installedModels.some(im => im.name.toLowerCase().startsWith(key));
    const existing = catalogMap.get(key);

    if (existing) {
      existing.title = catItem.title;
      existing.description = catItem.desc;
      existing.category = catItem.category;
      existing.downloads = catItem.downloads || existing.downloads;
      if (catItem.variants && catItem.variants.length > 0) {
        existing.variants = catItem.variants;
      }
      existing.isInstalled = isInstalled || existing.isInstalled;
    } else {
      catalogMap.set(key, {
        name: catItem.name,
        title: catItem.title,
        description: catItem.desc,
        category: catItem.category,
        downloads: catItem.downloads,
        variants: catItem.variants,
        isInstalled,
        source: 'local'
      });
    }
  });

  // 3. Add any installed models not in catalog
  installedModels.forEach(m => {
    const baseName = m.name.split(':')[0].toLowerCase();
    const tag = m.name.split(':')[1] || 'latest';
    if (!catalogMap.has(baseName)) {
      catalogMap.set(baseName, {
        name: m.name,
        title: m.name,
        description: `Local installed model (${formatBytes(m.size || 0)})`,
        category: 'Local',
        variants: [{ tag, size: formatBytes(m.size || 0), context: '128K' }],
        isInstalled: true,
        source: 'local'
      });
    } else {
      const entry = catalogMap.get(baseName);
      entry.isInstalled = true;
    }
  });

  let models = Array.from(catalogMap.values());

  if (activeFilter === 'local') {
    models = models.filter(m => m.isInstalled);
  } else if (activeFilter === 'cloud') {
    models = models.filter(m => m.source === 'cloud' || !m.isInstalled);
  }

  if (searchVal) {
    models = models.filter(m =>
      (m.name && m.name.toLowerCase().includes(searchVal)) ||
      (m.title && m.title.toLowerCase().includes(searchVal)) ||
      (m.description && m.description.toLowerCase().includes(searchVal)) ||
      (m.category && m.category.toLowerCase().includes(searchVal)) ||
      (m.variants && m.variants.some(v => v.tag && v.tag.toLowerCase().includes(searchVal)))
    );
  }

  if (countBadge) {
    countBadge.textContent = `${models.length} models`;
  }

  if (models.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 48px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No models found matching the selected filters.
      </div>
    `;
    return;
  }

  grid.innerHTML = models.map(m => {
    const defaultTag = (m.variants && m.variants[0]?.tag) || 'latest';
    const activeTag = selectedModelVariants[m.name] || defaultTag;
    const activeVariant = (m.variants && m.variants.find(v => v.tag === activeTag)) || (m.variants && m.variants[0]) || { size: 'N/A' };
    const fullName = `${m.name}:${activeTag}`;
    const isThisInstalled = installedModels.some(im => im.name.toLowerCase() === fullName.toLowerCase() || im.name.toLowerCase() === m.name.toLowerCase());
    const isPulling = currentPullingModel === fullName;

    return `
      <div class="model-card">
        <div class="model-card-top">
          <div class="model-header-row">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h3 class="model-name">${escapeHtml(m.title || m.name)}</h3>
                <span class="model-category-badge">${escapeHtml(m.category || 'General')}</span>
              </div>
              <p class="model-meta-subtitle">
                ${m.downloads ? `${m.downloads} downloads • ` : ''}${activeVariant.size || 'Local'}
              </p>
            </div>

            <span class="status-badge ${isThisInstalled ? 'installed' : 'available'}">
              ${isThisInstalled ? 'Installed' : 'Available'}
            </span>
          </div>

          <p class="model-desc">
            ${escapeHtml(m.description)}
          </p>

          ${m.variants && m.variants.length > 1 ? `
            <div class="variants-container">
              <span class="variants-label">Variants</span>
              <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                ${m.variants.map(v => `
                  <button type="button" onclick="window.selectVariant('${escapeHtml(m.name)}', '${escapeHtml(v.tag)}')" class="variant-pill ${v.tag === activeTag ? 'active' : ''}">
                    ${escapeHtml(v.tag)} (${escapeHtml(v.size)})
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>

        <div class="model-card-footer">
          <span class="model-fullname">
            ${escapeHtml(fullName)}
          </span>

          <div style="display: flex; align-items: center; gap: 6px;">
            ${isThisInstalled
              ? `
                <button type="button" onclick="window.useModelInChat('${escapeHtml(fullName)}')" class="btn btn-primary">
                  <span>Chat</span>
                  <i data-lucide="arrow-up-right" style="width: 14px; height: 14px;"></i>
                </button>
                <button type="button" onclick="window.deleteModel('${escapeHtml(fullName)}')" class="icon-btn danger" title="Delete model">
                  <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
              `
              : `
                <button type="button" onclick="window.pullModel('${escapeHtml(fullName)}')" ${isPulling ? 'disabled' : ''} class="btn btn-secondary">
                  <i data-lucide="download" style="width: 14px; height: 14px;"></i>
                  <span>${isPulling ? 'Downloading...' : 'Download'}</span>
                </button>
              `
            }
          </div>
        </div>
      </div>
    `;
  }).join('');

  initLucide();
}

window.selectVariant = function(modelName, tag) {
  selectedModelVariants[modelName] = tag;
  renderModels();
};

window.pullModel = async function(modelName) {
  if (currentPullingModel) {
    alert('A download is already in progress: ' + currentPullingModel);
    return;
  }

  currentPullingModel = modelName;
  openPullProgressModal(modelName);

  try {
    const res = await fetch('/api/models/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, model_name: modelName })
    });

    if (!res.ok) {
      throw new Error(`Server error (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const raw = trimmed.replace(/^data:\s*/, '').trim();
          if (!raw) continue;
          try {
            const data = JSON.parse(raw);
            updatePullProgress(data);
          } catch (e) {}
        }
      }
    }

    completePullProgress(true, `Model ${modelName} downloaded successfully.`);
    await fetchModels();
  } catch (err) {
    completePullProgress(false, `Download failed: ${err.message}`);
  } finally {
    currentPullingModel = null;
  }
};

function openPullProgressModal(modelName) {
  let modal = document.getElementById('pull-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pull-modal';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-card" style="max-width: 440px; padding: 24px; flex-direction: column;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <h3 style="font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          <i data-lucide="download-cloud" style="width: 16px; height: 16px;"></i>
          <span>Downloading: <strong>${escapeHtml(modelName)}</strong></span>
        </h3>
      </div>

      <div style="margin-bottom: 16px;">
        <div class="progress-bar-track">
          <div id="pull-progress-bar" class="progress-bar-fill" style="width: 0%"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
          <span id="pull-status-text">Starting download...</span>
          <span id="pull-percent-text">0%</span>
        </div>
      </div>

      <div id="pull-modal-actions" style="display: flex; justify-content: flex-end; padding-top: 8px;">
        <button id="btn-close-pull" class="btn btn-secondary hidden" onclick="document.getElementById('pull-modal').remove()">
          Close
        </button>
      </div>
    </div>
  `;

  initLucide();
}

function updatePullProgress(data) {
  const bar = document.getElementById('pull-progress-bar');
  const statusText = document.getElementById('pull-status-text');
  const percentText = document.getElementById('pull-percent-text');

  if (statusText && data.status) {
    statusText.textContent = data.status;
  }

  if (data.total && data.completed) {
    const percent = Math.min(100, Math.round((data.completed / data.total) * 100));
    if (bar) bar.style.width = `${percent}%`;
    if (percentText) percentText.textContent = `${percent}% (${formatBytes(data.completed)} / ${formatBytes(data.total)})`;
  }
}

function completePullProgress(success, msg) {
  const statusText = document.getElementById('pull-status-text');
  const bar = document.getElementById('pull-progress-bar');
  const closeBtn = document.getElementById('btn-close-pull');

  if (bar) {
    bar.style.width = '100%';
    if (!success) bar.classList.add('error');
  }

  if (statusText) {
    statusText.textContent = msg;
    statusText.style.color = success ? 'var(--text-main)' : '#ef4444';
  }

  if (closeBtn) {
    closeBtn.classList.remove('hidden');
  }
}

window.deleteModel = async function(modelName) {
  if (!confirm(`Are you sure you want to delete local model ${modelName}?`)) return;

  try {
    const res = await fetch(`/api/models/${encodeURIComponent(modelName)}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Failed to delete model');

    installedModels = installedModels.filter(m => m.name !== modelName);
    renderModels();
  } catch (err) {
    alert(err.message || 'Failed to delete model');
  }
};

window.useModelInChat = function(modelName) {
  localStorage.setItem('samaipata_default_model', modelName);
  localStorage.setItem('samaipata_selected_model', modelName);
  window.location.href = `index.html?model=${encodeURIComponent(modelName)}`;
};

// System Prompts Manager
function initPromptsManager() {
  const btnNewPrompt = document.getElementById('btn-new-prompt');
  if (btnNewPrompt) {
    btnNewPrompt.addEventListener('click', () => openPromptEditor());
  }
}

function getStoredPrompts() {
  const defaultPrompts = [
    {
      id: 'default-coding',
      title: 'Senior Software Engineer',
      description: 'Expert in clean code, scalable architectures, and best practices.',
      prompt: 'You are a world-class principal software engineer. Respond with concise solutions, clean, modular, and well-structured code.'
    },
    {
      id: 'default-analyst',
      title: 'Analyst & Strategist',
      description: 'Data structuring, executive synthesis, and critical analysis.',
      prompt: 'You are a strategic analyst. Break down complex problems into comprehensible parts and present clear findings in structured bullet points.'
    }
  ];

  try {
    const saved = localStorage.getItem('samaipata_custom_prompts');
    return saved ? JSON.parse(saved) : defaultPrompts;
  } catch (e) {
    return defaultPrompts;
  }
}

function saveStoredPrompts(prompts) {
  localStorage.setItem('samaipata_custom_prompts', JSON.stringify(prompts));
}

function renderPrompts() {
  const container = document.getElementById('prompts-list');
  const searchVal = (document.getElementById('search-input')?.value || '').toLowerCase();
  if (!container) return;

  let prompts = getStoredPrompts();
  if (searchVal) {
    prompts = prompts.filter(p =>
      p.title.toLowerCase().includes(searchVal) ||
      p.description.toLowerCase().includes(searchVal) ||
      p.prompt.toLowerCase().includes(searchVal)
    );
  }

  if (prompts.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 48px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No saved System Prompts found. Create your first one!
      </div>
    `;
    return;
  }

  container.innerHTML = prompts.map(p => `
    <div class="prompt-card">
      <div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <h3 style="font-size: 0.95rem; font-weight: 600; color: var(--text-main);">${escapeHtml(p.title)}</h3>
          <div style="display: flex; align-items: center; gap: 4px;">
            <button type="button" onclick="window.editPrompt('${p.id}')" class="icon-btn" title="Edit">
              <i data-lucide="edit-2" style="width: 14px; height: 14px;"></i>
            </button>
            <button type="button" onclick="window.deletePrompt('${p.id}')" class="icon-btn danger" title="Delete">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">${escapeHtml(p.description || '')}</p>
        <div style="background: var(--bg-input); padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 0.75rem; color: var(--text-muted); font-family: monospace; margin-bottom: 14px; max-height: 80px; overflow-y: auto;">
          ${escapeHtml(p.prompt)}
        </div>
      </div>

      <div style="padding-top: 12px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end;">
        <button type="button" onclick="window.activatePrompt('${p.id}')" class="btn btn-primary">
          <span>Use in Chat</span>
          <i data-lucide="arrow-up-right" style="width: 14px; height: 14px;"></i>
        </button>
      </div>
    </div>
  `).join('');

  initLucide();
}

window.openPromptEditor = function(promptData = null) {
  let modal = document.getElementById('prompt-editor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'prompt-editor-modal';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-card" style="max-width: 500px; padding: 24px; flex-direction: column;">
      <h3 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 16px;">
        ${promptData ? 'Edit System Prompt' : 'New System Prompt'}
      </h3>

      <form id="form-prompt" style="display: flex; flex-direction: column; gap: 12px;">
        <input type="hidden" id="prompt-id" value="${promptData ? promptData.id : ''}" />
        <div>
          <label style="display: block; font-size: 0.78rem; font-weight: 500; color: var(--text-muted); margin-bottom: 6px;">Title</label>
          <input type="text" id="prompt-title" required value="${promptData ? escapeHtml(promptData.title) : ''}" placeholder="e.g. Python Assistant" style="width: 100%; background: var(--bg-input); border: 1px solid var(--border); padding: 8px 12px; border-radius: var(--radius-sm); color: var(--text-main); font-size: 0.82rem;" />
        </div>

        <div>
          <label style="display: block; font-size: 0.78rem; font-weight: 500; color: var(--text-muted); margin-bottom: 6px;">Short Description</label>
          <input type="text" id="prompt-desc" value="${promptData ? escapeHtml(promptData.description) : ''}" placeholder="e.g. Specialized in code refactoring" style="width: 100%; background: var(--bg-input); border: 1px solid var(--border); padding: 8px 12px; border-radius: var(--radius-sm); color: var(--text-main); font-size: 0.82rem;" />
        </div>

        <div>
          <label style="display: block; font-size: 0.78rem; font-weight: 500; color: var(--text-muted); margin-bottom: 6px;">System Instructions</label>
          <textarea id="prompt-content" rows="6" required placeholder="Write your system instructions here..." style="width: 100%; background: var(--bg-input); border: 1px solid var(--border); padding: 8px 12px; border-radius: var(--radius-sm); color: var(--text-main); font-size: 0.82rem; font-family: monospace; resize: none;">${promptData ? escapeHtml(promptData.prompt) : ''}</textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
          <button type="button" onclick="document.getElementById('prompt-editor-modal').remove()" class="btn btn-secondary">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  `;

  const form = document.getElementById('form-prompt');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('prompt-id').value || 'prompt-' + Date.now();
    const title = document.getElementById('prompt-title').value.trim();
    const description = document.getElementById('prompt-desc').value.trim();
    const prompt = document.getElementById('prompt-content').value.trim();

    let prompts = getStoredPrompts();
    const existingIndex = prompts.findIndex(p => p.id === id);

    if (existingIndex >= 0) {
      prompts[existingIndex] = { id, title, description, prompt };
    } else {
      prompts.unshift({ id, title, description, prompt });
    }

    saveStoredPrompts(prompts);
    modal.remove();
    renderPrompts();
  });
};

window.editPrompt = function(id) {
  const prompts = getStoredPrompts();
  const found = prompts.find(p => p.id === id);
  if (found) window.openPromptEditor(found);
};

window.deletePrompt = function(id) {
  if (!confirm('Are you sure you want to delete this System Prompt?')) return;
  let prompts = getStoredPrompts();
  prompts = prompts.filter(p => p.id !== id);
  saveStoredPrompts(prompts);
  renderPrompts();
};

window.activatePrompt = function(id) {
  const prompts = getStoredPrompts();
  const found = prompts.find(p => p.id === id);
  if (found) {
    localStorage.setItem('samaipata_system_instruction', found.prompt);
    window.location.href = 'index.html';
  }
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
