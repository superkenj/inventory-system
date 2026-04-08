const menuItems = Array.from(document.querySelectorAll(".menu-item"));
const panels = {
  inventory: document.getElementById("inventory-view"),
  "add-item": document.getElementById("add-item-view"),
  logs: document.getElementById("logs-view")
};

const inventoryBody = document.getElementById("inventory-body");
const addItemBody = document.getElementById("add-item-body");
const logsBody = document.getElementById("logs-body");
const addNewItemBtn = document.getElementById("add-new-item-btn");
const addItemSearchInput = document.getElementById("add-item-search");
const logsMonthFilter = document.getElementById("logs-month-filter");
const logsYearFilter = document.getElementById("logs-year-filter");
const logsPeriodLabel = document.getElementById("logs-period-label");
const adminContent = document.getElementById("admin-content");
const authState = document.getElementById("auth-state");
const logoutBtn = document.getElementById("logout-btn");

const modalOverlay = document.getElementById("modal-overlay");
const modalCard = document.getElementById("modal-card");
const modalTitle = document.getElementById("modal-title");
const modalForm = document.getElementById("modal-form");
const modalClose = document.getElementById("modal-close");
const printPreviewBtn = document.getElementById("print-preview-btn");
const printPreviewLogsBtn = document.getElementById("print-preview-logs-btn");
const dialogModalRoot = document.getElementById("dialog-modal-root");

let dialogZSeq = 1000;
const openDialogOverlays = [];

let isAdmin = false;
let needsSetup = false;
let inventoryCache = [];
let logsCache = [];
let currentView = "inventory";
let addItemSearchTerm = "";
let onModalClosed = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatInventoryQuantity(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isNaN(n) ? "" : String(n);
}

function hasPositiveStock(row) {
  if (row.quantity === null || row.quantity === undefined || row.quantity === "") return false;
  const n = Number(row.quantity);
  return !Number.isNaN(n) && n > 0;
}

/**
 * Display order:
 * (0) critical low stock (0 < qty <= 1),
 * (1) medium low stock (qty <= 3),
 * (2) warning low stock (qty <= 5),
 * (3) other in-stock,
 * (4) no stock.
 * Within each tier: A–Z by item name.
 */
function inventoryDisplayTier(row) {
  if (!hasPositiveStock(row)) return 4;
  const n = Number(row.quantity);
  if (Number.isNaN(n)) return 4;
  if (n <= 1) return 0;
  if (n <= 3) return 1;
  if (n <= 5) return 2;
  return 3;
}

function compareInventoryDisplayOrder(a, b) {
  const ta = inventoryDisplayTier(a);
  const tb = inventoryDisplayTier(b);
  if (ta !== tb) return ta - tb;
  return a.item_name.localeCompare(b.item_name, undefined, { sensitivity: "base" });
}

function sortInventoryForDisplay(rows) {
  return [...rows].sort(compareInventoryDisplayOrder);
}

/** Critical/medium/warn reds for low stock; gray row when there is no stock. */
function lowStockRowClass(row) {
  if (!hasPositiveStock(row)) return "row-no-stock";
  const n = Number(row.quantity);
  if (Number.isNaN(n)) return "row-no-stock";
  if (n <= 1) return "row-low-stock-critical";
  if (n <= 3) return "row-low-stock-medium";
  if (n <= 5) return "row-low-stock-warn";
  return "";
}

function formatInventoryUom(value) {
  if (value === null || value === undefined || value === "") return "";
  return escapeHtml(String(value));
}

function availableStockNumber(row) {
  if (row.quantity === null || row.quantity === undefined || row.quantity === "") return NaN;
  const n = Number(row.quantity);
  return Number.isNaN(n) ? NaN : n;
}

function parseCheckoutWholeQuantity(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits === "") return NaN;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : NaN;
}

function showView(view) {
  currentView = view;
  menuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });

  Object.entries(panels).forEach(([key, panel]) => {
    panel.classList.toggle("visible", key === view);
  });
}

function bumpMainModalZ() {
  modalOverlay.style.zIndex = String(++dialogZSeq);
}

function bindTopDialogEscape(overlay, onEscape) {
  const escapeHandler = (e) => {
    if (e.key !== "Escape") return;
    if (openDialogOverlays[openDialogOverlays.length - 1] !== overlay) return;
    e.preventDefault();
    onEscape();
  };
  document.addEventListener("keydown", escapeHandler);
  return () => document.removeEventListener("keydown", escapeHandler);
}

