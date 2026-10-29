const WORKER_BASE = "https://tickerprice.mankrishsolutions.workers.dev";
const THEME_KEY = "portfolio_theme_mode";
const VIEW_MODE_KEY = "portfolio_last_view_mode"; // 'CONSOLIDATED', 'ACCOUNT', or 'WATCHLIST'
const LAST_ACCOUNT_KEY = "portfolio_last_selected_account";

// Distinct Account Avatars / Icons
const ACCOUNT_ICONS = ["💼", "🏦", "🪙", "💳", "📊", "🏛️", "💰", "💎"];

// Dynamic Palette for Stock Avatar Badges
const LOGO_BG_COLORS = [
    "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-indigo-500", 
    "bg-rose-500", "bg-purple-500", "bg-teal-500", "bg-orange-500"
];

let holdings = [];
let accounts = [];
let activeAccount = "";
let currentViewMode = "CONSOLIDATED"; // Default view
let computedData = [];
let isFetching = false;
let autoRefreshInterval = null;

// Sorting state for Account Holdings Table
let currentSortCol = 'totalDiff';
let currentSortAsc = false;

// Sorting and Filter state for Watchlist Table
let wlSearchQuery = "";
let wlSortCol = 'symbol';
let wlSortAsc = true;

// Get distinct icon per account index
function getAccountIcon(accName) {
    const index = accounts.indexOf(accName);
    if (index === -1) return "💼";
    return ACCOUNT_ICONS[index % ACCOUNT_ICONS.length];
}

// Generate color-coded circle badge letter for stock
function getStockAvatar(symbol) {
    let charCode = 0;
    for (let i = 0; i < symbol.length; i++) charCode += symbol.charCodeAt(i);
    const colorClass = LOGO_BG_COLORS[charCode % LOGO_BG_COLORS.length];
    return `<div class="w-8 h-8 rounded-full ${colorClass} text-white flex items-center justify-center font-bold text-xs shadow-sm">${symbol.slice(0, 2)}</div>`;
}

// Generate intraday trend SVG sparkline
function generateSparklineSvg(isPositive) {
    const strokeColor = isPositive ? "#10b981" : "#f43f5e";
    const path = isPositive 
        ? "M 0,22 Q 15,10 30,16 T 60,6 T 90,12 T 110,4" 
        : "M 0,6 Q 20,18 40,12 T 70,22 T 95,16 T 110,24";
    return `
      <svg class="w-24 h-7 inline-block overflow-visible" viewBox="0 0 110 28" fill="none">
        <path d="${path}" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="0" y1="20" x2="110" y2="20" stroke="#64748b" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.4" />
      </svg>
    `;
}

// Generate 52-Week Range Slider Bar
function generate52WBar(ltp, low52, high52) {
    if (!low52 || !high52 || high52 <= low52) {
        return `<span class="text-slate-400 text-[10px]">--</span>`;
    }
    const clampedLtp = Math.max(low52, Math.min(high52, ltp));
    const pct = Math.round(((clampedLtp - low52) / (high52 - low52)) * 100);
    return `
      <div class="flex items-center gap-1.5 justify-center font-sans">
        <span class="text-[9.5px] text-slate-400 font-bold">L</span>
        <div class="relative w-20 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full">
          <div class="absolute top-1/2 -mt-1.5 w-1 h-3 bg-slate-700 dark:bg-slate-300 rounded-sm" style="left: ${pct}%;"></div>
        </div>
        <span class="text-[9.5px] text-slate-400 font-bold">H</span>
      </div>
    `;
}

// Save & Restore View Settings
function saveViewSettings() {
    localStorage.setItem(VIEW_MODE_KEY, currentViewMode);
    if (activeAccount) {
        localStorage.setItem(LAST_ACCOUNT_KEY, activeAccount);
    }
}

function loadViewSettings() {
    const savedMode = localStorage.getItem(VIEW_MODE_KEY);
    const savedAccount = localStorage.getItem(LAST_ACCOUNT_KEY);

    if (savedMode === "WATCHLIST") {
        showWatchlistView();
    } else if (savedMode === "ACCOUNT" && savedAccount && accounts.includes(savedAccount)) {
        selectAccount(savedAccount);
    } else {
        showConsolidatedDefaultView();
    }
}

// Show Consolidated Overview
function showConsolidatedDefaultView() {
    currentViewMode = "CONSOLIDATED";
    saveViewSettings();

    document.getElementById("consolidated-section").classList.remove("hidden");
    document.getElementById("watchlist-section").classList.add("hidden");
    document.getElementById("holdings-section").classList.add("hidden");
    renderConsolidatedCards();
}

