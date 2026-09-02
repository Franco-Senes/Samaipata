// public/js/index.js
import { initSettings, openSettingsModal } from './settings.js';
import { initAdmin, checkAdminAccess, loadAdminUsers, openAdminModal, openAdminWelcomeModal } from './admin.js';

window.loadAdminUsers = loadAdminUsers;
window.openAdminModal = openAdminModal;
window.openSettingsModal = openSettingsModal;
window.openAdminWelcomeModal = openAdminWelcomeModal;

// 1. Global Fetch Interceptor for Auth Token
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

// Global App State
let currentUser = null;
let currentConversationId = null;
let currentModel = localStorage.getItem('samaipata_default_model') || localStorage.getItem('samaipata_selected_model') || null;
let installedModels = [];
let isGenerating = false;
let abortController = null;
let attachedFiles = [];
let isWebSearchEnabled = false;

const sampleSuggestionsPool = [
  [
    { prompt: 'Create my game art assets and define the visual palette for the project', text: 'Create game art assets' },
    { prompt: 'Fix game performance bottlenecks and optimize rendering', text: 'Fix game performance & lag' },
    { prompt: 'Help me mod my game by adding interactive mechanics', text: 'Help mod my game' }
  ],
  [
    { prompt: 'Research the latest trends in large language models and autonomous agents', text: 'Research AI agent trends' },
    { prompt: 'Analyze this dataset and generate a structured executive summary', text: 'Analyze data & generate summary' },
    { prompt: 'Build a complete REST API in Node.js and Express with authentication', text: 'Build REST API with authentication' }
  ],
  [
    { prompt: 'Design a 5-slide executive presentation for investors', text: 'Design pitch deck for investors' },
    { prompt: 'Write a Python script to automate web data extraction', text: 'Automate data extraction' },
    { prompt: 'Explain attention mechanisms and memory in Transformers', text: 'Explain Transformer attention' }
  ]
];
let currentSuggestionIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
  // Capture URL query token (e.g. OAuth callback redirect)
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  if (token) {
    localStorage.setItem('samaipata_token', token);
    document.cookie = `samaipata_session=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  initTheme();
  initLucide();
  initSidebar();
  initSettings();
  initAdmin();
  initSettingsTriggers();

  // Verify auth session
  await checkAuthSession();

  // Load real models and conversations
  await loadModels();
  await loadConversationsList();

  initChatInputs();
  initSuggestionsAndPills();
  configureMarked();
});

// 2. Auth Session Check
async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user || data;
      localStorage.setItem('samaipata_user', JSON.stringify(currentUser));
      updateUserUI(currentUser);

      // Trigger first-time admin welcome modal
      const isAdmin = currentUser.role === 'admin' || currentUser.isAdmin;
      const setupCompleted = currentUser.setup_completed === 1 || currentUser.setup_completed === true;
      const localSetupDone = localStorage.getItem('samaipata_admin_setup_done') === 'true';

      if (isAdmin && !setupCompleted && !localSetupDone) {
        setTimeout(() => {
          openAdminWelcomeModal();
        }, 300);
      }
    } else {
      redirectToLogin();
    }
  } catch (err) {
    redirectToLogin();
  }
}

function redirectToLogin() {
  localStorage.removeItem('samaipata_token');
  localStorage.removeItem('samaipata_user');
  document.cookie = 'samaipata_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  window.location.href = 'login.html';
}

function updateUserUI(user) {
  if (!user) return;
  const initials = (user.username || 'FS').slice(0, 2).toUpperCase();
  const avatarEl = document.getElementById('sidebar-user-avatar');
  const stripAvatarEl = document.getElementById('btn-strip-profile');
  const userNameEl = document.getElementById('sidebar-user-name');
  const dropdownAvatarEl = document.getElementById('dropdown-user-avatar');
  const dropdownNameEl = document.getElementById('dropdown-user-name');
  const settingsNameEl = document.getElementById('settings-profile-name');

  if (avatarEl) avatarEl.textContent = initials;
  if (stripAvatarEl) stripAvatarEl.textContent = initials;
  if (userNameEl) userNameEl.textContent = user.username || 'Franco';
  if (dropdownAvatarEl) dropdownAvatarEl.textContent = initials;
  if (dropdownNameEl) dropdownNameEl.textContent = user.username || 'Franco';
  if (settingsNameEl) settingsNameEl.textContent = user.username || 'Franco';

  checkAdminAccess(user);
}

// 3. Theme initialization
function initTheme() {
  const savedTheme = localStorage.getItem('samaipata_theme') || 'dark';
  if (savedTheme === 'dark' || (savedTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function initLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// 4. Sidebar Collapsible State
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

  const btnNewChat = document.getElementById('btn-sidebar-new-chat');
  const btnStripNew = document.getElementById('btn-strip-new-task');

  const resetToNewChat = () => {
    currentConversationId = null;
    document.getElementById('messages-container').innerHTML = '';
    document.getElementById('hero-welcome').classList.remove('hidden');
    document.getElementById('chat-scroll-view').classList.add('hidden');
    document.getElementById('active-chat-input-bar').classList.add('hidden');

    const input = document.getElementById('prompt-input');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    attachedFiles = [];
    renderAttachmentPills();
    updateActiveConversationUI(null);
  };

  if (btnNewChat) btnNewChat.addEventListener('click', resetToNewChat);
  if (btnStripNew) btnStripNew.addEventListener('click', resetToNewChat);
}

// 5. Settings & User Profile Dropdown Triggers
function initSettingsTriggers() {
  const btnStripProfile = document.getElementById('btn-strip-profile');
  const btnOpenProfile = document.getElementById('btn-open-settings-profile');
  const btnHeroSettings = document.getElementById('btn-hero-settings-link');
  const userPopupMenu = document.getElementById('user-popup-menu');
  const btnDropdownSettings = document.getElementById('btn-dropdown-settings');
  const btnDropdownLogout = document.getElementById('btn-dropdown-logout');
  const btnStripTheme = document.getElementById('btn-strip-theme');
  const btnMainTheme = document.getElementById('btn-theme-toggle-main');

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('samaipata_theme', isDark ? 'dark' : 'light');
    initLucide();
  };

  if (btnStripTheme) btnStripTheme.addEventListener('click', toggleTheme);
  if (btnMainTheme) btnMainTheme.addEventListener('click', toggleTheme);

  // Toggle User Profile Popup Menu
  if (btnOpenProfile && userPopupMenu) {
    btnOpenProfile.addEventListener('click', (e) => {
      e.stopPropagation();
      userPopupMenu.classList.toggle('hidden');
    });
  }

  if (btnStripProfile) {
    btnStripProfile.addEventListener('click', () => openSettingsModal('general'));
  }

  // Close popup menu when clicking outside
  document.addEventListener('click', (e) => {
    if (userPopupMenu && !userPopupMenu.contains(e.target) && e.target !== btnOpenProfile) {
      userPopupMenu.classList.add('hidden');
    }
  });

  if (btnDropdownSettings) {
    btnDropdownSettings.addEventListener('click', () => {
      userPopupMenu?.classList.add('hidden');
      openSettingsModal('general');
    });
  }

  if (btnDropdownLogout) {
    btnDropdownLogout.addEventListener('click', () => {
      window.logoutUser ? window.logoutUser() : redirectToLogin();
    });
  }

  if (btnHeroSettings) btnHeroSettings.addEventListener('click', () => openSettingsModal('apikeys'));

  // Listen for models reload from settings
  window.addEventListener('samaipata_models_updated', () => {
    loadModels();
  });
}

// 6. Real Models Loading & Populating Selector
export async function loadModels() {
  try {
    const hackclubKey = localStorage.getItem('samaipata_hackclub_token') || localStorage.getItem('samaipata_hackclub_api_key') || '';
    const hasHackClub = hackclubKey || (currentUser && currentUser.hasHackClubApiKey);
    const url = hasHackClub ? '/api/models?hackclub=true' : '/api/models';

    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      installedModels = Array.isArray(data) ? data : (data.models || []);
    } else {
      installedModels = [];
    }

    if (installedModels.length === 0) {
      currentModel = null;
      localStorage.removeItem('samaipata_default_model');
      localStorage.removeItem('samaipata_selected_model');
    } else {
      // If query param set
      const urlParams = new URLSearchParams(window.location.search);
      const paramModel = urlParams.get('model');
      if (paramModel && installedModels.some(m => m.name === paramModel)) {
        currentModel = paramModel;
        localStorage.setItem('samaipata_default_model', currentModel);
      } else {
        const saved = localStorage.getItem('samaipata_default_model') || localStorage.getItem('samaipata_selected_model');
        if (saved && installedModels.some(m => m.name === saved)) {
          currentModel = saved;
        } else {
          currentModel = installedModels[0].name;
          localStorage.setItem('samaipata_default_model', currentModel);
        }
      }
    }

    renderModelPickerDropdown();
  } catch (err) {
    console.error('Failed to load models:', err);
    installedModels = [];
    currentModel = null;
    renderModelPickerDropdown();
  }
}

function renderModelPickerDropdown() {
  const modelBadge = document.getElementById('selected-model-badge');
  const dropdown = document.getElementById('model-picker-dropdown');
  const modelPickerBtn = document.getElementById('btn-model-picker');

  if (installedModels.length === 0) {
    if (modelBadge) {
      modelBadge.textContent = 'No models setup';
    }
    if (dropdown) {
      dropdown.innerHTML = `
        <div class="p-3 text-center text-xs text-zinc-400 space-y-2">
          <p class="font-medium text-zinc-300">No models setup</p>
          <p class="text-[11px] text-zinc-500">Neither Ollama nor Hack Club AI is connected.</p>
          <button type="button" id="btn-dropdown-setup-ai" class="w-full py-1.5 px-2 bg-[#2A2A2A] hover:bg-[#333] border border-[#3A3A3A] text-zinc-200 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5">
            <i data-lucide="settings" class="w-3.5 h-3.5 text-zinc-400"></i>
            <span>Setup AI Services</span>
          </button>
        </div>
      `;
      const btnSetup = dropdown.querySelector('#btn-dropdown-setup-ai');
      if (btnSetup) {
        btnSetup.onclick = (e) => {
          e.stopPropagation();
          dropdown.classList.add('hidden');
          if (currentUser && (currentUser.role === 'admin' || currentUser.isAdmin)) {
            openAdminModal('setup');
          } else {
            openSettingsModal('apikeys');
          }
        };
      }
    }

    if (modelPickerBtn) {
      modelPickerBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
      };

      document.onclick = () => {
        dropdown.classList.add('hidden');
      };
    }

    initLucide();
    return;
  }

  if (modelBadge) {
    const currentObj = installedModels.find(m => m.name === currentModel);
    modelBadge.textContent = (currentObj && (currentObj.displayName || currentObj.name)) || currentModel || 'Select model';
  }

  if (!dropdown) return;

  dropdown.innerHTML = installedModels.map(m => {
    const displayName = m.displayName || (m.is_hackclub ? `${m.name} (Hack Club)` : m.name);
    const isSelected = m.name === currentModel;
    return `
      <button type="button" class="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-[#2A2A2A] hover:text-white rounded-xl flex items-center justify-between transition-colors ${isSelected ? 'bg-blue-600/15 text-blue-400 font-medium' : ''}" data-model="${escapeHtml(m.name)}">
        <span class="truncate pr-2">${escapeHtml(displayName)}</span>
        ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-blue-500 shrink-0"></i>' : ''}
      </button>
    `;
  }).join('');

  dropdown.querySelectorAll('button[data-model]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentModel = btn.getAttribute('data-model');
      localStorage.setItem('samaipata_default_model', currentModel);
      localStorage.setItem('samaipata_selected_model', currentModel);

      if (modelBadge) {
        const currentObj = installedModels.find(m => m.name === currentModel);
        modelBadge.textContent = (currentObj && (currentObj.displayName || currentObj.name)) || currentModel;
      }
      dropdown.classList.add('hidden');
      renderModelPickerDropdown();
      initLucide();
    });
  });

  if (modelPickerBtn) {
    modelPickerBtn.onclick = (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    };

    document.onclick = () => {
      dropdown.classList.add('hidden');
    };
  }

  initLucide();
}

// 7. Markdown & Highlight Configuration
function configureMarked() {
  if (!window.marked) return;

  const renderer = new window.marked.Renderer();

  renderer.code = function(code, language) {
    const validLang = language && window.hljs && window.hljs.getLanguage(language) ? language : 'plaintext';
    let highlighted = escapeHtml(code);

    if (window.hljs) {
      try {
        highlighted = window.hljs.highlight(code, { language: validLang, ignoreIllegals: true }).value;
      } catch (e) {
        highlighted = escapeHtml(code);
      }
    }

    const uniqueId = 'code-' + Math.random().toString(36).substring(2, 9);

    return `
      <div class="code-block-wrapper my-3 bg-[#131313] rounded-2xl border border-[#2E2E2E] overflow-hidden">
        <div class="code-block-header flex items-center justify-between px-3.5 py-1.5 bg-[#1C1C1C] border-b border-[#2E2E2E] text-[11px] text-zinc-400">
          <span class="font-mono uppercase tracking-wider">${validLang}</span>
          <button onclick="window.copyCodeToClipboard('${uniqueId}', this)" class="hover:text-zinc-200 transition-colors flex items-center gap-1">
            <i data-lucide="copy" class="w-3.5 h-3.5"></i>
            <span>Copy</span>
          </button>
        </div>
        <pre class="p-3.5 overflow-x-auto text-xs font-mono text-zinc-200"><code id="${uniqueId}">${highlighted}</code></pre>
      </div>
    `;
  };

  window.marked.setOptions({
    renderer: renderer,
    gfm: true,
    breaks: true
  });
}

window.copyCodeToClipboard = function(elementId, btn) {
  const codeEl = document.getElementById(elementId);
  if (!codeEl) return;

  navigator.clipboard.writeText(codeEl.innerText).then(() => {
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="text-blue-400 font-medium">Copied!</span>`;
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      initLucide();
    }, 2000);
  }).catch(() => {});
};

