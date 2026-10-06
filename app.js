const STORAGE_KEY = "workLogTracker.v5";
const THEME_KEY = "workLogTracker.theme";
const API_URL = "https://open.er-api.com/v6/latest/USD";
const EXCHANGE_REFRESH_MS = 5 * 60 * 1000;
const HTP_DEFAULT_HOURS = 4;
const HTP_DEDUCTION = 0.15;
const HTP_MAX_PERIOD_DAYS = 92;

const firebaseConfig = {
  apiKey: "AIzaSyD0lpdM6dlVUJhe_w20Qr_MVcKllCQyN3E",
  authDomain: "work-tracker-77691.firebaseapp.com",
  projectId: "work-tracker-77691",
  storageBucket: "work-tracker-77691.firebasestorage.app",
  messagingSenderId: "785528025763",
  appId: "1:785528025763:web:5025d23aa675bacc35c516"
};

let db = null;
let cloudSaveTimer = null;
let localSaveTimer = null;
let pickerYear = new Date().getFullYear();
let rateFetchFailed = false;

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const monthShortNames = monthNames.map((name) => name.slice(0, 3));

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Personal details (name, email, address) are entered in Settings, not hardcoded, because this repo is public.
const DEFAULT_INVOICE_PROFILE = {
  name: "",
  position: "QA Tester",
  paymentTerms: "Monthly",
  billTo: "HEALTHTEK",
  service: "QA Testing",
  email: "",
  address: ""
};

const state = {
  activePage: "quri",
  phpRate: 58,
  phpRateUpdatedAt: 0,
  quriRate: 4,
  htpRate: 6,
  quriMonth: getCurrentMonthValue(),
  htpStartDate: "2026-04-16",
  htpEndDate: "2026-05-16",
  htpInvoiceNumber: "",
  invoiceProfile: { ...DEFAULT_INVOICE_PROFILE },
  quriEntries: {},
  htpEntries: {}
};

document.addEventListener("DOMContentLoaded", async () => {
  loadState();
  setupTheme();
  setupNavigation();
  setupControls();
  renderAll();

  initFirebase();

  if (db) {
    await loadCloudState();
    renderAll();
  }

  fetchExchangeRate(false);
  setInterval(() => fetchExchangeRate(false), EXCHANGE_REFRESH_MS);
});

window.addEventListener("pagehide", saveLocalState);

/* ---------- Persistence ---------- */

function initFirebase() {
  try {
    if (!window.firebase) {
      setCloudStatus("Firebase SDK not loaded. Using local backup only.", "warn");
      return;
    }

    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();

    setCloudStatus("Connected to Firebase.", "ok");
  } catch (error) {
    console.warn("Firebase failed to initialize:", error);
    setCloudStatus("Firebase connection failed. Using local backup only.", "error");
  }
}

async function loadCloudState() {
  try {
    const doc = await db.collection("users").doc("defaultUser").get();

    if (!doc.exists) {
      setCloudStatus("Connected. No cloud data yet.", "ok");
      return;
    }

    const data = doc.data() || {};

    Object.assign(state, {
      activePage: data.activePage || state.activePage,
      phpRate: data.phpRate || state.phpRate,
      quriRate: data.quriRate ?? state.quriRate,
      htpRate: data.htpRate ?? state.htpRate,
      quriMonth: data.quriMonth || state.quriMonth,
      htpStartDate: data.htpStartDate || state.htpStartDate,
      htpEndDate: data.htpEndDate || state.htpEndDate,
      htpInvoiceNumber: data.htpInvoiceNumber || state.htpInvoiceNumber,
      invoiceProfile: { ...state.invoiceProfile, ...(data.invoiceProfile || {}) },
      quriEntries: data.quriEntries || state.quriEntries,
      htpEntries: data.htpEntries || state.htpEntries
    });

    saveLocalState();
    setCloudStatus("Cloud data loaded.", "ok");
  } catch (error) {
    console.warn("Could not load cloud data:", error);
    setCloudStatus("Could not load Firebase data. Using local backup.", "error");
  }
}

function saveState() {
  clearTimeout(localSaveTimer);
  localSaveTimer = setTimeout(saveLocalState, 300);
  queueCloudSave();
}

function saveLocalState() {
  clearTimeout(localSaveTimer);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Could not save local backup:", error);
  }
}

function normalizeState() {
  delete state.htpTemplateBase64;
  delete state.htpTemplateName;

  state.invoiceProfile = { ...DEFAULT_INVOICE_PROFILE, ...state.invoiceProfile };

  ["phpRate", "quriRate", "htpRate"].forEach((key) => {
    state[key] = Math.max(0, parseFloat(state[key]) || 0);
  });

  if (!/^\d{4}-\d{2}$/.test(state.quriMonth)) state.quriMonth = getCurrentMonthValue();
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) Object.assign(state, JSON.parse(saved));
  } catch {
    console.warn("Could not parse saved tracker data.");
  }
}

function queueCloudSave() {
  if (!db) return;

  setCloudStatus("Saving...", "pending");
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(saveCloudState, 800);
}