function showAlertModal(message, title = "Notice") {
  return new Promise((resolve) => {
    if (!dialogModalRoot) {
      resolve();
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "dialog-modal-overlay";
    overlay.style.zIndex = String(++dialogZSeq);
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");

    const titleId = `dialog-alert-title-${dialogZSeq}`;
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">
          <h2 id="${titleId}">${escapeHtml(title)}</h2>
          <button type="button" class="icon-btn js-dialog-alert-x" aria-label="Close">x</button>
        </div>
        <div class="modal-form">
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button type="button" class="primary-btn js-dialog-alert-ok">OK</button>
          </div>
        </div>
      </div>
    `;
    overlay.setAttribute("aria-labelledby", titleId);

    let escapeCleanup = null;
    const finish = () => {
      if (escapeCleanup) escapeCleanup();
      escapeCleanup = null;
      const idx = openDialogOverlays.indexOf(overlay);
      if (idx >= 0) openDialogOverlays.splice(idx, 1);
      overlay.remove();
      resolve();
    };

    escapeCleanup = bindTopDialogEscape(overlay, finish);
    openDialogOverlays.push(overlay);
    dialogModalRoot.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish();
    });
    overlay.querySelector(".js-dialog-alert-ok").addEventListener("click", finish);
    overlay.querySelector(".js-dialog-alert-x").addEventListener("click", finish);
  });
}

function openConfirmationModal(title, message, confirmLabel = "Confirm") {
  return new Promise((resolve) => {
    if (!dialogModalRoot) {
      resolve(false);
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "dialog-modal-overlay";
    overlay.style.zIndex = String(++dialogZSeq);
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const titleId = `dialog-confirm-title-${dialogZSeq}`;
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">
          <h2 id="${titleId}">${escapeHtml(title)}</h2>
          <button type="button" class="icon-btn js-dialog-confirm-x" aria-label="Close">x</button>
        </div>
        <div class="modal-form">
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button type="button" class="ghost-btn js-dialog-confirm-cancel">Cancel</button>
            <button type="button" class="primary-btn js-dialog-confirm-yes">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>
    `;
    overlay.setAttribute("aria-labelledby", titleId);

    let settled = false;
    let escapeCleanup = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (escapeCleanup) escapeCleanup();
      escapeCleanup = null;
      const idx = openDialogOverlays.indexOf(overlay);
      if (idx >= 0) openDialogOverlays.splice(idx, 1);
      overlay.remove();
      resolve(value);
    };

    escapeCleanup = bindTopDialogEscape(overlay, () => finish(false));
    openDialogOverlays.push(overlay);
    dialogModalRoot.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
    overlay.querySelector(".js-dialog-confirm-cancel").addEventListener("click", () => finish(false));
    overlay.querySelector(".js-dialog-confirm-yes").addEventListener("click", () => finish(true));
    overlay.querySelector(".js-dialog-confirm-x").addEventListener("click", () => finish(false));
  });
}

function openModal(title, html, onSubmit) {
  bumpMainModalZ();
  modalTitle.textContent = title;
  modalForm.innerHTML = html;
  modalOverlay.classList.remove("hidden");

  modalForm.onsubmit = async (event) => {
    event.preventDefault();
    await onSubmit(new FormData(modalForm));
  };
}

function closeModal() {
  if (typeof onModalClosed === "function") {
    onModalClosed();
    onModalClosed = null;
  }
  if (modalCard) {
    modalCard.classList.remove("modal-card-wide");
  }
  modalOverlay.classList.add("hidden");
  modalForm.innerHTML = "";
  modalForm.onsubmit = null;
}

