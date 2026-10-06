const STORAGE_KEY = "workLogTracker.v5";
const API_URL = "https://open.er-api.com/v6/latest/USD";
const EXCHANGE_REFRESH_MS = 5 * 60 * 1000;

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
let pickerYear = new Date().getFullYear();

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const monthShortNames = [
  "Jan", "Feb", "Mar", "Apr",
  "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"
];

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const state = {
  activePage: "quri",
  phpRate: 58,
  quriRate: 4,
  htpRate: 6,
  quriMonth: getCurrentMonthValue(),
  htpStartDate: "2026-04-16",
  htpEndDate: "2026-05-16",
  htpInvoiceNumber: "",
  htpTemplateBase64: "",
  htpTemplateName: "",
  quriEntries: {},
  htpEntries: {}
};

document.addEventListener("DOMContentLoaded", async () => {
  loadState();
  setupNavigation();
  setupControls();
  populatePickers();
  initFirebase();

  if (db) {
    await loadCloudState();
  }

  await fetchExchangeRate(false);
  setInterval(() => fetchExchangeRate(false), EXCHANGE_REFRESH_MS);

  renderAll();
});

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
      quriRate: data.quriRate || state.quriRate,
      htpRate: data.htpRate || state.htpRate,
      quriMonth: data.quriMonth || state.quriMonth,
      htpStartDate: data.htpStartDate || state.htpStartDate,
      htpEndDate: data.htpEndDate || state.htpEndDate,
      htpInvoiceNumber: data.htpInvoiceNumber || state.htpInvoiceNumber,
      htpTemplateBase64: data.htpTemplateBase64 || state.htpTemplateBase64,
      htpTemplateName: data.htpTemplateName || state.htpTemplateName,
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
  saveLocalState();
  queueCloudSave();
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    Object.assign(state, JSON.parse(saved));
  } catch {
    console.warn("Could not parse saved tracker data.");
  }
}

function queueCloudSave() {
  if (!db) return;

  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(saveCloudState, 500);
}

async function saveCloudState() {
  if (!db) return;

  try {
    await db.collection("users").doc("defaultUser").set({
      activePage: state.activePage,
      phpRate: state.phpRate,
      quriRate: state.quriRate,
      htpRate: state.htpRate,
      quriMonth: state.quriMonth,
      htpStartDate: state.htpStartDate,
      htpEndDate: state.htpEndDate,
      htpInvoiceNumber: state.htpInvoiceNumber,
      htpTemplateBase64: state.htpTemplateBase64,
      htpTemplateName: state.htpTemplateName,
      quriEntries: state.quriEntries,
      htpEntries: state.htpEntries,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    setCloudStatus("Saved to Firebase.", "ok");
  } catch (error) {
    console.warn("Could not save cloud data:", error);
    setCloudStatus("Could not save to Firebase. Local backup saved.", "error");
  }
}

function setCloudStatus(message, type = "ok") {
  const status = document.getElementById("cloudStatus");
  if (!status) return;

  status.textContent = message;
  status.className = type === "ok" ? "status-ok" : type === "warn" ? "status-warn" : "status-error";
}

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => setActivePage(button.dataset.page));
  });

  document.getElementById("exportCurrentBtn").addEventListener("click", () => {
    showToast("Export disabled", "Use the HTP Generate Invoice PDF button for invoices.", "info");
  });
}

function setActivePage(page, shouldSave = true) {
  state.activePage = page;

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  document.querySelectorAll(".page").forEach((section) => {
    section.classList.remove("active");
  });

  const pageElement = document.getElementById(`${page}Page`);
  if (pageElement) {
    pageElement.classList.add("active");
  }

  if (page === "reports") {
    renderReports();
  }

  if (shouldSave) {
    saveState();
  }
}