function getCloudPayload() {
  return {
    activePage: state.activePage,
    phpRate: state.phpRate,
    quriRate: state.quriRate,
    htpRate: state.htpRate,
    quriMonth: state.quriMonth,
    htpStartDate: state.htpStartDate,
    htpEndDate: state.htpEndDate,
    htpInvoiceNumber: state.htpInvoiceNumber,
    invoiceProfile: state.invoiceProfile,
    // The uploaded PDF template is no longer used; remove it from older documents.
    htpTemplateBase64: firebase.firestore.FieldValue.delete(),
    htpTemplateName: firebase.firestore.FieldValue.delete(),
    quriEntries: state.quriEntries,
    htpEntries: state.htpEntries,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

async function saveCloudState() {
  if (!db) return;

  try {
    await db.collection("users").doc("defaultUser").set(getCloudPayload(), { merge: true });
    setCloudStatus("Saved to Firebase.", "ok");
  } catch (error) {
    console.warn("Could not save cloud data:", error);
    setCloudStatus("Could not save to Firebase. Local backup saved.", "error");
  }
}

function setCloudStatus(message, type = "ok") {
  const status = document.getElementById("cloudStatus");
  if (status) {
    status.textContent = message;
    status.className = `status-${type}`;
  }

  const sync = document.getElementById("syncStatus");
  if (sync) {
    const short = {
      ok: "Synced",
      pending: "Saving...",
      warn: "Local only",
      error: "Sync error"
    };

    sync.dataset.state = type;
    sync.title = message;
    sync.querySelector(".sync-text").textContent = short[type] || message;
  }
}

/* ---------- Theme ---------- */

// The theme is a per-device preference, so it lives in localStorage rather than the synced state.
function setupTheme() {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  document.getElementById("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  });

  // Follow the system setting until the user picks a theme explicitly.
  systemDark.addEventListener("change", (event) => {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {}

    if (!saved) applyTheme(event.matches ? "dark" : "light");
  });

  applyTheme(document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light"));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  const toggle = document.getElementById("themeToggle");
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
}

/* ---------- Navigation & controls ---------- */

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => setActivePage(button.dataset.page));
  });
}

function setActivePage(page, shouldSave = true) {
  if (!document.getElementById(`${page}Page`)) page = "quri";
  state.activePage = page;

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.id === `${page}Page`);
  });

  if (page === "reports") {
    renderReports();
  }

  if (shouldSave) {
    saveState();
  }
}

function setupControls() {
  setupRateInput("quriRate", "quriRate", refreshQuriFigures);
  setupRateInput("htpRate", "htpRate", refreshHtpFigures);

  document.getElementById("htpInvoiceNumber").addEventListener("input", (event) => {
    state.htpInvoiceNumber = event.target.value;
    saveState();
  });

  document.getElementById("applyHtpPeriodBtn").addEventListener("click", applyHtpPeriod);
  document.getElementById("generateHtpInvoiceBtn").addEventListener("click", generateHtpInvoicePdf);

  document.querySelectorAll("[data-refresh-rate]").forEach((button) => {
    button.addEventListener("click", () => fetchExchangeRate(true));
  });

  setupQuriTable();
  setupHtpTable();
  setupInvoiceProfile();

  document.getElementById("resetLocalDataBtn").addEventListener("click", () => {
    if (!confirm("Reset local browser backup only? Firebase cloud data will remain.")) return;

    clearTimeout(localSaveTimer);
    window.removeEventListener("pagehide", saveLocalState);
    localStorage.removeItem(STORAGE_KEY);
    showToast("Local data reset", "Local browser backup was cleared.", "success");

    setTimeout(() => location.reload(), 700);
  });

  document.getElementById("resetAllDataBtn").addEventListener("click", resetAllTrackerData);

  document.getElementById("reportYear").addEventListener("change", renderReports);
  document.getElementById("reportSource").addEventListener("change", renderReports);

  setupMonthPicker();
}

function setupRateInput(inputId, stateKey, refresh) {
  const input = document.getElementById(inputId);

  input.addEventListener("input", () => {
    state[stateKey] = Math.max(0, parseFloat(input.value) || 0);
    saveState();
    refresh();
  });

  input.addEventListener("blur", () => {
    input.value = state[stateKey].toFixed(2);
  });
}

/* ---------- Month picker ---------- */

function setupMonthPicker() {
  const modal = document.getElementById("monthPickerModal");

  document.getElementById("openQuriMonthPicker").addEventListener("click", () => {
    pickerYear = Number(state.quriMonth.split("-")[0]);
    openMonthPickerModal();
  });

  document.getElementById("prevYearBtn").addEventListener("click", () => {
    pickerYear -= 1;
    renderMonthPicker();
  });

  document.getElementById("nextYearBtn").addEventListener("click", () => {
    pickerYear += 1;
    renderMonthPicker();
  });

  document.getElementById("yearDisplayBtn").addEventListener("click", toggleYearDropdown);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeMonthPickerModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || modal.classList.contains("hidden")) return;

    const dropdown = document.getElementById("yearDropdown");
    if (!dropdown.classList.contains("hidden")) {
      closeYearDropdown();
    } else {
      closeMonthPickerModal();
    }
  });
}

function openMonthPickerModal() {
  document.getElementById("monthPickerModal").classList.remove("hidden");
  renderMonthPicker();
  document.querySelector(".month-choice.active, .month-choice")?.focus();
}

function closeMonthPickerModal() {
  document.getElementById("monthPickerModal").classList.add("hidden");
  closeYearDropdown();
  document.getElementById("openQuriMonthPicker").focus();
}

function toggleYearDropdown() {
  const dropdown = document.getElementById("yearDropdown");
  dropdown.classList.toggle("hidden");

  if (!dropdown.classList.contains("hidden")) {
    renderYearDropdown();
    dropdown.querySelector(".year-option.active")?.scrollIntoView({ block: "center" });
  }
}

function closeYearDropdown() {
  document.getElementById("yearDropdown").classList.add("hidden");
}

