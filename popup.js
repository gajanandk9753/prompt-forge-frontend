// ─────────────────────────────────────────────────────────────────────────────
// PromptForge — Popup Script v5
// ─────────────────────────────────────────────────────────────────────────────

let currentMode = "signin";
let cachedHistory = [];

document.addEventListener("DOMContentLoaded", async () => {
  setupAllHandlers();
  await refreshUI();
});

// ─── Refresh entire UI based on auth state ─────────────────────────────────
async function refreshUI() {
  const { user } = await chrome.runtime.sendMessage({ action: "getCurrentUser" });

  const authScreen = document.getElementById("auth-screen");
  const homeScreen = document.getElementById("home-screen");
  const settingsScreen = document.getElementById("settings-screen");
  const headerActions = document.getElementById("header-actions");

  if (user) {
    authScreen.style.display = "none";
    homeScreen.style.display = "block";
    settingsScreen.style.display = "none";
    headerActions.style.display = "flex";

    // Populate user info
    const initial = (user.name || user.email || "U")[0].toUpperCase();
    document.getElementById("user-avatar").textContent = initial;
    document.getElementById("user-name").textContent = user.name || "User";
    document.getElementById("user-email").textContent = user.email || "";
    document.getElementById("settings-email").textContent = user.email || "";

    await Promise.all([refreshUsage(), loadHistory()]);
  } else {
    authScreen.style.display = "block";
    homeScreen.style.display = "none";
    settingsScreen.style.display = "none";
    headerActions.style.display = "none";
  }
}

// ─── Setup all handlers ─────────────────────────────────────────────────────
function setupAllHandlers() {
  // Tab switch (auth)
  document.getElementById("tab-signin").addEventListener("click", () => switchAuthMode("signin"));
  document.getElementById("tab-signup").addEventListener("click", () => switchAuthMode("signup"));

  // Form submit
  document.getElementById("auth-form").addEventListener("submit", handleAuthSubmit);

  // Eye toggle
  document.getElementById("eye-toggle").addEventListener("click", () => {
    const input = document.getElementById("password-input");
    const showIcon = document.getElementById("eye-show");
    const hideIcon = document.getElementById("eye-hide");
    if (input.type === "password") {
      input.type = "text";
      showIcon.style.display = "none";
      hideIcon.style.display = "block";
    } else {
      input.type = "password";
      showIcon.style.display = "block";
      hideIcon.style.display = "none";
    }
  });

  // Forgot password
  document.getElementById("forgot-btn").addEventListener("click", async () => {
    const email = document.getElementById("email-input").value.trim();
    clearMessages();
    if (!email) {
      showError("Enter your email first, then click 'Forgot password?'");
      return;
    }
    const result = await chrome.runtime.sendMessage({ action: "resetPassword", email });
    if (result?.success) {
      showSuccess(`Password reset link sent to ${email}.\nCheck your inbox (and spam folder).`);
    } else {
      showError(result?.error || "Could not send reset email.");
    }
  });

  // Settings button
  document.getElementById("settings-btn").addEventListener("click", () => {
    document.getElementById("home-screen").style.display = "none";
    document.getElementById("settings-screen").style.display = "block";
  });

  // Back from settings
  document.getElementById("back-from-settings").addEventListener("click", () => {
    document.getElementById("settings-screen").style.display = "none";
    document.getElementById("home-screen").style.display = "block";
  });

  // Sign out
  document.getElementById("signout-btn").addEventListener("click", async () => {
    if (!confirm("Sign out of PromptForge?")) return;
    await chrome.runtime.sendMessage({ action: "signOut" });
    refreshUI();
  });

  // Clear history
  document.getElementById("clear-history-btn").addEventListener("click", async () => {
    if (!confirm("Clear all local history? This won't affect your account.")) return;
    await chrome.runtime.sendMessage({ action: "clearHistory" });
    cachedHistory = [];
    renderHistory([]);
    renderStats([]);
  });

  // Home tab nav
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      document.querySelectorAll(".nav-tab").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".tab-content").forEach(c => {
        c.classList.toggle("active", c.id === `tab-${target}`);
      });
    });
  });
}

function switchAuthMode(mode) {
  currentMode = mode;
  document.getElementById("tab-signin").classList.toggle("active", mode === "signin");
  document.getElementById("tab-signup").classList.toggle("active", mode === "signup");
  document.getElementById("auth-submit-btn").textContent = mode === "signin" ? "Sign in" : "Create account";
  document.getElementById("password-input").autocomplete = mode === "signin" ? "current-password" : "new-password";
  clearMessages();
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById("email-input").value.trim();
  const password = document.getElementById("password-input").value;
  const submitBtn = document.getElementById("auth-submit-btn");

  if (!email || !password) return;
  if (password.length < 6) {
    showError("Password must be at least 6 characters");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = currentMode === "signin" ? "Signing in..." : "Creating account...";
  clearMessages();

  try {
    if (currentMode === "signup") {
      const result = await chrome.runtime.sendMessage({ action: "signUp", email, password });
      if (!result.success) throw new Error(result.error);

      showSuccess(`Account created! 🎉\n\nWe sent a verification link to ${email}.\nClick it, then come back and sign in.`);
      document.getElementById("password-input").value = "";
      setTimeout(() => switchAuthMode("signin"), 4000);
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";
    } else {
      const result = await chrome.runtime.sendMessage({ action: "signIn", email, password });
      if (!result.success) throw new Error(result.error);
      showSuccess("Signed in!");
      setTimeout(refreshUI, 400);
    }
  } catch (err) {
    showError(err.message || "Something went wrong");
    submitBtn.disabled = false;
    submitBtn.textContent = currentMode === "signin" ? "Sign in" : "Create account";
  }
}

function showError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.style.display = "block";
  document.getElementById("auth-success").style.display = "none";
}
function showSuccess(msg) {
  const el = document.getElementById("auth-success");
  el.textContent = msg;
  el.style.display = "block";
  document.getElementById("auth-error").style.display = "none";
}
function clearMessages() {
  document.getElementById("auth-error").style.display = "none";
  document.getElementById("auth-success").style.display = "none";
}