function setupControls() {
  document.getElementById("quriRate").addEventListener("input", (event) => {
    state.quriRate = parseFloat(event.target.value || "0");
    saveState();
    renderQuri();
    renderReports();
  });

  document.getElementById("htpRate").addEventListener("input", (event) => {
    state.htpRate = parseFloat(event.target.value || "0");
    saveState();
    renderHtp();
    renderReports();
  });

  document.getElementById("htpStartDate").addEventListener("change", (event) => {
    state.htpStartDate = event.target.value;
  });

  document.getElementById("htpEndDate").addEventListener("change", (event) => {
    state.htpEndDate = event.target.value;
  });

  document.getElementById("htpInvoiceNumber").addEventListener("input", (event) => {
    state.htpInvoiceNumber = event.target.value;
    saveState();
  });

  document.getElementById("applyHtpPeriodBtn").addEventListener("click", () => {
    saveState();
    renderHtp();
    renderReports();
    showToast("Period applied", "HTP tracker was regenerated for the selected period.", "success");
  });

  document.getElementById("uploadHtpTemplateBtn").addEventListener("click", uploadHtpInvoiceTemplate);
  document.getElementById("generateHtpInvoiceBtn").addEventListener("click", generateHtpInvoicePdf);

  document.getElementById("resetLocalDataBtn").addEventListener("click", () => {
    if (!confirm("Reset local browser backup only? Firebase cloud data will remain.")) return;

    localStorage.removeItem(STORAGE_KEY);
    showToast("Local data reset", "Local browser backup was cleared.", "success");

    setTimeout(() => location.reload(), 700);
  });

  document.getElementById("resetAllDataBtn").addEventListener("click", resetAllTrackerData);

  document.getElementById("refreshRateQuriBtn").addEventListener("click", () => fetchExchangeRate(true));
  document.getElementById("refreshRateHtpBtn").addEventListener("click", () => fetchExchangeRate(true));

  document.getElementById("reportYear").addEventListener("change", renderReports);
  document.getElementById("reportSource").addEventListener("change", renderReports);

  setupMonthPicker();
}

function setupMonthPicker() {
  const modal = document.getElementById("monthPickerModal");
  const openBtn = document.getElementById("openQuriMonthPicker");
  const prevYearBtn = document.getElementById("prevYearBtn");
  const nextYearBtn = document.getElementById("nextYearBtn");
  const yearDisplayBtn = document.getElementById("yearDisplayBtn");

  openBtn.addEventListener("click", () => {
    const [year] = state.quriMonth.split("-").map(Number);
    pickerYear = year;
    openMonthPickerModal();
  });

  prevYearBtn.addEventListener("click", () => {
    pickerYear -= 1;
    renderMonthPicker();
  });

  nextYearBtn.addEventListener("click", () => {
    pickerYear += 1;
    renderMonthPicker();
  });

  yearDisplayBtn.addEventListener("click", () => {
    toggleYearDropdown();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeMonthPickerModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMonthPickerModal();
      closeYearDropdown();
    }
  });
}

function openMonthPickerModal() {
  document.getElementById("monthPickerModal").classList.remove("hidden");
  renderMonthPicker();
}

function closeMonthPickerModal() {
  document.getElementById("monthPickerModal").classList.add("hidden");
  closeYearDropdown();
}