function openConfirmationModal(title, message, confirmLabel = "Confirm") {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      onModalClosed = null;
      resolve(value);
    };

    onModalClosed = () => settle(false);
    openModal(
      title,
      `
      <p>${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="primary-btn">${escapeHtml(confirmLabel)}</button>
      </div>
    `,
      async () => {
        settle(true);
        closeModal();
      }
    );

    document.getElementById("cancel-btn").addEventListener("click", () => {
      settle(false);
      closeModal();
    });
  });
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function renderInventoryRows() {
  if (inventoryCache.length === 0) {
    inventoryBody.innerHTML = `<tr><td colspan="5" class="muted">No items available.</td></tr>`;
    addItemBody.innerHTML = `<tr><td colspan="5" class="muted">No items yet.</td></tr>`;
    return;
  }

  const sortedAll = sortInventoryForDisplay(inventoryCache);
  inventoryBody.innerHTML = sortedAll
    .map(
      (row) => `<tr class="${lowStockRowClass(row)}">
      <td>${escapeHtml(row.item_name)}</td>
      <td class="col-unit-cost">${Number(row.unit_cost).toFixed(2)}</td>
      <td class="col-quantity">${formatInventoryQuantity(row.quantity)}</td>
      <td class="col-uom">${formatInventoryUom(row.unit_of_measure)}</td>
      <td class="col-action">
        <button class="btn btn-checkout" data-checkout-id="${row.id}" ${hasPositiveStock(row) ? "" : "disabled"}>
          ${hasPositiveStock(row) ? "Check-Out" : "Out of Stock"}
        </button>
      </td>
    </tr>`
    )
    .join("");

  const filteredRows = sortInventoryForDisplay(
    inventoryCache.filter((row) => row.item_name.toLowerCase().includes(addItemSearchTerm.toLowerCase()))
  );

  if (filteredRows.length === 0) {
    addItemBody.innerHTML = `<tr><td colspan="5" class="muted">No matching items found.</td></tr>`;
    return;
  }

  addItemBody.innerHTML = filteredRows
    .map(
      (row) => `<tr class="${lowStockRowClass(row)}">
      <td>${escapeHtml(row.item_name)}</td>
      <td class="col-unit-cost">${Number(row.unit_cost).toFixed(2)}</td>
      <td class="col-quantity">${formatInventoryQuantity(row.quantity)}</td>
      <td class="col-uom">${formatInventoryUom(row.unit_of_measure)}</td>
      <td class="col-action">
        <div class="action-group">
          <button type="button" class="btn btn-edit" data-edit-id="${row.id}">Edit</button>
          <button type="button" class="btn btn-plus" data-addstock-id="${row.id}" data-uom="${escapeHtml(row.unit_of_measure || "")}">Add Stock</button>
          <button type="button" class="btn btn-deduct" data-deduct-id="${row.id}" data-uom="${escapeHtml(row.unit_of_measure || "")}">Deduct Stock</button>
          <button type="button" class="btn btn-delete" data-delete-id="${row.id}">Delete</button>
        </div>
      </td>
    </tr>`
    )
    .join("");
}

async function refreshInventory() {
  inventoryCache = await request("/api/inventory");
  renderInventoryRows();
}

function buildInventoryPrintTableHtml(dataRows = inventoryCache) {
  if (!dataRows.length) {
    return '<p class="muted" style="padding:12px;">No items to print.</p>';
  }
  const rows = sortInventoryForDisplay(dataRows)
    .map(
      (row) => `<tr class="${lowStockRowClass(row)}">
      <td>${escapeHtml(row.item_name)}</td>
      <td class="col-unit-cost">${Number(row.unit_cost).toFixed(2)}</td>
      <td class="col-quantity">${formatInventoryQuantity(row.quantity)}</td>
      <td class="col-uom">${formatInventoryUom(row.unit_of_measure)}</td>
    </tr>`
    )
    .join("");
  return `
    <table class="print-preview-table">
      <thead>
        <tr>
          <th>Description / Item Name</th>
          <th class="col-unit-cost">Unit Cost</th>
          <th class="col-quantity">Quantity</th>
          <th class="col-uom">Unit of Measure</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildInventoryPrintPageHtml() {
  const generated = new Date().toLocaleString();
  const tableHtml = buildInventoryPrintTableHtml();
  return `
    <div class="print-preview-canvas">
      <article class="print-page">
        <h1>CCRO — Inventory List</h1>
        <div class="meta">Generated: ${escapeHtml(generated)}</div>
        ${tableHtml}
      </article>
    </div>
  `;
}

function getInventoryPrintDocumentHtml() {
  const tableInner = buildInventoryPrintTableHtml();
  const generated = new Date().toLocaleString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>CCRO — Inventory List</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #1d2d2a; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { font-size: 12px; color: #5b6c67; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #dde6e3; }
    th { text-align: left; background: #eef3f2; text-transform: uppercase; font-size: 11px; letter-spacing: 0.2px; color: #5b6c67; }
    .col-unit-cost { text-align: right; }
    .col-quantity, .col-uom { text-align: center; }
    tbody tr.row-low-stock-warn td { background: rgba(239, 68, 68, 0.1); }
    tbody tr.row-low-stock-medium td { background: rgba(239, 68, 68, 0.2); }
    tbody tr.row-low-stock-critical td { background: rgba(239, 68, 68, 0.4); }
    tbody tr.row-no-stock td { background: #eef1f0; color: #6f7e7a; }
  </style>
</head>
<body>
  <h1>CCRO — Inventory List</h1>
  <div class="meta">Generated: ${escapeHtml(generated)}</div>
  ${tableInner}
</body>
</html>`;
}

