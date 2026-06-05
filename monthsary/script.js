const STORAGE_KEY = "monthsary-site-content-v1";
const THEME_STORAGE_KEY = "monthsary-site-theme-v1";
const MUSIC_STORAGE_KEY = "monthsary-site-music-v1";
const EXPERIENCE_STORAGE_KEY = "monthsary-site-experience-v1";
const MAX_GALLERY_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_GALLERY_PHOTO_DATA_URL_BYTES = 900 * 1024;
const MAX_GALLERY_PHOTO_DIMENSION = 1400;
const root = document.getElementById("app");
const defaultSiteContent = window.defaultSiteContent;

const defaultContent = deepClone(defaultSiteContent);
let activeContent = loadSavedContent();
let gameLoopId = null;
let gameRevealTimeoutId = null;
let audioContext = null;
let ambientOscillator = null;
let ambientGain = null;

const state = {
  screen: loadSavedExperienceState() === "keepsake" ? "keepsake" : "game",
  codeInput: "",
  lockError: "",
  currentQuestionIndex: 0,
  questionStage: "answering",
  draftAnswer: "",
  latestAnswer: "",
  latestFeedback: "",
  answers: {},
  responseSubmitted: false,
  responseSaveStatus: "idle",
  envelopeOpen: false,
  editorCodeInput: "",
  editorSessionCode: "",
  editorGoogleIdToken: "",
  ownerEmail: "",
  ownerAuth: {
    googleClientId: "",
    googleEnabled: false,
    loaded: false,
  },
  secretTapCount: 0,
  editorError: "",
  editorStatus: "Changes are saved only in this browser on this device.",
  editorStatusType: "info",
  editorDraft: null,
  savedResponses: [],
  savedResponsesStatus: "not-loaded",
  savedResponsesError: "",
  hostedConfigStatus: "loading",
  theme: loadSavedTheme(),
  musicOn: loadSavedMusicPreference(),
  game: createInitialGameState(),
};

function createInitialGameState() {
  return {
    running: false,
    won: false,
    failed: false,
    round: 1,
    totalRounds: 3,
    sequence: [],
    selected: [],
    activeTile: null,
    successFlash: false,
    locked: false,
    message: "Memorize the highlighted squares, then repeat the pattern.",
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeCode(value, fallback) {
  const digits = String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 6);

  return digits.length === 6 ? digits : fallback;
}

function slugify(value, fallback) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function parseChoiceOptions(optionsText) {
  return String(optionsText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [labelPart, ...feedbackParts] = line.split("|");
      const label = labelPart?.trim() || "";
      const feedback = feedbackParts.join("|").trim();

      if (!label) {
        return null;
      }

      return {
        label,
        feedback,
      };
    })
    .filter(Boolean);
}

function formatChoiceOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((option) => {
      const label = cleanText(option?.label, "");
      const feedback = cleanText(option?.feedback, "");
      return feedback ? `${label} | ${feedback}` : label;
    })
    .join("\n");
}

function normalizeQuestion(question, index) {
  const fallbackChoice = defaultContent.questions.find((item) => item.type === "choice");
  const fallbackText = defaultContent.questions.find((item) => item.type === "text");
  const type = question?.type === "text" ? "text" : "choice";
  const prompt = cleanText(question?.prompt, `Question ${index + 1}`);
  const note = cleanText(question?.note, "");
  const id = slugify(question?.id || prompt, `question-${index + 1}`);

  if (type === "text") {
    return {
      id,
      type,
      prompt,
      note,
      placeholder: cleanText(question?.placeholder, fallbackText?.placeholder || "Type here..."),
      buttonLabel: cleanText(question?.buttonLabel, fallbackText?.buttonLabel || "Save answer"),
      feedback: cleanText(
        question?.feedback,
        fallbackText?.feedback || defaultContent.questionFlow.defaultFeedback
      ),
    };
  }

  const parsedOptions = Array.isArray(question?.options) ? question.options : [];
  const options = parsedOptions
    .map((option) => ({
      label: cleanText(option?.label, ""),
      feedback: cleanText(option?.feedback, ""),
    }))
    .filter((option) => option.label);

  return {
    id,
    type,
    prompt,
    note,
    feedback: cleanText(
      question?.feedback,
      fallbackChoice?.feedback || defaultContent.questionFlow.defaultFeedback
    ),
    options: options.length ? options : deepClone(fallbackChoice?.options || []),
  };
}

function normalizeContent(candidate) {
  const base = deepClone(defaultContent);
  const source = candidate && typeof candidate === "object" ? candidate : {};

  base.brandLabel = cleanText(source.brandLabel, base.brandLabel);
  base.accessCode = normalizeCode(source.accessCode, base.accessCode);
  base.editorCode = normalizeCode(source.editorCode, base.editorCode);
  base.experienceResetAt = cleanText(source.experienceResetAt, base.experienceResetAt || "");

  base.lockScreen.title = cleanText(source.lockScreen?.title, base.lockScreen.title);
  base.lockScreen.copy = cleanText(source.lockScreen?.copy, base.lockScreen.copy);
  base.lockScreen.hint = cleanText(source.lockScreen?.hint, base.lockScreen.hint);

  base.intro.title = cleanText(source.intro?.title, base.intro.title);
  base.intro.copy = cleanText(source.intro?.copy, base.intro.copy);
  base.intro.sideTitle = cleanText(source.intro?.sideTitle, base.intro.sideTitle);
  base.intro.sideCopy = cleanText(source.intro?.sideCopy, base.intro.sideCopy);

  base.finale.title = cleanText(source.finale?.title, base.finale.title);
  base.finale.copy = cleanText(source.finale?.copy, base.finale.copy);

  base.letter.title = cleanText(source.letter?.title, base.letter.title);
  base.letter.signoff = cleanText(source.letter?.signoff, base.letter.signoff);
  base.gallery = {
    ...base.gallery,
    eyebrow: cleanText(source.gallery?.eyebrow, base.gallery?.eyebrow || "Bonus memories"),
    title: cleanText(source.gallery?.title, base.gallery?.title || "Tiny things I want to keep."),
    items: Array.isArray(source.gallery?.items) && source.gallery.items.length
      ? source.gallery.items
          .map((item) => ({
            title: cleanText(item?.title, ""),
            copy: cleanText(item?.copy, ""),
            photoUrl: cleanText(item?.photoUrl, ""),
          }))
          .filter((item) => item.title || item.copy || item.photoUrl)
      : base.gallery?.items || [],
  };

  if (Array.isArray(source.letter?.paragraphs) && source.letter.paragraphs.length) {
    base.letter.paragraphs = source.letter.paragraphs
      .map((paragraph) => cleanText(paragraph, "").trim())
      .filter(Boolean);
  }

  if (Array.isArray(source.questions) && source.questions.length) {
    base.questions = source.questions.map((question, index) => normalizeQuestion(question, index));
  }

  return base;
}

function loadSavedContent() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (!saved) {
      return deepClone(defaultContent);
    }

    return normalizeContent(JSON.parse(saved));
  } catch (error) {
    return deepClone(defaultContent);
  }
}

function loadSavedTheme() {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);

    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }
  } catch (error) {
    // Ignore storage errors and fall back to system preference.
  }

  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function loadSavedMusicPreference() {
  try {
    return localStorage.getItem(MUSIC_STORAGE_KEY) === "on";
  } catch (error) {
    return false;
  }
}

function loadSavedExperienceState() {
  try {
    return localStorage.getItem(EXPERIENCE_STORAGE_KEY) || "";
  } catch (error) {
    return "";
  }
}

function loadExperienceUnlockedAt() {
  try {
    return Number(localStorage.getItem(`${EXPERIENCE_STORAGE_KEY}-unlocked-at`) || "0");
  } catch (error) {
    return 0;
  }
}

function saveExperienceState(value) {
  try {
    if (value) {
      localStorage.setItem(EXPERIENCE_STORAGE_KEY, value);
      localStorage.setItem(`${EXPERIENCE_STORAGE_KEY}-unlocked-at`, String(Date.now()));
    } else {
      localStorage.removeItem(EXPERIENCE_STORAGE_KEY);
      localStorage.removeItem(`${EXPERIENCE_STORAGE_KEY}-unlocked-at`);
    }
  } catch (error) {
    // The experience still works without persistence.
  }
}

function saveActiveContent() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeContent));
  } catch (error) {
    throw new Error(
      "The saved content is too large for this browser. Use smaller memory photos or hosted image links."
    );
  }
}

async function loadHostedContent() {
  try {
    const response = await fetch("/api/config", {
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      state.hostedConfigStatus = "unavailable";
      return;
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      state.hostedConfigStatus = "unavailable";
      return;
    }

    if (payload.content) {
      activeContent = normalizeContent(payload.content);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(activeContent));
      } catch (error) {
        // Hosted content can still be used even when the browser cannot cache it locally.
      }

      if (
        activeContent.experienceResetAt &&
        Date.parse(activeContent.experienceResetAt) > loadExperienceUnlockedAt()
      ) {
        saveExperienceState("");
        if (state.screen === "keepsake") {
          state.screen = "game";
        }
      }
    }

    state.hostedConfigStatus = "ready";
    renderApp();
  } catch (error) {
    state.hostedConfigStatus = "unavailable";
  }
}

async function saveHostedContent(content) {
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      adminCode: state.editorSessionCode,
      googleIdToken: state.editorGoogleIdToken,
      content,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "The online configuration could not be saved.");
  }
}