function toggleYearDropdown() {
  const dropdown = document.getElementById("yearDropdown");
  dropdown.classList.toggle("hidden");

  if (!dropdown.classList.contains("hidden")) {
    renderYearDropdown();
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

  monthShortNames.forEach((monthLabel, monthIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "month-choice";

    if (selectedYear === pickerYear && selectedMonth === monthIndex + 1) {
      button.classList.add("active");
    }

    button.textContent = monthLabel;
    button.addEventListener("click", () => {
      state.quriMonth = `${pickerYear}-${String(monthIndex + 1).padStart(2, "0")}`;
      saveState();
      renderQuri();
      renderReports();
      closeMonthPickerModal();
      updateQuriMonthLabel();

      showToast("Month generated", `${getMonthLabel(state.quriMonth)} is ready for logging.`, "success");
    });

    monthGrid.appendChild(button);
  });

  renderYearDropdown();
}

function renderYearDropdown() {
  const yearList = document.getElementById("yearList");
  yearList.innerHTML = "";

  const startYear = pickerYear - 15;
  const endYear = pickerYear + 15;

  for (let year = startYear; year <= endYear; year++) {
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

async function resetAllTrackerData() {
  if (!confirm("This will clear all QURI and HTP tracker data from Firebase and this browser. Continue?")) return;

  state.activePage = "quri";
  state.quriRate = 4;
  state.htpRate = 6;
  state.quriMonth = getCurrentMonthValue();
  state.htpStartDate = "2026-04-16";
  state.htpEndDate = "2026-05-16";
  state.htpInvoiceNumber = "";
  state.quriEntries = {};
  state.htpEntries = {};

  localStorage.removeItem(STORAGE_KEY);
  saveLocalState();

  if (db) {
    try {
      await db.collection("users").doc("defaultUser").set({
        activePage: state.activePage,
        phpRate: state.phpRate,
        quriRate: state.quriRate,
        htpRate: state.htpRate,
        quriMonth: state.quriMonth,
        htpStartDate: state.htpStartDate,
        htpEndDate: state.htpEndDate,
        htpInvoiceNumber: state.htpInvoiceNumber,
        htpTemplateBase64: state.htpTemplateBase64,
        htpTemplateName: state.htpTemplateName,
        quriEntries: {},
        htpEntries: {},
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      setCloudStatus("Tracker data reset in Firebase.", "ok");
      showToast("Tracker data reset", "Firebase and local tracker data were cleared.", "success");
    } catch (error) {
      console.warn("Could not reset cloud data:", error);
      setCloudStatus("Could not reset Firebase data. Local data was reset.", "error");
      showToast("Firebase reset failed", "Local data was reset, but Firebase could not be cleared.", "error");
    }
  }

  populatePickers();
  renderAll();
}

async function fetchExchangeRate(showManualToast = false) {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("Rate request failed");

    const data = await response.json();
    const php = data?.rates?.PHP;

    if (typeof php === "number") {
      state.phpRate = php;
      saveState();
      renderAll();

      if (showManualToast) {
        showToast("Exchange rate refreshed", `1 USD = ₱${formatNumber(state.phpRate, 2)}`, "success");
      }
    }
  } catch (error) {
    console.warn("Using fallback PHP rate:", state.phpRate, error);

    if (showManualToast) {
      showToast("Rate refresh failed", "Using the last saved exchange rate.", "error");
    }
  }
}

function populatePickers() {
  updateQuriMonthLabel();

  const reportYear = document.getElementById("reportYear");
  reportYear.innerHTML = "";

  const currentYear = new Date().getFullYear();
  const startYear = Math.min(2026, currentYear - 2);
  const endYear = currentYear + 10;

  for (let year = startYear; year <= endYear; year++) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    reportYear.appendChild(option);
  }

  reportYear.value = String(currentYear < startYear ? startYear : currentYear);
}

function updateQuriMonthLabel() {
  const label = document.getElementById("selectedQuriMonthLabel");
  if (label) {
    label.textContent = getMonthLabel(state.quriMonth);
  }
}

function renderAll() {
  setActivePage(state.activePage || "quri", false);
  updateQuriMonthLabel();
  renderQuri();
  renderHtp();
  renderReports();
}

function renderQuri() {
  const [year, month] = state.quriMonth.split("-").map(Number);
  const tableBody = document.getElementById("quriTableBody");
  tableBody.innerHTML = "";

  updateQuriMonthLabel();
  document.getElementById("quriRate").value = formatNumber(state.quriRate, 2);
  document.getElementById("quriExchangeText").textContent = `1 USD = ₱${formatNumber(state.phpRate, 2)} today`;

  getDaysInMonth(year, month - 1).forEach((dateString) => {
    const date = parseLocalDate(dateString);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const entry = state.quriEntries[dateString] || { tasks: "", hours: 0 };
    const hours = parseFloat(entry.hours || 0);
    const usd = hours * state.quriRate;

    const row = document.createElement("tr");

    if (isWeekend) {
      row.innerHTML = `
        <td>${formatDateLong(dateString)}</td>
        <td>${dayNames[date.getDay()]}</td>
        <td><span class="day-off">DAY OFF</span></td>
        <td>—</td>
        <td>—</td>
        <td></td>
      `;
    } else {
      row.innerHTML = `
        <td>${formatDateLong(dateString)}</td>
        <td>${dayNames[date.getDay()]}</td>
        <td>
          <div class="task-box">
            <textarea data-quri-tasks="${dateString}" placeholder="Enter tasks here">${escapeHtml(entry.tasks || "")}</textarea>
            <button class="copy-btn" data-copy-quri="${dateString}" title="Copy tasks">⧉</button>
          </div>
        </td>
        <td>
          <input class="hours-input" type="number" step="0.01" min="0" data-quri-hours="${dateString}" value="${formatNumber(hours, 2)}" />
        </td>
        <td>${formatUsd(usd)}</td>
        <td>
          <div class="row-actions">
            <button class="save-btn" data-save-quri="${dateString}">💾 Save</button>
            <button class="clear-btn" data-clear-quri="${dateString}">Clear</button>
          </div>
        </td>
      `;
    }

    tableBody.appendChild(row);
  });

  tableBody.querySelectorAll("[data-save-quri]").forEach((button) => {
    button.addEventListener("click", () => saveQuriRow(button.dataset.saveQuri));
  });

  tableBody.querySelectorAll("[data-clear-quri]").forEach((button) => {
    button.addEventListener("click", () => clearQuriRow(button.dataset.clearQuri));
  });

  tableBody.querySelectorAll("[data-copy-quri]").forEach((button) => {
    button.addEventListener("click", () => copyQuriTasks(button.dataset.copyQuri));
  });

  const totals = calculateQuriTotals();
  document.getElementById("quriTotalHours").textContent = formatNumber(totals.hours, 2);
  document.getElementById("quriTotalUsd").textContent = formatUsd(totals.usd);
  document.getElementById("quriTotalPhp").textContent = formatPhp(totals.usd * state.phpRate);
}

function saveQuriRow(dateString) {
  const tasks = document.querySelector(`[data-quri-tasks="${dateString}"]`)?.value || "";
  const hours = parseFloat(document.querySelector(`[data-quri-hours="${dateString}"]`)?.value || "0");

  state.quriEntries[dateString] = { tasks, hours };

  saveState();
  renderQuri();
  renderReports();

  showToast("QURI row saved", `${formatDateLong(dateString)} was saved.`, "success");
}

function clearQuriRow(dateString) {
  if (!confirm("Clear tasks and hours for this date?")) return;

  delete state.quriEntries[dateString];

  saveState();
  renderQuri();
  renderReports();

  showToast("QURI row cleared", `${formatDateLong(dateString)} was cleared.`, "success");
}

async function copyQuriTasks(dateString) {
  const tasks = document.querySelector(`[data-quri-tasks="${dateString}"]`)?.value || state.quriEntries[dateString]?.tasks || "";
  await navigator.clipboard.writeText(tasks);

  showToast("Tasks copied", "The task list is ready to paste.", "success");
}

function renderHtp() {
  document.getElementById("htpStartDate").value = state.htpStartDate;
  document.getElementById("htpEndDate").value = state.htpEndDate;
  document.getElementById("htpRate").value = formatNumber(state.htpRate, 2);
  document.getElementById("htpInvoiceNumber").value = state.htpInvoiceNumber || "";
  document.getElementById("htpExchangeText").textContent = `1 USD = ₱${formatNumber(state.phpRate, 2)} today`;

  updateHtpTemplateStatus();

  const invoiceMonth = parseLocalDate(state.htpEndDate);
  document.getElementById("htpInvoiceLabel").textContent = `Invoice for ${monthNames[invoiceMonth.getMonth()]} ${invoiceMonth.getFullYear()}`;

  const tableBody = document.getElementById("htpTableBody");
  tableBody.innerHTML = "";

  getWeekdaysInRange(state.htpStartDate, state.htpEndDate).forEach((dateString) => {
    if (!state.htpEntries[dateString]) {
      state.htpEntries[dateString] = { hours: 4 };
    }

    const entry = state.htpEntries[dateString];
    const date = parseLocalDate(dateString);
    const hours = parseFloat(entry.hours || 0);
    const usd = hours * state.htpRate;
    const php = usd * state.phpRate;

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${formatDateLong(dateString)}</td>
      <td>${dayNames[date.getDay()]}</td>
      <td>
        <input class="hours-input" type="number" step="0.01" min="0" data-htp-hours="${dateString}" value="${formatNumber(hours, 2)}" />
      </td>
      <td>${formatUsd(usd)}</td>
      <td>${formatPhp(php)}</td>
      <td>
        <div class="row-actions">
          <button class="save-btn" data-save-htp="${dateString}">💾 Save</button>
          <button class="clear-btn" data-clear-htp="${dateString}">Clear</button>
        </div>
      </td>
    `;

    tableBody.appendChild(row);
  });

  tableBody.querySelectorAll("[data-save-htp]").forEach((button) => {
    button.addEventListener("click", () => saveHtpRow(button.dataset.saveHtp));
  });

  tableBody.querySelectorAll("[data-clear-htp]").forEach((button) => {
    button.addEventListener("click", () => clearHtpRow(button.dataset.clearHtp));
  });

  saveState();
  renderHtpSummary();
}

function saveHtpRow(dateString) {
  const hours = parseFloat(document.querySelector(`[data-htp-hours="${dateString}"]`)?.value || "0");

  state.htpEntries[dateString] = { hours };

  saveState();
  renderHtp();
  renderReports();

  showToast("HTP row saved", `${formatDateLong(dateString)} was saved.`, "success");
}

function clearHtpRow(dateString) {
  if (!confirm("Clear hours for this date?")) return;

  state.htpEntries[dateString] = { hours: 0 };

  saveState();
  renderHtp();
  renderReports();

  showToast("HTP row cleared", `${formatDateLong(dateString)} was cleared.`, "success");
}

function renderHtpSummary() {
  const totals = calculateHtpTotals();

  document.getElementById("htpTotalHours").textContent = formatNumber(totals.hours, 2);
  document.getElementById("htpTotalUsd").textContent = formatUsd(totals.usd);
  document.getElementById("htpTotalPhp").textContent = formatPhp(totals.net);

  document.getElementById("sumUsd").textContent = formatUsd(totals.usd);
  document.getElementById("sumHours").textContent = formatNumber(totals.hours, 2);
  document.getElementById("sumRate").textContent = formatNumber(state.phpRate, 2);
  document.getElementById("sumGross").textContent = formatPhp(totals.php);
  document.getElementById("sumDeduction").textContent = formatPhp(totals.deduction);
  document.getElementById("sumNet").textContent = formatPhp(totals.net);
}

async function uploadHtpInvoiceTemplate() {
  const fileInput = document.getElementById("htpTemplateFile");
  const status = document.getElementById("htpTemplateStatus");
  const uploadButton = document.getElementById("uploadHtpTemplateBtn");
  const file = fileInput.files?.[0];

  if (!file) {
    showToast("No template selected", "Please choose a PDF template first.", "warning");
    return;
  }

  if (file.type !== "application/pdf") {
    showToast("Invalid file type", "Please upload a PDF file only.", "error");
    return;
  }

  try {
    uploadButton.disabled = true;
    uploadButton.textContent = "Saving...";
    status.textContent = `Saving template: ${file.name}`;

    const base64 = await fileToBase64(file);

    state.htpTemplateBase64 = base64;
    state.htpTemplateName = file.name;

    saveState();
    updateHtpTemplateStatus();

    showToast("Template saved", "Your HTP invoice template was saved.", "success");
  } catch (error) {
    console.error("Template save failed:", error);

    status.textContent = "Template save failed.";

    showToast(
      "Template save failed",
      error.message || "Could not save the PDF template.",
      "error"
    );
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = "Upload Template";
  }
}

function updateHtpTemplateStatus() {
  const status = document.getElementById("htpTemplateStatus");
  if (!status) return;

  if (state.htpTemplateName) {
    status.textContent = `Current template: ${state.htpTemplateName}`;
  } else {
    status.textContent = "No template uploaded yet.";
  }
}

async function generateHtpInvoicePdf() {
  if (!state.htpTemplateBase64) {
    showToast("Missing template", "Please upload your HTP invoice template first.", "warning");
    return;
  }

  if (!window.PDFLib) {
    showToast("PDF tool not loaded", "Please refresh the page and try again.", "error");
    return;
  }

  const invoiceNumber = document.getElementById("htpInvoiceNumber").value.trim();

  if (!invoiceNumber) {
    showToast("Missing invoice number", "Please enter an invoice number first.", "warning");
    return;
  }

  state.htpInvoiceNumber = invoiceNumber;
  saveState();

  try {
    const templateBytes = base64ToArrayBuffer(state.htpTemplateBase64);

    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page = pdfDoc.getPages()[0];

    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const totals = calculateHtpTotals();

    const amountDue = formatUsd(totals.usd);
    const workedHours = formatNumber(totals.hours, 2);
    const rate = formatUsd(state.htpRate);
    const workStart = formatDateShortForInvoice(state.htpStartDate);
    const workEnd = formatDateShortForInvoice(state.htpEndDate);

    const headerBlueGray = rgb(0.518, 0.588, 0.690);
    const darkText = rgb(0.11, 0.17, 0.29);
    const black = rgb(0, 0, 0);
    const white = rgb(1, 1, 1);

    page.drawRectangle({
      x: 382,
      y: 688,
      width: 150,
      height: 44,
      color: headerBlueGray
    });

    page.drawRectangle({
      x: 490,
      y: 355,
      width: 70,
      height: 24,
      color: white
    });

    drawCenteredText(page, amountDue, 450, 690, {
      font: boldFont,
      size: 24,
      color: darkText
    });

    drawCenteredText(page, invoiceNumber, 507, 585, {
      font: regularFont,
      size: 10,
      color: black
    });

    drawCenteredText(page, workStart, 405, 540, {
      font: regularFont,
      size: 10,
      color: black
    });

    drawCenteredText(page, workEnd, 505, 540, {
      font: regularFont,
      size: 10,
      color: black
    });

    drawCenteredText(page, workedHours, 300, 447, {
      font: regularFont,
      size: 10,
      color: black
    });

    drawCenteredText(page, rate, 405, 447, {
      font: regularFont,
      size: 10,
      color: black
    });

    drawCenteredText(page, amountDue, 510, 447, {
      font: regularFont,
      size: 10,
      color: black
    });

    drawCenteredText(page, amountDue, 508, 372, {
      font: boldFont,
      size: 10,
      color: black
    });

    const pdfBytes = await pdfDoc.save();
    downloadPdfBytes(pdfBytes, getHtpInvoiceFileName());

    showToast("Invoice generated", "Your HTP invoice PDF has been downloaded.", "success");
  } catch (error) {
    console.error(error);
    showToast("Invoice failed", "Could not generate the PDF invoice.", "error");
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected PDF file."));

    reader.readAsDataURL(file);
  });
}

function base64ToArrayBuffer(base64) {
  const base64Data = base64.split(",")[1];
  const binaryString = window.atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

function drawCenteredText(page, text, centerX, y, options) {
  const textWidth = options.font.widthOfTextAtSize(text, options.size);

  page.drawText(text, {
    x: centerX - textWidth / 2,
    y,
    size: options.size,
    font: options.font,
    color: options.color
  });
}

function downloadPdfBytes(pdfBytes, fileName) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

function getHtpInvoiceFileName() {
  const endDate = parseLocalDate(state.htpEndDate);
  const month = monthNames[endDate.getMonth()];
  const year = endDate.getFullYear();

  return `Ubaldo - Invoice - HealthTek - ${month} ${year}.pdf`;
}

function formatDateShortForInvoice(dateString) {
  const date = parseLocalDate(dateString);
  return `${monthNames[date.getMonth()].slice(0, 3)} ${date.getDate()}, ${date.getFullYear()}`;
}

function renderReports() {
  const year = parseInt(document.getElementById("reportYear")?.value || new Date().getFullYear(), 10);
  const source = document.getElementById("reportSource")?.value || "all";
  const monthly = calculateMonthlyTotals(year, source);

  const totalUsd = monthly.reduce((sum, item) => sum + item.usd, 0);
  const totalPhp = totalUsd * state.phpRate;
  const totalHours = monthly.reduce((sum, item) => sum + item.hours, 0);
  const nonZeroMonths = monthly.filter((item) => item.usd > 0);
  const avgUsd = nonZeroMonths.length ? totalUsd / nonZeroMonths.length : 0;
  const highest = monthly.reduce((max, item) => item.usd > max.usd ? item : max, monthly[0]);
  const currentMonth = monthly[new Date().getMonth()] || { usd: 0 };

  document.getElementById("reportThisMonth").textContent = formatUsd(currentMonth.usd);
  document.getElementById("reportThisMonthPhp").textContent = formatPhp(currentMonth.usd * state.phpRate);
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

  renderBarChart(monthly);
  renderMonthlyTotalsTable(monthly);
}

function renderBarChart(monthly) {
  const chart = document.getElementById("barChart");
  chart.innerHTML = "";

  const max = Math.max(...monthly.map((item) => item.usd), 1);

  monthly.forEach((item) => {
    const height = Math.max(4, (item.usd / max) * 210);
    const group = document.createElement("div");

    group.className = "bar-group";
    group.innerHTML = `
      <div class="bar-value">${formatUsd(item.usd)}</div>
      <div class="bar" style="height:${height}px"></div>
      <div class="bar-month">${item.month.slice(0, 3)}</div>
    `;

    chart.appendChild(group);
  });
}

function renderMonthlyTotalsTable(monthly) {
  const tableBody = document.getElementById("monthlyTotalsBody");
  tableBody.innerHTML = "";

  monthly.forEach((item) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.month}</td>
      <td>${formatUsd(item.usd)}</td>
      <td>${formatPhp(item.usd * state.phpRate)}</td>
    `;

    tableBody.appendChild(row);
  });
}

function calculateQuriTotals() {
  const [year, month] = state.quriMonth.split("-").map(Number);

  return getDaysInMonth(year, month - 1).reduce((totals, dateString) => {
    const date = parseLocalDate(dateString);
    if (date.getDay() === 0 || date.getDay() === 6) return totals;

    const hours = parseFloat(state.quriEntries[dateString]?.hours || 0);

    totals.hours += hours;
    totals.usd += hours * state.quriRate;

    return totals;
  }, { hours: 0, usd: 0 });
}

function calculateHtpTotals() {
  const hours = getWeekdaysInRange(state.htpStartDate, state.htpEndDate).reduce((sum, dateString) => {
    const entry = state.htpEntries[dateString] || { hours: 4 };
    return sum + parseFloat(entry.hours || 0);
  }, 0);

  const usd = hours * state.htpRate;
  const php = usd * state.phpRate;
  const deduction = php * 0.15;

  return {
    hours,
    usd,
    php,
    deduction,
    net: php - deduction
  };
}

function calculateMonthlyTotals(year, source = "all") {
  const monthly = monthNames.map((month) => ({
    month,
    usd: 0,
    hours: 0
  }));

  if (source === "all" || source === "quri") {
    Object.entries(state.quriEntries).forEach(([dateString, entry]) => {
      const date = parseLocalDate(dateString);
      if (date.getFullYear() !== year) return;

      const hours = parseFloat(entry.hours || 0);

      monthly[date.getMonth()].hours += hours;
      monthly[date.getMonth()].usd += hours * state.quriRate;
    });
  }

  if (source === "all" || source === "htp") {
    Object.entries(state.htpEntries).forEach(([dateString, entry]) => {
      const date = parseLocalDate(dateString);
      if (date.getFullYear() !== year) return;

      const hours = parseFloat(entry.hours || 0);

      monthly[date.getMonth()].hours += hours;
      monthly[date.getMonth()].usd += hours * state.htpRate;
    });
  }

  return monthly;
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
    const day = current.getDay();

    if (day !== 0 && day !== 6) {
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
  return `${monthNames[date.getMonth()].slice(0, 3)} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatUsd(value) {
  return `$${formatNumber(value, 2)}`;
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
    .replaceAll(">", "&gt;");
}

function showToast(title, message = "", type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const icons = {
    success: "✅",
    error: "⚠️",
    warning: "⚠️",
    info: "ℹ️"
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <p class="toast-title">${escapeHtml(title)}</p>
      ${message ? `<p class="toast-message">${escapeHtml(message)}</p>` : ""}
    </div>
    <button class="toast-close" type="button" aria-label="Close notification">×</button>
  `;

  toast.querySelector(".toast-close").addEventListener("click", () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}