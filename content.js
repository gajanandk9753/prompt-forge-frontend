(function () {
  "use strict";

  let panel = null;


  const SELECTORS = {
    input: [
      "#prompt-textarea",
      'div[contenteditable="true"][id="prompt-textarea"]',
      'textarea[data-id]',
      'div[contenteditable="true"]'
    ],
    messages: [
      '[data-message-author-role]',
      '[data-testid^="conversation-turn"]',
      'article[data-testid^="conversation"]'
    ],
  };

  function findElement(list) {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findAll(list) {
    for (const sel of list) {
      const elements = document.querySelectorAll(sel);
      if (elements.length) return Array.from(elements);
    }
    return [];
  }

  // Find the send button using multiple selectors

  function getPromptText() {
    const input = findElement(SELECTORS.input);
    if (!input) return "";
    if (input.tagName === "TEXTAREA") return input.value;
    return (input.innerText || input.textContent || "").trim();
  }

  function setPromptText(text) {
    const input = findElement(SELECTORS.input);
    if (!input) return;

    if (input.tagName === "TEXTAREA") {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("delete", false);
    document.execCommand("insertText", false, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function getConversationContext() {
    const messages = findAll(SELECTORS.messages);
    if (messages.length < 2) return null;

    const lastTwo = messages.slice(-2);
    let context = "";

    for (const msg of lastTwo) {
      const role = msg.getAttribute("data-message-author-role") ||
                   (msg.textContent.length > 100 ? "assistant" : "user");
      const text = (msg.innerText || msg.textContent || "").trim();
      if (text.length > 20) {
        context += `[${role.toUpperCase()}]: ${text.slice(0, 800)}\n\n`;
      }
    }

    return context.length > 100 ? context : null;
  }

function injectButton() {
  if (document.getElementById("promptforge-btn")) return;

  const textarea = document.querySelector("#prompt-textarea");

  if (!textarea) {
    console.log("[PromptForge] Textarea not found yet...");
    return;
  }

  // RIGHT SIDE ACTIONS AREA (mic/send buttons container)
  const actionArea =
    textarea
      .closest("form")
      ?.querySelector('[class*="bottom"], [class*="footer"], [class*="controls"]')
    ||
    textarea
      .closest("form")
      ?.querySelector("button")
      ?.parentElement;

  if (!actionArea) {
    console.log("[PromptForge] Action area not found...");
    return;
  }

    // CREATE BUTTON
  const btn = document.createElement("button");
  btn.id = "promptforge-btn";
  btn.type = "button";
  btn.className = "pf-sparkle-btn";
  btn.title = "Enhance your prompt";

  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round">
      <path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l3.5 7.5L24 14l-7.5 3.5L13 25l-3.5-7.5L2 14l7.5-3.5L13 3z"/>
    </svg>
  `;

  btn.addEventListener("click", handleEnhanceClick);

const buttons = Array.from(actionArea.querySelectorAll("button"));

const micBtn = buttons.find(btn => {
  const label =
    btn.getAttribute("aria-label") ||
    btn.getAttribute("data-testid") ||
    "";

  return (
    label.toLowerCase().includes("voice") ||
    label.toLowerCase().includes("speech") ||
    label.toLowerCase().includes("microphone")
  );
});

if (!micBtn) {
  console.log("[PromptForge] Mic button not found...");

  // fallback: second last button usually mic
  const allBtns = actionArea.querySelectorAll("button");

  if (allBtns.length >= 2) {
    allBtns[allBtns.length - 2].before(btn);
  }

  return;
}



  // INSERT LEFT OF MIC BUTTON
  const sendBtn =
    buttons.find(btn =>
      btn.querySelector("svg path[d*='M']")
    ) || buttons[buttons.length - 1];

  if (sendBtn) {
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "8px";

      sendBtn.parentNode.insertBefore(wrapper, sendBtn);

      wrapper.appendChild(btn);
      wrapper.appendChild(sendBtn);
  } else {
    micBtn.before(btn);
  }

  console.log("[PromptForge] ✨ Button inserted beside mic button");

  observeInputChanges();
}

  function observeInputChanges() {
    const input = findElement(SELECTORS.input);
    if (!input) return;

    const observer = new MutationObserver(updateButtonState);
    observer.observe(input, { childList: true, subtree: true, characterData: true });

    // Also listen to input events
    input.addEventListener("input", updateButtonState);
    document.addEventListener("input", updateButtonState);

    updateButtonState();
  }

  function updateButtonState() {
    const btn = document.getElementById("promptforge-btn");
    if (!btn) return;

    const hasText = getPromptText().length > 2;
    btn.style.opacity = hasText ? "1" : "0.6";
    btn.style.pointerEvents = "auto";

    const hasContext = !!getConversationContext();
    btn.classList.toggle("pf-has-context", hasContext);
    btn.title = hasContext
      ? "Enhance follow-up (Ctrl+Shift+E)"
      : "Enhance your prompt (Ctrl+Shift+E)";
  }

  function startObserver() {
  const observer = new MutationObserver(() => {
    injectButton();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

  async function handleEnhanceClick(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }

    const prompt = getPromptText();
    if (!prompt || prompt.length < 3) {
      showToast("Type a prompt first", "warning");
      return;
    }

    openPanel();
    setPanelState("loading");

    try {
      const useCase = panel?.querySelector("#pf-use-case-select")?.value || "auto";
      const conversationContext = getConversationContext();

      const result = await chrome.runtime.sendMessage({
        action: "enhance",
        prompt,
        useCase,
        conversationContext,
      });

      if (!result.success) {
        setPanelState("error", { message: result.error });
        return;
      }

      setPanelState("result", { original: prompt, ...result });
    } catch (err) {
      setPanelState("error", { message: err.message });
    }
  }

  function openPanel() {
    if (panel) {
      panel.classList.add("pf-visible");
      return;
    }

    panel = document.createElement("div");
    panel.id = "promptforge-panel";
    panel.innerHTML = `
      <div class="pf-header">
        <div class="pf-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l3.5 7.5L24 14l-7.5 3.5L13 25l-3.5-7.5L2 14l7.5-3.5L13 3z"/>
          </svg>
          <span>PromptForge</span>
        </div>
        <button class="pf-close" id="pf-close-btn">×</button>
      </div>
      <div class="pf-body" id="pf-body"></div>
      <div class="pf-footer">
        <select id="pf-use-case-select">
          <option value="auto">✨ Auto-detect</option>
          <option value="youtube">🎬 YouTube Script</option>
          <option value="blog">✍️ Blog Writing</option>
          <option value="coding">💻 Coding</option>
          <option value="email">📧 Email Writing</option>
          <option value="social">📱 Social Media</option>
          <option value="startup">🚀 Startup Ideas</option>
        </select>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector("#pf-close-btn").addEventListener("click", closePanel);
    setTimeout(() => panel.classList.add("pf-visible"), 10);
  }

  function closePanel() {
    if (panel) panel.classList.remove("pf-visible");
  }

  function setPanelState(state, data = {}) {
    const body = panel.querySelector("#pf-body");

    if (state === "loading") {
      body.innerHTML = `
        <div class="pf-loading">
          <div class="pf-spinner"></div>
          <p>Forging your prompt...</p>
        </div>
      `;
      return;
    }

    if (state === "error") {
      body.innerHTML = `
        <div class="pf-error">
          <p class="pf-error-title">Something went wrong</p>
          <p class="pf-error-msg">${escapeHtml(data.message)}</p>
        </div>
      `;
      return;
    }

    if (state === "result") {
      const scoreJump = data.enhancedScore - data.originalScore;
      const useCaseLabel = getUseCaseLabel(data.detectedUseCase);
      const followupBadge = data.isFollowup
        ? '<span class="pf-followup-badge">↳ Follow-up mode</span>'
        : '';

      body.innerHTML = `
        <div class="pf-detected">
          ${followupBadge}
          ${data.isFollowup ? "Continuing the conversation" : "Detected: <strong>" + useCaseLabel + "</strong>"}
        </div>

        <div class="pf-score-row">
          <div class="pf-score">
            <span class="pf-score-label">Original</span>
            <span class="pf-score-val pf-score-low">${data.originalScore}/10</span>
          </div>
          <div class="pf-score-arrow">→</div>
          <div class="pf-score">
            <span class="pf-score-label">Enhanced</span>
            <span class="pf-score-val pf-score-high">${data.enhancedScore}/10</span>
          </div>
          <div class="pf-score-jump">+${scoreJump}</div>
        </div>

        <div class="pf-section-label">Enhanced prompt</div>
        <textarea id="pf-enhanced-text" class="pf-enhanced">${escapeHtml(data.enhanced)}</textarea>

        <div class="pf-actions">
          <button class="pf-btn pf-btn-primary" id="pf-use-btn">Use this prompt</button>
          <button class="pf-btn pf-btn-secondary" id="pf-copy-btn">Copy</button>
        </div>

        <div class="pf-remaining">
          ${typeof data.remaining === "number" ? `${data.remaining} enhancements left today` : ""}
        </div>
      `;

      body.querySelector("#pf-use-btn").addEventListener("click", () => {
        const enhancedText = body.querySelector("#pf-enhanced-text").value;
        setPromptText(enhancedText);
        closePanel();
        showToast("Prompt enhanced ✨", "success");
      });

      body.querySelector("#pf-copy-btn").addEventListener("click", () => {
        const enhancedText = body.querySelector("#pf-enhanced-text").value;
        navigator.clipboard.writeText(enhancedText);
        showToast("Copied", "success");
      });
    }
  }

  function getUseCaseLabel(id) {
    const map = {
      auto: "Auto", youtube: "YouTube Script", blog: "Blog Writing",
      coding: "Coding", email: "Email", social: "Social Media",
      startup: "Startup Ideas", general: "General", followup: "Follow-up"
    };
    return map[id] || "General";
  }

  function showToast(message, type = "info") {
    const t = document.createElement("div");
    t.className = `pf-toast pf-toast-${type}`;
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("pf-toast-visible"), 10);
    setTimeout(() => {
      t.classList.remove("pf-toast-visible");
      setTimeout(() => t.remove(), 300);
    }, 2200);
  }

  function escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === "E" || e.key === "e")) {
      e.preventDefault();
      handleEnhanceClick();
    }
  });

  window.addEventListener("load", () => {
  injectButton();

  startObserver();

  setInterval(() => {
    injectButton();
  }, 2000);
});


})();

