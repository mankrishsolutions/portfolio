const WORKER_BASE = "https://tickerprice.mankrishsolutions.workers.dev";
const THEME_KEY = "portfolio_theme_mode";
const VIEW_MODE_KEY = "portfolio_last_view_mode"; // 'CONSOLIDATED' or 'ACCOUNT'
const LAST_ACCOUNT_KEY = "portfolio_last_selected_account";

let holdings = [];
let accounts = [];
let activeAccount = "";
let currentViewMode = "CONSOLIDATED"; // Default view
let computedData = [];
let isFetching = false;
let autoRefreshInterval = null;

// Sorting state
let currentSortCol = 'totalDiff';
let currentSortAsc = false;

// 4. Save and Apply View Settings
function saveViewSettings() {
    localStorage.setItem(VIEW_MODE_KEY, currentViewMode);
    if (activeAccount) {
        localStorage.setItem(LAST_ACCOUNT_KEY, activeAccount);
    }
}

function loadViewSettings() {
    const savedMode = localStorage.getItem(VIEW_MODE_KEY);
    const savedAccount = localStorage.getItem(LAST_ACCOUNT_KEY);

    if (savedMode === "ACCOUNT" && savedAccount && accounts.includes(savedAccount)) {
        selectAccount(savedAccount);
    } else {
        showConsolidatedDefaultView();
    }
}

// Show Consolidated Overview (Hides detail table)
function showConsolidatedDefaultView() {
    currentViewMode = "CONSOLIDATED";
    saveViewSettings();

    document.getElementById("consolidated-section").classList.remove("hidden");
    document.getElementById("holdings-section").classList.add("hidden");
    renderConsolidatedCards();
}

// Show Specific Account Holdings (Hides consolidated cards)
function showAccountHoldingsView() {
    currentViewMode = "ACCOUNT";
    saveViewSettings();

    document.getElementById("consolidated-section").classList.add("hidden");
    document.getElementById("holdings-section").classList.remove("hidden");
}

// Toggle Tools Dropdown Menu
function toggleSettingsMenu(forceState) {
    const menu = document.getElementById("settings-dropdown");
    const isHidden = forceState !== undefined ? !forceState : menu.classList.contains("hidden");
    if (isHidden) {
        menu.classList.remove("hidden");
    } else {
        menu.classList.add("hidden");
    }
}

// Close settings dropdown when clicking outside
document.addEventListener("click", function (e) {
    const btn = document.getElementById("btn-settings-menu");
    const menu = document.getElementById("settings-dropdown");
    if (btn && menu && !btn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.add("hidden");
    }
});

// Left Performance Drawer Controller
function togglePerformanceDrawer(open) {
    const drawer = document.getElementById("performance-drawer");
    const backdrop = document.getElementById("drawer-backdrop");
    if (open) {
        drawer.classList.remove("-translate-x-full");
        backdrop.classList.remove("hidden");
    } else {
        drawer.classList.add("-translate-x-full");
        backdrop.classList.add("hidden");
    }
}

// Theme Management
function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || "dark";
    applyTheme(saved === "dark");
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
    applyTheme(isDark);
}

function applyTheme(isDark) {
    if (isDark) {
        document.documentElement.classList.add("dark");
        document.getElementById("theme-menu-icon").innerText = "☀️";
        document.getElementById("theme-menu-label").innerText = "Dark";
    } else {
        document.documentElement.classList.remove("dark");
        document.getElementById("theme-menu-icon").innerText = "🌙";
        document.getElementById("theme-menu-label").innerText = "Light";
    }
}

// Toggle Add Form
function toggleAddForm(forceState) {
    const panel = document.getElementById("add-form-panel");
    const isHidden = forceState !== undefined ? !forceState : panel.classList.contains("hidden");

    if (isHidden) {
        updateAccountOptions();
        if (activeAccount) {
            document.getElementById("input-account").value = activeAccount;
        }
        panel.classList.remove("hidden");
        document.getElementById("input-symbol").focus();
    } else {
        panel.classList.add("hidden");
    }
}