// 8. Chat Inputs & File Attachments
function initChatInputs() {
  const heroInput = document.getElementById('prompt-input');
  const heroSendBtn = document.getElementById('btn-send-message');
  const attachBtn = document.getElementById('btn-attach-file');
  const fileInput = document.getElementById('file-upload-input');

  const activeInput = document.getElementById('active-prompt-input');
  const activeSendBtn = document.getElementById('btn-active-send');
  const activeAttachBtn = document.getElementById('btn-active-attach');

  // Auto-grow textarea
  [heroInput, activeInput].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = `${Math.min(inp.scrollHeight, 180)}px`;
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = inp.value.trim();
        if (text) sendMessage(text);
      }
    });
  });

  if (heroSendBtn) {
    heroSendBtn.addEventListener('click', () => {
      if (isGenerating) {
        abortGeneration();
      } else {
        const text = heroInput?.value.trim();
        if (text) sendMessage(text);
      }
    });
  }

  if (activeSendBtn) {
    activeSendBtn.addEventListener('click', () => {
      if (isGenerating) {
        abortGeneration();
      } else {
        const text = activeInput?.value.trim();
        if (text) sendMessage(text);
      }
    });
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
  }
  if (activeAttachBtn && fileInput) {
    activeAttachBtn.addEventListener('click', () => fileInput.click());
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      files.forEach(f => attachedFiles.push(f.name));
      renderAttachmentPills();
      fileInput.value = '';
    });
  }
}

