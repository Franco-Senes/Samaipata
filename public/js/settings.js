// public/js/settings.js

export function initSettings() {
  bindSettingsTabs();
  loadSettingsValues();
  bindSettingsEvents();
}

function bindSettingsTabs() {
  const tabButtons = document.querySelectorAll('.settings-tab-btn');
  const tabContents = document.querySelectorAll('.settings-tab-content');
  const modalTitle = document.getElementById('settings-active-title');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      const tabName = btn.querySelector('.tab-label')?.textContent || 'Configuración';

      tabButtons.forEach(b => {
        b.classList.remove('bg-[#2A2A2A]', 'text-zinc-100', 'font-medium');
        b.classList.add('text-zinc-400', 'hover:bg-[#242424]', 'hover:text-zinc-200');
      });

      btn.classList.add('bg-[#2A2A2A]', 'text-zinc-100', 'font-medium');
      btn.classList.remove('text-zinc-400', 'hover:bg-[#242424]', 'hover:text-zinc-200');

      if (modalTitle) modalTitle.textContent = tabName;

      tabContents.forEach(content => {
        if (content.id === `settings-tab-${targetTab}`) {
          content.classList.remove('hidden');
        } else {
          content.classList.add('hidden');
        }
      });
    });
  });

  // Search filter in settings sidebar
  const searchInput = document.getElementById('settings-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value.toLowerCase().trim();
      tabButtons.forEach(b => {
        const text = b.textContent.toLowerCase();
        if (!val || text.includes(val)) {
          b.classList.remove('hidden');
        } else {
          b.classList.add('hidden');
        }
      });
    });
  }
}

export function loadSettingsValues() {
  const theme = localStorage.getItem('samaipata_theme') || 'dark';
  const ollamaUrl = localStorage.getItem('samaipata_ollama_url') || 'http://localhost:11434';
  const geminiKey = localStorage.getItem('samaipata_gemini_key') || localStorage.getItem('samaipata_gemini_api_key') || '';
  const hackclubToken = localStorage.getItem('samaipata_hackclub_token') || localStorage.getItem('samaipata_hackclub_api_key') || '';
  const defaultModel = localStorage.getItem('samaipata_default_model') || 'llama3.2';
  const systemPrompt = localStorage.getItem('samaipata_system_instruction') || '';
  const lang = localStorage.getItem('samaipata_language') || 'es-latam';

  const user = JSON.parse(localStorage.getItem('samaipata_user') || '{}');
  const profileNameEl = document.getElementById('settings-profile-name');
  if (profileNameEl) profileNameEl.textContent = user.username || 'Franco';

  const elOllamaUrl = document.getElementById('settings-ollama-url');
  const elDefaultModel = document.getElementById('settings-default-model');
  const elGeminiKey = document.getElementById('settings-gemini-key');
  const elHackClubToken = document.getElementById('settings-hackclub-token');
  const elSystemPrompt = document.getElementById('settings-system-prompt');
  const elLang = document.getElementById('settings-lang');

  if (elOllamaUrl) elOllamaUrl.value = ollamaUrl;
  if (elDefaultModel) elDefaultModel.value = defaultModel;
  if (elGeminiKey) elGeminiKey.value = geminiKey;
  if (elHackClubToken) elHackClubToken.value = hackclubToken;
  if (elSystemPrompt) elSystemPrompt.value = systemPrompt;
  if (elLang) elLang.value = lang;

  // Set Theme Option Segmented UI
  document.querySelectorAll('.theme-option-btn').forEach(btn => {
    const btnTheme = btn.getAttribute('data-theme');
    if (btnTheme === theme) {
      btn.className = 'theme-option-btn px-4 py-2 rounded-xl bg-[#2A2A2A] text-zinc-100 font-medium flex items-center gap-2 border border-zinc-500 shadow-sm transition-all';
    } else {
      btn.className = 'theme-option-btn px-4 py-2 rounded-xl bg-[#242424] text-zinc-400 hover:text-zinc-200 flex items-center gap-2 border border-[#2E2E2E] transition-all';
    }
  });
}