// Account Switcher
function selectAccount(acc) {
    activeAccount = acc;
    document.getElementById("drawer-account-label").innerText = activeAccount || "--";
    showAccountHoldingsView();
    renderAccountTabs();
    renderDashboard();
}

// Create New Account
function promptAddAccount() {
    const name = prompt("Enter new account name (e.g. ZERODHA_2):");
    if (!name) return;
    const cleanName = name.trim().toUpperCase();
    if (!cleanName) return;
    if (!accounts.includes(cleanName)) {
        accounts.push(cleanName);
    }
    selectAccount(cleanName);
    saveToCloud(holdings);
}

// Rename Active Account
async function renameActiveAccount() {
    const currentName = activeAccount;
    if (!currentName) return;

    const newName = prompt(`Enter new name for account "${currentName}":`, currentName);
    if (!newName) return;
    const cleanName = newName.trim().toUpperCase();
    if (!cleanName || cleanName === currentName) return;

    if (accounts.includes(cleanName)) {
        alert(`An account named "${cleanName}" already exists!`);
        return;
    }

    holdings.forEach(item => {
        if (item.account === currentName) {
            item.account = cleanName;
        }
    });

    const idx = accounts.indexOf(currentName);
    if (idx !== -1) accounts[idx] = cleanName;

    activeAccount = cleanName;
    saveViewSettings();

    await saveToCloud(holdings);
    document.getElementById("drawer-account-label").innerText = activeAccount;
    renderAccountTabs();
    renderDashboard();
    renderConsolidatedCards();
}

// Delete Active Account
async function deleteActiveAccount() {
    const currentName = activeAccount;
    if (!currentName) return;

    if (accounts.length <= 1) {
        alert("You must have at least one account in your portfolio.");
        return;
    }

    const count = holdings.filter(item => item.account === currentName).length;
    if (count > 0) {
        alert(`Cannot delete account "${currentName}" because it holds ${count} position(s). Delete or move them first.`);
        return;
    }

    if (!confirm(`Are you sure you want to delete empty account "${currentName}"?`)) {
        return;
    }

    accounts = accounts.filter(acc => acc !== currentName);
    activeAccount = accounts[0];
    saveViewSettings();

    await saveToCloud(holdings);
    showConsolidatedDefaultView();
    renderAccountTabs();
}

// Render Account Selector Tabs
function renderAccountTabs() {
    const container = document.getElementById("account-tabs-container");
    let tabsHtml = "";

    accounts.forEach(acc => {
        const isCurrent = acc === activeAccount && currentViewMode === "ACCOUNT";
        const count = holdings.filter(h => h.account === acc).length;

        if (isCurrent) {
            tabsHtml += `
        <button onclick="selectAccount('${acc}')" class="px-3 py-1 rounded-lg bg-indigo-600 text-white font-mono font-bold text-xs shadow-sm flex items-center gap-1.5 transition">
          <span>${acc}</span>
          <span class="bg-indigo-700 text-[10px] px-1.5 py-0.2 rounded-full">${count}</span>
        </button>
      `;
        } else {
            tabsHtml += `
        <button onclick="selectAccount('${acc}')" class="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono font-semibold text-xs border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition">
          <span>${acc}</span>
          <span class="text-slate-400 text-[10px]">${count}</span>
        </button>
      `;
        }
    });

    container.innerHTML = tabsHtml;
}

function updateAccountOptions() {
    const select = document.getElementById("input-account");
    select.innerHTML = accounts.map(a => `<option value="${a}">${a}</option>`).join("");
}