function runInventoryPrint() {
  if (!inventoryCache.length) {
    void showAlertModal("No items to print.");
    return;
  }
  const html = getInventoryPrintDocumentHtml();
  if (window.electronPrint && typeof window.electronPrint.directPrintHtml === "function") {
    window.electronPrint.directPrintHtml(html).then((result) => {
      if (!result || !result.ok) {
        void showAlertModal(result?.error || "Print failed.");
      }
    });
    return;
  }
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    void showAlertModal("Print window was blocked. Allow pop-ups for this site, then try again.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 300);
}

function openInventoryPrintPreview() {
  bumpMainModalZ();
  if (modalCard) {
    modalCard.classList.add("modal-card-wide");
  }
  modalTitle.textContent = "Print Preview — Inventory List";
  modalForm.innerHTML = `
    <div class="print-preview-scroll">${buildInventoryPrintPageHtml()}</div>
    <div class="modal-actions">
      <button type="button" class="ghost-btn" id="print-preview-close">Close</button>
      <button type="button" class="secondary-btn" id="print-preview-print-only" ${!inventoryCache.length ? "disabled" : ""}>Print</button>
    </div>
  `;
  modalOverlay.classList.remove("hidden");
  modalForm.onsubmit = (e) => e.preventDefault();
  onModalClosed = null;

  document.getElementById("print-preview-close").addEventListener("click", closeModal);
  document.getElementById("print-preview-print-only").addEventListener("click", () => {
    runInventoryPrint();
  });
}

function buildLogsPrintTableHtml() {
  const rows = Array.from(logsBody.querySelectorAll("tr"));
  if (!rows.length || rows[0].textContent.includes("No issuance logs found for selected filters.")) {
    return '<p class="muted" style="padding:12px;">No logs to print.</p>';
  }
  const htmlRows = rows
    .map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 6) return "";
      return `<tr>
        <td>${escapeHtml(cells[0].textContent.trim())}</td>
        <td class="col-quantity">${escapeHtml(cells[1].textContent.trim())}</td>
        <td class="col-uom">${escapeHtml(cells[2].textContent.trim())}</td>
        <td>${escapeHtml(cells[3].textContent.trim())}</td>
        <td>${escapeHtml(cells[4].textContent.trim())}</td>
        <td>${escapeHtml(cells[5].textContent.trim())}</td>
      </tr>`;
    })
    .join("");

  return `
    <table class="print-preview-table">
      <thead>
        <tr>
          <th>Item Name</th>
          <th class="col-quantity">Quantity</th>
          <th class="col-uom">Unit of Measure</th>
          <th>ID Number</th>
          <th>Name</th>
          <th>Date Issued</th>
        </tr>
      </thead>
      <tbody>${htmlRows}</tbody>
    </table>
  `;
}