function renderMonthPicker() {
  document.getElementById("yearDisplayBtn").textContent = String(pickerYear);

  const monthGrid = document.getElementById("quriMonthGrid");
  monthGrid.innerHTML = "";

  const [selectedYear, selectedMonth] = state.quriMonth.split("-").map(Number);
  const now = new Date();

  monthShortNames.forEach((monthLabel, monthIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "month-choice";
    button.textContent = monthLabel;

    if (selectedYear === pickerYear && selectedMonth === monthIndex + 1) {
      button.classList.add("active");
    }

    if (now.getFullYear() === pickerYear && now.getMonth() === monthIndex) {
      button.classList.add("current");
    }

    button.addEventListener("click", () => {
      state.quriMonth = `${pickerYear}-${String(monthIndex + 1).padStart(2, "0")}`;
      saveState();
      renderQuri();
      closeMonthPickerModal();
    });

    monthGrid.appendChild(button);
  });

  renderYearDropdown();
}

function renderYearDropdown() {
  const yearList = document.getElementById("yearList");
  yearList.innerHTML = "";

  for (let year = pickerYear - 15; year <= pickerYear + 15; year++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "year-option";
    button.textContent = String(year);

    if (year === pickerYear) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      pickerYear = year;
      renderMonthPicker();
      closeYearDropdown();
    });

    yearList.appendChild(button);
  }
}

/* ---------- Reset ---------- */

async function resetAllTrackerData() {
  if (!confirm("This will clear all QURI and HTP tracker data from Firebase and this browser. Continue?")) return;

  Object.assign(state, {
    activePage: "settings",
    quriRate: 4,
    htpRate: 6,
    quriMonth: getCurrentMonthValue(),
    htpStartDate: "2026-04-16",
    htpEndDate: "2026-05-16",
    htpInvoiceNumber: "",
    quriEntries: {},
    htpEntries: {}
  });

  clearTimeout(cloudSaveTimer);
  saveLocalState();

  if (db) {
    try {
      await db.collection("users").doc("defaultUser").set(getCloudPayload(), { merge: true });

      setCloudStatus("Tracker data reset in Firebase.", "ok");
      showToast("Tracker data reset", "Firebase and local tracker data were cleared.", "success");
    } catch (error) {
      console.warn("Could not reset cloud data:", error);
      setCloudStatus("Could not reset Firebase data. Local data was reset.", "error");
      showToast("Firebase reset failed", "Local data was reset, but Firebase could not be cleared.", "error");
    }
  } else {
    showToast("Tracker data reset", "Local tracker data was cleared.", "success");
  }

  renderAll();
}

/* ---------- Exchange rate ---------- */

async function fetchExchangeRate(showManualToast = false) {
  const buttons = document.querySelectorAll("[data-refresh-rate]");
  buttons.forEach((button) => button.classList.add("spinning"));

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("Rate request failed");

    const data = await response.json();
    const php = data?.rates?.PHP;

    if (typeof php !== "number") throw new Error("PHP rate missing from response");

    state.phpRate = php;
    state.phpRateUpdatedAt = Date.now();
    rateFetchFailed = false;
    saveLocalState();

    if (showManualToast) {
      showToast("Exchange rate refreshed", `1 USD = ₱${formatNumber(state.phpRate, 2)}`, "success");
    }
  } catch (error) {
    console.warn("Using last saved PHP rate:", state.phpRate, error);
    rateFetchFailed = true;

    if (showManualToast) {
      showToast("Rate refresh failed", "Using the last saved exchange rate.", "error");
    }
  } finally {
    buttons.forEach((button) => button.classList.remove("spinning"));
    refreshQuriFigures();
    refreshHtpFigures();
    if (state.activePage === "reports") renderReports();
  }
}

function updateExchangeText() {
  let text = `1 USD = ₱${formatNumber(state.phpRate, 2)}`;

  if (rateFetchFailed) {
    text += " · offline";
  } else if (state.phpRateUpdatedAt) {
    const time = new Date(state.phpRateUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    text += ` · ${time}`;
  }

  document.querySelectorAll("[data-exchange-text]").forEach((element) => {
    element.textContent = text;
  });
}

/* ---------- Rendering ---------- */

function populatePickers() {
  updateQuriMonthLabel();

  const reportYear = document.getElementById("reportYear");
  const previous = reportYear.value;
  reportYear.innerHTML = "";

  const currentYear = new Date().getFullYear();
  const dataYears = [...Object.keys(state.quriEntries), ...Object.keys(state.htpEntries)]
    .map((dateString) => Number(dateString.slice(0, 4)))
    .filter(Boolean);
  const startYear = Math.min(currentYear - 2, ...dataYears);
  const endYear = Math.max(currentYear + 1, ...dataYears);

  for (let year = endYear; year >= startYear; year--) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    reportYear.appendChild(option);
  }

  reportYear.value = previous && reportYear.querySelector(`option[value="${previous}"]`) ? previous : String(currentYear);
}

function updateQuriMonthLabel() {
  document.getElementById("selectedQuriMonthLabel").textContent = getMonthLabel(state.quriMonth);
}

function renderAll() {
  normalizeState();
  populatePickers();
  setActivePage(state.activePage || "quri", false);
  renderQuri();
  renderHtp();
  renderInvoiceProfile();
}

/* ---------- QURI ---------- */

function setupQuriTable() {
  const tableBody = document.getElementById("quriTableBody");

  tableBody.addEventListener("input", (event) => {
    const dateString = event.target.dataset.quriTasks || event.target.dataset.quriHours;
    if (dateString) updateQuriEntry(dateString);
  });

  tableBody.addEventListener("change", (event) => {
    const dateString = event.target.dataset.quriHours;
    if (!dateString) return;

    const hours = state.quriEntries[dateString]?.hours || 0;
    event.target.value = hours ? hours.toFixed(2) : "";
  });

  tableBody.addEventListener("click", (event) => {
    const clearButton = event.target.closest("[data-clear-quri]");
    if (clearButton) clearQuriRow(clearButton.dataset.clearQuri);

    const copyButton = event.target.closest("[data-copy-quri]");
    if (copyButton) copyQuriTasks(copyButton.dataset.copyQuri);
  });
}

