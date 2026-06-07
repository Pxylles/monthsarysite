const STORAGE_KEY = "monthsary-site-content-v1";
const THEME_STORAGE_KEY = "monthsary-site-theme-v1";
const MUSIC_STORAGE_KEY = "monthsary-site-music-v1";
const EXPERIENCE_STORAGE_KEY = "monthsary-site-experience-v1";
const MAX_GALLERY_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_GALLERY_PHOTO_DATA_URL_BYTES = 900 * 1024;
const MAX_GALLERY_PHOTO_DIMENSION = 1400;
const MAX_GALLERY_VIDEO_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_GALLERY_VIDEO_DATA_URL_BYTES = 2 * 1024 * 1024;
const MAX_GALLERY_VIDEO_DIMENSION = 720;
const MAX_GALLERY_VIDEO_SECONDS = 12;
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
  game: createInitialGameState(activeContent.game?.rounds),
};

function createInitialGameState(totalRounds = 3) {
  const rounds = Number.isInteger(Number(totalRounds)) && Number(totalRounds) > 0 ? Number(totalRounds) : 3;

  return {
    running: false,
    won: false,
    failed: false,
    round: 1,
    totalRounds: rounds,
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

function normalizeGalleryMedia(item) {
  const media = [];

  if (Array.isArray(item?.media)) {
    item.media.forEach((mediaItem) => {
      const src = cleanText(mediaItem?.src, "").trim();
      const type = mediaItem?.type === "video" ? "video" : "image";

      if (!src) {
        return;
      }

      media.push({
        type,
        src,
        caption: cleanText(mediaItem?.caption, "").trim(),
      });
    });
  }

  const legacyPhotoUrl = cleanText(item?.photoUrl, "").trim();

  if (legacyPhotoUrl && !media.some((mediaItem) => mediaItem.src === legacyPhotoUrl)) {
    media.unshift({
      type: "image",
      src: legacyPhotoUrl,
      caption: "",
    });
  }

  return media.slice(0, 8);
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

  const gameRounds = Number(source.game?.rounds);
  base.game = {
    rounds: Number.isInteger(gameRounds) && gameRounds > 0 ? gameRounds : base.game.rounds,
  };

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
            media: normalizeGalleryMedia(item),
          }))
          .filter((item) => item.title || item.copy || item.photoUrl || item.media.length)
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
      media: normalizeGalleryMedia(item),
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
    gameRounds: source.game?.rounds || 3,
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
                    game.locked || game.won
                      ? ""
                      : `
                        <button class="primary-button" type="button" data-action="start-game">
                          ${game.failed ? "Retry test" : "Start test"}
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

function renderMemoryMedia(item) {
  const mediaItems = normalizeGalleryMedia(item);

  if (!mediaItems.length) {
    return "";
  }

  return `
    <div class="memory-media-grid ${mediaItems.length === 1 ? "is-single" : ""}">
      ${mediaItems
        .map((mediaItem) =>
          mediaItem.type === "video"
            ? `
              <video
                class="memory-media memory-video"
                src="${escapeHtml(mediaItem.src)}"
                controls
                playsinline
                preload="metadata"
              ></video>
            `
            : `
              <img
                class="memory-media memory-photo"
                src="${escapeHtml(mediaItem.src)}"
                alt="${escapeHtml(mediaItem.caption || item.title || "Memory photo")}"
                loading="lazy"
                data-memory-photo="true"
              />
            `
        )
        .join("")}
    </div>
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
                ${renderMemoryMedia(item)}
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