function renderAttachmentPills() {
  const container = document.getElementById('attachment-pills-container');
  if (!container) return;

  if (attachedFiles.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = attachedFiles.map((name, idx) => `
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#282828] text-[11px] text-zinc-300 border border-[#333333]">
      <i data-lucide="paperclip" class="w-3 h-3 text-zinc-400"></i>
      <span class="max-w-[120px] truncate">${escapeHtml(name)}</span>
      <button type="button" onclick="window.removeAttachedFile(${idx})" class="hover:text-red-400 ml-1 text-xs leading-none font-bold">&times;</button>
    </span>
  `).join('');

  initLucide();
}

window.removeAttachedFile = function(idx) {
  attachedFiles.splice(idx, 1);
  renderAttachmentPills();
};

// 9. Suggestions & Action Pills
function initSuggestionsAndPills() {
  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.getAttribute('data-prompt');
      if (prompt) sendMessage(prompt);
    });
  });

  const actionPills = document.querySelectorAll('.action-pill');
  actionPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const prompt = pill.getAttribute('data-prompt');
      if (prompt) sendMessage(prompt);
    });
  });

  const refreshBtn = document.getElementById('btn-refresh-suggestions');
  const closeBtn = document.getElementById('btn-close-suggestions');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      currentSuggestionIndex = (currentSuggestionIndex + 1) % sampleSuggestionsPool.length;
      const suggestions = sampleSuggestionsPool[currentSuggestionIndex];
      const cards = document.querySelectorAll('.suggestion-card');
      cards.forEach((card, i) => {
        if (suggestions[i]) {
          card.setAttribute('data-prompt', suggestions[i].prompt);
          const p = card.querySelector('p');
          if (p) p.textContent = suggestions[i].text;
        }
      });
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('suggested-section')?.classList.add('hidden');
    });
  }
}