function renderQuri() {
  const [year, month] = state.quriMonth.split("-").map(Number);
  const today = toDateInputValue(new Date());

  updateQuriMonthLabel();

  const rateInput = document.getElementById("quriRate");
  if (document.activeElement !== rateInput) rateInput.value = state.quriRate.toFixed(2);

  document.getElementById("quriTableBody").innerHTML = getDaysInMonth(year, month - 1).map((dateString) => {
    const date = parseLocalDate(dateString);
    const dayCells = `
      <td class="date-cell">${formatDateLong(dateString)}</td>
      <td class="day-cell">${dayNames[date.getDay()]}</td>
    `;

    if (isWeekend(date)) {
      return `
        <tr class="weekend-row">
          ${dayCells}
          <td><span class="day-off">Day off</span></td>
          <td class="muted-cell">—</td>
          <td class="num muted-cell">—</td>
          <td></td>
        </tr>
      `;
    }

    const entry = state.quriEntries[dateString] || { tasks: "", hours: 0 };
    const hours = parseFloat(entry.hours) || 0;

    return `
      <tr class="${dateString === today ? "is-today" : ""}">
        ${dayCells}
        <td class="tasks-col">
          <div class="task-box">
            <textarea data-quri-tasks="${dateString}" rows="2" placeholder="What did you work on?" aria-label="Tasks for ${formatDateLong(dateString)}">${escapeHtml(entry.tasks || "")}</textarea>
            <button class="copy-btn" type="button" data-copy-quri="${dateString}" title="Copy tasks" aria-label="Copy tasks"><svg class="icon"><use href="#i-copy"/></svg></button>
          </div>
        </td>
        <td>
          <input class="hours-input" type="number" inputmode="decimal" step="0.01" min="0" max="24" placeholder="0.00" data-quri-hours="${dateString}" value="${hours ? hours.toFixed(2) : ""}" aria-label="Hours for ${formatDateLong(dateString)}" />
        </td>
        <td class="num" data-quri-usd="${dateString}"></td>
        <td class="actions-cell">
          <button class="clear-btn" type="button" data-clear-quri="${dateString}">Clear</button>
        </td>
      </tr>
    `;
  }).join("");

  refreshQuriFigures();
}

function refreshQuriFigures() {
  document.querySelectorAll("[data-quri-usd]").forEach((cell) => {
    const hours = parseFloat(state.quriEntries[cell.dataset.quriUsd]?.hours) || 0;
    cell.textContent = formatUsd(hours * state.quriRate);
    cell.classList.toggle("muted-cell", hours === 0);
  });

  const totals = calculateQuriTotals();
  document.getElementById("quriTotalHours").textContent = formatNumber(totals.hours, 2);
  document.getElementById("quriTotalUsd").textContent = formatUsd(totals.usd);
  document.getElementById("quriTotalPhp").textContent = formatPhp(totals.usd * state.phpRate);

  updateExchangeText();
}

function updateQuriEntry(dateString) {
  const tasks = document.querySelector(`[data-quri-tasks="${dateString}"]`)?.value || "";
  const hours = Math.max(0, parseFloat(document.querySelector(`[data-quri-hours="${dateString}"]`)?.value) || 0);

  if (!tasks.trim() && !hours) {
    delete state.quriEntries[dateString];
  } else {
    state.quriEntries[dateString] = { tasks, hours };
  }

  saveState();
  refreshQuriFigures();
}

function clearQuriRow(dateString) {
  const entry = state.quriEntries[dateString];
  if (!entry) return;
  if (!confirm(`Clear tasks and hours for ${formatDateLong(dateString)}?`)) return;

  delete state.quriEntries[dateString];

  document.querySelector(`[data-quri-tasks="${dateString}"]`).value = "";
  document.querySelector(`[data-quri-hours="${dateString}"]`).value = "";

  saveState();
  refreshQuriFigures();
}

async function copyQuriTasks(dateString) {
  const tasks = document.querySelector(`[data-quri-tasks="${dateString}"]`)?.value || "";

  if (!tasks.trim()) {
    showToast("Nothing to copy", "This day has no tasks yet.", "info");
    return;
  }

  try {
    await navigator.clipboard.writeText(tasks);
    showToast("Tasks copied", "The task list is ready to paste.", "success");
  } catch (error) {
    console.warn("Clipboard write failed:", error);
    showToast("Copy failed", "Your browser blocked clipboard access.", "error");
  }
}

/* ---------- HTP ---------- */

function setupHtpTable() {
  const tableBody = document.getElementById("htpTableBody");

  tableBody.addEventListener("input", (event) => {
    const dateString = event.target.dataset.htpHours;
    if (!dateString) return;

    state.htpEntries[dateString] = { hours: Math.max(0, parseFloat(event.target.value) || 0) };
    saveState();
    refreshHtpFigures();
  });

  tableBody.addEventListener("change", (event) => {
    const dateString = event.target.dataset.htpHours;
    if (dateString) event.target.value = state.htpEntries[dateString].hours.toFixed(2);
  });

  tableBody.addEventListener("click", (event) => {
    const clearButton = event.target.closest("[data-clear-htp]");
    if (!clearButton) return;

    const dateString = clearButton.dataset.clearHtp;
    state.htpEntries[dateString] = { hours: 0 };
    document.querySelector(`[data-htp-hours="${dateString}"]`).value = "0.00";

    saveState();
    refreshHtpFigures();
  });
}