// ─── Usage display ─────────────────────────────────────────────────────────
async function refreshUsage() {
  const usage = await chrome.runtime.sendMessage({ action: "getUsage" });
  const display = document.getElementById("usage-display");
  const bar = document.getElementById("usage-bar");
  const hint = document.getElementById("usage-hint");
  const planBadge = document.getElementById("plan-badge");

  if (usage.error) {
    display.textContent = "—";
    hint.textContent = "Backend issue: " + usage.error;
    hint.style.color = "var(--danger)";
    return;
  }

  const used = usage.used || 0;
  const limit = usage.limit || 5;
  const remaining = usage.remaining ?? Math.max(0, limit - used);

  display.textContent = `${used} / ${limit}`;
  bar.style.width = `${Math.min(100, (used / limit) * 100)}%`;

  if (usage.isPremium) {
    planBadge.textContent = "Pro";
    planBadge.classList.add("pro");
    document.getElementById("settings-plan").textContent = "Pro plan";
  } else {
    planBadge.textContent = "Free";
    planBadge.classList.remove("pro");
    document.getElementById("settings-plan").textContent = "Free plan";
  }

  if (used >= limit && limit > 0) {
    hint.textContent = "Daily limit reached. Resets at midnight.";
    hint.style.color = "var(--danger)";
  } else if (usage.isPremium) {
    hint.textContent = `${remaining} enhancements left today`;
    hint.style.color = "var(--success)";
  } else {
    hint.textContent = `${remaining} free enhancements remaining`;
    hint.style.color = "var(--text-muted)";
  }
}

// ─── History ───────────────────────────────────────────────────────────────
async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ action: "getHistory" });
  cachedHistory = response?.history || [];
  renderHistory(cachedHistory);
  renderStats(cachedHistory);
}

function renderHistory(history) {
  const list = document.getElementById("history-list");

  if (!history.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p class="empty-title">No enhancements yet</p>
        <p class="empty-sub">Your recent prompts will show up here</p>
      </div>
    `;
    return;
  }

  const labels = {
    auto: "Auto", youtube: "YouTube", blog: "Blog", coding: "Coding",
    email: "Email", social: "Social", startup: "Startup", general: "General",
    followup: "Follow-up"
  };

  list.innerHTML = history.slice(0, 20).map(entry => {
    const tag = entry.isFollowup ? "Follow-up" : (labels[entry.useCase] || "General");
    const tagClass = entry.isFollowup ? "history-tag followup" : "history-tag";
    const ago = formatTimeAgo(new Date(entry.timestamp));
    const scoreJump = (entry.enhancedScore || 0) - (entry.originalScore || 0);

    return `
      <div class="history-item" data-id="${entry.id}">
        <div class="history-item-header">
          <span class="${tagClass}">${escapeHtml(tag)}</span>
          <span class="history-time">${ago}</span>
        </div>
        <div class="history-text">${escapeHtml(entry.original)}</div>
        ${entry.enhancedScore ? `<div class="history-score">+${scoreJump} score</div>` : ""}
      </div>
    `;
  }).join("");

  // Click to copy enhanced version
  list.querySelectorAll(".history-item").forEach(item => {
    item.addEventListener("click", () => {
      const entry = history.find(h => String(h.id) === item.dataset.id);
      if (entry) copyToClipboard(entry.enhanced);
    });
  });
}

function renderStats(history) {
  document.getElementById("stat-total").textContent = history.length;

  if (!history.length) {
    document.getElementById("stat-improvement").textContent = "+0";
    document.getElementById("stat-favorite").textContent = "—";
    return;
  }

  // Avg score lift
  const lifts = history
    .filter(h => h.originalScore && h.enhancedScore)
    .map(h => h.enhancedScore - h.originalScore);
  const avgLift = lifts.length
    ? Math.round(lifts.reduce((a, b) => a + b, 0) / lifts.length * 10) / 10
    : 0;
  document.getElementById("stat-improvement").textContent = `+${avgLift}`;

  // Most used category
  const counts = {};
  history.forEach(h => {
    const c = h.useCase || "general";
    counts[c] = (counts[c] || 0) + 1;
  });
  const labels = {
    auto: "Auto", youtube: "🎬 YouTube", blog: "✍️ Blog", coding: "💻 Coding",
    email: "📧 Email", social: "📱 Social", startup: "🚀 Startup", general: "General",
    followup: "↳ Follow-up"
  };
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  document.getElementById("stat-favorite").textContent = top ? labels[top[0]] || top[0] : "—";
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  const t = document.createElement("div");
  t.style.cssText = `
    position: fixed; bottom: 16px; left: 50%;
    transform: translateX(-50%);
    background: #1a1a1a; color: #fff;
    padding: 8px 16px; border-radius: 8px;
    font-size: 12px; font-weight: 500;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  `;
  t.textContent = "✓ Copied to clipboard";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1500);
}
