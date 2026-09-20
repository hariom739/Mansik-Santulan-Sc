"use strict";

/* =========================================================
   Configuration
   ---------------------------------------------------------
   Change API_BASE_URL if your server runs on another port.
   ========================================================= */
const API_BASE_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 20000;
const MIN_LOADING_MS = 600; // keeps the loading state from flashing on fast responses

// The model returns a score on a 0 to 10 scale, where higher is better.
// Adjust these bands if your model's scale is different.
const SCORE_MAX = 10;
const SCORE_BANDS = [
  {
    max: 5,
    key: "low",
    label: "Low",
    text: "This is on the low end of the scale. Stress, sleep and screen time are the usual places to look first.",
  },
  {
    max: 7,
    key: "moderate",
    label: "Moderate",
    text: "This sits in the middle of the scale. Small changes to sleep or screen time could move it.",
  },
  {
    max: Infinity,
    key: "good",
    label: "Good",
    text: "This is on the higher end of the scale, which fits the habits entered.",
  },
];

// Mirrors the StudentData model in the backend.
const FIELD_RULES = {
  Age:                     { label: "Age",                     type: "int",   min: 10, max: 100 },
  Gender:                  { label: "Gender",                  type: "choice" },
  Country:                 { label: "Country",                 type: "text" },
  Academic_Level:          { label: "Academic level",          type: "choice" },
  Most_Used_Platform:      { label: "Most used platform",      type: "choice" },
  Purpose_Of_Use:          { label: "Main purpose of use",     type: "choice" },
  Avg_Daily_Usage_Hours:   { label: "Daily social media use",  type: "float", min: 0, max: 24 },
  Daily_Unlocks:           { label: "Phone unlocks per day",   type: "int",   min: 0 },
  Study_Hours:             { label: "Study time",              type: "float", min: 0, max: 24 },
  Physical_Activity_Hours: { label: "Physical activity",       type: "float", min: 0, max: 24 },
  Sleep_Hours_Per_Night:   { label: "Sleep",                   type: "float", min: 0, max: 24 },
  Stress_Level:            { label: "Stress level",            type: "choice" },
};

const EXAMPLE = {
  Age: 20,
  Gender: "Female",
  Country: "India",
  Academic_Level: "Undergraduate",
  Most_Used_Platform: "Instagram",
  Purpose_Of_Use: "Entertainment",
  Avg_Daily_Usage_Hours: 5.5,
  Daily_Unlocks: 80,
  Study_Hours: 3,
  Physical_Activity_Hours: 1,
  Sleep_Hours_Per_Night: 6.5,
  Stress_Level: "High",
};

const COUNTRIES = [
  "Afghanistan", "Argentina", "Australia", "Austria", "Bahrain", "Bangladesh", "Belgium", "Bhutan",
  "Brazil", "Canada", "Chile", "China", "Colombia", "Czech Republic", "Denmark", "Egypt", "Finland",
  "France", "Germany", "Ghana", "Greece", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia",
  "Iraq", "Ireland", "Israel", "Italy", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Lebanon",
  "Malaysia", "Maldives", "Mexico", "Morocco", "Nepal", "Netherlands", "New Zealand", "Nigeria",
  "Norway", "Oman", "Pakistan", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania",
  "Russia", "Saudi Arabia", "Singapore", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden",
  "Switzerland", "Taiwan", "Thailand", "Turkey", "UAE", "UK", "Ukraine", "USA", "Vietnam",
];

/* =========================================================
   DOM references
   ========================================================= */
const form = document.getElementById("predictForm");
const submitBtn = document.getElementById("submitBtn");
const submitLabel = document.getElementById("submitLabel");
const exampleBtn = document.getElementById("exampleBtn");
const formAlert = document.getElementById("formAlert");