function applyHtpPeriod() {
  const start = document.getElementById("htpStartDate").value;
  const end = document.getElementById("htpEndDate").value;

  if (!start || !end) {
    showToast("Missing dates", "Please pick both a start and an end date.", "warning");
    return;
  }

  if (start > end) {
    showToast("Invalid period", "The end date must be on or after the start date.", "warning");
    return;
  }

  const days = (parseLocalDate(end) - parseLocalDate(start)) / 86400000;
  if (days > HTP_MAX_PERIOD_DAYS) {
    showToast("Period too long", `A billing period can be at most ${HTP_MAX_PERIOD_DAYS} days.`, "warning");
    return;
  }

  state.htpStartDate = start;
  state.htpEndDate = end;

  saveState();
  renderHtp();
  showToast("Period applied", `${formatDateLong(start)} – ${formatDateLong(end)}`, "success");
}

function renderHtp() {
  document.getElementById("htpStartDate").value = state.htpStartDate;
  document.getElementById("htpEndDate").value = state.htpEndDate;
  document.getElementById("htpInvoiceNumber").value = state.htpInvoiceNumber || "";

  const rateInput = document.getElementById("htpRate");
  if (document.activeElement !== rateInput) rateInput.value = state.htpRate.toFixed(2);

  const invoiceMonth = parseLocalDate(state.htpEndDate);
  document.getElementById("htpInvoiceLabel").textContent = `Invoice for ${monthNames[invoiceMonth.getMonth()]} ${invoiceMonth.getFullYear()}`;

  const today = toDateInputValue(new Date());
  let addedDefaults = false;

  document.getElementById("htpTableBody").innerHTML = getWeekdaysInRange(state.htpStartDate, state.htpEndDate).map((dateString) => {
    if (!state.htpEntries[dateString]) {
      state.htpEntries[dateString] = { hours: HTP_DEFAULT_HOURS };
      addedDefaults = true;
    }

    const hours = parseFloat(state.htpEntries[dateString].hours) || 0;

    return `
      <tr class="${dateString === today ? "is-today" : ""}">
        <td class="date-cell">${formatDateLong(dateString)}</td>
        <td class="day-cell">${dayNames[parseLocalDate(dateString).getDay()]}</td>
        <td>
          <input class="hours-input" type="number" inputmode="decimal" step="0.01" min="0" max="24" data-htp-hours="${dateString}" value="${hours.toFixed(2)}" aria-label="Hours for ${formatDateLong(dateString)}" />
        </td>
        <td class="num" data-htp-usd="${dateString}"></td>
        <td class="num" data-htp-php="${dateString}"></td>
        <td class="actions-cell">
          <button class="clear-btn" type="button" data-clear-htp="${dateString}">Clear</button>
        </td>
      </tr>
    `;
  }).join("");

  if (addedDefaults) saveState();

  refreshHtpFigures();
}

function refreshHtpFigures() {
  document.querySelectorAll("[data-htp-usd]").forEach((cell) => {
    const dateString = cell.dataset.htpUsd;
    const hours = parseFloat(state.htpEntries[dateString]?.hours) || 0;
    const usd = hours * state.htpRate;

    cell.textContent = formatUsd(usd);
    cell.classList.toggle("muted-cell", hours === 0);

    const phpCell = document.querySelector(`[data-htp-php="${dateString}"]`);
    phpCell.textContent = formatPhp(usd * state.phpRate);
    phpCell.classList.toggle("muted-cell", hours === 0);
  });

  const totals = calculateHtpTotals();

  document.getElementById("htpTotalHours").textContent = formatNumber(totals.hours, 2);
  document.getElementById("htpTotalUsd").textContent = formatUsd(totals.usd);
  document.getElementById("htpTotalPhp").textContent = formatPhp(totals.net);

  document.getElementById("sumUsd").textContent = formatUsd(totals.usd);
  document.getElementById("sumHours").textContent = formatNumber(totals.hours, 2);
  document.getElementById("sumRate").textContent = `₱${formatNumber(state.phpRate, 2)}`;
  document.getElementById("sumGross").textContent = formatPhp(totals.php);
  document.getElementById("sumDeduction").textContent = `−${formatPhp(totals.deduction)}`;
  document.getElementById("sumNet").textContent = formatPhp(totals.net);

  updateExchangeText();
}

/* ---------- HTP invoice ---------- */

// Mirrors the "INVOICE" sheet of the HealthTek invoice spreadsheet (columns A–J, rows 1–28).
// Column widths are in spreadsheet character units; row heights are in points.
const INVOICE_COLUMN_WIDTHS = [2.63, 14.25, 3.25, 6, 8, 12.25, 5.25, 18.88, 16.25, 2.63];
const INVOICE_ROW_HEIGHTS = [
  34.5, 12, 21.75, 18.75, 55.5, 13.5, 21.75, 21.75, 21.75, 21.75, 31.5, 21.75, 17.25, 17.25,
  17.25, 10.5, 10.5, 21.75, 22.5, 22.5, 22.5, 22.5, 22.5, 42.75, 55.5, 15, 15, 51.75
];
const POINTS_PER_CHAR = 5.25;

const INVOICE_COLORS = {
  band: "8496B0",
  label: "525252",
  tableHeader: "333F4F",
  stripe: "CCCCCC",
  section: "BFBFBF",
  amountDue: "1F3864",
  title: "ECECEC",
  text: "434343",
  black: "000000",
  white: "FFFFFF",
  lightBorder: "BFBFBF",
  border: "A5A5A5"
};

const INVOICE_PROFILE_FIELDS = ["name", "position", "paymentTerms", "billTo", "service", "email", "address"];

function setupInvoiceProfile() {
  INVOICE_PROFILE_FIELDS.forEach((field) => {
    const input = document.querySelector(`[data-profile="${field}"]`);

    input.addEventListener("input", () => {
      state.invoiceProfile[field] = input.value;
      saveState();
    });
  });
}