function renderEditorSlider(label, field, value, min = 1, max = 10, help = "") {
  return `
    <label class="editor-field editor-field-full">
      <span class="editor-label">${escapeHtml(label)}</span>
      <div class="editor-slider-row">
        <input
          class="editor-input editor-range"
          type="range"
          min="${min}"
          max="${max}"
          data-editor-field="${escapeHtml(field)}"
          value="${escapeHtml(value)}"
          oninput="this.nextElementSibling.textContent = this.value"
        />
        <span class="editor-range-value">${escapeHtml(value)}</span>
      </div>
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

function renderGalleryMediaEditor(item, index) {
  const mediaItems = normalizeGalleryMedia(item);

  if (!mediaItems.length) {
    return "";
  }

  return `
    <div class="editor-field editor-field-full">
      <span class="editor-label">Media preview</span>
      <div class="editor-media-grid">
        ${mediaItems
          .map(
            (mediaItem, mediaIndex) => `
              <div class="editor-media-item">
                ${
                  mediaItem.type === "video"
                    ? `
                      <video
                        class="editor-photo-preview"
                        src="${escapeHtml(mediaItem.src)}"
                        controls
                        playsinline
                        preload="metadata"
                      ></video>
                    `
                    : `
                      <img
                        class="editor-photo-preview"
                        src="${escapeHtml(mediaItem.src)}"
                        alt="${escapeHtml(item.title || "Memory media preview")}"
                      />
                    `
                }
                <button
                  class="tiny-button tiny-button-danger"
                  type="button"
                  data-action="remove-gallery-media"
                  data-gallery-index="${index}"
                  data-media-index="${mediaIndex}"
                >
                  Remove
                </button>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
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
          <span class="editor-label">Fallback photo URL</span>
          <input
            class="editor-input"
            type="url"
            data-gallery-index="${index}"
            data-gallery-field="photoUrl"
            value="${escapeHtml(item.photoUrl || "")}"
            placeholder="https://example.com/photo.jpg or ./photos/photo.jpg"
          />
          <span class="editor-help">
            Optional. Uploaded media below can hold several compressed images or short videos.
          </span>
        </label>

        <label class="editor-field editor-field-full">
          <span class="editor-label">Add images or short videos</span>
          <input
            class="editor-input file-input"
            type="file"
            accept="image/*,video/*"
            multiple
            data-gallery-index="${index}"
            data-gallery-upload="media"
          />
          <span class="editor-help">
            Images are resized automatically. Videos are shortened/compressed for shared saving, so keep clips brief.
          </span>
        </label>

        ${renderGalleryMediaEditor(item, index)}

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
            Print responses
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
                        <div class="editor-inline-actions">
                          <span class="meta-pill">${escapeHtml(formatResponseDate(savedResponse.submittedAt))}</span>
                          <button
                            class="tiny-button tiny-button-danger"
                            type="button"
                            data-action="delete-response"
                            data-response-id="${escapeHtml(savedResponse.id || "")}"
                          >
                            Delete
                          </button>
                        </div>
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
            ${renderEditorSlider(
              "Memory game rounds",
              "gameRounds",
              draft.gameRounds,
              1,
              10,
              "Choose how many rounds the minigame should use."
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
            <button class="secondary-button" type="button" data-action="print-letter-card">
              Print letter card
            </button>
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
  state.game = createInitialGameState(activeContent.game?.rounds);
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
    media: [],
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

function loadVideoFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("The video could not be prepared."));
    video.src = dataUrl;
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

function getSupportedVideoMimeType() {
  if (!window.MediaRecorder) {
    return "";
  }

  return [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The compressed video could not be saved."));
    reader.readAsDataURL(blob);
  });
}

async function optimizeVideoDataUrl(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const mimeType = getSupportedVideoMimeType();

  if (!mimeType || !HTMLCanvasElement.prototype.captureStream) {
    if (getDataUrlByteSize(originalDataUrl) <= MAX_GALLERY_VIDEO_DATA_URL_BYTES) {
      return originalDataUrl;
    }

    throw new Error("This browser cannot compress that video. Try a shorter clip or a hosted video link.");
  }

  const video = await loadVideoFromDataUrl(originalDataUrl);
  const scale = Math.min(
    1,
    MAX_GALLERY_VIDEO_DIMENSION / Math.max(video.videoWidth, video.videoHeight)
  );
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("This browser cannot compress that video.");
  }

  canvas.width = width;
  canvas.height = height;

  const stream = canvas.captureStream(12);
  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 450000,
  });
  const durationLimit = Math.min(video.duration || MAX_GALLERY_VIDEO_SECONDS, MAX_GALLERY_VIDEO_SECONDS);

  recorder.ondataavailable = (event) => {
    if (event.data?.size) {
      chunks.push(event.data);
    }
  };

  const finished = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = () => reject(new Error("The video could not be compressed."));
  });

  const drawFrame = () => {
    if (video.paused || video.ended || video.currentTime >= durationLimit) {
      recorder.stop();
      return;
    }

    context.drawImage(video, 0, 0, width, height);
    requestAnimationFrame(drawFrame);
  };

  recorder.start(250);
  video.currentTime = 0;
  await video.play();
  drawFrame();
  await finished;

  const blob = new Blob(chunks, { type: mimeType });
  const dataUrl = await blobToDataUrl(blob);

  if (getDataUrlByteSize(dataUrl) <= MAX_GALLERY_VIDEO_DATA_URL_BYTES) {
    return dataUrl;
  }

  throw new Error("That video is still too large after compression. Try a shorter clip.");
}

async function optimizeGalleryMediaFile(file) {
  if (file.type.startsWith("image/")) {
    return {
      type: "image",
      src: await optimizeImageDataUrl(file),
      caption: file.name || "",
    };
  }

  if (file.type.startsWith("video/")) {
    return {
      type: "video",
      src: await optimizeVideoDataUrl(file),
      caption: file.name || "",
    };
  }

  throw new Error("Choose image or video files for memory media.");
}

async function uploadGalleryMedia(index, files) {
  const item = state.editorDraft?.galleryItems?.[index];
  const selectedFiles = Array.from(files || []);

  if (!item || !selectedFiles.length) {
    return;
  }

  if (selectedFiles.length > 6) {
    state.editorStatus = "Add up to 6 media files at a time.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  const oversizedFile = selectedFiles.find((file) =>
    file.type.startsWith("video/")
      ? file.size > MAX_GALLERY_VIDEO_UPLOAD_BYTES
      : file.size > MAX_GALLERY_UPLOAD_BYTES
  );

  if (oversizedFile) {
    state.editorStatus = oversizedFile.type.startsWith("video/")
      ? "That video is too large. Use a short video under 25 MB."
      : "That photo is too large. Use an image under 8 MB.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  try {
    state.editorStatus = `Preparing ${selectedFiles.length === 1 ? "media" : "media files"}...`;
    state.editorStatusType = "info";
    renderApp();

    const nextMedia = [];

    for (const file of selectedFiles) {
      nextMedia.push(await optimizeGalleryMediaFile(file));
    }

    item.media = [...normalizeGalleryMedia(item), ...nextMedia].slice(0, 8);
    item.photoUrl = item.media.find((mediaItem) => mediaItem.type === "image")?.src || "";
    state.editorStatus = "Media attached. Save changes when the gallery looks right.";
    state.editorStatusType = "info";
    renderApp();
  } catch (error) {
    state.editorStatus = error.message || "The media could not be attached.";
    state.editorStatusType = "error";
    renderApp();
  }
}

function removeGalleryMedia(index, mediaIndex) {
  const item = state.editorDraft?.galleryItems?.[index];

  if (!item) {
    return;
  }

  const mediaItems = normalizeGalleryMedia(item);
  mediaItems.splice(mediaIndex, 1);
  item.media = mediaItems;
  item.photoUrl = mediaItems.find((mediaItem) => mediaItem.type === "image")?.src || "";
  state.editorStatus = "Media removed. Save changes when the gallery looks right.";
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
      media: normalizeGalleryMedia(item),
    }))
    .filter((item) => item.title || item.copy || item.photoUrl || item.media.length);

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
    game: {
      rounds: Number.isInteger(Number(draft.gameRounds)) && Number(draft.gameRounds) > 0
        ? Number(draft.gameRounds)
        : defaultContent.game.rounds,
    },
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

async function deleteSavedResponse(responseId) {
  if (!responseId) {
    return;
  }

  const savedResponse = state.savedResponses.find((item) => item.id === responseId);
  const label = savedResponse
    ? `Response from ${formatResponseDate(savedResponse.submittedAt)}`
    : "this response";

  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
    return;
  }

  state.savedResponsesStatus = "loading";
  state.savedResponsesError = "";
  renderApp();

  try {
    const response = await fetch("/api/responses", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        adminCode: state.editorSessionCode,
        googleIdToken: state.editorGoogleIdToken,
        responseId,
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Response could not be deleted.");
    }

    state.savedResponses = state.savedResponses.filter((item) => item.id !== responseId);
    state.savedResponsesStatus = "ready";
    renderApp();
  } catch (error) {
    state.savedResponsesStatus = "error";
    state.savedResponsesError = error.message || "Response could not be deleted.";
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

  const printWindow = window.open("", "_blank", "width=900,height=720");

  if (!printWindow) {
    state.savedResponsesStatus = "error";
    state.savedResponsesError = "Pop-up was blocked. Allow pop-ups to print responses.";
    renderApp();
    return;
  }

  const responseMarkup = state.savedResponses
    .map(
      (savedResponse, index) => `
        <article class="fold-card">
          <section class="fold-page cover-page">
            <div class="fold-guide" aria-hidden="true"></div>
            <div class="cover-panel">
              <p class="kicker">Monthsary response card</p>
              <h1>Response ${state.savedResponses.length - index}</h1>
              <p class="date">${escapeHtml(formatResponseDate(savedResponse.submittedAt))}</p>
            </div>
            <div class="back-panel">
              <p>Fold along the center line.</p>
              <p class="tiny">Print this page first, then the answers page if your printer does not duplex.</p>
            </div>
          </section>
          <section class="fold-page answer-page">
            <div class="fold-guide" aria-hidden="true"></div>
            <div class="answer-panel">
              <p class="kicker">Her answers</p>
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
            </div>
          </section>
        </article>
      `
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Monthsary Responses</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: Georgia, "Times New Roman", serif;
            color: #2b1f23;
            background: #fff;
          }
          .fold-card { page-break-after: always; }
          .fold-page {
            position: relative;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 18mm;
            min-height: 267mm;
            padding: 8mm;
            page-break-after: always;
            break-after: page;
          }
          .fold-card:last-child .fold-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .fold-guide {
            position: absolute;
            inset: 8mm auto 8mm 50%;
            border-left: 1px dashed #b28b93;
          }
          .cover-panel,
          .back-panel,
          .answer-panel {
            display: grid;
            align-content: center;
            min-height: 240mm;
            padding: 14mm;
            border: 1px solid #d8b8bd;
            border-radius: 8mm;
            background: #fff8f4;
          }
          .answer-panel {
            grid-column: 1 / -1;
            align-content: start;
            background: #fff;
          }
          .kicker {
            margin: 0 0 8mm;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font: 700 10pt Arial, sans-serif;
            color: #9b4f62;
          }
          h1 {
            margin: 0 0 8mm;
            font-size: 34pt;
            line-height: 1.05;
          }
          .date,
          .tiny,
          .back-panel p {
            margin: 0 0 5mm;
            font: 11pt Arial, sans-serif;
            color: #685760;
          }
          .answer {
            break-inside: avoid;
            margin: 0 0 7mm;
            padding-bottom: 5mm;
            border-bottom: 1px solid #ead7da;
          }
          .answer p {
            margin: 0 0 2mm;
            font: 700 10pt Arial, sans-serif;
            color: #9b4f62;
          }
          .answer strong {
            display: block;
            white-space: pre-wrap;
            font-size: 14pt;
            line-height: 1.35;
            font-weight: 400;
          }
          @media screen {
            body { background: #f4ecef; padding: 24px; }
            .fold-page {
              max-width: 210mm;
              margin: 0 auto 24px;
              background: #fff;
              box-shadow: 0 16px 48px rgba(40, 24, 30, 0.18);
            }
          }
        </style>
      </head>
      <body>
        ${responseMarkup}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.setTimeout(() => printWindow.print(), 250);
}

function getDraftLetterForPrint() {
  const draft = state.editorDraft;

  if (!draft) {
    return {
      title: activeContent.letter.title,
      signoff: activeContent.letter.signoff,
      paragraphs: activeContent.letter.paragraphs,
    };
  }

  return {
    title: cleanText(draft.letterTitle, activeContent.letter.title).trim() || activeContent.letter.title,
    signoff:
      cleanText(draft.letterSignoff, activeContent.letter.signoff).trim() ||
      activeContent.letter.signoff,
    paragraphs: String(draft.letterParagraphsText || "")
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean),
  };
}

function printLetterCard() {
  const letter = getDraftLetterForPrint();

  if (!letter.paragraphs.length) {
    state.editorStatus = "Add at least one letter paragraph before printing the card.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  const printWindow = window.open("", "_blank", "width=1000,height=760");

  if (!printWindow) {
    state.editorStatus = "Pop-up was blocked. Allow pop-ups to print the letter card.";
    state.editorStatusType = "error";
    renderApp();
    return;
  }

  const paragraphMarkup = letter.paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Printable Letter Card</title>
        <style>
          @page { size: A4 landscape; margin: 10mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: Georgia, "Times New Roman", serif;
            color: #2a1821;
            background: #ffffff;
          }
          .print-note {
            display: none;
          }
          .card-sheet {
            position: relative;
            width: 148.5mm;
            min-height: 190mm;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0;
            page-break-after: always;
            break-after: page;
            overflow: hidden;
            background: #c9b2de;
            border-radius: 3mm;
            margin: 0 auto;
          }
          .card-sheet:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .card-panel {
            position: relative;
            min-height: 190mm;
            padding: 16mm;
            display: grid;
            align-content: center;
            overflow: hidden;
          }
          .card-panel::before {
            content: "";
            position: absolute;
            inset: 7mm;
            border: 1px dashed rgba(255, 255, 255, 0.85);
            pointer-events: none;
          }
          .fold-line {
            position: absolute;
            inset: 0 auto 0 50%;
            border-left: 1.5px dashed rgba(88, 49, 116, 0.85);
            z-index: 5;
          }
          .outside-back {
            background: linear-gradient(145deg, #cbb7e4, #b99fd6);
            text-align: center;
          }
          .outside-front {
            background:
              radial-gradient(circle at 18% 18%, rgba(255, 255, 255, 0.48), transparent 28%),
              linear-gradient(145deg, #d9c8ee, #bba0d9);
            text-align: center;
          }
          .inside-left {
            background:
              radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.5), transparent 26%),
              linear-gradient(145deg, #e8dbf5, #c9b2de);
          }
          .inside-letter {
            background:
              radial-gradient(circle at 85% 15%, rgba(255, 255, 255, 0.55), transparent 24%),
              linear-gradient(145deg, #f8f1ff, #dfcdef);
            align-content: start;
          }
          .cover-message {
            max-width: 95mm;
            margin: 0 auto;
            padding: 13mm 10mm;
            border-radius: 8mm;
            background: rgba(255, 255, 255, 0.58);
            box-shadow: 0 10mm 24mm rgba(70, 39, 92, 0.18);
          }
          .cover-message p,
          .from-line,
          .fold-help {
            margin: 0;
            font: 700 15pt/1.35 Georgia, "Times New Roman", serif;
          }
          .from-line {
            font-size: 12pt;
            color: #ffffff;
            text-shadow: 0 1px 2px rgba(54, 31, 73, 0.28);
          }
          .fold-help {
            font-size: 11pt;
            color: rgba(255, 255, 255, 0.92);
          }
          .letter-box {
            position: relative;
            max-width: 112mm;
            margin: 0 auto;
            padding: 11mm;
            border-radius: 8mm;
            background: rgba(255, 255, 255, 0.72);
            box-shadow: 0 10mm 24mm rgba(70, 39, 92, 0.15);
          }
          .letter-box h1 {
            margin: 0 0 6mm;
            font-size: 21pt;
            line-height: 1.05;
          }
          .letter-box p {
            margin: 0 0 4mm;
            font-size: 10.5pt;
            line-height: 1.35;
          }
          .letter-box .signoff {
            margin-top: 6mm;
            text-align: right;
            font-weight: 700;
          }
          .ribbon {
            position: absolute;
            inset: 50% auto auto 0;
            width: 100%;
            height: 6mm;
            background: rgba(132, 103, 168, 0.42);
            transform: translateY(-50%);
          }
          .ribbon.vertical {
            inset: 0 auto auto 18%;
            width: 6mm;
            height: 100%;
            transform: none;
          }
          @media screen {
            body {
              background: #2d2432;
              padding: 24px;
            }
            .print-note {
              display: block;
              max-width: 148.5mm;
              margin: 0 auto 16px;
              padding: 12px 14px;
              border-radius: 10px;
              background: #fff;
              font: 14px Arial, sans-serif;
              color: #33233a;
            }
            .card-sheet {
              margin: 0 auto 24px;
              box-shadow: 0 18px 60px rgba(0, 0, 0, 0.32);
            }
          }
        </style>
      </head>
      <body>
        <div class="print-note">
          Print at 100% scale on A4 landscape. Page 1 is the outside, page 2 is the inside.
          Fold along the dashed center line. Duplex printing may need short-edge flip depending on the printer.
        </div>

        <section class="card-sheet outside-sheet">
          <div class="fold-line" aria-hidden="true"></div>
          <div class="card-panel outside-back">
            <p class="from-line">from: ${escapeHtml(activeContent.brandLabel || "me")}</p>
          </div>
          <div class="card-panel outside-front">
            <span class="ribbon" aria-hidden="true"></span>
            <span class="ribbon vertical" aria-hidden="true"></span>
            <div class="cover-message">
              <p>Remember the girl I made this little site for?</p>
              <p>Turns out... that was you.</p>
            </div>
          </div>
        </section>

        <section class="card-sheet inside-sheet">
          <div class="fold-line" aria-hidden="true"></div>
          <div class="card-panel inside-left">
            <p class="fold-help">A little letter, made to be folded and kept.</p>
          </div>
          <div class="card-panel inside-letter">
            <div class="letter-box">
              <h1>${escapeHtml(letter.title)}</h1>
              ${paragraphMarkup}
              <p class="signoff">${escapeHtml(letter.signoff)}</p>
            </div>
          </div>
        </section>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.setTimeout(() => printWindow.print(), 250);
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

  if (action === "remove-gallery-media") {
    removeGalleryMedia(
      Number(actionTarget.dataset.galleryIndex),
      Number(actionTarget.dataset.mediaIndex)
    );
    return;
  }

  if (action === "clear-gallery-photo") {
    removeGalleryMedia(Number(actionTarget.dataset.galleryIndex), 0);
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

  if (action === "print-letter-card") {
    printLetterCard();
    return;
  }

  if (action === "delete-response") {
    deleteSavedResponse(actionTarget.dataset.responseId);
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

  if (uploadIndex !== undefined && (uploadType === "media" || uploadType === "photo")) {
    uploadGalleryMedia(Number(uploadIndex), event.target.files);
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