const panel = document.getElementById("resultPanel");
const gaugeValue = document.getElementById("gaugeValue");
const scoreEl = document.getElementById("scoreValue");
const srResult = document.getElementById("srResult");
const bandLabel = document.getElementById("bandLabel");
const bandText = document.getElementById("bandText");
const errorTitle = document.getElementById("errorTitle");
const errorText = document.getElementById("errorText");
const retryBtn = document.getElementById("retryBtn");

const apiStatus = document.getElementById("apiStatus");
const apiStatusText = document.getElementById("apiStatusText");

let isSubmitting = false;
let scoreFrame = 0;

/* =========================================================
   Small helpers
   ========================================================= */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

class ApiError extends Error {
  constructor(status, body) {
    super(`API responded with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/* =========================================================
   Form setup: country list and hour sliders
   ========================================================= */
function buildCountryList() {
  const list = document.getElementById("countryList");
  COUNTRIES.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    list.appendChild(option);
  });
}

const sliderSyncs = [];

function initSliders() {
  document.querySelectorAll(".slider-field").forEach((wrapper) => {
    const range = wrapper.querySelector(".range");
    const number = wrapper.querySelector('input[type="number"]');
    const min = Number(range.min);
    const max = Number(range.max);

    const paint = () => {
      const value = clamp(parseFloat(number.value) || 0, min, max);
      range.style.setProperty("--pct", `${((value - min) / (max - min)) * 100}%`);
    };

    range.addEventListener("input", () => {
      number.value = range.value;
      paint();
    });

    number.addEventListener("input", () => {
      const value = parseFloat(number.value);
      if (Number.isFinite(value)) range.value = clamp(value, min, max);
      paint();
    });

    sliderSyncs.push(() => {
      const value = parseFloat(number.value);
      range.value = Number.isFinite(value) ? clamp(value, min, max) : min;
      paint();
    });
  });
  syncSliders();
}

function syncSliders() {
  sliderSyncs.forEach((sync) => sync());
}

/* =========================================================
   Validation and error display
   ========================================================= */
function fieldWrapper(name) {
  return form.querySelector(`[data-field="${name}"]`);
}

function setFieldError(name, message) {
  const wrapper = fieldWrapper(name);
  if (!wrapper) return;
  const errorEl = wrapper.querySelector(".error");
  errorEl.textContent = message;
  wrapper.classList.add("has-error");
  wrapper.querySelectorAll("input:not(.range)").forEach((input) => {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", errorEl.id);
  });
}

function clearFieldError(name) {
  const wrapper = fieldWrapper(name);
  if (!wrapper) return;
  wrapper.querySelector(".error").textContent = "";
  wrapper.classList.remove("has-error");
  wrapper.querySelectorAll("input").forEach((input) => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  });
}

function clearAllErrors() {
  Object.keys(FIELD_RULES).forEach(clearFieldError);
  formAlert.hidden = true;
  formAlert.textContent = "";
}

function showFormAlert(message) {
  formAlert.textContent = message;
  formAlert.hidden = false;
}

function focusFirstError() {
  const first = form.querySelector(".field.has-error");
  const target = first && first.querySelector("input:not(.range)");
  if (target) target.focus();
}

function validate() {
  const payload = {};
  const errors = {};

  Object.entries(FIELD_RULES).forEach(([name, rule]) => {
    if (rule.type === "choice") {
      const value = form.elements[name].value;
      if (!value) {
        errors[name] = "Choose one option.";
      } else {
        payload[name] = value;
      }
      return;
    }

    const raw = form.elements[name].value.trim();

    if (rule.type === "text") {
      if (!raw) errors[name] = "Enter a country.";
      else payload[name] = raw;
      return;
    }

    // Numeric fields
    if (raw === "") {
      errors[name] = "Enter a number.";
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors[name] = "Enter a valid number.";
      return;
    }
    if (rule.type === "int" && !Number.isInteger(value)) {
      errors[name] = "Enter a whole number.";
      return;
    }
    if (rule.min !== undefined && value < rule.min) {
      errors[name] = rule.max !== undefined
        ? `Enter a value between ${rule.min} and ${rule.max}.`
        : `Enter ${rule.min} or more.`;
      return;
    }
    if (rule.max !== undefined && value > rule.max) {
      errors[name] = `Enter a value between ${rule.min} and ${rule.max}.`;
      return;
    }
    payload[name] = value;
  });

  return { payload, errors };
}

/* =========================================================
   Result panel states
   ========================================================= */
function setState(state) {
  panel.dataset.state = state;
  panel.querySelectorAll(".state").forEach((el) => {
    el.hidden = !el.classList.contains(`state-${state}`);
  });
}

function resetGauge() {
  cancelAnimationFrame(scoreFrame);
  gaugeValue.style.setProperty("--fill", "0");
  scoreEl.textContent = "–";
  srResult.textContent = "";
  delete panel.dataset.band;
}

function revealPanelIfHidden() {
  const rect = panel.getBoundingClientRect();
  const fullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  if (!fullyVisible) {
    panel.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
  }
}

function setLoading(loading) {
  isSubmitting = loading;
  submitBtn.disabled = loading;
  submitBtn.classList.toggle("is-loading", loading);
  submitBtn.setAttribute("aria-busy", String(loading));
  submitLabel.textContent = loading ? "Predicting…" : "Predict score";

  if (loading) {
    resetGauge();
    scoreEl.textContent = "…";
    setState("loading");
    revealPanelIfHidden();
  }
}

function animateScore(target) {
  cancelAnimationFrame(scoreFrame);
  if (prefersReducedMotion()) {
    scoreEl.textContent = target.toFixed(2);
    return;
  }
  const duration = 1000;
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    scoreEl.textContent = (target * eased).toFixed(2);
    if (progress < 1) scoreFrame = requestAnimationFrame(tick);
  };
  scoreFrame = requestAnimationFrame(tick);
}

function showResult(score) {
  const band = SCORE_BANDS.find((b) => score < b.max);
  panel.dataset.band = band.key;
  bandLabel.textContent = band.label;
  bandText.textContent = band.text;
  setState("result");

  const percent = clamp(score / SCORE_MAX, 0, 1) * 100;
  gaugeValue.style.setProperty("--fill", "0");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => gaugeValue.style.setProperty("--fill", percent.toFixed(2)));
  });

  animateScore(score);
  srResult.textContent = `Predicted mental health score: ${score.toFixed(2)} out of ${SCORE_MAX}. ${band.label}.`;
  revealPanelIfHidden();
}

function showPanelError(title, message) {
  resetGauge();
  errorTitle.textContent = title;
  errorText.textContent = message;
  setState("error");
  revealPanelIfHidden();
}

/* =========================================================
   API calls and error translation
   ========================================================= */
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const [response] = await Promise.all([
      fetch(`${API_BASE_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }),
      wait(MIN_LOADING_MS),
    ]);

    const body = await readJson(response);
    if (!response.ok) throw new ApiError(response.status, body);

    const score = body && body.predicted_mental_health_score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new Error("missing-score");
    }
    showResult(score);
    setApiStatus("online");
  } catch (error) {
    handleRequestError(error);
  } finally {
    clearTimeout(timer);
    setLoading(false);
  }
}