function renderInvoiceProfile() {
  INVOICE_PROFILE_FIELDS.forEach((field) => {
    const input = document.querySelector(`[data-profile="${field}"]`);
    if (document.activeElement !== input) input.value = state.invoiceProfile[field] || "";
  });
}

async function generateHtpInvoicePdf() {
  if (!window.PDFLib) {
    showToast("PDF tool not loaded", "Please refresh the page and try again.", "error");
    return;
  }

  const invoiceNumber = document.getElementById("htpInvoiceNumber").value.trim();

  if (!invoiceNumber) {
    showToast("Missing invoice number", "Please enter an invoice number first.", "warning");
    document.getElementById("htpInvoiceNumber").focus();
    return;
  }

  const profile = state.invoiceProfile;

  if (["name", "email", "address"].some((field) => !profile[field]?.trim())) {
    showToast("Missing invoice details", "Add your name, email, and address in Settings → Invoice details.", "warning");
    return;
  }

  state.htpInvoiceNumber = invoiceNumber;
  saveState();

  const generateButton = document.getElementById("generateHtpInvoiceBtn");
  generateButton.disabled = true;

  try {
    const pdfBytes = await buildHtpInvoicePdf(invoiceNumber, profile, calculateHtpTotals());
    downloadPdfBytes(pdfBytes, getHtpInvoiceFileName());

    showToast("Invoice generated", "Your HTP invoice PDF has been downloaded.", "success");
  } catch (error) {
    console.error(error);
    showToast("Invoice failed", "Could not generate the PDF invoice.", "error");
  } finally {
    generateButton.disabled = false;
  }
}

async function buildHtpInvoicePdf(invoiceNumber, profile, totals) {
  const { PDFDocument, StandardFonts, PageSizes } = PDFLib;

  const pdfDoc = await PDFDocument.create();
  const [pageWidth, pageHeight] = PageSizes.Letter;
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  pdfDoc.setTitle(`Invoice ${invoiceNumber}`);
  pdfDoc.setAuthor(profile.name);

  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  };

  // Scale the sheet to fit inside 0.5" margins, centered horizontally.
  const margin = 36;
  const columnPoints = INVOICE_COLUMN_WIDTHS.map((width) => width * POINTS_PER_CHAR);
  const sheetWidth = columnPoints.reduce((sum, width) => sum + width, 0);
  const sheetHeight = INVOICE_ROW_HEIGHTS.reduce((sum, height) => sum + height, 0);
  const scale = Math.min((pageWidth - margin * 2) / sheetWidth, (pageHeight - margin * 2) / sheetHeight);
  const originX = (pageWidth - sheetWidth * scale) / 2;
  const originY = pageHeight - margin;

  const columnStarts = columnPoints.reduce((starts, width, index) => [...starts, starts[index] + width], [0]);
  const rowStarts = INVOICE_ROW_HEIGHTS.reduce((starts, height, index) => [...starts, starts[index] + height], [0]);

  // "B7:D7" → rectangle in PDF coordinates.
  const rect = (range) => {
    const [start, end = start] = range.split(":");
    const parse = (cell) => ({ col: cell.charCodeAt(0) - 65, row: Number(cell.slice(1)) - 1 });
    const a = parse(start);
    const b = parse(end);

    return {
      x: originX + columnStarts[a.col] * scale,
      y: originY - rowStarts[b.row + 1] * scale,
      width: (columnStarts[b.col + 1] - columnStarts[a.col]) * scale,
      height: (rowStarts[b.row + 1] - rowStarts[a.row]) * scale
    };
  };

  const fill = (range, color) => {
    page.drawRectangle({ ...rect(range), color: hexToRgb(color) });
  };

  const box = (range, color = INVOICE_COLORS.border, sides = "LRTB") => {
    const { x, y, width, height } = rect(range);
    const line = (start, end) => page.drawLine({ start, end, thickness: 0.6, color: hexToRgb(color) });

    if (sides.includes("L")) line({ x, y }, { x, y: y + height });
    if (sides.includes("R")) line({ x: x + width, y }, { x: x + width, y: y + height });
    if (sides.includes("T")) line({ x, y: y + height }, { x: x + width, y: y + height });
    if (sides.includes("B")) line({ x, y }, { x: x + width, y });
  };

  const text = (range, value, options = {}) => {
    const {
      size = 8,
      bold = false,
      color = INVOICE_COLORS.text,
      align = "left",
      valign = "middle"
    } = options;

    const font = bold ? fonts.bold : fonts.regular;
    const area = rect(range);
    const padding = 3 * scale;
    const content = String(value ?? "");
    if (!content) return;

    // Shrink long values to fit their cell instead of overflowing.
    let fontSize = size * scale;
    while (fontSize > 4 && font.widthOfTextAtSize(content, fontSize) > area.width - padding * 2) {
      fontSize -= 0.25;
    }

    const textWidth = font.widthOfTextAtSize(content, fontSize);
    const capHeight = font.heightAtSize(fontSize, { descender: false }) * 0.72;

    const x = align === "center"
      ? area.x + (area.width - textWidth) / 2
      : align === "right"
        ? area.x + area.width - padding - textWidth
        : area.x + padding;

    const y = valign === "bottom"
      ? area.y + padding
      : area.y + (area.height - capHeight) / 2;

    page.drawText(content, { x, y, size: fontSize, font, color: hexToRgb(color) });
  };

  const amountDue = formatUsd(totals.usd);
  const white = { bold: true, color: INVOICE_COLORS.white };
  const black = { color: INVOICE_COLORS.black };

  // Header band
  fill("A1:J5", INVOICE_COLORS.band);
  text("B1:F1", "INVOICE", { size: 18, bold: true, color: INVOICE_COLORS.title, valign: "bottom" });
  text("B3:F3", "BILL TO", { size: 10, bold: true, ...black });
  text("B4:E4", profile.billTo.toUpperCase(), { size: 10, ...white, valign: "bottom" });
  text("H2:I3", amountDue, { size: 30, bold: true, color: INVOICE_COLORS.amountDue, align: "center" });
  text("H4:I4", "Amount Due", { size: 10, ...white, align: "center" });

  // Details
  [
    [7, "Name", profile.name],
    [8, "Position", profile.position],
    [9, "Payment Terms", profile.paymentTerms]
  ].forEach(([row, label, value]) => {
    fill(`B${row}:D${row}`, INVOICE_COLORS.label);
    box(`B${row}:D${row}`, INVOICE_COLORS.lightBorder);
    box(`E${row}:F${row}`, INVOICE_COLORS.lightBorder);
    text(`B${row}:D${row}`, label, white);
    text(`E${row}:F${row}`, value, black);
  });

  fill("H7", INVOICE_COLORS.label);
  box("H7", INVOICE_COLORS.lightBorder);
  box("I7", INVOICE_COLORS.lightBorder);
  text("H7", "Invoice Number", white);
  text("I7", invoiceNumber, { ...black, align: "center" });

  fill("H8:I8", INVOICE_COLORS.label);
  box("H8:I8", INVOICE_COLORS.lightBorder, "LRT");
  text("H8:I8", "Work Period", { ...white, align: "center" });

  box("H9");
  box("I9");
  text("H9", formatInvoiceDate(state.htpStartDate), { align: "center" });
  text("I9", formatInvoiceDate(state.htpEndDate), { align: "center" });

  // Services table
  const tableRow = (row, values, rowFill, style = {}) => {
    [`B${row}:E${row}`, `F${row}:G${row}`, `H${row}`, `I${row}`].forEach((range, index) => {
      if (rowFill) fill(range, rowFill);
      box(range);
      text(range, values[index], { align: "center", ...style });
    });
  };

  tableRow(12, ["Services", "Worked Hours", "Rate", "Amount"], INVOICE_COLORS.tableHeader, white);
  tableRow(13, [profile.service, formatNumber(totals.hours, 2), formatUsd(state.htpRate), amountDue], INVOICE_COLORS.stripe, { bold: true, color: INVOICE_COLORS.label });
  tableRow(14, []);
  tableRow(15, [], INVOICE_COLORS.stripe);

  box("F18:I18", INVOICE_COLORS.border, "T");
  text("F18:H18", "Amount Due ($):", { align: "right" });
  text("I18", amountDue, { bold: true, align: "center" });

  // Personal information
  fill("B20:G20", INVOICE_COLORS.section);
  text("B20:G20", "Personal Information", { bold: true, ...black, align: "center" });

  [[21, "Email Address", profile.email], [22, "Personal Address", profile.address]].forEach(([row, label, value]) => {
    text(`B${row}`, label, { bold: true, ...black });
    text(`C${row}`, ":", { bold: true, ...black });
    box(`D${row}:G${row}`, INVOICE_COLORS.border, "B");
    text(`D${row}:G${row}`, value, { size: 7, ...black });
  });

  // Signature
  text("B26:E26", profile.name, { bold: true, ...black, align: "center", valign: "bottom" });
  box("B27:E27", INVOICE_COLORS.black, "T");
  text("B27:E27", "Name and E-signature", { bold: true, ...black, align: "center" });

  return pdfDoc.save();
}

