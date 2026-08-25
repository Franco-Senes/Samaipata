// public/js/login.js

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initLucide();
  initTabs();
  initForms();
  checkExistingSession();
});

function initTheme() {
  const savedTheme = localStorage.getItem('samaipata_theme') || 'dark';
  if (savedTheme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }

  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('samaipata_theme', isDark ? 'dark' : 'light');
      initLucide();
    });
  }
}

function initLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function initTabs() {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  if (!tabLogin || !tabRegister) return;

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.remove('tab-item-inactive');
    tabLogin.classList.add('tab-item-active');

    tabRegister.classList.remove('tab-item-active');
    tabRegister.classList.add('tab-item-inactive');

    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
    hideAlert();
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.remove('tab-item-inactive');
    tabRegister.classList.add('tab-item-active');

    tabLogin.classList.remove('tab-item-active');
    tabLogin.classList.add('tab-item-inactive');

    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
    hideAlert();
  });
}

function showAlert(message, type = 'error') {
  const alertBox = document.getElementById('auth-alert');
  if (!alertBox) return;
  alertBox.textContent = message;
  alertBox.className = `p-3 rounded-2xl text-xs border ${
    type === 'error'
      ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
  }`;
  alertBox.classList.remove('hidden');
}

function hideAlert() {
  const alertBox = document.getElementById('auth-alert');
  if (alertBox) alertBox.classList.add('hidden');
}

async function checkExistingSession() {
  const token = localStorage.getItem('samaipata_token');
  if (!token) return;

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.user || data.id)) {
        localStorage.setItem('samaipata_user', JSON.stringify(data.user || data));
        window.location.href = 'index.html';
      }
    }
  } catch (err) {
    // ignore
  }
}

function initForms() {
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const submitBtn = formLogin.querySelector('button[type="submit"]');

      if (!username || !password) {
        showAlert('Please fill in all fields.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="inline-block animate-spin mr-2">◌</span> Signing in...`;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to sign in');
        }

        if (data.token) {
          localStorage.setItem('samaipata_token', data.token);
          document.cookie = `samaipata_session=${data.token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
        }
        if (data.user) {
          localStorage.setItem('samaipata_user', JSON.stringify(data.user));
        }

        showAlert('Sign in successful! Redirecting...', 'success');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 500);
      } catch (err) {
        showAlert(err.message || 'Server error occurred');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  }

  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const username = document.getElementById('reg-username').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const submitBtn = formRegister.querySelector('button[type="submit"]');

      if (!username || !password) {
        showAlert('Username and password are required.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="inline-block animate-spin mr-2">◌</span> Creating account...`;

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to register user');
        }

        showAlert('Account created successfully! Signing in...', 'success');

        if (data.token) {
          localStorage.setItem('samaipata_token', data.token);
          document.cookie = `samaipata_session=${data.token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
          if (data.user) localStorage.setItem('samaipata_user', JSON.stringify(data.user));
          setTimeout(() => {
            window.location.href = 'index.html';
          }, 600);
        } else {
          document.getElementById('tab-login').click();
          document.getElementById('login-username').value = username;
          showAlert('Account created. Please enter your password to sign in.', 'success');
        }
      } catch (err) {
        showAlert(err.message || 'Registration error occurred');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Free Account';
      }
    });
  }
}