// Show Groww-Style Watchlist View
function showWatchlistView() {
    currentViewMode = "WATCHLIST";
    saveViewSettings();

    document.getElementById("consolidated-section").classList.add("hidden");
    document.getElementById("watchlist-section").classList.remove("hidden");
    document.getElementById("holdings-section").classList.add("hidden");
    renderWatchlistTable();
}

// Show Specific Account Holdings
function showAccountHoldingsView() {
    currentViewMode = "ACCOUNT";
    saveViewSettings();

    document.getElementById("consolidated-section").classList.add("hidden");
    document.getElementById("watchlist-section").classList.add("hidden");
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

// Reliable Toggle for Add Form Modal
function toggleAddForm(forceState) {
    const modal = document.getElementById("add-form-modal");
    if (!modal) return;
    
    const isCurrentlyClosed = (modal.style.display === "none" || modal.classList.contains("hidden"));
    const shouldOpen = forceState !== undefined ? forceState : isCurrentlyClosed;

    if (shouldOpen) {
        updateAccountOptions();
        modal.classList.remove("hidden");
        modal.classList.add("flex");
        modal.style.display = "flex";

        const accSelect = document.getElementById("input-account");
        if (accSelect && activeAccount) {
            accSelect.value = activeAccount;
        }

        setTimeout(() => {
            const sym = document.getElementById("input-symbol");
            if (sym) sym.focus();
        }, 50);
    } else {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
        modal.style.display = "none";
    }
}

// Safely update account dropdown list
function updateAccountOptions() {
    const select = document.getElementById("input-account");
    if (!select) return;
    const list = (accounts && accounts.length > 0) ? accounts : ["6474"];
    select.innerHTML = list.map(a => `<option value="${a}">${a}</option>`).join("");
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

// Render Account Tabs with unique icons
function renderAccountTabs() {
    const container = document.getElementById("account-tabs-container");
    let tabsHtml = "";

    accounts.forEach(acc => {
        const isCurrent = acc === activeAccount && currentViewMode === "ACCOUNT";
        const count = holdings.filter(h => h.account === acc).length;
        const icon = getAccountIcon(acc);

        if (isCurrent) {
            tabsHtml += `
        <button onclick="selectAccount('${acc}')" class="px-2.5 py-0.5 rounded-lg bg-indigo-600 text-white font-mono font-bold text-xs shadow-sm flex items-center gap-1 transition">
          <span>${icon}</span>
          <span>${acc}</span>
          <span class="bg-indigo-700 text-[9.5px] px-1 py-0.2 rounded-full">${count}</span>
        </button>
      `;
        } else {
            tabsHtml += `
        <button onclick="selectAccount('${acc}')" class="px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono font-semibold text-xs border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition">
          <span>${icon}</span>
          <span>${acc}</span>
          <span class="text-slate-400 text-[9.5px]">${count}</span>
        </button>
      `;
        }
    });

    container.innerHTML = tabsHtml;
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
            discovered.add("6474");
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
const fmtVol = (n) => Number(n).toLocaleString("en-IN");

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
        chgElem.className = `font-mono text-[10px] font-extrabold text-right mt-0.5 ${isPos ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`;
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

// Sort Column Trigger for Account Holdings Table
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
    if (indicator) indicator.className = "w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping";

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
            const todayDiff = ltp - prevClose;
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
                todayDiff,
                todayPct,
                from52Pct
            };
        });

        renderAccountTabs();
        if (currentViewMode === "CONSOLIDATED") {
            renderConsolidatedCards();
        } else if (currentViewMode === "WATCHLIST") {
            renderWatchlistTable();
        } else {
            renderDashboard();
        }
    } catch (err) {
        console.error("Refresh error:", err);
    } finally {
        isFetching = false;
        if (indicator) indicator.className = "w-1.5 h-1.5 rounded-full bg-slate-400";
    }
}