async function loadOwnerAuthConfig() {
  try {
    const response = await fetch("/api/auth", {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return;
    }

    const payload = await response.json().catch(() => ({}));
    state.ownerAuth.googleClientId = payload.googleClientId || "";
    state.ownerAuth.googleEnabled = Boolean(payload.googleEnabled && payload.googleClientId);
    state.ownerAuth.loaded = true;
  } catch (error) {
    state.ownerAuth.loaded = true;
  }
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');

    if (existingScript) {
      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

async function initializeGoogleOwnerButton() {
  if (state.screen !== "editor-auth" || !state.ownerAuth.googleEnabled) {
    return;
  }

  const buttonRoot = document.getElementById("google-owner-signin");

  if (!buttonRoot || buttonRoot.dataset.ready === "true") {
    return;
  }

  try {
    await loadGoogleIdentityScript();
    window.google.accounts.id.initialize({
      client_id: state.ownerAuth.googleClientId,
      callback: handleGoogleCredentialResponse,
    });
    window.google.accounts.id.renderButton(buttonRoot, {
      theme: state.theme === "dark" ? "filled_black" : "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      width: 280,
    });
    buttonRoot.dataset.ready = "true";
  } catch (error) {
    state.editorError = "Google sign-in could not load. Use the editor code for now.";
    renderApp();
  }
}

async function handleGoogleCredentialResponse(response) {
  try {
    const verifyResponse = await fetch("/api/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ googleIdToken: response.credential }),
    });
    const payload = await verifyResponse.json().catch(() => ({}));

    if (!verifyResponse.ok) {
      throw new Error(payload.error || "This Google account cannot edit the site.");
    }

    state.editorGoogleIdToken = response.credential;
    state.ownerEmail = payload.owner?.email || "";
    openEditorPanel();
  } catch (error) {
    state.editorError = error.message || "Google sign-in failed.";
    renderApp();
  }
}

window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;

function buildResponsePayload() {
  return {
    id:
      window.crypto?.randomUUID?.() ||
      `response-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    submittedAt: new Date().toISOString(),
    pageTitle: document.title,
    answers: getQuestions().map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      answer: state.answers[question.id] || "",
    })),
  };
}

async function saveVisitorResponse() {
  if (state.responseSubmitted || state.responseSaveStatus === "saving") {
    return;
  }

  state.responseSaveStatus = "saving";
  renderApp();

  try {
    const response = await fetch("/api/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ response: buildResponsePayload() }),
    });

    if (response.status === 404) {
      state.responseSaveStatus = "unavailable";
      renderApp();
      return;
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "The response could not be saved online.");
    }

    state.responseSubmitted = true;
    state.responseSaveStatus = "saved";
    renderApp();
  } catch (error) {
    state.responseSaveStatus = "failed";
    renderApp();
  }
}

function saveThemePreference() {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  } catch (error) {
    // Ignore storage errors so the site still works in restricted contexts.
  }
}

function applyTheme() {
  document.body.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
}

function createEditorDraft(source = activeContent) {
  return {
    brandLabel: source.brandLabel,
    accessCode: source.accessCode,
    editorCode: source.editorCode,
    lockTitle: source.lockScreen.title,
    lockCopy: source.lockScreen.copy,
    lockHint: source.lockScreen.hint,
    introTitle: source.intro.title,
    introCopy: source.intro.copy,
    introSideTitle: source.intro.sideTitle,
    introSideCopy: source.intro.sideCopy,
    finaleTitle: source.finale.title,
    finaleCopy: source.finale.copy,
    letterTitle: source.letter.title,
    letterSignoff: source.letter.signoff,
    letterParagraphsText: source.letter.paragraphs.join("\n\n"),
    galleryEyebrow: source.gallery?.eyebrow || "Bonus memories",
    galleryTitle: source.gallery?.title || "Tiny things I want to keep.",
    galleryItems: (source.gallery?.items || []).map((item) => ({
      title: item.title || "",
      copy: item.copy || "",
      photoUrl: item.photoUrl || "",
    })),
    questions: source.questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      note: question.note || "",
      placeholder: question.placeholder || "",
      buttonLabel: question.buttonLabel || "",
      feedback: question.feedback || "",
      optionsText: question.type === "choice" ? formatChoiceOptions(question.options) : "",
    })),
  };
}

function getQuestions() {
  return Array.isArray(activeContent.questions) ? activeContent.questions : [];
}

function getCurrentQuestion() {
  return getQuestions()[state.currentQuestionIndex];
}

function getCompletionCount() {
  const total = getQuestions().length;

  if (!total) {
    return 0;
  }

  if (state.screen === "finale") {
    return total;
  }

  if (state.screen !== "questions") {
    return 0;
  }

  return state.questionStage === "feedback"
    ? state.currentQuestionIndex + 1
    : state.currentQuestionIndex;
}

function getProgressWidth() {
  const total = getQuestions().length;

  if (!total) {
    return 0;
  }

  return Math.round((getCompletionCount() / total) * 100);
}

function renderTopbar() {
  const nextTheme = state.theme === "light" ? "dark" : "light";
  const currentThemeLabel = state.theme === "light" ? "Light mode" : "Dark mode";
  const nextMusicLabel = state.musicOn ? "Turn music off" : "Turn music on";

  return `
    <div class="app-topbar">
      <button
        class="floating-chip"
        type="button"
        data-action="secret-owner-tap"
        aria-label="Owner access"
      >
        <span class="chip-dot" aria-hidden="true"></span>
        <span>${escapeHtml(activeContent.brandLabel)}</span>
      </button>

      <div class="topbar-actions">
        <button
          class="theme-toggle"
          type="button"
          data-action="toggle-music"
          aria-label="${escapeHtml(nextMusicLabel)}"
        >
          <span class="theme-toggle-label">Sound</span>
          <span class="theme-toggle-value">${state.musicOn ? "Music on" : "Music off"}</span>
        </button>

        <button
          class="theme-toggle"
          type="button"
          data-action="toggle-theme"
          aria-label="Switch to ${escapeHtml(nextTheme)} mode"
        >
          <span class="theme-toggle-label">Theme</span>
          <span class="theme-toggle-value">${escapeHtml(currentThemeLabel)}</span>
        </button>
      </div>
    </div>
  `;
}

function renderProgress() {
  const total = getQuestions().length;
  const completed = getCompletionCount();

  return `
    <div class="progress-shell">
      <div class="progress-topline">
        <span>Little questions before the final surprise</span>
        <span>${completed} / ${total} answered</span>
      </div>
      <div class="progress-track" aria-hidden="true">
        <div class="progress-fill" style="width: ${getProgressWidth()}%;"></div>
      </div>
    </div>
  `;
}

function renderGameScreen() {
  const game = state.game;
  const statusClass = game.failed ? "game-status is-danger" : "game-status";
  const fieldClass = game.won ? "game-field focus-test is-won" : "game-field focus-test";
  const progressLabel = game.won
    ? "Complete"
    : game.running
      ? `${game.selected.length} / ${game.sequence.length}`
      : "Ready";

  return `
    <section class="game-shell">
      <div class="game-header">
        <div>
          <p class="game-kicker">School project test</p>
          <h1 class="game-title" data-action="secret-owner-tap">Focus Grid</h1>
          <p class="game-copy">
            I need someone to try this quick memory prototype. Watch the
            highlighted squares, then click them back in the same order.
          </p>
        </div>

        <span class="game-test-badge">Prototype v0.3</span>
      </div>

      <div class="game-hud" aria-live="polite">
        <span>Round <strong>${game.round} / ${game.totalRounds}</strong></span>
        <span>Pattern <strong>${progressLabel}</strong></span>
        <span>Status <strong>${game.locked ? "Watch" : game.running ? "Repeat" : "Idle"}</strong></span>
      </div>

      <div class="${fieldClass}">
        <div class="focus-card">
          <p class="focus-label">Short-term memory check</p>
          <div
            class="${game.successFlash ? "focus-grid is-success" : "focus-grid"}"
            aria-label="Nine square memory grid"
          >
            ${new Array(9)
              .fill(null)
              .map((_, index) => {
                const tileNumber = index + 1;
                const isActive = game.activeTile === tileNumber;
                const isSelected = game.selected.includes(tileNumber);
                const classes = [
                  "focus-tile",
                  isActive ? "is-active" : "",
                  isSelected ? "is-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return `
                  <button
                    class="${classes}"
                    type="button"
                    data-action="select-game-tile"
                    data-tile="${tileNumber}"
                    ${!game.running || game.locked || game.won ? "disabled" : ""}
                    aria-label="Grid square ${tileNumber}"
                  ></button>
                `;
              })
              .join("")}
          </div>
        </div>
        ${
          !game.running || game.locked
            ? `
              <div class="game-overlay">
                ${game.locked ? "" : `<p class="${statusClass}">${escapeHtml(game.message)}</p>`}
                <div class="button-row">
                  ${
                    game.locked
                      ? ""
                      : `
                        <button class="primary-button" type="button" data-action="start-game">
                          ${game.won ? "Run test again" : game.failed ? "Retry test" : "Start test"}
                        </button>
                      `
                  }
                </div>
              </div>
            `
            : ""
        }
      </div>

      <p class="game-tip">Tip for the tester: the pattern gets slightly longer each round.</p>
    </section>
  `;
}

function renderRevealScreen() {
  return `
    <section class="reveal-screen" aria-live="polite">
      <div class="reveal-loader">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p class="game-kicker">Result ready</p>
      <h1 class="reveal-title">This was not actually for school.</h1>
      <p class="reveal-copy">Loading the real page...</p>
    </section>
  `;
}

function renderCodeSlots(value) {
  return new Array(6)
    .fill(null)
    .map((_, index) => {
      const digit = value[index] || "";
      const classes = digit ? "code-slot is-filled" : "code-slot";
      return `<span class="${classes}">${escapeHtml(digit)}</span>`;
    })
    .join("");
}

function renderLockScreen() {
  const helpClass = state.lockError ? "code-help is-error" : "code-help";

  return `
    <section class="screen-card">
      <div class="lock-layout">
        <span class="sticker">Private mode: on</span>
        <p class="eyebrow">${escapeHtml(activeContent.lockScreen.eyebrow)}</p>
        <h1 class="screen-title">${escapeHtml(activeContent.lockScreen.title)}</h1>
        <p class="screen-copy">${escapeHtml(activeContent.lockScreen.copy)}</p>

        <form class="code-form" data-form="unlock">
          <label class="code-frame">
            <span class="sr-only">Enter the six digit code</span>
            <input
              id="code-input"
              class="ghost-input"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              aria-label="Six digit access code"
            />
            <span class="code-slots" aria-hidden="true">${renderCodeSlots(state.codeInput)}</span>
          </label>

          <p class="${helpClass}">
            ${escapeHtml(state.lockError || activeContent.lockScreen.hint)}
          </p>

          <div class="button-row">
            <button class="primary-button" type="submit">
              ${escapeHtml(activeContent.lockScreen.buttonLabel)}
            </button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderEditorAuthScreen() {
  const helpClass = state.editorError ? "code-help is-error" : "code-help";
  const googleMarkup = state.ownerAuth.googleEnabled
    ? `
      <div class="google-owner-auth">
        <p class="editor-help">Sign in with the owner Gmail account.</p>
        <div id="google-owner-signin"></div>
      </div>
    `
    : "";

  return `
    <section class="screen-card">
      <div class="lock-layout">
        <span class="sticker">Owner only</span>
        <p class="eyebrow">Edit mode</p>
        <h1 class="screen-title">Owner access only.</h1>
        <p class="screen-copy">
          Sign in with the owner Gmail account when the hosted version is
          configured, or use the backup editor code while testing locally.
        </p>

        ${googleMarkup}

        <form class="code-form" data-form="editor-auth">
          <label class="code-frame">
            <span class="sr-only">Enter the editor code</span>
            <input
              id="editor-code-input"
              class="ghost-input"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              aria-label="Six digit editor code"
            />
            <span class="code-slots" aria-hidden="true">
              ${renderCodeSlots(state.editorCodeInput)}
            </span>
          </label>

          <p class="${helpClass}">
            ${escapeHtml(state.editorError || "Use the owner code, not the visitor code.")}
          </p>

          <div class="button-row">
            <button class="primary-button" type="submit">Open editor</button>
            <button class="secondary-button" type="button" data-action="back-to-lock">
              Back
            </button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderIntroScreen() {
  return `
    <section class="screen-card">
      <div class="hero-layout">
        <div class="hero-panel">
          <p class="eyebrow">${escapeHtml(activeContent.intro.eyebrow)}</p>
          <h1 class="screen-title">${escapeHtml(activeContent.intro.title)}</h1>
          <p class="screen-copy">${escapeHtml(activeContent.intro.copy)}</p>
          <div class="button-row">
            <button class="primary-button" type="button" data-action="start-questions">
              ${escapeHtml(activeContent.intro.buttonLabel)}
            </button>
          </div>
        </div>

        <div class="support-stack">
          <span class="sticker">${escapeHtml(activeContent.intro.sticker)}</span>
          <div class="support-card">
            <h2 class="panel-title">${escapeHtml(activeContent.intro.sideTitle)}</h2>
            <p class="panel-copy">${escapeHtml(activeContent.intro.sideCopy)}</p>
          </div>
          <div class="mini-list">
            ${activeContent.intro.points
              .map(
                (point) => `
                  <div class="mini-row">
                    <span>${escapeHtml(point.label)}</span>
                    <strong>${escapeHtml(point.value)}</strong>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderQuestionInput(question) {
  if (question.type === "text") {
    return `
      <form class="text-form" data-form="text-question">
        <label for="text-answer" class="sr-only">${escapeHtml(question.prompt)}</label>
        <textarea
          id="text-answer"
          class="text-answer"
          placeholder="${escapeHtml(question.placeholder || "Type here...")}"
        ></textarea>
        <div class="button-row">
          <button class="primary-button" type="submit">
            ${escapeHtml(question.buttonLabel || "Save answer")}
          </button>
        </div>
      </form>
    `;
  }

  return `
    <div class="choice-grid">
      ${question.options
        .map(
          (option, index) => `
            <button
              class="choice-button"
              type="button"
              data-action="pick-choice"
              data-option-index="${index}"
            >
              ${escapeHtml(option.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderQuestionFeedback() {
  const isLastQuestion = state.currentQuestionIndex === getQuestions().length - 1;
  const nextLabel = isLastQuestion
    ? activeContent.finale.buttonLabel
    : activeContent.questionFlow.nextLabel;

  return `
    <div class="feedback-card">
      <p class="feedback-label">${escapeHtml(activeContent.questionFlow.feedbackLabel)}</p>
      <p class="feedback-answer">${escapeHtml(state.latestAnswer)}</p>
      <p class="feedback-copy">${escapeHtml(state.latestFeedback)}</p>
      <div class="button-row">
        <button class="primary-button" type="button" data-action="next-question">
          ${escapeHtml(nextLabel)}
        </button>
      </div>
    </div>
  `;
}

function renderQuestionScreen() {
  const question = getCurrentQuestion();

  if (!question) {
    state.screen = "finale";
    return renderFinaleScreen();
  }

  return `
    <section class="screen-card">
      <div class="question-layout">
        ${renderProgress()}
        <div class="question-card">
          <div class="question-meta">
            <span class="meta-pill">Question ${state.currentQuestionIndex + 1}</span>
            <span class="meta-pill">${escapeHtml(question.type)}</span>
          </div>
          <h1 class="panel-title">${escapeHtml(question.prompt)}</h1>
          <p class="question-note">${escapeHtml(question.note || "")}</p>
          ${
            state.questionStage === "feedback"
              ? renderQuestionFeedback()
              : renderQuestionInput(question)
          }
        </div>
      </div>
    </section>
  `;
}

function renderAnswerCloud() {
  const answerEntries = getQuestions()
    .map((question) => {
      const answer = state.answers[question.id];

      if (!answer) {
        return null;
      }

      const preview =
        answer.length > 42 ? `${answer.slice(0, 39).trimEnd()}...` : answer;

      return `<span class="answer-chip">${escapeHtml(preview)}</span>`;
    })
    .filter(Boolean);

  if (!answerEntries.length) {
    return `<p class="helper-copy">${escapeHtml(activeContent.finale.emptyAnswersCopy)}</p>`;
  }

  return `<div class="answer-cloud">${answerEntries.join("")}</div>`;
}

function renderResponseSaveNote() {
  const messages = {
    idle: "",
    saving: "Saving your answers...",
    saved: "Your answers were saved.",
    failed: "Your answers stayed on this page, but online saving failed.",
    unavailable: "Local preview mode: answers are not saving online yet.",
  };

  const message = messages[state.responseSaveStatus] || "";

  if (!message) {
    return "";
  }

  return `<p class="response-save-note">${escapeHtml(message)}</p>`;
}

function renderLetter() {
  return `
    <article class="opened-letter">
      <p class="eyebrow">${escapeHtml(activeContent.letter.eyebrow)}</p>
      <h2 class="letter-title">${escapeHtml(activeContent.letter.title)}</h2>
      ${activeContent.letter.paragraphs
        .map((paragraph) => `<p class="letter-copy">${escapeHtml(paragraph)}</p>`)
        .join("")}
      <p class="letter-signoff">${escapeHtml(activeContent.letter.signoff)}</p>
    </article>
  `;
}

function renderMemoryGallery() {
  const gallery = activeContent.gallery;

  if (!gallery?.items?.length) {
    return "";
  }

  return `
    <section class="memory-gallery">
      <p class="eyebrow">${escapeHtml(gallery.eyebrow)}</p>
      <h2 class="letter-title">${escapeHtml(gallery.title)}</h2>
      <div class="memory-grid">
        ${gallery.items
          .map(
            (item, index) => `
              <article class="memory-card">
                ${
                  item.photoUrl
                    ? `
                      <img
                        class="memory-photo"
                        src="${escapeHtml(item.photoUrl)}"
                        alt="${escapeHtml(item.title || "Memory photo")}"
                        loading="lazy"
                        data-memory-photo="true"
                      />
                    `
                    : ""
                }
                <span>${String(index + 1).padStart(2, "0")}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.copy)}</p>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderFinaleScreen() {
  const envelopeClass = state.envelopeOpen ? "envelope is-open" : "envelope";

  return `
    <section class="screen-card">
      <div class="finale-layout">
        ${renderProgress()}
        <div class="finale-grid">
          <div class="finale-panel">
            <p class="eyebrow">${escapeHtml(activeContent.finale.eyebrow)}</p>
            <h1 class="panel-title">${escapeHtml(activeContent.finale.title)}</h1>
            <p class="panel-copy">${escapeHtml(activeContent.finale.copy)}</p>
            ${renderAnswerCloud()}
            ${renderResponseSaveNote()}
          </div>

          <div class="envelope-scene" id="envelope-section">
            <button
              class="${envelopeClass}"
              type="button"
              data-action="toggle-envelope"
              aria-expanded="${state.envelopeOpen ? "true" : "false"}"
            >
              <span class="envelope-shadow" aria-hidden="true"></span>
              <span class="envelope-card" aria-hidden="true"></span>
              <span class="letter-peek" aria-hidden="true">
                <p>${escapeHtml(activeContent.letter.peekLabel)}</p>
                <span>${escapeHtml(activeContent.letter.peekCopy)}</span>
              </span>
              <span class="envelope-pocket" aria-hidden="true"></span>
              <span class="envelope-flap" aria-hidden="true"></span>
              <span class="envelope-seal" aria-hidden="true">
                ${escapeHtml(activeContent.letter.sealLabel)}
              </span>
              <span class="sr-only">
                ${escapeHtml(activeContent.finale.envelopeButtonLabel)}
              </span>
            </button>

            <button class="envelope-button" type="button" data-action="toggle-envelope">
              ${
                state.envelopeOpen
                  ? escapeHtml(activeContent.finale.openedButtonLabel)
                  : escapeHtml(activeContent.finale.envelopeButtonLabel)
              }
            </button>
          </div>
        </div>
        ${state.envelopeOpen ? `${renderLetter()}${renderMemoryGallery()}` : ""}
      </div>
    </section>
  `;
}

function scrollEnvelopeIntoView() {
  window.setTimeout(() => {
    document
      .getElementById("envelope-section")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 120);
}

function renderKeepsakeScreen() {
  return `
    <section class="screen-card keepsake-screen">
      <div class="finale-layout">
        <div class="finale-panel">
          <p class="eyebrow">Unlocked keepsake</p>
          <h1 class="panel-title">${escapeHtml(activeContent.finale.title)}</h1>
          <p class="panel-copy">
            The surprise is already open. You can come back here anytime to read
            the letter again or browse the memory gallery.
          </p>
        </div>
        ${renderLetter()}
        ${renderMemoryGallery()}
      </div>
    </section>
  `;
}

function renderEditorInput(label, field, value, help = "", extraAttributes = "") {
  return `
    <label class="editor-field">
      <span class="editor-label">${escapeHtml(label)}</span>
      <input
        class="editor-input"
        type="text"
        data-editor-field="${escapeHtml(field)}"
        value="${escapeHtml(value)}"
        ${extraAttributes}
      />
      ${help ? `<span class="editor-help">${escapeHtml(help)}</span>` : ""}
    </label>
  `;
}

function renderEditorTextarea(label, field, value, help = "", rows = 4) {
  return `
    <label class="editor-field editor-field-full">
      <span class="editor-label">${escapeHtml(label)}</span>
      <textarea
        class="editor-textarea"
        rows="${rows}"
        data-editor-field="${escapeHtml(field)}"
      >${escapeHtml(value)}</textarea>
      ${help ? `<span class="editor-help">${escapeHtml(help)}</span>` : ""}
    </label>
  `;
}

function renderQuestionEditor(question, index) {
  return `
    <article class="editor-question-card">
      <div class="editor-question-top">
        <div>
          <p class="editor-card-kicker">Question ${index + 1}</p>
          <h3 class="editor-card-title">${escapeHtml(question.prompt || "Untitled question")}</h3>
        </div>
        <div class="editor-inline-actions">
          <button
            class="tiny-button"
            type="button"
            data-action="move-question-up"
            data-question-index="${index}"
          >
            Up
          </button>
          <button
            class="tiny-button"
            type="button"
            data-action="move-question-down"
            data-question-index="${index}"
          >
            Down
          </button>
          <button
            class="tiny-button tiny-button-danger"
            type="button"
            data-action="remove-question"
            data-question-index="${index}"
          >
            Remove
          </button>
        </div>
      </div>

      <div class="editor-grid">
        <label class="editor-field editor-field-full">
          <span class="editor-label">Prompt</span>
          <input
            class="editor-input"
            type="text"
            data-question-index="${index}"
            data-question-field="prompt"
            value="${escapeHtml(question.prompt)}"
          />
        </label>

        <label class="editor-field editor-field-full">
          <span class="editor-label">Note</span>
          <input
            class="editor-input"
            type="text"
            data-question-index="${index}"
            data-question-field="note"
            value="${escapeHtml(question.note)}"
          />
        </label>

        <label class="editor-field">
          <span class="editor-label">Type</span>
          <select
            class="editor-select"
            data-question-index="${index}"
            data-question-field="type"
          >
            <option value="choice" ${question.type === "choice" ? "selected" : ""}>choice</option>
            <option value="text" ${question.type === "text" ? "selected" : ""}>text</option>
          </select>
        </label>
      </div>

      ${
        question.type === "choice"
          ? `
            <label class="editor-field editor-field-full">
              <span class="editor-label">Options</span>
              <textarea
                class="editor-textarea"
                rows="6"
                data-question-index="${index}"
                data-question-field="optionsText"
              >${escapeHtml(question.optionsText)}</textarea>
              <span class="editor-help">
                One option per line. Use this format: Choice text | Feedback text
              </span>
            </label>
          `
          : `
            <div class="editor-grid">
              <label class="editor-field editor-field-full">
                <span class="editor-label">Placeholder</span>
                <input
                  class="editor-input"
                  type="text"
                  data-question-index="${index}"
                  data-question-field="placeholder"
                  value="${escapeHtml(question.placeholder)}"
                />
              </label>

              <label class="editor-field">
                <span class="editor-label">Button label</span>
                <input
                  class="editor-input"
                  type="text"
                  data-question-index="${index}"
                  data-question-field="buttonLabel"
                  value="${escapeHtml(question.buttonLabel)}"
                />
              </label>

              <label class="editor-field editor-field-full">
                <span class="editor-label">Feedback after submit</span>
                <textarea
                  class="editor-textarea"
                  rows="4"
                  data-question-index="${index}"
                  data-question-field="feedback"
                >${escapeHtml(question.feedback)}</textarea>
              </label>
            </div>
          `
      }
    </article>
  `;
}

function renderGalleryItemEditor(item, index) {
  return `
    <article class="editor-question-card">
      <div class="editor-question-top">
        <div>
          <p class="editor-card-kicker">Memory ${index + 1}</p>
          <h3 class="editor-card-title">${escapeHtml(item.title || "Untitled memory")}</h3>
        </div>
        <button
          class="tiny-button tiny-button-danger"
          type="button"
          data-action="remove-gallery-item"
          data-gallery-index="${index}"
        >
          Remove
        </button>
      </div>

      <div class="editor-grid">
        <label class="editor-field editor-field-full">
          <span class="editor-label">Memory title</span>
          <input
            class="editor-input"
            type="text"
            data-gallery-index="${index}"
            data-gallery-field="title"
            value="${escapeHtml(item.title)}"
          />
        </label>

        <label class="editor-field editor-field-full">
          <span class="editor-label">Photo URL</span>
          <input
            class="editor-input"
            type="url"
            data-gallery-index="${index}"
            data-gallery-field="photoUrl"
            value="${escapeHtml(item.photoUrl || "")}"
            placeholder="https://example.com/photo.jpg or ./photos/photo.jpg"
          />
          <span class="editor-help">
            Use a hosted image link, or put an image in the project folder and reference it like ./photos/photo.jpg.
          </span>
        </label>

        <label class="editor-field editor-field-full">
          <span class="editor-label">Optional photo upload</span>
          <input
            class="editor-input file-input"
            type="file"
            accept="image/*"
            data-gallery-index="${index}"
            data-gallery-upload="photo"
          />
          <span class="editor-help">
            This embeds the selected image into the memory card. Use smaller photos for faster loading.
          </span>
        </label>

        ${
          item.photoUrl
            ? `
              <div class="editor-field editor-field-full">
                <span class="editor-label">Photo preview</span>
                <img
                  class="editor-photo-preview"
                  src="${escapeHtml(item.photoUrl)}"
                  alt="${escapeHtml(item.title || "Memory photo preview")}"
                />
                <button
                  class="tiny-button tiny-button-danger"
                  type="button"
                  data-action="clear-gallery-photo"
                  data-gallery-index="${index}"
                >
                  Remove photo
                </button>
              </div>
            `
            : ""
        }

        <label class="editor-field editor-field-full">
          <span class="editor-label">Memory note</span>
          <textarea
            class="editor-textarea"
            rows="4"
            data-gallery-index="${index}"
            data-gallery-field="copy"
          >${escapeHtml(item.copy)}</textarea>
        </label>
      </div>
    </article>
  `;
}

function formatResponseDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (error) {
    return value || "Unknown date";
  }
}

function renderSavedResponsesPanel() {
  const statusText = {
    "not-loaded": "Load responses when you want to review or print them.",
    loading: "Loading saved responses...",
    ready: state.savedResponses.length
      ? `${state.savedResponses.length} saved response${state.savedResponses.length === 1 ? "" : "s"} loaded.`
      : "No saved responses yet.",
    error: state.savedResponsesError || "Responses could not be loaded.",
  }[state.savedResponsesStatus];

  return `
    <section class="editor-section">
      <div class="editor-section-top">
        <div>
          <p class="editor-card-kicker">Answer archive</p>
          <h2 class="editor-section-title">Saved responses</h2>
        </div>

        <div class="editor-inline-actions">
          <button class="secondary-button" type="button" data-action="load-responses">
            Refresh responses
          </button>
          <button
            class="secondary-button"
            type="button"
            data-action="download-responses"
            ${state.savedResponses.length ? "" : "disabled"}
          >
            Download CSV
          </button>
          <button
            class="secondary-button"
            type="button"
            data-action="print-responses"
            ${state.savedResponses.length ? "" : "disabled"}
          >
            Print
          </button>
        </div>
      </div>

      <p class="editor-help response-panel-status">${escapeHtml(statusText || "")}</p>

      ${
        state.savedResponses.length
          ? `
            <div class="response-list">
              ${state.savedResponses
                .map(
                  (savedResponse, index) => `
                    <article class="response-card">
                      <div class="response-card-top">
                        <h3 class="editor-card-title">Response ${state.savedResponses.length - index}</h3>
                        <span class="meta-pill">${escapeHtml(formatResponseDate(savedResponse.submittedAt))}</span>
                      </div>
                      ${(savedResponse.answers || [])
                        .map(
                          (item) => `
                            <div class="response-answer">
                              <p>${escapeHtml(item.prompt || "Question")}</p>
                              <strong>${escapeHtml(item.answer || "No answer")}</strong>
                            </div>
                          `
                        )
                        .join("")}
                    </article>
                  `
                )
                .join("")}
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderEditorPanel() {
  const draft = state.editorDraft || createEditorDraft();
  const statusClass = `code-help editor-status ${
    state.editorStatusType === "error" ? "is-error" : ""
  }`;

  return `
    <section class="screen-card">
      <div class="editor-layout">
        <div class="editor-header">
          <div class="editor-header-copy">
            <p class="eyebrow">Owner editor</p>
            <h1 class="panel-title">Edit the site from here.</h1>
            <p class="panel-copy">
              Update the passcodes, rewrite the girlfriend-facing copy, add or
              remove questions, and replace the final envelope letter whenever
              you want.
            </p>
          </div>

          <div class="editor-action-stack">
            <button class="primary-button" type="button" data-action="save-editor">
              Save changes
            </button>
            <button class="secondary-button keepsake-reset-button" type="button" data-action="remove-keepsake">
              Reset keepsake
            </button>
            <button class="secondary-button" type="button" data-action="exit-editor">
              Back to the live site
            </button>
            <button class="secondary-button" type="button" data-action="reset-editor">
              Reset to original
            </button>
          </div>
        </div>

        <p class="${statusClass}">${escapeHtml(state.editorStatus)}</p>

        ${renderSavedResponsesPanel()}

        <section class="editor-section">
          <div class="editor-section-top">
            <div>
              <p class="editor-card-kicker">Codes and quick text</p>
              <h2 class="editor-section-title">Core settings</h2>
            </div>
          </div>

          <div class="editor-grid">
            ${renderEditorInput(
              "Floating label",
              "brandLabel",
              draft.brandLabel,
              "This is the small chip at the top of the site."
            )}
            ${renderEditorInput(
              "Visitor 6 digit code",
              "accessCode",
              draft.accessCode,
              "Six numbers only.",
              'inputmode="numeric" maxlength="6"'
            )}
            ${renderEditorInput(
              "Editor 6 digit code",
              "editorCode",
              draft.editorCode,
              "This protects the built-in editor.",
              'inputmode="numeric" maxlength="6"'
            )}
            ${renderEditorInput("Lock screen title", "lockTitle", draft.lockTitle)}
            ${renderEditorTextarea("Lock screen copy", "lockCopy", draft.lockCopy, "", 3)}
            ${renderEditorInput(
              "Lock screen hint",
              "lockHint",
              draft.lockHint,
              "This clue appears under the six code boxes."
            )}
            ${renderEditorInput("Intro title", "introTitle", draft.introTitle)}
            ${renderEditorTextarea("Intro copy", "introCopy", draft.introCopy, "", 3)}
            ${renderEditorInput("Intro side title", "introSideTitle", draft.introSideTitle)}
            ${renderEditorTextarea(
              "Intro side copy",
              "introSideCopy",
              draft.introSideCopy,
              "",
              3
            )}
            ${renderEditorInput("Finale title", "finaleTitle", draft.finaleTitle)}
            ${renderEditorTextarea("Finale copy", "finaleCopy", draft.finaleCopy, "", 3)}
          </div>
        </section>

        <section class="editor-section">
          <div class="editor-section-top">
            <div>
              <p class="editor-card-kicker">Question builder</p>
              <h2 class="editor-section-title">Questions</h2>
            </div>

            <div class="editor-inline-actions">
              <button
                class="secondary-button"
                type="button"
                data-action="add-question"
                data-new-type="choice"
              >
                Add choice question
              </button>
              <button
                class="secondary-button"
                type="button"
                data-action="add-question"
                data-new-type="text"
              >
                Add text question
              </button>
            </div>
          </div>

          <div class="editor-question-list">
            ${draft.questions.map((question, index) => renderQuestionEditor(question, index)).join("")}
          </div>
        </section>

        <section class="editor-section">
          <div class="editor-section-top">
            <div>
              <p class="editor-card-kicker">Envelope content</p>
              <h2 class="editor-section-title">Final letter</h2>
            </div>
          </div>

          <div class="editor-grid">
            ${renderEditorInput("Letter title", "letterTitle", draft.letterTitle)}
            ${renderEditorInput("Letter signoff", "letterSignoff", draft.letterSignoff)}
            ${renderEditorTextarea(
              "Letter paragraphs",
              "letterParagraphsText",
              draft.letterParagraphsText,
              "Separate paragraphs with a blank line.",
              12
            )}
          </div>
        </section>

        <section class="editor-section">
          <div class="editor-section-top">
            <div>
              <p class="editor-card-kicker">Keepsake section</p>
              <h2 class="editor-section-title">Memory gallery</h2>
            </div>

            <button class="secondary-button" type="button" data-action="add-gallery-item">
              Add memory
            </button>
          </div>

          <div class="editor-grid">
            ${renderEditorInput("Gallery eyebrow", "galleryEyebrow", draft.galleryEyebrow)}
            ${renderEditorInput("Gallery title", "galleryTitle", draft.galleryTitle)}
          </div>

          <div class="editor-question-list">
            ${
              draft.galleryItems.length
                ? draft.galleryItems
                    .map((item, index) => renderGalleryItemEditor(item, index))
                    .join("")
                : `<p class="editor-help">No gallery memories yet. Add one when you are ready.</p>`
            }
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderApp() {
  let screenMarkup = "";
  const topbarMarkup = state.screen === "game" || state.screen === "reveal" ? "" : renderTopbar();

  applyTheme();

  if (state.screen === "game") {
    screenMarkup = renderGameScreen();
  } else if (state.screen === "reveal") {
    screenMarkup = renderRevealScreen();
  } else if (state.screen === "keepsake") {
    screenMarkup = renderKeepsakeScreen();
  } else if (state.screen === "lock") {
    screenMarkup = renderLockScreen();
  } else if (state.screen === "editor-auth") {
    screenMarkup = renderEditorAuthScreen();
  } else if (state.screen === "editor-panel") {
    screenMarkup = renderEditorPanel();
  } else if (state.screen === "intro") {
    screenMarkup = renderIntroScreen();
  } else if (state.screen === "questions") {
    screenMarkup = renderQuestionScreen();
  } else {
    screenMarkup = renderFinaleScreen();
  }

  root.innerHTML = `
    <div class="app-shell">
      ${topbarMarkup}
      ${screenMarkup}
    </div>
  `;

  syncScreenInputs();
  initializeGoogleOwnerButton();
}

function syncScreenInputs() {
  const codeInput = document.getElementById("code-input");
  const editorCodeInput = document.getElementById("editor-code-input");
  const textAnswer = document.getElementById("text-answer");

  if (codeInput) {
    codeInput.value = state.codeInput;
    codeInput.focus();
  }

  if (editorCodeInput) {
    editorCodeInput.value = state.editorCodeInput;
    editorCodeInput.focus();
  }

  if (textAnswer) {
    textAnswer.value = state.draftAnswer;
    textAnswer.focus();
  }
}

function unlockVisitorView() {
  if (state.codeInput.length !== 6 || state.codeInput !== activeContent.accessCode) {
    state.lockError = activeContent.lockScreen.errorCopy;
    state.codeInput = "";
    renderApp();
    return;
  }

  state.lockError = "";
  state.codeInput = "";
  state.screen = "intro";
  renderApp();
}

function openEditorAuth() {
  stopGameLoop();
  state.screen = "editor-auth";
  state.editorCodeInput = "";
  state.editorError = "";
  renderApp();
  loadOwnerAuthConfig().then(() => {
    if (state.screen === "editor-auth") {
      renderApp();
    }
  });
}

function openEditorPanel() {
  state.screen = "editor-panel";
  state.editorError = "";
  state.editorStatus =
    state.hostedConfigStatus === "ready"
      ? "Changes save online for everyone who visits the hosted site."
      : "Changes are saved only in this browser on this device.";
  state.editorStatusType = "info";
  state.editorDraft = createEditorDraft();
  renderApp();
}

async function verifyEditorToken(adminCode) {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ adminCode }),
  });

  return response.ok;
}

async function unlockEditor() {
  const editorCode = state.editorCodeInput;

  if (editorCode.length !== 6) {
    state.editorError = "That editor code is not right yet.";
    state.editorCodeInput = "";
    renderApp();
    return;
  }

  let codeAllowed = editorCode === activeContent.editorCode;

  if (!codeAllowed) {
    try {
      codeAllowed = await verifyEditorToken(editorCode);
    } catch (error) {
      codeAllowed = false;
    }
  }

  if (!codeAllowed) {
    state.editorError = "That editor code is not right yet.";
    state.editorCodeInput = "";
    renderApp();
    return;
  }

  state.editorSessionCode = editorCode;
  state.editorCodeInput = "";
  state.ownerEmail = "";
  openEditorPanel();
}

function resetGameState() {
  state.game = createInitialGameState();
}

function stopGameLoop() {
  if (gameLoopId) {
    clearTimeout(gameLoopId);
    gameLoopId = null;
  }

  if (gameRevealTimeoutId) {
    clearTimeout(gameRevealTimeoutId);
    gameRevealTimeoutId = null;
  }
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function playTone(frequency, duration = 0.16, type = "sine", volume = 0.08) {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.03);
}

function playFocusTileTone(tileNumber) {
  const frequencies = [392, 440, 494, 523, 587, 659, 698, 784, 880];
  playTone(frequencies[tileNumber - 1] || 523, 0.18, "sine", 0.07);
}

function playErrorTone() {
  playTone(185, 0.22, "sawtooth", 0.045);
}

function playWinTone() {
  [523, 659, 784].forEach((frequency, index) => {
    setTimeout(() => playTone(frequency, 0.16, "triangle", 0.06), index * 115);
  });
}

function startAmbientMusic() {
  const context = getAudioContext();

  if (!context || ambientOscillator) {
    return;
  }

  ambientOscillator = context.createOscillator();
  ambientGain = context.createGain();
  ambientOscillator.type = "sine";
  ambientOscillator.frequency.setValueAtTime(174.61, context.currentTime);
  ambientGain.gain.setValueAtTime(0.018, context.currentTime);
  ambientOscillator.connect(ambientGain);
  ambientGain.connect(context.destination);
  ambientOscillator.start();
}

function stopAmbientMusic() {
  if (!ambientOscillator || !ambientGain || !audioContext) {
    ambientOscillator = null;
    ambientGain = null;
    return;
  }

  const now = audioContext.currentTime;
  ambientGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  ambientOscillator.stop(now + 0.3);
  ambientOscillator = null;
  ambientGain = null;
}

function syncAmbientMusic() {
  if (state.musicOn) {
    startAmbientMusic();
  } else {
    stopAmbientMusic();
  }
}

function saveMusicPreference() {
  try {
    localStorage.setItem(MUSIC_STORAGE_KEY, state.musicOn ? "on" : "off");
  } catch (error) {
    // Music preference is nice-to-have only.
  }
}

function toggleMusic() {
  state.musicOn = !state.musicOn;
  saveMusicPreference();
  syncAmbientMusic();
  renderApp();
}

function startGame() {
  stopGameLoop();
  getAudioContext();
  resetGameState();
  state.game.running = true;
  state.game.message = "Round 1. Watch closely.";
  renderApp();
  showFocusSequence();
}

function createFocusSequence(length) {
  const sequence = [];

  while (sequence.length < length) {
    const nextTile = Math.floor(Math.random() * 9) + 1;
    const previousTile = sequence[sequence.length - 1];

    if (nextTile !== previousTile) {
      sequence.push(nextTile);
    }
  }

  return sequence;
}

function showFocusSequence() {
  const game = state.game;

  if (!game.running) {
    return;
  }

  game.locked = true;
  game.selected = [];
  game.successFlash = false;
  game.sequence = createFocusSequence(game.round + 2);
  game.message = `Round ${game.round}. Watch the pattern.`;
  renderApp();

  let stepIndex = 0;

  const playStep = () => {
    if (!game.running) {
      return;
    }

    if (stepIndex >= game.sequence.length) {
      game.activeTile = null;
      game.locked = false;
      game.message = "Your turn. Repeat the pattern.";
      renderApp();
      return;
    }

    game.activeTile = game.sequence[stepIndex];
    playFocusTileTone(game.activeTile);
    renderApp();

    gameLoopId = setTimeout(() => {
      game.activeTile = null;
      renderApp();
      stepIndex += 1;
      gameLoopId = setTimeout(playStep, 260);
    }, 520);
  };

  gameLoopId = setTimeout(playStep, 500);
}

function chooseFocusTile(tileNumber) {
  const game = state.game;

  if (!game.running || game.locked || game.won) {
    return;
  }

  const expectedTile = game.sequence[game.selected.length];

  if (tileNumber !== expectedTile) {
    playErrorTone();
    failGame();
    return;
  }

  game.selected.push(tileNumber);
  playFocusTileTone(tileNumber);

  if (game.selected.length < game.sequence.length) {
    game.message = "Good. Keep going.";
    renderApp();
    return;
  }

  game.successFlash = true;
  playWinTone();

  if (game.round >= game.totalRounds) {
    winGame();
    return;
  }

  game.round += 1;
  game.message = "Nice. Loading the next pattern.";
  game.locked = true;
  renderApp();
  gameLoopId = setTimeout(showFocusSequence, 850);
}

function winGame() {
  const game = state.game;
  game.running = false;
  game.won = true;
  game.failed = false;
  game.locked = false;
  game.activeTile = null;
  game.successFlash = true;
  game.message = "Test complete. Calculating result...";
  stopGameLoop();
  renderApp();
  gameRevealTimeoutId = setTimeout(() => {
    game.message = "Result: this was not actually for school.";
    renderApp();
    gameRevealTimeoutId = setTimeout(revealSurprise, 1200);
  }, 950);
}

function failGame() {
  const game = state.game;
  game.running = false;
  game.failed = true;
  game.won = false;
  game.locked = false;
  game.activeTile = null;
  game.message = "The pattern slipped. Try the test one more time.";
  stopGameLoop();
  renderApp();
}

function revealSurprise() {
  stopGameLoop();
  state.screen = "reveal";
  state.codeInput = "";
  state.lockError = "";
  state.envelopeOpen = false;
  renderApp();
  gameRevealTimeoutId = setTimeout(() => {
    state.screen = "lock";
    renderApp();
  }, 1700);
}

function openHiddenOwnerAccess() {
  state.secretTapCount = 0;
  openEditorAuth();
}

function handleSecretOwnerTap() {
  state.secretTapCount += 1;

  if (state.secretTapCount >= 5) {
    openHiddenOwnerAccess();
    return;
  }

  window.setTimeout(() => {
    state.secretTapCount = 0;
  }, 1400);
}

function startQuestions() {
  stopGameLoop();
  state.screen = "questions";
  state.currentQuestionIndex = 0;
  state.questionStage = "answering";
  state.draftAnswer = "";
  state.latestAnswer = "";
  state.latestFeedback = "";
  state.answers = {};
  state.responseSubmitted = false;
  state.responseSaveStatus = "idle";
  state.envelopeOpen = false;

  if (!getQuestions().length) {
    state.screen = "finale";
    saveExperienceState("keepsake");
  }

  renderApp();
  if (state.screen === "finale") {
    scrollEnvelopeIntoView();
  }
}

function saveChoiceAnswer(optionIndex) {
  const question = getCurrentQuestion();

  if (!question || question.type !== "choice") {
    return;
  }

  const option = question.options?.[optionIndex];

  if (!option) {
    return;
  }

  state.answers[question.id] = option.label;
  state.latestAnswer = option.label;
  state.latestFeedback =
    option.feedback || question.feedback || activeContent.questionFlow.defaultFeedback;
  state.questionStage = "feedback";
  renderApp();
}

function saveTextAnswer() {
  const question = getCurrentQuestion();
  const answer = state.draftAnswer.trim();

  if (!question || question.type !== "text" || !answer) {
    return;
  }

  state.answers[question.id] = answer;
  state.latestAnswer = answer;
  state.latestFeedback =
    question.feedback || activeContent.questionFlow.defaultFeedback;
  state.questionStage = "feedback";
  renderApp();
}

function goToNextQuestion() {
  const lastIndex = getQuestions().length - 1;

  if (state.currentQuestionIndex >= lastIndex) {
    state.screen = "finale";
    state.questionStage = "answering";
    state.draftAnswer = "";
    saveExperienceState("keepsake");
    renderApp();
    scrollEnvelopeIntoView();
    saveVisitorResponse();
    return;
  }

  state.currentQuestionIndex += 1;
  state.questionStage = "answering";
  state.draftAnswer = "";
  state.latestAnswer = "";
  state.latestFeedback = "";
  renderApp();
}

function toggleEnvelope() {
  state.envelopeOpen = !state.envelopeOpen;
  renderApp();
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  saveThemePreference();
  renderApp();
}

function updateEditorTopLevelField(field, value) {
  if (!state.editorDraft) {
    return;
  }

  state.editorDraft[field] = value;
}

function updateEditorQuestionField(index, field, value) {
  const question = state.editorDraft?.questions?.[index];

  if (!question) {
    return;
  }

  question[field] = value;
}

function updateEditorGalleryField(index, field, value) {
  const item = state.editorDraft?.galleryItems?.[index];

  if (!item) {
    return;
  }

  item[field] = value;
}

function addQuestion(type) {
  if (!state.editorDraft) {
    return;
  }

  const nextNumber = state.editorDraft.questions.length + 1;
  const newQuestion =
    type === "text"
      ? {
          id: `question-${nextNumber}`,
          type: "text",
          prompt: "Write your question here",
          note: "",
          placeholder: "Type here...",
          buttonLabel: "Save answer",
          feedback: activeContent.questionFlow.defaultFeedback,
          optionsText: "",
        }
      : {
          id: `question-${nextNumber}`,
          type: "choice",
          prompt: "Write your question here",
          note: "",
          placeholder: "",
          buttonLabel: "",
          feedback: activeContent.questionFlow.defaultFeedback,
          optionsText: "Option one | Cute feedback\nOption two | Another cute feedback",
        };

  state.editorDraft.questions.push(newQuestion);
  renderApp();
}

function removeQuestion(index) {
  if (!state.editorDraft || state.editorDraft.questions.length <= 1) {
    state.editorStatus = "Keep at least one question in the experience.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  state.editorDraft.questions.splice(index, 1);
  state.editorStatus = "Question removed. Save when you are happy with the list.";
  state.editorStatusType = "info";
  renderApp();
}

function moveQuestion(index, direction) {
  if (!state.editorDraft) {
    return;
  }

  const targetIndex = index + direction;

  if (targetIndex < 0 || targetIndex >= state.editorDraft.questions.length) {
    return;
  }

  const items = state.editorDraft.questions;
  const [moved] = items.splice(index, 1);
  items.splice(targetIndex, 0, moved);
  renderApp();
}

function addGalleryItem() {
  if (!state.editorDraft) {
    return;
  }

  state.editorDraft.galleryItems.push({
    title: "A new memory",
    copy: "Write what you want to remember here.",
    photoUrl: "",
  });
  state.editorStatus = "Memory added. Save when the gallery looks right.";
  state.editorStatusType = "info";
  renderApp();
}

function removeGalleryItem(index) {
  if (!state.editorDraft?.galleryItems?.[index]) {
    return;
  }

  state.editorDraft.galleryItems.splice(index, 1);
  state.editorStatus = "Memory removed. Save when the gallery looks right.";
  state.editorStatusType = "info";
  renderApp();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The photo could not be prepared."));
    image.src = dataUrl;
  });
}

function getDataUrlByteSize(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

async function optimizeImageDataUrl(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(originalDataUrl);
  const scale = Math.min(
    1,
    MAX_GALLERY_PHOTO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight)
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return originalDataUrl;
  }

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const qualities = [0.86, 0.76, 0.66, 0.56];

  for (const quality of qualities) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);

    if (getDataUrlByteSize(dataUrl) <= MAX_GALLERY_PHOTO_DATA_URL_BYTES) {
      return dataUrl;
    }
  }

  throw new Error("That photo is still too large after resizing. Try a smaller image.");
}

async function uploadGalleryPhoto(index, file) {
  const item = state.editorDraft?.galleryItems?.[index];

  if (!item || !file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    state.editorStatus = "Choose an image file for the memory photo.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  if (file.size > MAX_GALLERY_UPLOAD_BYTES) {
    state.editorStatus = "That photo is too large. Use an image under 8 MB.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  try {
    state.editorStatus = "Preparing photo...";
    state.editorStatusType = "info";
    renderApp();
    item.photoUrl = await optimizeImageDataUrl(file);
    state.editorStatus = "Photo attached. Save changes when the gallery looks right.";
    state.editorStatusType = "info";
    renderApp();
  } catch (error) {
    state.editorStatus = error.message || "The photo could not be attached.";
    state.editorStatusType = "error";
    renderApp();
  }
}

function clearGalleryPhoto(index) {
  const item = state.editorDraft?.galleryItems?.[index];

  if (!item) {
    return;
  }

  item.photoUrl = "";
  state.editorStatus = "Photo removed. Save changes when the gallery looks right.";
  state.editorStatusType = "info";
  renderApp();
}

function buildContentFromDraft() {
  const draft = state.editorDraft;

  if (!draft) {
    return {
      error: "There is no editor draft to save yet.",
    };
  }

  const accessCode = String(draft.accessCode || "").replace(/\D/g, "").slice(0, 6);
  const editorCode = String(draft.editorCode || "").replace(/\D/g, "").slice(0, 6);

  if (accessCode.length !== 6) {
    return { error: "The visitor code must be exactly 6 digits." };
  }

  if (editorCode.length !== 6) {
    return { error: "The editor code must be exactly 6 digits." };
  }

  const questions = draft.questions.map((question, index) => {
    const prompt = cleanText(question.prompt, "").trim();

    if (!prompt) {
      throw new Error(`Question ${index + 1} needs a prompt.`);
    }

    if (question.type === "text") {
      return {
        id: slugify(question.id || prompt, `question-${index + 1}`),
        type: "text",
        prompt,
        note: cleanText(question.note, "").trim(),
        placeholder: cleanText(question.placeholder, "Type here...").trim() || "Type here...",
        buttonLabel:
          cleanText(question.buttonLabel, "Save answer").trim() || "Save answer",
        feedback:
          cleanText(question.feedback, activeContent.questionFlow.defaultFeedback).trim() ||
          activeContent.questionFlow.defaultFeedback,
      };
    }

    const options = parseChoiceOptions(question.optionsText);

    if (options.length < 2) {
      throw new Error(`Question ${index + 1} needs at least 2 choice options.`);
    }

    return {
      id: slugify(question.id || prompt, `question-${index + 1}`),
      type: "choice",
      prompt,
      note: cleanText(question.note, "").trim(),
      feedback:
        cleanText(question.feedback, activeContent.questionFlow.defaultFeedback).trim() ||
        activeContent.questionFlow.defaultFeedback,
      options: options.map((option) => ({
        label: option.label,
        feedback: option.feedback || activeContent.questionFlow.defaultFeedback,
      })),
    };
  });

  const paragraphs = String(draft.letterParagraphsText || "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return { error: "Add at least one paragraph for the final letter." };
  }

  const galleryItems = (draft.galleryItems || [])
    .map((item) => ({
      title: cleanText(item.title, "").trim(),
      copy: cleanText(item.copy, "").trim(),
      photoUrl: cleanText(item.photoUrl, "").trim(),
    }))
    .filter((item) => item.title || item.copy || item.photoUrl);

  const nextContent = normalizeContent({
    ...deepClone(defaultContent),
    brandLabel: draft.brandLabel,
    accessCode,
    editorCode,
    experienceResetAt: activeContent.experienceResetAt || "",
    lockScreen: {
      ...activeContent.lockScreen,
      title: draft.lockTitle,
      copy: draft.lockCopy,
      hint: draft.lockHint,
    },
    intro: {
      ...activeContent.intro,
      title: draft.introTitle,
      copy: draft.introCopy,
      sideTitle: draft.introSideTitle,
      sideCopy: draft.introSideCopy,
    },
    finale: {
      ...activeContent.finale,
      title: draft.finaleTitle,
      copy: draft.finaleCopy,
    },
    letter: {
      ...activeContent.letter,
      title: draft.letterTitle,
      signoff: draft.letterSignoff,
      paragraphs,
    },
    gallery: {
      ...activeContent.gallery,
      eyebrow: draft.galleryEyebrow,
      title: draft.galleryTitle,
      items: galleryItems,
    },
    questions,
  });

  return { content: nextContent };
}

async function saveEditorChanges() {
  try {
    const result = buildContentFromDraft();

    if (result.error) {
      state.editorStatus = result.error;
      state.editorStatusType = "error";
      renderApp();
      return;
    }

    activeContent = result.content;
    let localSaveWarning = "";
    let onlineSaveError = "";

    try {
      await saveHostedContent(activeContent);
      state.hostedConfigStatus = "ready";
      try {
        saveActiveContent();
      } catch (error) {
        localSaveWarning = error.message;
      }
    } catch (error) {
      onlineSaveError = error.message || "The online configuration could not be saved.";
      state.hostedConfigStatus = "unavailable";
      saveActiveContent();
    }

    state.editorDraft = createEditorDraft(activeContent);
    state.editorStatus = localSaveWarning
      ? `Saved online, but this browser could not keep a local copy. ${localSaveWarning}`
      : onlineSaveError
        ? `Saved only on this browser. Online save failed: ${onlineSaveError}`
        : state.hostedConfigStatus === "ready"
        ? "Saved online. The hosted site now uses your new questions and letter."
        : "Saved on this browser. Add hosted storage to sync it online.";
    state.editorStatusType = "info";
    renderApp();
  } catch (error) {
    state.editorStatus = error.message || "Something went wrong while saving.";
    state.editorStatusType = "error";
    renderApp();
  }
}

async function resetEditorToOriginal() {
  activeContent = deepClone(defaultContent);
  activeContent.experienceResetAt = new Date().toISOString();
  localStorage.removeItem(STORAGE_KEY);
  saveExperienceState("");

  try {
    if (state.hostedConfigStatus === "ready") {
      await saveHostedContent(activeContent);
    }
  } catch (error) {
    state.editorStatus = error.message || "The online configuration could not be reset.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  state.editorDraft = createEditorDraft(activeContent);
  state.editorStatus =
    state.hostedConfigStatus === "ready"
      ? "Reset complete. The hosted site is back to the original content."
      : "Reset complete. The original default content is back on this browser.";
  state.editorStatusType = "info";
  renderApp();
}

async function removeKeepsakeMode() {
  activeContent = normalizeContent({
    ...activeContent,
    experienceResetAt: new Date().toISOString(),
  });
  saveActiveContent();
  saveExperienceState("");

  try {
    if (state.hostedConfigStatus === "ready") {
      await saveHostedContent(activeContent);
    }
  } catch (error) {
    state.editorStatus = error.message || "Keepsake mode was cleared locally, but not online.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  state.editorDraft = createEditorDraft(activeContent);
  state.editorStatus =
    state.hostedConfigStatus === "ready"
      ? "Keepsake mode removed. Visitors will return to the normal start page."
      : "Keepsake mode removed on this browser.";
  state.editorStatusType = "info";
  renderApp();
}

async function loadSavedResponses() {
  state.savedResponsesStatus = "loading";
  state.savedResponsesError = "";
  renderApp();

  try {
    const params = new URLSearchParams({
      adminCode: state.editorSessionCode,
      googleIdToken: state.editorGoogleIdToken,
    });
    const response = await fetch(`/api/responses?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Responses could not be loaded.");
    }

    state.savedResponses = Array.isArray(payload.responses) ? payload.responses : [];
    state.savedResponsesStatus = "ready";
    renderApp();
  } catch (error) {
    state.savedResponsesStatus = "error";
    state.savedResponsesError = error.message || "Responses could not be loaded.";
    renderApp();
  }
}

function escapeCsv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function buildResponsesCsv() {
  const rows = [["Submitted At", "Question", "Answer"]];

  state.savedResponses.forEach((savedResponse) => {
    (savedResponse.answers || []).forEach((item) => {
      rows.push([
        formatResponseDate(savedResponse.submittedAt),
        item.prompt || "",
        item.answer || "",
      ]);
    });
  });

  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function downloadResponsesCsv() {
  if (!state.savedResponses.length) {
    return;
  }

  const blob = new Blob([buildResponsesCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `monthsary-responses-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printSavedResponses() {
  if (!state.savedResponses.length) {
    return;
  }

  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=720");

  if (!printWindow) {
    state.savedResponsesStatus = "error";
    state.savedResponsesError = "Pop-up was blocked. Allow pop-ups to print responses.";
    renderApp();
    return;
  }

  const responseMarkup = state.savedResponses
    .map(
      (savedResponse, index) => `
        <section>
          <h2>Response ${state.savedResponses.length - index}</h2>
          <p class="date">${escapeHtml(formatResponseDate(savedResponse.submittedAt))}</p>
          ${(savedResponse.answers || [])
            .map(
              (item) => `
                <div class="answer">
                  <p>${escapeHtml(item.prompt || "Question")}</p>
                  <strong>${escapeHtml(item.answer || "No answer")}</strong>
                </div>
              `
            )
            .join("")}
        </section>
      `
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Monthsary Responses</title>
        <style>
          body { font-family: Arial, sans-serif; color: #202124; margin: 32px; }
          h1 { margin: 0 0 24px; }
          section { break-inside: avoid; border-top: 1px solid #ddd; padding: 18px 0; }
          h2 { margin: 0 0 4px; }
          .date { margin: 0 0 14px; color: #666; }
          .answer { margin: 0 0 14px; }
          .answer p { margin: 0 0 4px; font-weight: 700; }
          .answer strong { white-space: pre-wrap; font-weight: 400; }
        </style>
      </head>
      <body>
        <h1>Monthsary Responses</h1>
        ${responseMarkup}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function exitEditor() {
  state.screen = "game";
  state.editorDraft = null;
  state.editorStatus = "Changes are saved only in this browser on this device.";
  state.editorStatusType = "info";
  state.editorError = "";
  state.editorCodeInput = "";
  state.editorSessionCode = "";
  state.editorGoogleIdToken = "";
  state.ownerEmail = "";
  state.savedResponses = [];
  state.savedResponsesStatus = "not-loaded";
  state.savedResponsesError = "";
  state.codeInput = "";
  state.lockError = "";
  renderApp();
}

root.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");

  if (!actionTarget) {
    return;
  }

  const { action } = actionTarget.dataset;

  if (action === "open-editor-auth") {
    openEditorAuth();
    return;
  }

  if (action === "secret-owner-tap") {
    handleSecretOwnerTap();
    return;
  }

  if (action === "start-game") {
    startGame();
    return;
  }

  if (action === "select-game-tile") {
    chooseFocusTile(Number(actionTarget.dataset.tile));
    return;
  }

  if (action === "reveal-surprise") {
    revealSurprise();
    return;
  }

  if (action === "back-to-lock") {
    exitEditor();
    return;
  }

  if (action === "start-questions") {
    startQuestions();
    return;
  }

  if (action === "pick-choice") {
    saveChoiceAnswer(Number(actionTarget.dataset.optionIndex));
    return;
  }

  if (action === "next-question") {
    goToNextQuestion();
    return;
  }

  if (action === "toggle-envelope") {
    toggleEnvelope();
    return;
  }

  if (action === "toggle-theme") {
    toggleTheme();
    return;
  }

  if (action === "toggle-music") {
    toggleMusic();
    return;
  }

  if (action === "add-question") {
    addQuestion(actionTarget.dataset.newType === "text" ? "text" : "choice");
    return;
  }

  if (action === "remove-question") {
    removeQuestion(Number(actionTarget.dataset.questionIndex));
    return;
  }

  if (action === "move-question-up") {
    moveQuestion(Number(actionTarget.dataset.questionIndex), -1);
    return;
  }

  if (action === "move-question-down") {
    moveQuestion(Number(actionTarget.dataset.questionIndex), 1);
    return;
  }

  if (action === "add-gallery-item") {
    addGalleryItem();
    return;
  }

  if (action === "remove-gallery-item") {
    removeGalleryItem(Number(actionTarget.dataset.galleryIndex));
    return;
  }

  if (action === "clear-gallery-photo") {
    clearGalleryPhoto(Number(actionTarget.dataset.galleryIndex));
    return;
  }

  if (action === "save-editor") {
    saveEditorChanges();
    return;
  }

  if (action === "load-responses") {
    loadSavedResponses();
    return;
  }

  if (action === "download-responses") {
    downloadResponsesCsv();
    return;
  }

  if (action === "print-responses") {
    printSavedResponses();
    return;
  }

  if (action === "reset-editor") {
    resetEditorToOriginal();
    return;
  }

  if (action === "remove-keepsake") {
    removeKeepsakeMode();
    return;
  }

  if (action === "exit-editor") {
    exitEditor();
  }
});

root.addEventListener("submit", (event) => {
  event.preventDefault();

  const formType = event.target.dataset.form;

  if (formType === "unlock") {
    unlockVisitorView();
    return;
  }

  if (formType === "editor-auth") {
    unlockEditor();
    return;
  }

  if (formType === "text-question") {
    saveTextAnswer();
  }
});

root.addEventListener("input", (event) => {
  if (event.target.id === "code-input") {
    state.codeInput = event.target.value.replace(/\D/g, "").slice(0, 6);
    state.lockError = "";
    renderApp();
    return;
  }

  if (event.target.id === "editor-code-input") {
    state.editorCodeInput = event.target.value.replace(/\D/g, "").slice(0, 6);
    state.editorError = "";
    renderApp();
    return;
  }

  if (event.target.id === "text-answer") {
    state.draftAnswer = event.target.value;
    return;
  }

  const editorField = event.target.dataset.editorField;

  if (editorField) {
    updateEditorTopLevelField(editorField, event.target.value);
    return;
  }

  const questionIndex = event.target.dataset.questionIndex;
  const questionField = event.target.dataset.questionField;

  if (questionIndex !== undefined && questionField) {
    updateEditorQuestionField(Number(questionIndex), questionField, event.target.value);
    return;
  }

  const galleryIndex = event.target.dataset.galleryIndex;
  const galleryField = event.target.dataset.galleryField;

  if (galleryIndex !== undefined && galleryField) {
    updateEditorGalleryField(Number(galleryIndex), galleryField, event.target.value);
  }
});

root.addEventListener("change", (event) => {
  const uploadIndex = event.target.dataset.galleryIndex;
  const uploadType = event.target.dataset.galleryUpload;

  if (uploadIndex !== undefined && uploadType === "photo") {
    uploadGalleryPhoto(Number(uploadIndex), event.target.files?.[0]);
    return;
  }

  const questionIndex = event.target.dataset.questionIndex;
  const questionField = event.target.dataset.questionField;

  if (questionIndex === undefined || !questionField) {
    return;
  }

  updateEditorQuestionField(Number(questionIndex), questionField, event.target.value);

  if (questionField === "type") {
    const question = state.editorDraft.questions[Number(questionIndex)];

    if (question.type === "choice" && !question.optionsText) {
      question.optionsText =
        "Option one | Cute feedback\nOption two | Another cute feedback";
    }

    if (question.type === "text") {
      question.placeholder = question.placeholder || "Type here...";
      question.buttonLabel = question.buttonLabel || "Save answer";
      question.feedback =
        question.feedback || activeContent.questionFlow.defaultFeedback;
    }

    renderApp();
  }
});

root.addEventListener(
  "error",
  (event) => {
    if (!event.target?.dataset?.memoryPhoto) {
      return;
    }

    event.target.hidden = true;
  },
  true
);

document.addEventListener("keydown", (event) => {
  if (state.screen === "game") {
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      chooseFocusTile(Number(event.key));
      return;
    }

    if (event.key === "Enter" && !state.game.running && !state.game.locked) {
      event.preventDefault();
      startGame();
      return;
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target.id === "code-input" && event.key === "Enter") {
    event.preventDefault();
    unlockVisitorView();
    return;
  }

  if (event.target.id === "editor-code-input" && event.key === "Enter") {
    event.preventDefault();
    unlockEditor();
  }

});

renderApp();
loadHostedContent();