function hexToRgb(hex) {
  const value = parseInt(hex, 16);
  return PDFLib.rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function formatInvoiceDate(dateString) {
  const date = parseLocalDate(dateString);
  return `${monthShortNames[date.getMonth()]} ${String(date.getDate()).padStart(2, "0")}, ${date.getFullYear()}`;
}

function downloadPdfBytes(pdfBytes, fileName) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getHtpInvoiceFileName() {
  const endDate = parseLocalDate(state.htpEndDate);
  return `Ubaldo - Invoice - HealthTek - ${monthNames[endDate.getMonth()]} ${endDate.getFullYear()}.pdf`;
}

/* ---------- Reports ---------- */

function renderReports() {
  const now = new Date();
  const year = parseInt(document.getElementById("reportYear").value || now.getFullYear(), 10);
  const source = document.getElementById("reportSource").value || "all";
  const monthly = calculateMonthlyTotals(year, source);

  const totalUsd = monthly.reduce((sum, item) => sum + item.usd, 0);
  const totalPhp = totalUsd * state.phpRate;
  const totalHours = monthly.reduce((sum, item) => sum + item.hours, 0);
  const nonZeroMonths = monthly.filter((item) => item.usd > 0);
  const avgUsd = nonZeroMonths.length ? totalUsd / nonZeroMonths.length : 0;
  const highest = monthly.reduce((max, item) => item.usd > max.usd ? item : max, monthly[0]);

  // "This month" always refers to the real current month, regardless of the selected year.
  const currentMonth = (year === now.getFullYear() ? monthly : calculateMonthlyTotals(now.getFullYear(), source))[now.getMonth()];

  document.getElementById("reportThisMonthLabel").textContent = `This month (${monthShortNames[now.getMonth()]} ${now.getFullYear()})`;
  document.getElementById("reportThisMonth").textContent = formatUsd(currentMonth.usd);
  document.getElementById("reportThisMonthPhp").textContent = formatPhp(currentMonth.usd * state.phpRate);
  document.getElementById("reportYearLabel").textContent = `${year} total`;
  document.getElementById("reportThisYear").textContent = formatUsd(totalUsd);
  document.getElementById("reportThisYearPhp").textContent = formatPhp(totalPhp);
  document.getElementById("reportAverage").textContent = formatUsd(avgUsd);
  document.getElementById("reportAveragePhp").textContent = formatPhp(avgUsd * state.phpRate);
  document.getElementById("reportHighestMonth").textContent = highest.usd > 0 ? highest.month : "N/A";
  document.getElementById("reportHighestValue").textContent = formatUsd(highest.usd);

  document.getElementById("yearUsd").textContent = formatUsd(totalUsd);
  document.getElementById("yearPhp").textContent = formatPhp(totalPhp);
  document.getElementById("yearHours").textContent = formatNumber(totalHours, 2);
  document.getElementById("avgHourly").textContent = formatUsd(totalHours ? totalUsd / totalHours : 0);

  renderBarChart(monthly, year === now.getFullYear() ? now.getMonth() : -1);
  renderMonthlyTotalsTable(monthly);
}

function renderBarChart(monthly, currentMonthIndex) {
  const max = Math.max(...monthly.map((item) => item.usd), 1);

  document.getElementById("barChart").innerHTML = monthly.map((item, index) => {
    const height = item.usd > 0 ? Math.max(2, (item.usd / max) * 100) : 0;
    const classes = ["bar-group", index === currentMonthIndex ? "current" : ""].join(" ");

    return `
      <div class="${classes}" title="${item.month}: ${formatUsd(item.usd)} · ${formatNumber(item.hours, 2)} hrs">
        <div class="bar-value">${item.usd > 0 ? formatUsdCompact(item.usd) : ""}</div>
        <div class="bar-track"><div class="bar" style="height:${height}%"></div></div>
        <div class="bar-month">${item.month.slice(0, 3)}</div>
      </div>
    `;
  }).join("");
}

function renderMonthlyTotalsTable(monthly) {
  document.getElementById("monthlyTotalsBody").innerHTML = monthly.map((item) => `
    <tr class="${item.usd > 0 ? "" : "empty-row"}">
      <td>${item.month}</td>
      <td class="num">${formatNumber(item.hours, 2)}</td>
      <td class="num">${formatUsd(item.usd)}</td>
      <td class="num">${formatPhp(item.usd * state.phpRate)}</td>
    </tr>
  `).join("");
}

/* ---------- Calculations ---------- */

function calculateQuriTotals() {
  const [year, month] = state.quriMonth.split("-").map(Number);

  return getDaysInMonth(year, month - 1).reduce((totals, dateString) => {
    if (isWeekend(parseLocalDate(dateString))) return totals;

    const hours = parseFloat(state.quriEntries[dateString]?.hours) || 0;

    totals.hours += hours;
    totals.usd += hours * state.quriRate;

    return totals;
  }, { hours: 0, usd: 0 });
}

function calculateHtpTotals() {
  const hours = getWeekdaysInRange(state.htpStartDate, state.htpEndDate).reduce((sum, dateString) => {
    const entry = state.htpEntries[dateString] || { hours: HTP_DEFAULT_HOURS };
    return sum + (parseFloat(entry.hours) || 0);
  }, 0);

  const usd = hours * state.htpRate;
  const php = usd * state.phpRate;
  const deduction = php * HTP_DEDUCTION;

  return { hours, usd, php, deduction, net: php - deduction };
}

function calculateMonthlyTotals(year, source = "all") {
  const monthly = monthNames.map((month) => ({ month, usd: 0, hours: 0 }));

  const addEntries = (entries, rate) => {
    Object.entries(entries).forEach(([dateString, entry]) => {
      const date = parseLocalDate(dateString);
      if (date.getFullYear() !== year) return;

      const hours = parseFloat(entry.hours) || 0;
      monthly[date.getMonth()].hours += hours;
      monthly[date.getMonth()].usd += hours * rate;
    });
  };

  if (source === "all" || source === "quri") addEntries(state.quriEntries, state.quriRate);
  if (source === "all" || source === "htp") addEntries(state.htpEntries, state.htpRate);

  return monthly;
}

/* ---------- Date helpers ---------- */

function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function getDaysInMonth(year, monthIndex) {
  const dates = [];
  const date = new Date(year, monthIndex, 1);

  while (date.getMonth() === monthIndex) {
    dates.push(toDateInputValue(date));
    date.setDate(date.getDate() + 1);
  }

  return dates;
}

function getWeekdaysInRange(startDate, endDate) {
  const dates = [];
  const current = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  while (current <= end) {
    if (!isWeekend(current)) {
      dates.push(toDateInputValue(current));
    }

    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function getCurrentMonthValue() {
  return toDateInputValue(new Date()).slice(0, 7);
}

function getMonthLabel(value) {
  const [year, month] = value.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatDateLong(dateString) {
  const date = parseLocalDate(dateString);
  return `${monthShortNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/* ---------- Formatting ---------- */

function formatUsd(value) {
  return `$${formatNumber(value, 2)}`;
}

function formatUsdCompact(value) {
  return value >= 1000 ? `$${formatNumber(value / 1000, 1)}k` : `$${formatNumber(value, 0)}`;
}

function formatPhp(value) {
  return `₱${formatNumber(value, 2)}`;
}

function formatNumber(value, decimals = 2) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ---------- Toasts ---------- */

function showToast(title, message = "", type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <div class="toast-content">
      <p class="toast-title">${escapeHtml(title)}</p>
      ${message ? `<p class="toast-message">${escapeHtml(message)}</p>` : ""}
    </div>
    <button class="toast-close" type="button" aria-label="Close notification">×</button>
  `;

  toast.querySelector(".toast-close").addEventListener("click", () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => toast.remove(), type === "error" ? 6000 : 3500);
}