function getLogsPrintDocumentHtml() {
  const tableInner = buildLogsPrintTableHtml();
  const generated = new Date().toLocaleString();
  const period = escapeHtml(currentLogsPeriodText());
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>CCRO — Issuance Logs</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #1d2d2a; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { font-size: 12px; color: #5b6c67; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #dde6e3; }
    th { text-align: left; background: #eef3f2; text-transform: uppercase; font-size: 11px; letter-spacing: 0.2px; color: #5b6c67; }
    .col-quantity, .col-uom { text-align: center; }
  </style>
</head>
<body>
  <h1>CCRO — Issuance Logs (${period})</h1>
  <div class="meta">Generated: ${escapeHtml(generated)}</div>
  ${tableInner}
</body>
</html>`;
}

function runLogsPrint() {
  const html = getLogsPrintDocumentHtml();
  if (html.includes("No logs to print.")) {
    void showAlertModal("No logs to print.");
    return;
  }
  if (window.electronPrint && typeof window.electronPrint.directPrintHtml === "function") {
    window.electronPrint.directPrintHtml(html).then((result) => {
      if (!result || !result.ok) {
        void showAlertModal(result?.error || "Print failed.");
      }
    });
    return;
  }
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    void showAlertModal("Print window was blocked. Allow pop-ups for this site, then try again.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 300);
}

function openLogsPrintPreview() {
  bumpMainModalZ();
  if (modalCard) {
    modalCard.classList.add("modal-card-wide");
  }
  modalTitle.textContent = "Print Preview — Issuance Logs";
  const generated = escapeHtml(new Date().toLocaleString());
  const period = escapeHtml(currentLogsPeriodText());
  modalForm.innerHTML = `
    <div class="print-preview-scroll">
      <div class="print-preview-canvas">
        <article class="print-page">
          <h1>CCRO — Issuance Logs (${period})</h1>
          <div class="meta">Generated: ${generated}</div>
          ${buildLogsPrintTableHtml()}
        </article>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost-btn" id="print-preview-close">Close</button>
      <button type="button" class="secondary-btn" id="print-preview-print-only">Print</button>
    </div>
  `;
  modalOverlay.classList.remove("hidden");
  modalForm.onsubmit = (e) => e.preventDefault();
  onModalClosed = null;

  document.getElementById("print-preview-close").addEventListener("click", closeModal);
  document.getElementById("print-preview-print-only").addEventListener("click", () => {
    runLogsPrint();
  });
}

function openEditItemModal(item) {
  openModal(
    "Edit Item",
    `
      <div>
        <label>Description / Item Name</label>
        <input name="itemName" value="${escapeHtml(item.item_name)}" required />
      </div>
      <div>
        <label>Unit Cost (PHP)</label>
        <input name="unitCost" type="number" min="0" step="0.01" value="${Number(item.unit_cost)}" required />
      </div>
      <p class="muted">Quantity and unit of measure are updated using Add Stock or Adjust.</p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="primary-btn">Save Changes</button>
      </div>
    `,
    async (formData) => {
      try {
        await request("/api/inventory/update", {
          method: "POST",
          body: JSON.stringify({
            itemId: item.id,
            itemName: formData.get("itemName"),
            unitCost: Number(formData.get("unitCost"))
          })
        });
        closeModal();
        await refreshInventory();
      } catch (err) {
        await showAlertModal(err.message);
      }
    }
  );

  document.getElementById("cancel-btn").addEventListener("click", closeModal);
}

function parseIssuedDate(value) {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function currentLogsPeriodText() {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const selectedMonth = logsMonthFilter ? logsMonthFilter.value : "";
  const selectedYear = logsYearFilter ? logsYearFilter.value : "";
  if (selectedMonth === "" && selectedYear === "") return "All Time";
  const monthText = selectedMonth === "" ? "" : monthNames[Number(selectedMonth)] || "";
  const yearText = selectedYear === "" ? "" : selectedYear;
  return [monthText, yearText].filter(Boolean).join(" ").trim() || "All Time";
}

function renderLogsTitlePeriod() {
  if (!logsPeriodLabel) return;
  logsPeriodLabel.textContent = ` (${currentLogsPeriodText()})`;
}

function updateLogsYearOptions() {
  if (!logsYearFilter) return;
  const existing = logsYearFilter.value || "";
  const years = Array.from(
    new Set(
      logsCache
        .map((row) => parseIssuedDate(row.issued_at))
        .filter((dt) => dt)
        .map((dt) => String(dt.getFullYear()))
    )
  ).sort((a, b) => Number(b) - Number(a));

  logsYearFilter.innerHTML =
    `<option value=""></option>` + years.map((year) => `<option value="${year}">${year}</option>`).join("");

  logsYearFilter.value = years.includes(existing) ? existing : "";
}

function getFilteredLogsRows() {
  const selectedMonth = logsMonthFilter ? logsMonthFilter.value : "";
  const selectedYear = logsYearFilter ? logsYearFilter.value : "";
  return logsCache.filter((row) => {
    const dt = parseIssuedDate(row.issued_at);
    if (!dt) return false;
    if (selectedMonth !== "" && dt.getMonth() !== Number(selectedMonth)) return false;
    if (selectedYear !== "" && dt.getFullYear() !== Number(selectedYear)) return false;
    return true;
  });
}

function renderLogsRows() {
  renderLogsTitlePeriod();
  const rows = getFilteredLogsRows();
  logsBody.innerHTML =
    rows.length === 0
      ? `<tr><td colspan="6" class="muted">No issuance logs found for selected filters.</td></tr>`
      : rows
          .map(
            (row) => `<tr>
      <td>${escapeHtml(row.item_name)}</td>
      <td>${formatInventoryQuantity(row.quantity)}</td>
      <td>${formatInventoryUom(row.unit_of_measure)}</td>
      <td>${escapeHtml(row.person_id)}</td>
      <td>${escapeHtml(row.person_name)}</td>
      <td>${new Date(row.issued_at).toLocaleString()}</td>
    </tr>`
          )
          .join("");
}

async function refreshLogs() {
  logsCache = await request("/api/logs");
  updateLogsYearOptions();
  renderLogsRows();
}

function setAdminUiState() {
  if (isAdmin) {
    authState.textContent = "Logged in as admin";
    adminContent.classList.remove("hidden");
    addNewItemBtn.classList.remove("hidden");
    addItemSearchInput.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
  } else if (needsSetup) {
    authState.textContent = "Administrator not configured";
    adminContent.classList.add("hidden");
    addNewItemBtn.classList.add("hidden");
    addItemSearchInput.classList.add("hidden");
    addItemSearchTerm = "";
    addItemSearchInput.value = "";
    logoutBtn.classList.add("hidden");
  } else {
    authState.textContent = "Not logged in";
    adminContent.classList.add("hidden");
    addNewItemBtn.classList.add("hidden");
    addItemSearchInput.classList.add("hidden");
    addItemSearchTerm = "";
    addItemSearchInput.value = "";
    logoutBtn.classList.add("hidden");
  }
}

async function loadSession() {
  const session = await request("/api/session");
  isAdmin = Boolean(session.isAdmin);
  needsSetup = Boolean(session.needsSetup);
  setAdminUiState();
}

async function logoutAdminSession() {
  try {
    await request("/api/logout", { method: "POST" });
  } catch (err) {
    // Ignore logout errors in UI flow.
  }
  isAdmin = false;
  try {
    await loadSession();
  } catch (err) {
    needsSetup = false;
    setAdminUiState();
  }
}

function openSetupAdminModal(onSuccess) {
  openModal(
    "Create administrator account",
    `
      <p class="muted">This is a one-time setup. Choose a username and password for Inventory Management.</p>
      <div>
        <label>Username</label>
        <input name="username" required minlength="3" maxlength="64" autocomplete="username" />
      </div>
      <div>
        <label>Password</label>
        <input name="password" type="password" required minlength="8" autocomplete="new-password" />
      </div>
      <div>
        <label>Confirm password</label>
        <input name="passwordConfirm" type="password" required minlength="8" autocomplete="new-password" />
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="primary-btn">Create account</button>
      </div>
    `,
    async (formData) => {
      try {
        await request("/api/setup-admin", {
          method: "POST",
          body: JSON.stringify({
            username: formData.get("username"),
            password: formData.get("password"),
            passwordConfirm: formData.get("passwordConfirm")
          })
        });
        isAdmin = true;
        needsSetup = false;
        setAdminUiState();
        closeModal();
        if (typeof onSuccess === "function") onSuccess();
      } catch (err) {
        await showAlertModal(err.message);
      }
    }
  );

  document.getElementById("cancel-btn").addEventListener("click", closeModal);
}

function openAdminLoginModal(onSuccess) {
  openModal(
    "Admin Login Required",
    `
      <p class="muted">Inventory Management is restricted to admin users.</p>
      <div>
        <label>Username</label>
        <input name="username" required />
      </div>
      <div>
        <label>Password</label>
        <input name="password" type="password" required />
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="primary-btn">Log in</button>
      </div>
    `,
    async (formData) => {
      try {
        await request("/api/login", {
          method: "POST",
          body: JSON.stringify({
            username: formData.get("username"),
            password: formData.get("password")
          })
        });
        isAdmin = true;
        setAdminUiState();
        closeModal();
        if (typeof onSuccess === "function") onSuccess();
      } catch (err) {
        await showAlertModal("Invalid admin credentials.");
      }
    }
  );

  document.getElementById("cancel-btn").addEventListener("click", closeModal);
}

menuItems.forEach((item) => {
  item.addEventListener("click", async () => {
    const targetView = item.dataset.view;
    if (targetView === currentView) return;

    if (currentView === "add-item" && targetView !== "add-item" && isAdmin) {
      const shouldLeave = await openConfirmationModal(
        "Leave Inventory Management",
        "Do you want to leave Inventory Management? Your admin session will be logged out.",
        "Leave Page"
      );
      if (!shouldLeave) return;
      await logoutAdminSession();
    }

    if (targetView === "add-item" && !isAdmin) {
      if (needsSetup) {
        openSetupAdminModal(() => showView("add-item"));
      } else {
        openAdminLoginModal(() => showView("add-item"));
      }
      return;
    }

    showView(targetView);
  });
});

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

inventoryBody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-checkout-id]");
  if (!btn) return;

  const itemId = Number(btn.dataset.checkoutId);
  const item = inventoryCache.find((row) => Number(row.id) === itemId);
  if (!item) return;

  const available = availableStockNumber(item);
  const availableLabel = formatInventoryQuantity(item.quantity) || String(available);

  openModal(
    `Check-Out: ${item.item_name}`,
    `
      <div>
        <label>ID Number</label>
        <input name="personId" required />
      </div>
      <div>
        <label>Name</label>
        <input name="personName" required />
      </div>
      <div class="row">
        <div>
          <label>Amount</label>
          <input
            name="quantity"
            id="checkout-quantity"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            required
          />
          <p id="checkout-qty-hint" class="checkout-qty-hint muted hidden" role="status"></p>
        </div>
        <div>
          <label>Unit of Measure</label>
          <input value="${escapeHtml(item.unit_of_measure || "")}" readonly />
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="primary-btn">Check-Out</button>
      </div>
    `,
    async (formData) => {
      const quantity = parseCheckoutWholeQuantity(formData.get("quantity"));
      if (!Number.isFinite(quantity) || quantity < 1) {
        await showAlertModal("Enter a whole number amount of at least 1.");
        return;
      }
      if (Number.isFinite(available) && quantity > available) {
        await showAlertModal(`Only ${availableLabel} available in stock.`);
        return;
      }
      try {
        await request("/api/checkout", {
          method: "POST",
          body: JSON.stringify({
            itemId,
            personId: formData.get("personId"),
            personName: formData.get("personName"),
            quantity
          })
        });
        closeModal();
        await Promise.all([refreshInventory(), refreshLogs()]);
      } catch (err) {
        await showAlertModal(err.message);
      }
    }
  );

  const qtyInput = document.getElementById("checkout-quantity");
  const qtyHint = document.getElementById("checkout-qty-hint");
  if (qtyInput && qtyHint) {
    const syncAmountField = () => {
      const cleaned = qtyInput.value.replace(/\D/g, "");
      if (qtyInput.value !== cleaned) qtyInput.value = cleaned;
    };
    const updateQtyHint = () => {
      syncAmountField();
      const n = parseCheckoutWholeQuantity(qtyInput.value);
      if (!Number.isFinite(available) || !Number.isFinite(n)) {
        qtyHint.classList.add("hidden");
        return;
      }
      if (n > available) {
        qtyHint.textContent = `Only ${availableLabel} available in stock. Enter ${availableLabel} or less.`;
        qtyHint.classList.remove("hidden");
      } else {
        qtyHint.classList.add("hidden");
      }
    };
    qtyInput.addEventListener("input", updateQtyHint);
    qtyInput.addEventListener("blur", updateQtyHint);
    updateQtyHint();
  }

  const cancelBtn = document.getElementById("cancel-btn");
  cancelBtn.addEventListener("click", closeModal);
});

function focusAndSelectAmountInput(inputId) {
  const amountInput = document.getElementById(inputId);
  if (amountInput) {
    amountInput.focus();
    amountInput.select();
  }
}

function openAddStockModal(itemId, uom) {
  openModal(
    "Add Stock",
    `
      <div class="row modal-stock-row">
        <div>
          <label>Amount</label>
          <input
            id="add-stock-amount"
            class="amount-large"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            autofocus
          />
        </div>
        <div class="uom-compact">
          <label>Unit of Measure</label>
          <input value="${escapeHtml(uom)}" readonly disabled />
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="primary-btn">Save</button>
      </div>
    `,
    async (formData) => {
      try {
        await request("/api/inventory/add-stock", {
          method: "POST",
          body: JSON.stringify({
            itemId,
            amount: Number(formData.get("amount"))
          })
        });
        closeModal();
        await refreshInventory();
      } catch (err) {
        await showAlertModal(err.message);
      }
    }
  );

  focusAndSelectAmountInput("add-stock-amount");
  document.getElementById("cancel-btn").addEventListener("click", closeModal);
}

function openDeductStockModal(itemId, uom) {
  openModal(
    "Deduct Stock",
    `
      <div class="row modal-stock-row">
        <div>
          <label>Amount</label>
          <input
            id="deduct-stock-amount"
            class="amount-large"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            autofocus
          />
        </div>
        <div class="uom-compact">
          <label>Unit of Measure</label>
          <input value="${escapeHtml(uom)}" readonly disabled />
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="primary-btn">Deduct</button>
      </div>
    `,
    async (formData) => {
      try {
        await request("/api/inventory/adjust", {
          method: "POST",
          body: JSON.stringify({
            itemId,
            amount: Number(formData.get("amount"))
          })
        });
        closeModal();
        await refreshInventory();
      } catch (err) {
        await showAlertModal(err.message);
      }
    }
  );

  focusAndSelectAmountInput("deduct-stock-amount");
  document.getElementById("cancel-btn").addEventListener("click", closeModal);
}

async function confirmDeleteInventoryItem(item) {
  const ok = await openConfirmationModal(
    "Delete Item",
    `Permanently remove "${item.item_name}" from inventory? This cannot be undone.`,
    "Delete"
  );
  if (!ok) return;
  try {
    await request("/api/inventory/delete-item", {
      method: "POST",
      body: JSON.stringify({ itemId: item.id })
    });
    await refreshInventory();
  } catch (err) {
    await showAlertModal(err.message);
  }
}

addItemBody.addEventListener("click", (e) => {
  if (!isAdmin) return;

  const plusBtn = e.target.closest("[data-addstock-id]");
  if (plusBtn) {
    const itemId = Number(plusBtn.dataset.addstockId);
    const uom = plusBtn.dataset.uom || "";
    openAddStockModal(itemId, uom);
    return;
  }

  const deductBtn = e.target.closest("[data-deduct-id]");
  if (deductBtn) {
    const itemId = Number(deductBtn.dataset.deductId);
    const uom = deductBtn.dataset.uom || "";
    openDeductStockModal(itemId, uom);
    return;
  }

  const deleteBtn = e.target.closest("[data-delete-id]");
  if (deleteBtn) {
    const itemId = Number(deleteBtn.dataset.deleteId);
    const item = inventoryCache.find((row) => Number(row.id) === itemId);
    if (item) confirmDeleteInventoryItem(item);
    return;
  }

  const editBtn = e.target.closest("[data-edit-id]");
  if (editBtn) {
    const itemId = Number(editBtn.dataset.editId);
    const item = inventoryCache.find((row) => Number(row.id) === itemId);
    if (item) openEditItemModal(item);
  }
});

addNewItemBtn.addEventListener("click", () => {
  if (!isAdmin) return;
  openModal(
    "Add New Item",
    `
      <div>
        <label>Description / Item Name</label>
        <input name="itemName" required />
      </div>
      <div class="row">
        <div>
          <label>Unit Cost</label>
          <input name="unitCost" type="number" min="0" step="0.01" required />
        </div>
        <div>
          <label>Quantity</label>
          <input name="quantity" type="number" min="0.01" step="0.01" required />
        </div>
      </div>
      <div>
        <label>Unit of Measure</label>
        <input name="unitOfMeasure" required />
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="primary-btn">Add Item</button>
      </div>
    `,
    async (formData) => {
      try {
        await request("/api/inventory/new-item", {
          method: "POST",
          body: JSON.stringify({
            itemName: formData.get("itemName"),
            unitCost: Number(formData.get("unitCost")),
            quantity: Number(formData.get("quantity")),
            unitOfMeasure: formData.get("unitOfMeasure")
          })
        });
        closeModal();
        await refreshInventory();
      } catch (err) {
        await showAlertModal(err.message);
      }
    }
  );

  document.getElementById("cancel-btn").addEventListener("click", closeModal);
});

addItemSearchInput.addEventListener("input", () => {
  addItemSearchTerm = addItemSearchInput.value.trim();
  renderInventoryRows();
});

if (logsMonthFilter) {
  logsMonthFilter.addEventListener("change", () => {
    renderLogsRows();
  });
}

if (logsYearFilter) {
  logsYearFilter.addEventListener("change", () => {
    renderLogsRows();
  });
}

logoutBtn.addEventListener("click", async () => {
  await logoutAdminSession();
  if (currentView === "add-item") {
    showView("inventory");
  }
});

if (printPreviewBtn) {
  printPreviewBtn.addEventListener("click", () => openInventoryPrintPreview());
}
if (printPreviewLogsBtn) {
  printPreviewLogsBtn.addEventListener("click", () => openLogsPrintPreview());
}

async function bootstrap() {
  try {
    await loadSession();
    await Promise.all([refreshInventory(), refreshLogs()]);
    showView("inventory");
  } catch (err) {
    await showAlertModal(`App failed to load: ${err.message}`, "Error");
  }
}

bootstrap();