// Cloudflare KV Read
async function syncFromCloud() {
    try {
        const res = await fetch(`${WORKER_BASE}/holdings?t=${Date.now()}`);
        if (!res.ok) throw new Error("Cloud fetch failed");
        const data = await res.json();

        const rawHoldings = Array.isArray(data) ? data : [];

        const discovered = new Set();
        rawHoldings.forEach(h => {
            if (h.account && h.account.trim()) {
                discovered.add(h.account.trim().toUpperCase());
            }
        });

        if (discovered.size === 0) {
            discovered.add("VM6747");
        }

        accounts = Array.from(discovered);
        const fallbackAccount = accounts[0];

        holdings = rawHoldings.map(item => ({
            ...item,
            account: item.account && item.account.trim() ? item.account.trim().toUpperCase() : fallbackAccount
        }));

        if (!activeAccount || !accounts.includes(activeAccount)) {
            activeAccount = accounts[0];
        }

        document.getElementById("drawer-account-label").innerText = activeAccount;
        renderAccountTabs();
        await refreshAllPrices();
        loadViewSettings();
    } catch (err) {
        console.error("KV Read Error:", err);
    }
}

// Cloudflare KV Write
async function saveToCloud(updatedHoldings) {
    try {
        await fetch(`${WORKER_BASE}/holdings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedHoldings)
        });
    } catch (err) {
        alert("Failed to save holdings to Cloudflare KV.");
    }
}

const fmtInr = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtVol = (n) => n > 100000 ? (n / 100000).toFixed(2) + " L" : Number(n).toLocaleString("en-IN");

// Fetch quote helper
async function fetchQuote(symbol) {
    try {
        const res = await fetch(`${WORKER_BASE}/?symbol=${encodeURIComponent(symbol)}`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

// Update Header Indices
function updateTickerBadge(prefix, quote) {
    if (!quote || quote.ltp === undefined) return;
    const ltp = quote.ltp;
    const prev = quote.previousClose || ltp;
    const diff = ltp - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;
    const isPos = diff >= 0;

    const ltpElem = document.getElementById(`${prefix}-ltp`);
    const chgElem = document.getElementById(`${prefix}-chg`);

    if (ltpElem) {
        ltpElem.innerText = `₹${ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (chgElem) {
        const sign = isPos ? "+" : "";
        chgElem.innerText = `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
        chgElem.className = `font-mono text-[11px] font-extrabold text-right mt-0.5 ${isPos ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`;
    }
}

// Refresh Macro Indices & Commodities in INR
function refreshMacroTickers() {
    fetchQuote("NIFTY_50").then(q => updateTickerBadge("idx-nifty", q));
    fetchQuote("BANK_NIFTY").then(q => updateTickerBadge("idx-banknifty", q));
    fetchQuote("MIDCAP_50").then(q => updateTickerBadge("idx-midcap", q));
    fetchQuote("GOLD").then(q => updateTickerBadge("idx-gold", q));
    fetchQuote("SILVER").then(q => updateTickerBadge("idx-silver", q));
}

// Add position
async function addStock(e) {
    e.preventDefault();
    const targetAccount = document.getElementById("input-account").value || activeAccount;
    const symInput = document.getElementById("input-symbol");
    const qtyInput = document.getElementById("input-qty");
    const priceInput = document.getElementById("input-price");
    const saveBtn = document.getElementById("save-btn");

    const symbol = symInput.value.trim().toUpperCase();
    const bq = parseFloat(qtyInput.value);
    const price = parseFloat(priceInput.value);

    if (!symbol || isNaN(bq) || isNaN(price)) return;

    saveBtn.innerText = "Saving...";
    saveBtn.disabled = true;

    holdings.push({
        id: Date.now().toString(),
        account: targetAccount,
        symbol: symbol,
        bq: bq,
        price: price
    });

    if (!accounts.includes(targetAccount)) {
        accounts.push(targetAccount);
    }

    await saveToCloud(holdings);

    symInput.value = "";
    qtyInput.value = "";
    priceInput.value = "";
    saveBtn.innerText = "Save Position";
    saveBtn.disabled = false;
    toggleAddForm(false);

    selectAccount(targetAccount);
    refreshAllPrices();
}

// Remove position
async function removeStock(id) {
    if (!confirm("Delete position?")) return;
    holdings = holdings.filter(item => item.id !== id);
    await saveToCloud(holdings);
    renderAccountTabs();
    refreshAllPrices();
}

// Sort Column Trigger
function sortTable(column) {
    if (currentSortCol === column) {
        currentSortAsc = !currentSortAsc;
    } else {
        currentSortCol = column;
        currentSortAsc = true;
    }
    renderDashboard();
}

// Main Price Sync
async function refreshAllPrices() {
    if (isFetching) return;
    isFetching = true;

    const indicator = document.getElementById("refresh-indicator");
    indicator.className = "w-2 h-2 rounded-full bg-emerald-500 animate-ping";

    refreshMacroTickers();

    const uniqueSymbols = Array.from(new Set(holdings.map(h => h.symbol)));

    try {
        const quoteResults = await Promise.all(uniqueSymbols.map(s => fetchQuote(s)));
        const quoteMap = {};
        uniqueSymbols.forEach((sym, idx) => {
            quoteMap[sym] = quoteResults[idx];
        });

        computedData = holdings.map(item => {
            const q = quoteMap[item.symbol];
            const ltp = q?.ltp || item.price;
            const prevClose = q?.previousClose || ltp;
            const high52 = q?.high52 || 0;
            const low52 = q?.low52 || 0;
            const vol = q?.volume || 0;

            const buyValue = item.bq * item.price;
            const currValue = item.bq * ltp;
            const prevValue = item.bq * prevClose;

            const totalDiff = currValue - buyValue;
            const totalPct = (totalDiff / buyValue) * 100;
            const todayPct = ((ltp - prevClose) / prevClose) * 100;
            const from52Pct = high52 > 0 ? ((ltp - high52) / high52) * 100 : 0;

            return {
                ...item,
                ltp,
                prevClose,
                high52,
                low52,
                vol,
                buyValue,
                currValue,
                prevValue,
                totalDiff,
                totalPct,
                todayPct,
                from52Pct
            };
        });

        renderAccountTabs();
        if (currentViewMode === "CONSOLIDATED") {
            renderConsolidatedCards();
        } else {
            renderDashboard();
        }
    } catch (err) {
        console.error("Refresh error:", err);
    } finally {
        isFetching = false;
        indicator.className = "w-2 h-2 rounded-full bg-slate-400";
    }
}

// 3. Render Consolidated Overview & Interactive Account Cards
function renderConsolidatedCards() {
    let grandInvested = 0;
    let grandCurrent = 0;
    let grandPrev = 0;

    let cardsHtml = "";

    accounts.forEach(acc => {
        const accItems = computedData.filter(i => i.account === acc);
        let accInv = 0;
        let accCur = 0;
        let accPre = 0;

        accItems.forEach(it => {
            accInv += it.buyValue;
            accCur += it.currValue;
            accPre += it.prevValue;
        });

        grandInvested += accInv;
        grandCurrent += accCur;
        grandPrev += accPre;

        const accPnl = accCur - accInv;
        const accPct = accInv > 0 ? (accPnl / accInv) * 100 : 0;
        const accToday = accCur - accPre;

        const pnlCol = accPnl >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400";
        const todayCol = accToday >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400";

        cardsHtml += `
      <div onclick="selectAccount('${acc}')" class="group bg-slate-50 dark:bg-slate-950/80 hover:bg-indigo-50/50 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-xl p-4 cursor-pointer transition shadow-sm space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 font-bold text-sm text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
            <span>📁</span>
            <span>${acc}</span>
          </div>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
            ${accItems.length} stocks
          </span>
        </div>

        <div>
          <div class="text-[10px] uppercase font-bold text-slate-400">Current Value</div>
          <div class="text-base font-extrabold text-slate-900 dark:text-white font-mono mt-0.5">${fmtInr(accCur)}</div>
        </div>

        <div class="pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-xs font-mono">
          <div>
            <span class="text-slate-400 text-[10px]">Total P&L</span>
            <div class="font-bold ${pnlCol}">${accPnl >= 0 ? '+' : ''}${fmtInr(accPnl)} (${accPct.toFixed(2)}%)</div>
          </div>
          <div class="text-right">
            <span class="text-slate-400 text-[10px]">Today</span>
            <div class="font-bold ${todayCol}">${accToday >= 0 ? '+' : ''}${fmtInr(accToday)}</div>
          </div>
        </div>
      </div>
    `;
    });

    const grandTotalPnl = grandCurrent - grandInvested;
    const grandTotalPct = grandInvested > 0 ? (grandTotalPnl / grandInvested) * 100 : 0;
    const grandTodayPnl = grandCurrent - grandPrev;

    const grandColor = grandTotalPnl >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400";
    const grandTodayColor = grandTodayPnl >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400";

    document.getElementById("c-kpi-invested").innerText = fmtInr(grandInvested);
    document.getElementById("c-kpi-current").innerText = fmtInr(grandCurrent);

    const cPnlElem = document.getElementById("c-kpi-total-pnl");
    cPnlElem.innerText = `${grandTotalPnl >= 0 ? '+' : ''}${fmtInr(grandTotalPnl)}`;
    cPnlElem.className = `font-black text-base sm:text-lg mt-0.5 ${grandColor}`;

    const cPctElem = document.getElementById("c-kpi-total-pct");
    cPctElem.innerText = `${grandTotalPnl >= 0 ? '+' : ''}${grandTotalPct.toFixed(2)}%`;
    cPctElem.className = `text-[11px] font-bold ${grandColor}`;

    const cTodayElem = document.getElementById("c-kpi-today-pnl");
    cTodayElem.innerText = `${grandTodayPnl >= 0 ? '+' : ''}${fmtInr(grandTodayPnl)}`;
    cTodayElem.className = `font-black text-base sm:text-lg mt-0.5 ${grandTodayColor}`;

    document.getElementById("account-cards-grid").innerHTML = cardsHtml || `<div class="col-span-4 text-center py-6 text-slate-400">No accounts created.</div>`;
}

// Render Holdings Table for Active Account
function renderDashboard() {
    const accountHoldings = computedData.filter(item => item.account === activeAccount);

    accountHoldings.sort((a, b) => {
        let valA = a[currentSortCol];
        let valB = b[currentSortCol];

        if (typeof valA === "string") {
            return currentSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return currentSortAsc ? valA - valB : valB - valA;
    });

    const sortHeaders = ['symbol', 'bq', 'price', 'buyValue', 'ltp', 'currValue', 'totalDiff', 'todayPct', 'from52Pct'];
    sortHeaders.forEach(col => {
        const span = document.getElementById(`sort-${col}`);
        if (span) {
            span.innerText = currentSortCol === col ? (currentSortAsc ? '↑' : '↓') : '';
        }
    });

    let totalInvested = 0;
    let totalCurrent = 0;
    let totalPrevClose = 0;

    let desktopHtml = "";
    let mobileHtml = "";

    accountHoldings.forEach((item, i) => {
        totalInvested += item.buyValue;
        totalCurrent += item.currValue;
        totalPrevClose += item.prevValue;

        const isPositive = item.totalDiff >= 0;
        const isTodayPos = item.todayPct >= 0;

        const totalColor = isPositive ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400";
        const todayBadge = isTodayPos
            ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40"
            : "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40";

        desktopHtml += `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
        <td class="py-2.5 px-3 text-slate-400 text-xs">${i + 1}</td>
        <td class="py-2.5 px-3 font-sans font-bold text-slate-900 dark:text-slate-100 text-[13.5px]">${item.symbol}</td>
        <td class="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">${item.bq}</td>
        <td class="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">₹${item.price.toFixed(2)}</td>
        <td class="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">${fmtInr(item.buyValue)}</td>
        <td class="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-white">₹${item.ltp.toFixed(2)}</td>
        <td class="py-2.5 px-3 text-right font-semibold text-slate-800 dark:text-slate-200">${fmtInr(item.currValue)}</td>
        <td class="py-2.5 px-3 text-right">
          <div class="font-bold ${totalColor}">${isPositive ? '+' : ''}${fmtInr(item.totalDiff)}</div>
          <div class="text-[11px] ${totalColor} opacity-90">${isPositive ? '+' : ''}${item.totalPct.toFixed(2)}%</div>
        </td>
        <td class="py-2.5 px-3 text-right">
          <span class="font-bold px-2 py-0.5 rounded text-xs inline-block ${todayBadge}">
            ${isTodayPos ? '+' : ''}${item.todayPct.toFixed(2)}%
          </span>
        </td>
        <td class="py-2.5 px-3 text-right text-xs">
          <div class="${item.from52Pct < 0 ? 'text-rose-400' : 'text-slate-400'}">${item.from52Pct ? item.from52Pct.toFixed(2) + '%' : '--'}</div>
          <div class="text-[10px] text-slate-500">H: ${item.high52 ? item.high52.toFixed(2) : '--'}</div>
        </td>
        <td class="py-2.5 px-3 text-center font-sans">
          <button onclick="removeStock('${item.id}')" title="Delete" class="text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 p-1">✕</button>
        </td>
      </tr>
    `;

        mobileHtml += `
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm space-y-1.5">
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-500 dark:text-slate-400">Qty. ${item.bq} • Avg. ${item.price.toFixed(2)}</span>
          <span class="font-bold ${totalColor}">${isPositive ? '+' : ''}${item.totalPct.toFixed(2)}%</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-base text-slate-900 dark:text-white">${item.symbol}</span>
          <span class="font-extrabold text-base ${totalColor}">${isPositive ? '+' : ''}${fmtInr(item.totalDiff)}</span>
        </div>
        <div class="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
          <span class="text-slate-400">Invested ${fmtInr(item.buyValue)}</span>
          <div class="flex items-center gap-2">
            <span class="font-bold text-slate-800 dark:text-slate-200">LTP ${item.ltp.toFixed(2)}</span>
            <span class="text-xs font-semibold ${isTodayPos ? 'text-emerald-500' : 'text-rose-500'}">(${isTodayPos ? '+' : ''}${item.todayPct.toFixed(2)}%)</span>
            <button onclick="removeStock('${item.id}')" class="text-rose-400 hover:text-rose-600 pl-1 text-sm">✕</button>
          </div>
        </div>
      </div>
    `;
    });

    document.getElementById("portfolio-body").innerHTML = desktopHtml || `<tr><td colspan="11" class="text-center py-8 text-slate-400 font-sans">No positions found for <strong>${activeAccount}</strong>. Use "Tools > Add New Stock".</td></tr>`;
    document.getElementById("mobile-cards-container").innerHTML = mobileHtml || `<div class="text-center py-8 text-slate-400 font-sans">No positions found for <strong>${activeAccount}</strong>.</div>`;

    updateKPIs(totalInvested, totalCurrent, totalPrevClose);
    renderTopMovers(accountHoldings);
}

// Side Drawer Top Movers
function renderTopMovers(accountHoldings) {
    const container = document.getElementById("top-movers-list");
    if (!accountHoldings || accountHoldings.length === 0) {
        container.innerHTML = `<div class="text-slate-500">No positions in this account</div>`;
        return;
    }

    const sortedByToday = [...accountHoldings].sort((a, b) => b.todayPct - a.todayPct);
    const top3 = sortedByToday.slice(0, 3);
    const bottom1 = sortedByToday[sortedByToday.length - 1];

    let moversHtml = "";
    top3.forEach(s => {
        const isPos = s.todayPct >= 0;
        moversHtml += `
      <div class="flex items-center justify-between">
        <span class="font-bold text-slate-800 dark:text-slate-200">${s.symbol}</span>
        <span class="font-mono font-bold ${isPos ? 'text-emerald-500' : 'text-rose-500'}">${isPos ? '+' : ''}${s.todayPct.toFixed(2)}%</span>
      </div>
    `;
    });

    if (bottom1 && bottom1.todayPct < 0) {
        moversHtml += `
      <div class="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <span class="text-slate-400">Biggest Drag: <strong>${bottom1.symbol}</strong></span>
        <span class="font-mono font-bold text-rose-500">${bottom1.todayPct.toFixed(2)}%</span>
      </div>
    `;
    }

    container.innerHTML = moversHtml;
}

// Update Drawer KPIs
function updateKPIs(invested, current, prevClose) {
    const totalPnl = current - invested;
    const totalPct = invested > 0 ? (totalPnl / invested) * 100 : 0;
    const todayPnl = current - prevClose;

    const totalColor = totalPnl >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400';
    const todayColor = todayPnl >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400';

    document.getElementById("kpi-invested").innerText = fmtInr(invested);
    document.getElementById("kpi-current").innerText = fmtInr(current);

    const totalElem = document.getElementById("kpi-total-pnl");
    totalElem.innerText = `${totalPnl >= 0 ? '+' : ''}${fmtInr(totalPnl)}`;
    totalElem.className = `text-base font-extrabold text-right ${totalColor}`;

    const totalPctElem = document.getElementById("kpi-total-pct");
    totalPctElem.innerText = `${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}% overall`;
    totalPctElem.className = `text-[11px] font-bold ${totalColor}`;

    const todayElem = document.getElementById("kpi-today-pnl");
    todayElem.innerText = `${todayPnl >= 0 ? '+' : ''}${fmtInr(todayPnl)}`;
    todayElem.className = `text-base font-extrabold text-right ${todayColor}`;

    document.getElementById("kpi-prev-close").innerText = `Prev: ${fmtInr(prevClose)}`;
}

// Auto-refresh tick
function toggleAutoRefresh(start) {
    if (start) {
        refreshAllPrices();
        autoRefreshInterval = setInterval(refreshAllPrices, 1000);
    } else {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    }
}

// Backup JSON
function downloadPortfolioBackup() {
    if (!holdings || holdings.length === 0) {
        alert("No holdings found to export.");
        return;
    }

    const backupData = {
        exportedAt: new Date().toISOString(),
        accounts: accounts,
        totalPositions: holdings.length,
        holdings: holdings
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `portfolio_backup_${dateStr}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Import JSON
function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async function (e) {
        try {
            const parsed = JSON.parse(e.target.result);
            let importedHoldings = Array.isArray(parsed) ? parsed : parsed.holdings;

            if (!Array.isArray(importedHoldings) || importedHoldings.length === 0) {
                throw new Error("No valid holdings array found in backup file.");
            }

            if (!confirm(`Found ${importedHoldings.length} position(s). Restore and overwrite current portfolio in Cloud?`)) {
                event.target.value = "";
                return;
            }

            const discovered = new Set();
            importedHoldings.forEach(h => {
                const acc = (h.account && h.account.trim()) ? h.account.trim().toUpperCase() : "VM6747";
                h.account = acc;
                discovered.add(acc);
            });

            accounts = Array.from(discovered);
            activeAccount = accounts[0];
            holdings = importedHoldings;

            await saveToCloud(holdings);
            renderAccountTabs();
            await refreshAllPrices();
            showConsolidatedDefaultView();

            alert(`Restored ${holdings.length} positions across ${accounts.length} account(s).`);
        } catch (err) {
            alert("Import failed: " + err.message);
        } finally {
            event.target.value = "";
        }
    };

    reader.readAsText(file);
}

// Initialization
initTheme();
syncFromCloud();