function tidyMessage(message) {
  const text = String(message || "Invalid value")
    .replace(/^Value error,\s*/i, "")
    .trim();
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

// FastAPI returns validation errors as: { detail: [{ loc: ["body", "Age"], msg: "..." }] }
function applyServerValidationErrors(detail) {
  const unmatched = [];
  let matched = 0;

  if (Array.isArray(detail)) {
    detail.forEach((item) => {
      const loc = Array.isArray(item && item.loc) ? item.loc : [];
      const name = loc[loc.length - 1];
      if (typeof name === "string" && FIELD_RULES[name]) {
        setFieldError(name, tidyMessage(item.msg));
        matched += 1;
      } else {
        unmatched.push(tidyMessage(item && item.msg));
      }
    });
  } else if (typeof detail === "string") {
    unmatched.push(tidyMessage(detail));
  }
  return { matched, unmatched };
}

function handleRequestError(error) {
  resetGauge();

  // Timeout
  if (error.name === "AbortError") {
    showPanelError(
      "The request timed out",
      `The API didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Check that the server is running, then try again.`
    );
    setApiStatus("offline");
    return;
  }

  // The API answered with an error status
  if (error instanceof ApiError) {
    if (error.status === 422) {
      const { matched, unmatched } = applyServerValidationErrors(error.body && error.body.detail);
      setState("idle");
      const summary = matched
        ? `The server rejected ${matched} ${matched === 1 ? "value" : "values"}. Check the highlighted fields.`
        : `The server rejected the request. ${unmatched.join(" ")}`.trim();
      showFormAlert(summary);
      focusFirstError();
      return;
    }

    if (error.status >= 500) {
      showPanelError(
        "The model couldn't score this input",
        "The server hit an error while predicting. This can happen when a value, such as the country, is one the model wasn't trained on. Try a country from the list."
      );
      return;
    }

    const detail = error.body && typeof error.body.detail === "string" ? ` ${tidyMessage(error.body.detail)}` : "";
    showPanelError(
      `The API returned an error (${error.status})`,
      `The request wasn't accepted.${detail} Check the API URL in script.js and try again.`
    );
    return;
  }

  // The API answered, but not with a score
  if (error.message === "missing-score") {
    showPanelError(
      "The response had no score",
      "The API replied, but the result didn't include predicted_mental_health_score. Check the /predict response in the backend."
    );
    return;
  }

  // Network failure (server down, wrong port, blocked by CORS)
  showPanelError(
    "Can't reach the API",
    `No response from ${API_BASE_URL}. Check that uvicorn is running on that address and port, then try again.`
  );
  setApiStatus("offline");
}

/* =========================================================
   API status pill
   ========================================================= */
function setApiStatus(state) {
  apiStatus.dataset.state = state;
  apiStatusText.textContent = {
    checking: "Checking API…",
    online: "API connected",
    offline: "API offline",
  }[state];
}

async function checkApi() {
  setApiStatus("checking");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${API_BASE_URL}/`, { signal: controller.signal });
    setApiStatus(response.ok ? "online" : "offline");
  } catch {
    setApiStatus("offline");
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   Events
   ========================================================= */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSubmitting) return;

  clearAllErrors();
  const { payload, errors } = validate();
  const names = Object.keys(errors);

  if (names.length) {
    names.forEach((name) => setFieldError(name, errors[name]));
    showFormAlert(
      names.length === 1
        ? "Fix 1 field to continue."
        : `Fix ${names.length} fields to continue.`
    );
    focusFirstError();
    return;
  }

  setLoading(true);
  await requestPrediction(payload);
});

// Clear a field's error as soon as the person edits it
form.addEventListener("input", (event) => {
  const wrapper = event.target.closest("[data-field]");
  if (wrapper) clearFieldError(wrapper.dataset.field);
});

form.addEventListener("reset", () => {
  clearAllErrors();
  resetGauge();
  setState("idle");
  // Wait for the browser to restore default values, then update the sliders
  setTimeout(syncSliders, 0);
});

exampleBtn.addEventListener("click", () => {
  Object.entries(EXAMPLE).forEach(([name, value]) => {
    const rule = FIELD_RULES[name];
    if (rule.type === "choice") {
      const radio = form.querySelector(`input[name="${name}"][value="${value}"]`);
      if (radio) radio.checked = true;
    } else {
      form.elements[name].value = value;
    }
  });
  syncSliders();
  clearAllErrors();
});

retryBtn.addEventListener("click", () => {
  if (typeof form.requestSubmit === "function") form.requestSubmit();
  else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
});

apiStatus.addEventListener("click", checkApi);

/* =========================================================
   Init
   ========================================================= */
buildCountryList();
initSliders();
checkApi();
