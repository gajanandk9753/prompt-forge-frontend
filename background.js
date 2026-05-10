
const CONFIG = {
  // ⚠️  Your live backend URL
  API_URL: "https://prompt-forge-backend.vercel.app",

  // ⚠️  Your Supabase URL and ANON key (NOT service_role!)
  // Get these from: Supabase → Project Settings → API
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGc-your-anon-key-here",

  HISTORY_LIMIT: 50,
};

// ─── Install ID (anonymous tracker, kept for analytics) ─────────────────────
async function getInstallId() {
  const { installId } = await chrome.storage.local.get("installId");
  if (installId) return installId;
  const newId = "pf_" + crypto.randomUUID();
  await chrome.storage.local.set({ installId: newId });
  return newId;
}

// ─── Supabase Auth helpers (direct REST API calls) ──────────────────────────

// Sign up a new user with email/password
async function supabaseSignUp(email, password) {
  const resp = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error_description || data.msg || data.error || "Sign up failed");
  }
  return data;
}

// Sign in with email/password
async function supabaseSignIn(email, password) {
  const resp = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error_description || data.msg || data.error || "Sign in failed");
  }

  // Save the session
  await saveSession(data);
  return data;
}

// Refresh an expired token using refresh_token
async function supabaseRefresh(refreshToken) {
  const resp = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  await saveSession(data);
  return data;
}

// Sign out — clear local session
async function supabaseSignOut() {
  const session = await getSession();
  if (session?.access_token) {
    // Tell Supabase to invalidate the token (best effort)
    fetch(`${CONFIG.SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": CONFIG.SUPABASE_ANON_KEY,
      },
    }).catch(() => {});
  }
  await chrome.storage.local.remove(["session", "user"]);
}

// ─── Session management ─────────────────────────────────────────────────────
async function saveSession(authResponse) {
  const session = {
    access_token: authResponse.access_token,
    refresh_token: authResponse.refresh_token,
    expires_at: Date.now() + (authResponse.expires_in * 1000) - 60000, // 1 min buffer
  };
  const user = {
    id: authResponse.user?.id,
    email: authResponse.user?.email,
    name: authResponse.user?.user_metadata?.name || authResponse.user?.email?.split("@")[0],
  };
  await chrome.storage.local.set({ session, user });
}

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  if (!session?.access_token) return null;

  // Token expired? Try to refresh
  if (Date.now() >= session.expires_at) {
    const refreshed = await supabaseRefresh(session.refresh_token);
    if (!refreshed) {
      // Refresh failed, sign out
      await chrome.storage.local.remove(["session", "user"]);
      return null;
    }
    const { session: newSession } = await chrome.storage.local.get("session");
    return newSession;
  }

  return session;
}

async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const { user } = await chrome.storage.local.get("user");
  return user || null;
}

// ─── Get a valid access token for API calls ────────────────────────────────
async function getAccessToken() {
  const session = await getSession();
  return session?.access_token || null;
}

// ─── Install handler ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await getInstallId();
    await chrome.storage.local.set({ history: [] });
    chrome.tabs.create({ url: "https://chatgpt.com" });
  }
});

// ─── Message router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "enhance") {
    enhancePrompt(message.prompt, message.useCase, message.conversationContext)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "signUp") {
    supabaseSignUp(message.email, message.password)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "signIn") {
    supabaseSignIn(message.email, message.password)
      .then(data => sendResponse({ success: true, user: data.user }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "signOut") {
    supabaseSignOut().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === "getCurrentUser") {
    getCurrentUser().then(user => sendResponse({ user }));
    return true;
  }

  if (message.action === "getUsage") {
    fetchUsage().then(usage => sendResponse(usage));
    return true;
  }

  if (message.action === "getHistory") {
    chrome.storage.local.get("history").then(d => sendResponse({ history: d.history || [] }));
    return true;
  }

  if (message.action === "clearHistory") {
    chrome.storage.local.set({ history: [] }).then(() => sendResponse({ success: true }));
    return true;
  }
});

// ─── Fetch usage from backend ───────────────────────────────────────────────
async function fetchUsage() {
  try {
    const accessToken = await getAccessToken();
    const resp = await fetch(`${CONFIG.API_URL}/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({}),
    });

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Backend returned non-JSON");
    }
    return await resp.json();
  } catch (err) {
    return { used: 0, limit: 5, remaining: 0, error: err.message, isAuthenticated: false };
  }
}

// ─── MAIN: Enhance prompt ───────────────────────────────────────────────────
async function enhancePrompt(prompt, useCase, conversationContext) {
  const installId = await getInstallId();
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new Error("Please sign in to use PromptForge.");
  }

  const response = await fetch(`${CONFIG.API_URL}/enhance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ prompt, useCase, installId, conversationContext }),
  });

  // Check for non-JSON responses
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    console.error("[Enhance] Non-JSON response:", text.slice(0, 200));
    throw new Error("Backend returned non-JSON. Check your API_URL or Vercel deployment.");
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${response.status}`);
  }

  const data = await response.json();

  // Save to history
  const { history = [] } = await chrome.storage.local.get("history");
  const newEntry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    original: prompt,
    enhanced: data.enhanced,
    useCase: data.detectedUseCase || useCase,
    originalScore: data.originalScore,
    enhancedScore: data.enhancedScore,
    isFollowup: data.isFollowup,
  };
  const updated = [newEntry, ...history].slice(0, CONFIG.HISTORY_LIMIT);
  await chrome.storage.local.set({ history: updated });

  return data;
}