// Render Consolidated Overview
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
        const icon = getAccountIcon(acc);

        cardsHtml += `
      <div onclick="selectAccount('${acc}')" class="group bg-slate-50 dark:bg-slate-950/80 hover:bg-indigo-50/50 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-xl p-3 cursor-pointer transition shadow-sm space-y-1.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 font-bold text-xs text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
            <span>${icon}</span>
            <span>${acc}</span>
          </div>
          <span class="text-[9.5px] font-mono px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
            ${accItems.length} stocks
          </span>
        </div>

        <div class="grid grid-cols-2 gap-1 pt-0.5">
          <div>
            <div class="text-[9px] uppercase font-bold text-slate-400">Invested</div>
            <div class="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono mt-0.5">${fmtInr(accInv)}</div>
          </div>
          <div class="text-right">
            <div class="text-[9px] uppercase font-bold text-slate-400">Current Val</div>
            <div class="text-xs font-extrabold text-slate-900 dark:text-white font-mono mt-0.5">${fmtInr(accCur)}</div>
          </div>
        </div>

        <div class="pt-1.5 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
          <div>
            <span class="text-slate-400 text-[9.5px]">Total P&L</span>
            <div class="font-bold ${pnlCol}">${accPnl >= 0 ? '+' : ''}${fmtInr(accPnl)} (${accPct.toFixed(2)}%)</div>
          </div>
          <div class="text-right">
            <span class="text-slate-400 text-[9.5px]">Today</span>
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
    cPnlElem.className = `font-black text-xs sm:text-sm mt-0.5 ${grandColor}`;

    const cPctElem = document.getElementById("c-kpi-total-pct");
    cPctElem.innerText = `${grandTotalPnl >= 0 ? '+' : ''}${grandTotalPct.toFixed(2)}%`;
    cPctElem.className = `text-[10px] font-bold ${grandColor}`;

    const cTodayElem = document.getElementById("c-kpi-today-pnl");
    cTodayElem.innerText = `${grandTodayPnl >= 0 ? '+' : ''}${fmtInr(grandTodayPnl)}`;
    cTodayElem.className = `font-black text-xs sm:text-sm mt-0.5 ${grandTodayColor}`;

    document.getElementById("account-cards-grid").innerHTML = cardsHtml || `<div class="col-span-4 text-center py-4 text-slate-400">No accounts created.</div>`;

    renderConsolidatedMoversAndLosers();
}

// Side-by-Side Top Gainers & Losers (Summary Page)
function renderConsolidatedMoversAndLosers() {
    const gainersContainer = document.getElementById("consolidated-top-gainers");
    const losersContainer = document.getElementById("consolidated-top-losers");

    if (!computedData || computedData.length === 0) {
        gainersContainer.innerHTML = `<div class="text-slate-400 py-1">No stocks found.</div>`;
        losersContainer.innerHTML = `<div class="text-slate-400 py-1">No stocks found.</div>`;
        return;
    }

    const sortedDesc = [...computedData].sort((a, b) => b.todayPct - a.todayPct);
    const topGainers = sortedDesc.slice(0, 5);
    const topLosers = [...computedData].sort((a, b) => a.todayPct - b.todayPct).slice(0, 5);

    let gainersHtml = "";
    topGainers.forEach((s, idx) => {
        const isPos = s.todayPct >= 0;
        const diffSign = s.todayDiff >= 0 ? "+" : "";
        const icon = getAccountIcon(s.account);
        gainersHtml += `
      <div onclick="selectAccount('${s.account}')" class="flex items-center justify-between p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-emerald-500/50 cursor-pointer transition">
        <div class="flex items-center gap-1.5">
          <span class="text-slate-400 text-[9.5px] w-2.5">${idx + 1}</span>
          <div>
            <div class="font-sans font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1 text-[11.5px]">
              <span>${s.symbol}</span>
              <span class="text-[8.5px] font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 font-normal flex items-center gap-0.5">
                <span>${icon}</span><span>${s.account}</span>
              </span>
            </div>
            <div class="text-[9.5px] text-slate-400">LTP ₹${s.ltp.toFixed(2)}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold text-emerald-500 dark:text-emerald-400 text-[11px]">
            ${isPos ? '+' : ''}${s.todayPct.toFixed(2)}%
          </div>
          <div class="text-[9.5px] text-slate-400 font-mono">${diffSign}₹${s.todayDiff.toFixed(2)}</div>
        </div>
      </div>
    `;
    });
    gainersContainer.innerHTML = gainersHtml;

    let losersHtml = "";
    topLosers.forEach((s, idx) => {
        const diffSign = s.todayDiff >= 0 ? "+" : "";
        const icon = getAccountIcon(s.account);
        losersHtml += `
      <div onclick="selectAccount('${s.account}')" class="flex items-center justify-between p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-rose-500/50 cursor-pointer transition">
        <div class="flex items-center gap-1.5">
          <span class="text-slate-400 text-[9.5px] w-2.5">${idx + 1}</span>
          <div>
            <div class="font-sans font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1 text-[11.5px]">
              <span>${s.symbol}</span>
              <span class="text-[8.5px] font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 font-normal flex items-center gap-0.5">
                <span>${icon}</span><span>${s.account}</span>
              </span>
            </div>
            <div class="text-[9.5px] text-slate-400">LTP ₹${s.ltp.toFixed(2)}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold text-rose-500 dark:text-rose-400 text-[11px]">
            ${s.todayPct.toFixed(2)}%
          </div>
          <div class="text-[9.5px] text-slate-400 font-mono">${diffSign}₹${s.todayDiff.toFixed(2)}</div>
        </div>
      </div>
    `;
    });
    losersContainer.innerHTML = losersHtml;
}

// -------------------------------------------------------------
// DEDICATED GROWW-STYLE WATCHLIST LOGIC & SORTING
// -------------------------------------------------------------

// Search Filter Input Trigger
function handleWatchlistSearch(val) {
    wlSearchQuery = (val || "").trim().toLowerCase();
    renderWatchlistTable();
}

// Sort Trigger for Watchlist Table
function sortWatchlist(column) {
    if (wlSortCol === column) {
        wlSortAsc = !wlSortAsc;
    } else {
        wlSortCol = column;
        wlSortAsc = true;
    }
    renderWatchlistTable();
}

// Render Groww-Style Watchlist Table
function renderWatchlistTable() {
    const tbody = document.getElementById("watchlist-body");
    if (!tbody) return;

    // Filter stocks matching query
    let filtered = [...computedData];
    if (wlSearchQuery) {
        filtered = filtered.filter(item => 
            item.symbol.toLowerCase().includes(wlSearchQuery) || 
            (item.account && item.account.toLowerCase().includes(wlSearchQuery))
        );
    }

    // Update Counter badge
    document.getElementById("watchlist-total-count").innerText = `(${filtered.length})`;

    // Sort Watchlist Data
    filtered.sort((a, b) => {
        let valA = a[wlSortCol];
        let valB = b[wlSortCol];

        if (typeof valA === "string") {
            return wlSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return wlSortAsc ? valA - valB : valB - valA;
    });

    // Update Arrow Indicators
    ['symbol', 'ltp', 'todayPct', 'vol'].forEach(col => {
        const span = document.getElementById(`wl-sort-${col}`);
        if (span) {
            span.innerText = wlSortCol === col ? (wlSortAsc ? '↑' : '↓') : '';
        }
    });

    let html = "";
    filtered.forEach(item => {
        const isPos = item.todayPct >= 0;
        const colorClass = isPos ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400";
        const sign = isPos ? "+" : "";
        const diffSign = item.todayDiff >= 0 ? "+" : "";

        html += `
          <tr onclick="selectAccount('${item.account}')" class="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition">
            <!-- Company / Symbol with Logo -->
            <td class="py-3 px-3">
              <div class="flex items-center gap-3">
                ${getStockAvatar(item.symbol)}
                <div>
                  <div class="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-[13px] flex items-center gap-1.5">
                    <span>${item.symbol}</span>
                    <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 font-normal">
                      ${item.account}
                    </span>
                  </div>
                  <div class="text-[10px] text-slate-400">NSE • Equity</div>
                </div>
              </div>
            </td>

            <!-- Trend Sparkline Curve -->
            <td class="py-3 px-3 text-center">
              ${generateSparklineSvg(isPos)}
            </td>

            <!-- Market Price (LTP) -->
            <td class="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-white text-xs sm:text-[13px]">
              ₹${item.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>

            <!-- 1D Change (+/- and %) -->
            <td class="py-3 px-3 text-right font-mono">
              <div class="font-bold text-xs sm:text-[12.5px] ${colorClass}">
                ${diffSign}₹${Math.abs(item.todayDiff).toFixed(2)} (${sign}${item.todayPct.toFixed(2)}%)
              </div>
            </td>

            <!-- 1D Volume -->
            <td class="py-3 px-3 text-right font-mono text-slate-600 dark:text-slate-300 text-xs">
              ${fmtVol(item.vol)}
            </td>

            <!-- 52W Performance Slider -->
            <td class="py-3 px-3 text-center">
              ${generate52WBar(item.ltp, item.low52, item.high52)}
            </td>
          </tr>
        `;
    });

    tbody.innerHTML = html || `<tr><td colspan="6" class="text-center py-8 text-slate-400 font-sans">No matching stocks found in your watchlist.</td></tr>`;
}

// -------------------------------------------------------------
// ORIGINAL ACCOUNT HOLDINGS TABLE
// -------------------------------------------------------------
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
        <td class="py-1.5 px-2 text-slate-400 text-[10px]">${i + 1}</td>
        <td class="py-1.5 px-2 font-sans font-bold text-slate-900 dark:text-slate-100 text-xs">${item.symbol}</td>
        <td class="py-1.5 px-2 text-right text-slate-600 dark:text-slate-300">${item.bq}</td>
        <td class="py-1.5 px-2 text-right text-slate-600 dark:text-slate-300">₹${item.price.toFixed(2)}</td>
        <td class="py-1.5 px-2 text-right text-slate-600 dark:text-slate-300">${fmtInr(item.buyValue)}</td>
        <td class="py-1.5 px-2 text-right font-bold text-slate-900 dark:text-white">₹${item.ltp.toFixed(2)}</td>
        <td class="py-1.5 px-2 text-right font-semibold text-slate-800 dark:text-slate-200">${fmtInr(item.currValue)}</td>
        <td class="py-1.5 px-2 text-right">
          <div class="font-bold ${totalColor}">${isPositive ? '+' : ''}${fmtInr(item.totalDiff)}</div>
          <div class="text-[10px] ${totalColor} opacity-90">${isPositive ? '+' : ''}${item.totalPct.toFixed(2)}%</div>
        </td>
        <td class="py-1.5 px-2 text-right">
          <span class="font-bold px-1.5 py-0.2 rounded text-[10.5px] inline-block ${todayBadge}">
            ${isTodayPos ? '+' : ''}${item.todayPct.toFixed(2)}%
          </span>
        </td>
        <td class="py-1.5 px-2 text-right text-[10.5px]">
          <div class="${item.from52Pct < 0 ? 'text-rose-400' : 'text-slate-400'}">${item.from52Pct ? item.from52Pct.toFixed(2) + '%' : '--'}</div>
          <div class="text-[9px] text-slate-500">H: ${item.high52 ? item.high52.toFixed(2) : '--'}</div>
        </td>
        <td class="py-1.5 px-2 text-center font-sans">
          <button onclick="removeStock('${item.id}')" title="Delete" class="text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 px-1">✕</button>
        </td>
      </tr>
    `;

        mobileHtml += `
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 shadow-sm space-y-1">
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-slate-500 dark:text-slate-400">Qty. ${item.bq} • Avg. ${item.price.toFixed(2)}</span>
          <span class="font-bold ${totalColor}">${isPositive ? '+' : ''}${item.totalPct.toFixed(2)}%</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-sm text-slate-900 dark:text-white">${item.symbol}</span>
          <span class="font-extrabold text-sm ${totalColor}">${isPositive ? '+' : ''}${fmtInr(item.totalDiff)}</span>
        </div>
        <div class="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800/80">
          <span class="text-slate-400">Invested ${fmtInr(item.buyValue)}</span>
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-800 dark:text-slate-200">LTP ${item.ltp.toFixed(2)}</span>
            <span class="text-[10px] font-semibold ${isTodayPos ? 'text-emerald-500' : 'text-rose-500'}">(${isTodayPos ? '+' : ''}${item.todayPct.toFixed(2)}%)</span>
            <button onclick="removeStock('${item.id}')" class="text-rose-400 hover:text-rose-600 pl-0.5 text-xs">✕</button>
          </div>
        </div>
      </div>
    `;
    });

    document.getElementById("portfolio-body").innerHTML = desktopHtml || `<tr><td colspan="11" class="text-center py-6 text-slate-400 font-sans">No positions found for <strong>${activeAccount}</strong>. Use "Tools > Add New Stock".</td></tr>`;
    document.getElementById("mobile-cards-container").innerHTML = mobileHtml || `<div class="text-center py-6 text-slate-400 font-sans">No positions found for <strong>${activeAccount}</strong>.</div>`;

    updateKPIs(totalInvested, totalCurrent, totalPrevClose);
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
    totalElem.className = `text-sm font-extrabold text-right ${totalColor}`;

    const totalPctElem = document.getElementById("kpi-total-pct");
    totalPctElem.innerText = `${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}% overall`;
    totalPctElem.className = `text-[10px] font-bold ${totalColor}`;

    const todayElem = document.getElementById("kpi-today-pnl");
    todayElem.innerText = `${todayPnl >= 0 ? '+' : ''}${fmtInr(todayPnl)}`;
    todayElem.className = `text-sm font-extrabold text-right ${todayColor}`;

    document.getElementById("kpi-prev-close").innerText = `Prev: ${fmtInr(prevClose)}`;
}

// Auto-refresh tick
function toggleAutoRefresh(start) {
    if (start) {
        refreshAllPrices();
        autoRefreshInterval = setInterval(refreshAllPrices, 5000);
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
                const acc = (h.account && h.account.trim()) ? h.account.trim().toUpperCase() : "6474";
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