function bindSettingsEvents() {
  const modal = document.getElementById('settings-modal-backdrop');
  const btnClose = document.getElementById('btn-close-settings-modal');
  const btnSave = document.getElementById('btn-save-settings');
  const btnTestOllama = document.getElementById('btn-test-ollama');
  const btnSettingsLogout = document.getElementById('btn-settings-logout');

  // Close modal when clicking outside card or clicking close icon
  if (btnClose) btnClose.addEventListener('click', closeSettingsModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSettingsModal();
    });
  }

  // Theme option clicks
  document.querySelectorAll('.theme-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedTheme = btn.getAttribute('data-theme');
      localStorage.setItem('samaipata_theme', selectedTheme);
      applyTheme(selectedTheme);

      document.querySelectorAll('.theme-option-btn').forEach(b => {
        if (b === btn) {
          b.className = 'theme-option-btn px-4 py-2 rounded-xl bg-[#2A2A2A] text-zinc-100 font-medium flex items-center gap-2 border border-zinc-500 shadow-sm transition-all';
        } else {
          b.className = 'theme-option-btn px-4 py-2 rounded-xl bg-[#242424] text-zinc-400 hover:text-zinc-200 flex items-center gap-2 border border-[#2E2E2E] transition-all';
        }
      });
    });
  });

  // Save Settings Click
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const ollamaUrl = document.getElementById('settings-ollama-url')?.value.trim() || 'http://localhost:11434';
      const defaultModel = document.getElementById('settings-default-model')?.value.trim() || 'llama3.2';
      const geminiKey = document.getElementById('settings-gemini-key')?.value.trim() || '';
      const hackclubToken = document.getElementById('settings-hackclub-token')?.value.trim() || '';
      const systemPrompt = document.getElementById('settings-system-prompt')?.value.trim() || '';
      const lang = document.getElementById('settings-lang')?.value || 'es-latam';

      localStorage.setItem('samaipata_ollama_url', ollamaUrl);
      localStorage.setItem('samaipata_default_model', defaultModel);
      localStorage.setItem('samaipata_selected_model', defaultModel);
      localStorage.setItem('samaipata_gemini_key', geminiKey);
      localStorage.setItem('samaipata_gemini_api_key', geminiKey);
      localStorage.setItem('samaipata_hackclub_token', hackclubToken);
      localStorage.setItem('samaipata_hackclub_api_key', hackclubToken);
      localStorage.setItem('samaipata_system_instruction', systemPrompt);
      localStorage.setItem('samaipata_language', lang);

      // Save Hack Club Key to server profile if logged in
      if (hackclubToken) {
        try {
          await fetch('/api/user/hackclub-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: hackclubToken })
          });
        } catch (e) {}
      }

      showSettingsToast('Configuración guardada correctamente.');
      window.dispatchEvent(new CustomEvent('samaipata_models_updated'));
      closeSettingsModal();
    });
  }

  // Logout from Settings
  if (btnSettingsLogout) {
    btnSettingsLogout.addEventListener('click', () => {
      logoutUser();
    });
  }

  // Test Ollama server connection
  if (btnTestOllama) {
    btnTestOllama.addEventListener('click', async () => {
      const url = document.getElementById('settings-ollama-url')?.value.trim() || 'http://localhost:11434';
      const statusEl = document.getElementById('ollama-test-status');
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.className = 'text-xs text-zinc-400 mt-2 flex items-center gap-1.5';
        statusEl.innerHTML = `<span class="inline-block animate-spin mr-1">◌</span> Conectando con ${url}...`;

        try {
          const res = await fetch('/api/models');
          if (res.ok) {
            const data = await res.json();
            const count = Array.isArray(data) ? data.length : (data.models || []).length;
            statusEl.className = 'text-xs text-emerald-400 mt-2 flex items-center gap-1.5';
            statusEl.innerHTML = `Conexión exitosa (${count} modelos locales detectados)`;
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          statusEl.className = 'text-xs text-red-400 mt-2 flex items-center gap-1.5';
          statusEl.innerHTML = `Sin conexión: ${err.message}`;
        }
      }
    });
  }
}

function applyTheme(theme) {
  if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function openSettingsModal(tabName = 'general') {
  const modal = document.getElementById('settings-modal-backdrop');
  if (!modal) return;

  loadSettingsValues();

  const tabBtn = document.querySelector(`.settings-tab-btn[data-tab="${tabName}"]`);
  if (tabBtn) tabBtn.click();

  modal.classList.remove('hidden');
  void modal.offsetWidth;
  modal.classList.add('active');
}

export function closeSettingsModal() {
  const modal = document.getElementById('settings-modal-backdrop');
  if (!modal) return;

  modal.classList.remove('active');
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 200);
}

export async function logoutUser() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  localStorage.removeItem('samaipata_token');
  localStorage.removeItem('samaipata_user');
  document.cookie = 'samaipata_session=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  window.location.href = 'login.html';
}

window.logoutUser = logoutUser;

function showSettingsToast(msg) {
  let toast = document.getElementById('samaipata-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'samaipata-toast';
    toast.className = 'fixed bottom-6 right-6 z-50 bg-[#252525] border border-[#333333] text-zinc-100 text-xs px-4 py-2.5 rounded-2xl shadow-2xl transition-all duration-300 transform translate-y-4 opacity-0 flex items-center gap-2.5';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span class="w-2 h-2 rounded-full bg-white"></span> ${msg}`;
  toast.classList.remove('translate-y-4', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-4', 'opacity-0');
  }, 2200);
}