// 10. Helper to parse reasoning models (<think>...</think>)
function parseReasoningAndContent(text) {
  let thinking = '';
  let response = text;

  const thinkStart = text.indexOf('<think>');
  if (thinkStart !== -1) {
    const thinkEnd = text.indexOf('</think>');
    if (thinkEnd !== -1) {
      thinking = text.substring(thinkStart + 7, thinkEnd).trim();
      response = text.substring(thinkEnd + 8).trim();
    } else {
      thinking = text.substring(thinkStart + 7).trim();
      response = '';
    }
  }
  return { thinking, response };
}

// 11. Send Message with Full Backend Protocol
async function sendMessage(messageText) {
  if (!messageText || isGenerating) return;

  // Image Generation command detection
  const isImageRequest = messageText.toLowerCase().startsWith('/image ') ||
                         messageText.toLowerCase().startsWith('dibuja ') ||
                         messageText.toLowerCase().startsWith('genera una imagen ');

  if (isImageRequest) {
    handleImageGeneration(messageText);
    return;
  }

  let fullMessage = messageText;
  if (attachedFiles.length > 0) {
    fullMessage += `\n\n[Archivos adjuntos: ${attachedFiles.join(', ')}]`;
    attachedFiles = [];
    renderAttachmentPills();
  }

  // If no services or models are setup, show immediate error message
  if (!currentModel || installedModels.length === 0) {
    const heroInput = document.getElementById('prompt-input');
    const activeInput = document.getElementById('active-prompt-input');
    if (heroInput) { heroInput.value = ''; heroInput.style.height = 'auto'; }
    if (activeInput) { activeInput.value = ''; activeInput.style.height = 'auto'; }

    document.getElementById('hero-welcome')?.classList.add('hidden');
    document.getElementById('chat-scroll-view')?.classList.remove('hidden');
    document.getElementById('active-chat-input-bar')?.classList.remove('hidden');

    appendMessageToUI('user', fullMessage);

    const botMessageId = 'msg-' + Date.now();
    appendMessageToUI('assistant', '', botMessageId);

    const botMessageContentEl = document.getElementById(`content-${botMessageId}`);
    if (botMessageContentEl) {
      botMessageContentEl.innerHTML = `
        <div class="p-4 bg-red-500/10 border border-red-500/25 rounded-2xl text-xs text-zinc-200 space-y-2.5">
          <div class="flex items-center gap-2 font-semibold text-red-400">
            <i data-lucide="alert-circle" class="w-4 h-4 text-red-400 shrink-0"></i>
            <span>No AI Models Available</span>
          </div>
          <p class="text-zinc-300 leading-relaxed">No API keys are setup or Ollama is not running. Please configure your Hack Club AI API key or make sure Ollama is installed and running.</p>
          <div class="pt-1">
            <button id="btn-chat-error-setup" class="px-3 py-1.5 rounded-xl bg-[#282828] hover:bg-[#323232] text-zinc-200 border border-[#3A3A3A] transition-colors inline-flex items-center gap-1.5 text-xs font-medium">
              <i data-lucide="settings" class="w-3.5 h-3.5 text-zinc-400"></i>
              <span>Setup AI Services</span>
            </button>
          </div>
        </div>
      `;
      const btnSetup = botMessageContentEl.querySelector('#btn-chat-error-setup');
      if (btnSetup) {
        btnSetup.onclick = () => {
          if (currentUser && (currentUser.role === 'admin' || currentUser.isAdmin)) {
            openAdminModal('setup');
          } else {
            openSettingsModal('apikeys');
          }
        };
      }
      initLucide();
      scrollToBottom();
    }
    return;
  }

  // Clear inputs
  const heroInput = document.getElementById('prompt-input');
  const activeInput = document.getElementById('active-prompt-input');
  if (heroInput) { heroInput.value = ''; heroInput.style.height = 'auto'; }
  if (activeInput) { activeInput.value = ''; activeInput.style.height = 'auto'; }

  // Switch UI view to chat scroll
  document.getElementById('hero-welcome').classList.add('hidden');
  document.getElementById('chat-scroll-view').classList.remove('hidden');
  document.getElementById('active-chat-input-bar').classList.remove('hidden');

  // Render User Message
  appendMessageToUI('user', fullMessage);

  // Placeholder Bot Message
  const botMessageId = 'msg-' + Date.now();
  appendMessageToUI('assistant', '', botMessageId);

  setGeneratingState(true);
  abortController = new AbortController();

  try {
    const systemPromptOverride = localStorage.getItem('samaipata_system_instruction') || '';
    const hackclubApiKey = localStorage.getItem('samaipata_hackclub_token') || localStorage.getItem('samaipata_hackclub_api_key') || '';
    const isHackClubModel = currentModel.includes('/') || installedModels.some(m => m.name === currentModel && m.is_hackclub);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        conversation_id: currentConversationId,
        model_name: currentModel,
        is_hackclub: isHackClubModel,
        message_content: fullMessage,
        web_search_enabled: isWebSearchEnabled,
        memory_enabled: true,
        system_instruction: systemPromptOverride,
        hackclub_api_key: hackclubApiKey
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Error HTTP: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    const botMessageContentEl = document.getElementById(`content-${botMessageId}`);
    botMessageContentEl.classList.add('typing-cursor');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (part.startsWith('data:')) {
          const jsonStr = part.replace(/^data:\s*/, '').trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);

            if (parsed.conversation_id && !currentConversationId) {
              currentConversationId = parsed.conversation_id;
              loadConversationsList();
            }

            if (parsed.error) {
              throw new Error(parsed.error);
            }

            const chunkText = parsed.message || parsed.content || (parsed.choices && (parsed.choices[0]?.delta?.content || parsed.choices[0]?.text)) || '';
            if (chunkText) {
              accumulatedText += chunkText;
              renderAssistantText(botMessageContentEl, accumulatedText);
              scrollToBottom();
            }
          } catch (e) {
            if (e.message && e.message.startsWith('Error') || (e.message && e.message.includes('Hack Club'))) {
              throw e;
            }
          }
        }
      }
    }

    botMessageContentEl.classList.remove('typing-cursor');
    renderAssistantText(botMessageContentEl, accumulatedText);
    initLucide();
    scrollToBottom();
  } catch (err) {
    const botMessageContentEl = document.getElementById(`content-${botMessageId}`);
    if (botMessageContentEl) {
      botMessageContentEl.classList.remove('typing-cursor');
      if (err.name === 'AbortError') {
        botMessageContentEl.innerHTML += `<p class="text-xs text-zinc-500 italic mt-2">[Generation stopped]</p>`;
      } else {
        const cleanMsg = err.message || 'Unknown error while processing the request.';
        botMessageContentEl.innerHTML = `
          <div class="p-3.5 bg-red-500/10 border border-red-500/25 rounded-2xl text-xs text-zinc-200 space-y-1.5">
            <div class="flex items-center gap-2 font-semibold text-red-400">
              <i data-lucide="alert-circle" class="w-4 h-4 text-red-400 shrink-0"></i>
              <span>The model could not respond</span>
            </div>
            <p class="text-zinc-300 leading-relaxed">${escapeHtml(cleanMsg)}</p>
            <p class="text-[11px] text-zinc-500 pt-0.5">Tip: The current model may be temporarily offline at the provider. Try selecting another model from the top dropdown.</p>
          </div>
        `;
        initLucide();
      }
    }
  } finally {
    setGeneratingState(false);
    abortController = null;
  }
}

function renderAssistantText(element, text) {
  const { thinking, response } = parseReasoningAndContent(text);
  let html = '';

  if (thinking) {
    html += `
      <details class="mb-3 bg-[#171717] border border-[#282828] rounded-xl p-2.5 text-xs text-zinc-400" open>
        <summary class="cursor-pointer font-medium text-zinc-300 flex items-center gap-1.5 select-none">
          <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          <span>Thought Process</span>
        </summary>
        <div class="mt-2 text-zinc-400 whitespace-pre-wrap font-mono text-[11px] leading-relaxed pl-3 border-l border-zinc-700">
          ${escapeHtml(thinking)}
        </div>
      </details>
    `;
  }

  html += response ? (window.marked ? window.marked.parse(response) : escapeHtml(response)) : '';
  element.innerHTML = html;
  initLucide();
}

async function handleImageGeneration(promptText) {
  let cleanPrompt = promptText;
  if (promptText.toLowerCase().startsWith('/image ')) cleanPrompt = promptText.substring(7).trim();
  else if (promptText.toLowerCase().startsWith('draw ')) cleanPrompt = promptText.substring(5).trim();
  else if (promptText.toLowerCase().startsWith('generate an image of ')) cleanPrompt = promptText.substring(21).trim();
  else if (promptText.toLowerCase().startsWith('genera una imagen ')) cleanPrompt = promptText.substring(18).trim();
  else if (promptText.toLowerCase().startsWith('dibuja ')) cleanPrompt = promptText.substring(7).trim();

  // Clear inputs
  const heroInput = document.getElementById('prompt-input');
  const activeInput = document.getElementById('active-prompt-input');
  if (heroInput) { heroInput.value = ''; heroInput.style.height = 'auto'; }
  if (activeInput) { activeInput.value = ''; activeInput.style.height = 'auto'; }

  document.getElementById('hero-welcome').classList.add('hidden');
  document.getElementById('chat-scroll-view').classList.remove('hidden');
  document.getElementById('active-chat-input-bar').classList.remove('hidden');

  appendMessageToUI('user', promptText);
  const botMessageId = 'msg-' + Date.now();
  appendMessageToUI('assistant', 'Generating image...', botMessageId);

  setGeneratingState(true);

  try {
    const res = await fetch('/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: cleanPrompt })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to generate image');
    }

    const data = await res.json();
    const contentEl = document.getElementById(`content-${botMessageId}`);
    if (contentEl) {
      contentEl.innerHTML = `
        <p class="text-xs text-zinc-400 mb-2 font-medium">Image generated for: <span class="text-zinc-200">"${escapeHtml(cleanPrompt)}"</span></p>
        <img src="${data.url}" alt="${escapeHtml(cleanPrompt)}" class="rounded-2xl border border-[#2E2E2E] shadow-xl max-w-full h-auto mt-1" style="max-height: 480px;" />
      `;
    }
  } catch (err) {
    const contentEl = document.getElementById(`content-${botMessageId}`);
    if (contentEl) {
      contentEl.innerHTML = `<div class="p-3 bg-red-500/10 border border-red-500/30 rounded-2xl text-xs text-red-400">Error: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    setGeneratingState(false);
    scrollToBottom();
  }
}

function setGeneratingState(generating) {
  isGenerating = generating;
  const heroSendBtn = document.getElementById('btn-send-message');
  const activeSendBtn = document.getElementById('btn-active-send');

  [heroSendBtn, activeSendBtn].forEach(btn => {
    if (!btn) return;
    if (generating) {
      btn.innerHTML = `<i data-lucide="square" class="w-3.5 h-3.5 text-white fill-white"></i>`;
      btn.title = 'Stop';
    } else {
      btn.innerHTML = `<i data-lucide="arrow-up" class="w-4 h-4 text-white"></i>`;
      btn.title = 'Send';
    }
  });
  initLucide();
}

function abortGeneration() {
  if (abortController) abortController.abort();
}

// 12. UI Message Elements
function appendMessageToUI(role, content, customId = null) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const msgId = customId || 'msg-' + Date.now();
  const isUser = role === 'user';

  const messageWrapper = document.createElement('div');
  messageWrapper.id = msgId;
  messageWrapper.className = `flex flex-col ${isUser ? 'items-end' : 'items-start'} my-3.5 w-full`;

  const parsedContent = isUser
    ? `<p class="whitespace-pre-wrap leading-relaxed">${escapeHtml(content)}</p>`
    : (content ? (window.marked ? window.marked.parse(content) : escapeHtml(content)) : '');

  messageWrapper.innerHTML = `
    <div class="max-w-[88%] sm:max-w-[80%] rounded-3xl p-4 sm:p-5 ${
      isUser
        ? 'bg-[#2A2A2A] text-zinc-100 rounded-tr-sm border border-[#333333]'
        : 'bg-[#212121] border border-[#2E2E2E] text-zinc-200 rounded-tl-sm shadow-sm'
    }">
      <div id="content-${msgId}" class="markdown-body text-xs sm:text-sm">
        ${parsedContent}
      </div>
    </div>
  `;

  container.appendChild(messageWrapper);
  initLucide();
  scrollToBottom();
}

function scrollToBottom() {
  const scrollContainer = document.getElementById('chat-scroll-view');
  if (scrollContainer) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }
}

// 13. Conversations History List
async function loadConversationsList() {
  const historyList = document.getElementById('history-list');
  if (!historyList) return;

  try {
    const res = await fetch('/api/conversations');
    if (!res.ok) return;

    const data = await res.json();
    const conversations = Array.isArray(data) ? data : (data.conversations || []);

    if (conversations.length === 0) {
      historyList.innerHTML = `
        <div class="py-8 flex flex-col items-center justify-center text-center text-zinc-600">
          <div class="w-10 h-10 rounded-2xl border border-dashed border-zinc-700 flex items-center justify-center mb-2">
            <i data-lucide="message-square-dashed" class="w-5 h-5 text-zinc-500"></i>
          </div>
          <p class="text-[11px] text-zinc-400">Start a new chat to begin</p>
        </div>
      `;
      initLucide();
      return;
    }

    historyList.innerHTML = conversations.map(c => `
      <li class="group relative flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-zinc-100 hover:bg-[#222222] cursor-pointer transition-colors ${c.id == currentConversationId ? 'bg-[#242424] text-zinc-100 font-medium' : ''}" data-conv-id="${c.id}">
        <span class="truncate flex-1" onclick="window.loadConversationDetails('${c.id}')">
          ${escapeHtml(c.title || 'New Chat')}
        </span>
        <button onclick="window.deleteConversation('${c.id}', event)" class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity ml-1.5" title="Delete">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </li>
    `).join('');

    initLucide();
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

window.loadConversationDetails = async function(id) {
  try {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) throw new Error('Error loading chat');

    const data = await res.json();
    const conversation = data.conversation || data;
    const messages = data.messages || [];

    currentConversationId = id;

    if (conversation.model_name) {
      currentModel = conversation.model_name;
      localStorage.setItem('samaipata_default_model', currentModel);
      const modelBadge = document.getElementById('selected-model-badge');
      if (modelBadge) modelBadge.textContent = currentModel;
    }

    document.getElementById('hero-welcome').classList.add('hidden');
    document.getElementById('chat-scroll-view').classList.remove('hidden');
    document.getElementById('active-chat-input-bar').classList.remove('hidden');

    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    messages.forEach(m => {
      appendMessageToUI(m.role, m.content);
    });

    updateActiveConversationUI(id);
  } catch (err) {
    alert(err.message || 'Error opening chat');
  }
};

window.deleteConversation = async function(id, e) {
  e.stopPropagation();
  if (!confirm('Are you sure you want to delete this chat?')) return;

  try {
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Could not delete conversation');

    if (currentConversationId == id) {
      document.getElementById('btn-sidebar-new-chat')?.click();
    }
    loadConversationsList();
  } catch (err) {
    alert(err.message || 'Error deleting conversation');
  }
};

function updateActiveConversationUI(id) {
  document.querySelectorAll('#history-list li').forEach(el => {
    if (el.getAttribute('data-conv-id') == id) {
      el.classList.add('bg-[#242424]', 'text-zinc-100', 'font-medium');
    } else {
      el.classList.remove('bg-[#242424]', 'text-zinc-100', 'font-medium');
    }
  });
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
