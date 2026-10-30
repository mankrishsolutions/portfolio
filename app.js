const WORKER_BASE = "https://tickerprice.mankrishsolutions.workers.dev";
const THEME_KEY = "portfolio_theme_mode";
const VIEW_MODE_KEY = "portfolio_last_view_mode"; // 'CONSOLIDATED', 'ACCOUNT', or 'WATCHLIST'
const LAST_ACCOUNT_KEY = "portfolio_last_selected_account";

// Distinct Account Icons
const ACCOUNT_ICONS = ["💼", "🏦", "🪙", "💳", "📊", "🏛️", "💰", "💎"];

// Palette for Circular Stock Logos
const LOGO_BG_COLORS = [
    "bg-indigo-600", "bg-emerald-600", "bg-amber-600", "bg-blue-600",
    "bg-rose-600", "bg-purple-600", "bg-teal-600", "bg-orange-600"
];

let holdings = [];
let accounts = [];
let activeAccount = "";
let currentViewMode = "CONSOLIDATED";
let computedData = [];
let isFetching = false;
let autoRefreshInterval = null;

// Memory cache to prevent blank prices
const quoteCache = {};

// Sorting state for Account Holdings Table
let currentSortCol = 'totalDiff';
let currentSortAsc = false;

// Sorting and Filter state for Watchlist Table
let wlSearchQuery = "";
let wlAccountFilter = "ALL";
let wlSortCol = 'symbol';
let wlSortAsc = true;

function getAccountIcon(accName) {
    const index = accounts.indexOf(accName);
    if (index === -1) return "💼";
    return ACCOUNT_ICONS[index % ACCOUNT_ICONS.length];
}

function getStockAvatar(symbol) {
    let charCode = 0;
    for (let i = 0; i < symbol.length; i++) charCode += symbol.charCodeAt(i);
    const colorClass = LOGO_BG_COLORS[charCode % LOGO_BG_COLORS.length];
    return `<div class="w-8 h-8 rounded-xl ${colorClass} text-white flex items-center justify-center font-extrabold text-[11px] shadow-sm flex-shrink-0">${symbol.slice(0, 2)}</div>`;
}

function generate52WBar(ltp, low52, high52) {
    if (!low52 || !high52 || high52 <= low52) {
        return `<span class="text-slate-400 text-[10px]">--</span>`;
    }
    const clampedLtp = Math.max(low52, Math.min(high52, ltp));
    const pct = Math.round(((clampedLtp - low52) / (high52 - low52)) * 100);
    return `
      <div class="flex items-center gap-1.5 justify-center font-sans">
        <span class="text-[9px] text-slate-400 font-bold">L</span>
        <div class="relative w-20 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full">
          <div class="absolute top-1/2 -mt-1 w-1 h-2.5 bg-slate-700 dark:bg-slate-300 rounded-sm" style="left: ${pct}%;"></div>
        </div>
        <span class="text-[9px] text-slate-400 font-bold">H</span>
      </div>
    `;
}

function saveViewSettings() {
    localStorage.setItem(VIEW_MODE_KEY, currentViewMode);
    if (activeAccount) {
        localStorage.setItem(LAST_ACCOUNT_KEY, activeAccount);
    }
}

function updateTopNavTabs() {
    const exploreBtn = document.getElementById("nav-tab-explore");
    const holdingsBtn = document.getElementById("nav-tab-holdings");
    const watchlistBtn = document.getElementById("nav-tab-watchlist");

    const activeClasses = ["border-b-2", "border-slate-900", "dark:border-emerald-400", "text-slate-900", "dark:text-white", "font-bold"];
    const inactiveClasses = ["text-slate-500", "dark:text-slate-400", "font-semibold"];

    [exploreBtn, holdingsBtn, watchlistBtn].forEach(b => {
        if (!b) return;
        b.classList.remove(...activeClasses);
        b.classList.add(...inactiveClasses);
    });

    if (currentViewMode === "CONSOLIDATED" && exploreBtn) {
        exploreBtn.classList.remove(...inactiveClasses);
        exploreBtn.classList.add(...activeClasses);
    } else if (currentViewMode === "ACCOUNT" && holdingsBtn) {
        holdingsBtn.classList.remove(...inactiveClasses);
        holdingsBtn.classList.add(...activeClasses);
    } else if (currentViewMode === "WATCHLIST" && watchlistBtn) {
        watchlistBtn.classList.remove(...inactiveClasses);
        watchlistBtn.classList.add(...activeClasses);
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

function showConsolidatedDefaultView() {
    currentViewMode = "CONSOLIDATED";
    saveViewSettings();
    updateTopNavTabs();

    document.getElementById("consolidated-section")?.classList.remove("hidden");
    document.getElementById("watchlist-section")?.classList.add("hidden");
    document.getElementById("holdings-section")?.classList.add("hidden");
    renderConsolidatedCards();
}

function showWatchlistView() {
    currentViewMode = "WATCHLIST";
    saveViewSettings();
    updateTopNavTabs();

    document.getElementById("consolidated-section")?.classList.add("hidden");
    document.getElementById("watchlist-section")?.classList.remove("hidden");
    document.getElementById("holdings-section")?.classList.add("hidden");
    populateWatchlistAccountFilter();
    renderWatchlistTable();
}

function showAccountHoldingsView() {
    currentViewMode = "ACCOUNT";
    saveViewSettings();
    updateTopNavTabs();

    document.getElementById("consolidated-section")?.classList.add("hidden");
    document.getElementById("watchlist-section")?.classList.add("hidden");
    document.getElementById("holdings-section")?.classList.remove("hidden");
}

function openFirstAccount() {
    if (accounts.length > 0) {
        selectAccount(activeAccount || accounts[0]);
    }
}

function toggleSettingsMenu(forceState) {
    const menu = document.getElementById("settings-dropdown");
    if (!menu) return;
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
    const icon = document.getElementById("theme-menu-icon");
    const label = document.getElementById("theme-menu-label");
    if (isDark) {
        document.documentElement.classList.add("dark");
        if (icon) icon.innerText = "☀️";
        if (label) label.innerText = "Dark";
    } else {
        document.documentElement.classList.remove("dark");
        if (icon) icon.innerText = "🌙";
        if (label) label.innerText = "Light";
    }
}

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

function updateAccountOptions() {
    const select = document.getElementById("input-account");
    if (!select) return;
    const list = (accounts && accounts.length > 0) ? accounts : ["6474"];
    select.innerHTML = list.map(a => `<option value="${a}">${a}</option>`).join("");
}

function selectAccount(acc) {
    activeAccount = acc;
    showAccountHoldingsView();
    renderAccountTabs();
    renderDashboard();
}

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
    renderAccountTabs();
    renderDashboard();
    renderConsolidatedCards();
}

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

function renderAccountTabs() {
    const container = document.getElementById("account-tabs-container");
    if (!container) return;
    let tabsHtml = "";

    accounts.forEach(acc => {
        const isCurrent = acc === activeAccount && currentViewMode === "ACCOUNT";
        const count = holdings.filter(h => h.account === acc).length;
        const icon = getAccountIcon(acc);

        if (isCurrent) {
            tabsHtml += `
        <button onclick="selectAccount('${acc}')" class="px-2.5 py-0.5 rounded-lg bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 font-mono font-bold text-xs shadow-sm flex items-center gap-1 transition">
          <span>${icon}</span>
          <span>${acc}</span>
          <span class="bg-black/20 text-[9px] px-1.5 py-0.2 rounded-full">${count}</span>
        </button>
      `;
        } else {
            tabsHtml += `
        <button onclick="selectAccount('${acc}')" class="px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono font-semibold text-xs border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition">
          <span>${icon}</span>
          <span>${acc}</span>
          <span class="text-slate-400 text-[9px]">${count}</span>
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

// Fetch quote with memory caching
async function fetchQuote(symbol) {
    try {
        const res = await fetch(`${WORKER_BASE}/?symbol=${encodeURIComponent(symbol)}`);
        if (!res.ok) return quoteCache[symbol] || null;
        const data = await res.json();
        if (data && data.ltp !== undefined) {
            quoteCache[symbol] = data;
            return data;
        }
        return quoteCache[symbol] || null;
    } catch (e) {
        return quoteCache[symbol] || null;
    }
}

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
        chgElem.className = `font-mono text-[10.5px] font-bold ${isPos ? 'text-emerald-500' : 'text-rose-500'}`;
    }
}

async function refreshMacroTickers() {
    fetchQuote("NIFTY_50").then(q => updateTickerBadge("idx-nifty", q));
    fetchQuote("GOLD").then(q => updateTickerBadge("idx-gold", q));
    fetchQuote("SILVER").then(q => updateTickerBadge("idx-silver", q));
}

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

async function removeStock(id) {
    if (!confirm("Delete position?")) return;
    holdings = holdings.filter(item => item.id !== id);
    await saveToCloud(holdings);
    renderAccountTabs();
    refreshAllPrices();
}

function sortTable(column) {
    if (currentSortCol === column) {
        currentSortAsc = !currentSortAsc;
    } else {
        currentSortCol = column;
        currentSortAsc = true;
    }
    renderDashboard();
}

// Request throttling in batches of 4
async function fetchInBatches(items, batchSize = 4) {
    const results = {};
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(sym => fetchQuote(sym)));
        batch.forEach((sym, idx) => {
            results[sym] = batchResults[idx];
        });
        if (i + batchSize < items.length) {
            await new Promise(r => setTimeout(r, 60));
        }
    }
    return results;
}

async function refreshAllPrices() {
    if (isFetching) return;
    isFetching = true;

    const indicator = document.getElementById("refresh-indicator");
    if (indicator) indicator.className = "w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping";

    refreshMacroTickers();

    const uniqueSymbols = Array.from(new Set(holdings.map(h => h.symbol)));

    try {
        const quoteMap = await fetchInBatches(uniqueSymbols, 4);

        computedData = holdings.map(item => {
            const q = quoteMap[item.symbol] || quoteCache[item.symbol];
            const ltp = q?.ltp !== undefined ? q.ltp : item.price;
            const prevClose = q?.previousClose || ltp;
            const high52 = q?.high52 || 0;
            const low52 = q?.low52 || 0;
            const vol = q?.volume || 0;

            const buyValue = item.bq * item.price;
            const currValue = item.bq * ltp;
            const prevValue = item.bq * prevClose;

            const totalDiff = currValue - buyValue;
            const totalPct = buyValue > 0 ? (totalDiff / buyValue) * 100 : 0;
            const todayDiff = ltp - prevClose;
            const todayPct = prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0;
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

// Render Top 2 Account Summary Badges in Top Indices Row & Explore Grid
function renderConsolidatedCards() {
    let grandInvested = 0;
    let grandCurrent = 0;
    let grandPrev = 0;

    let accountSummaries = [];

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
        const accTodayPct = accPre > 0 ? (accToday / accPre) * 100 : 0;

        accountSummaries.push({
            account: acc,
            count: accItems.length,
            invested: accInv,
            current: accCur,
            pnl: accPnl,
            pct: accPct,
            today: accToday,
            todayPct: accTodayPct
        });
    });

    const grandTotalPnl = grandCurrent - grandInvested;
    const grandTotalPct = grandInvested > 0 ? (grandTotalPnl / grandInvested) * 100 : 0;
    const grandTodayPnl = grandCurrent - grandPrev;
    const grandTodayPct = grandPrev > 0 ? (grandTodayPnl / grandPrev) * 100 : 0;

    const totalCol = grandTotalPnl >= 0 ? "text-emerald-500" : "text-rose-500";
    const dayCol = grandTodayPnl >= 0 ? "text-emerald-500" : "text-rose-500";

    // Update Right "Your investments" Card (Total Consolidated)
    const curElem = document.getElementById("groww-kpi-current");
    const invElem = document.getElementById("groww-kpi-invested");
    const dayElem = document.getElementById("groww-kpi-day");
    const totElem = document.getElementById("groww-kpi-total");

    if (curElem) curElem.innerText = fmtInr(grandCurrent);
    if (invElem) invElem.innerText = fmtInr(grandInvested);
    if (dayElem) {
        dayElem.innerText = `${grandTodayPnl >= 0 ? '+' : ''}${fmtInr(grandTodayPnl)} (${grandTodayPct.toFixed(2)}%)`;
        dayElem.className = `font-mono font-bold ${dayCol}`;
    }
    if (totElem) {
        totElem.innerText = `${grandTotalPnl >= 0 ? '+' : ''}${fmtInr(grandTotalPnl)} (${grandTotalPct.toFixed(2)}%)`;
        totElem.className = `font-mono font-bold ${totalCol}`;
    }

    // Sort by largest accounts
    accountSummaries.sort((a, b) => b.count - a.count);
    const top2Accounts = accountSummaries.slice(0, 2);

    // Render Top 2 Account Badges on Top Row (In place of BankNifty and Midcap)
    let topBadgesHtml = "";
    top2Accounts.forEach(accData => {
        const icon = getAccountIcon(accData.account);
        const dayCol = accData.today >= 0 ? "text-emerald-500" : "text-rose-500";
        topBadgesHtml += `
          <div onclick="selectAccount('${accData.account}')" class="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition flex-shrink-0">
            <span class="font-bold text-slate-400 text-[11px] flex items-center gap-1">
              <span>${icon}</span>
              <span>${accData.account}</span>
            </span>
            <strong class="font-mono font-bold text-slate-900 dark:text-white text-xs">${fmtInr(accData.current)}</strong>
            <span class="font-mono font-bold text-[10px] ${dayCol}">(${accData.today >= 0 ? '+' : ''}${accData.todayPct.toFixed(2)}%)</span>
          </div>
        `;
    });
    const topBadgesContainer = document.getElementById("top-row-accounts-badges");
    if (topBadgesContainer) topBadgesContainer.innerHTML = topBadgesHtml;

    // Render All Accounts Grid
    let allCardsHtml = "";
    accountSummaries.forEach(acc => {
        const pnlCol = acc.pnl >= 0 ? "text-emerald-500" : "text-rose-500";
        const todayCol = acc.today >= 0 ? "text-emerald-500" : "text-rose-500";
        const icon = getAccountIcon(acc.account);

        allCardsHtml += `
          <div onclick="selectAccount('${acc.account}')" class="group bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800/80 hover:border-emerald-500/50 rounded-xl p-3 cursor-pointer transition shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 font-bold text-xs text-slate-800 dark:text-slate-100 group-hover:text-emerald-500 transition">
                <span>${icon}</span>
                <span>${acc.account}</span>
              </div>
              <span class="text-[9.5px] font-mono px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                ${acc.count} stocks
              </span>
            </div>

            <div class="grid grid-cols-2 gap-1 pt-0.5">
              <div>
                <div class="text-[9px] uppercase font-bold text-slate-400">Invested</div>
                <div class="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono mt-0.5">${fmtInr(acc.invested)}</div>
              </div>
              <div class="text-right">
                <div class="text-[9px] uppercase font-bold text-slate-400">Current</div>
                <div class="text-xs font-extrabold text-slate-900 dark:text-white font-mono mt-0.5">${fmtInr(acc.current)}</div>
              </div>
            </div>

            <div class="pt-1.5 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
              <div>
                <span class="text-slate-400 text-[9.5px]">Total P&L</span>
                <div class="font-bold ${pnlCol}">${acc.pnl >= 0 ? '+' : ''}${fmtInr(acc.pnl)} (${acc.pct.toFixed(2)}%)</div>
              </div>
              <div class="text-right">
                <span class="text-slate-400 text-[9.5px]">Today</span>
                <div class="font-bold ${todayCol}">${acc.today >= 0 ? '+' : ''}${fmtInr(acc.today)}</div>
              </div>
            </div>
          </div>
        `;
    });
    const gridBox = document.getElementById("account-cards-grid");
    if (gridBox) gridBox.innerHTML = allCardsHtml || `<div class="col-span-4 text-center py-4 text-slate-400">No accounts created.</div>`;

    renderGrowwMoverCards();
}

// Render Top 5 Gainers & Losers (Expanded 5-Column Cards)
function renderGrowwMoverCards() {
    const gainersContainer = document.getElementById("groww-gainers-grid");
    const losersContainer = document.getElementById("groww-losers-grid");

    if (!computedData || computedData.length === 0) {
        if (gainersContainer) gainersContainer.innerHTML = `<div class="col-span-5 text-slate-400 py-2">No stocks found.</div>`;
        if (losersContainer) losersContainer.innerHTML = `<div class="col-span-5 text-slate-400 py-2">No stocks found.</div>`;
        return;
    }

    const sortedDesc = [...computedData].sort((a, b) => b.todayPct - a.todayPct);
    const topGainers = sortedDesc.slice(0, 5);
    const topLosers = [...computedData].sort((a, b) => a.todayPct - b.todayPct).slice(0, 5);

    let gHtml = "";
    topGainers.forEach(s => {
        gHtml += `
          <div onclick="selectAccount('${s.account}')" class="bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 rounded-xl p-2 cursor-pointer transition shadow-sm space-y-1.5 flex flex-col justify-between">
            <div class="flex items-center justify-between">
              ${getStockAvatar(s.symbol)}
              <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 font-semibold">${s.account}</span>
            </div>

            <div>
              <div class="font-bold text-slate-900 dark:text-white text-[11px] truncate">${s.symbol}</div>
              <div class="text-[9px] text-slate-400">NSE • Equity</div>
            </div>

            <div class="pt-1 border-t border-slate-200/50 dark:border-slate-800/60">
              <div class="font-extrabold text-xs font-mono text-slate-900 dark:text-white">₹${s.ltp.toFixed(2)}</div>
              <div class="font-bold font-mono text-emerald-500 text-[10px] mt-0.5">
                +${s.todayDiff.toFixed(2)} (+${s.todayPct.toFixed(2)}%)
              </div>
            </div>
          </div>
        `;
    });
    if (gainersContainer) gainersContainer.innerHTML = gHtml;

    let lHtml = "";
    topLosers.forEach(s => {
        lHtml += `
          <div onclick="selectAccount('${s.account}')" class="bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 rounded-xl p-2 cursor-pointer transition shadow-sm space-y-1.5 flex flex-col justify-between">
            <div class="flex items-center justify-between">
              ${getStockAvatar(s.symbol)}
              <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 font-semibold">${s.account}</span>
            </div>

            <div>
              <div class="font-bold text-slate-900 dark:text-white text-[11px] truncate">${s.symbol}</div>
              <div class="text-[9px] text-slate-400">NSE • Equity</div>
            </div>

            <div class="pt-1 border-t border-slate-200/50 dark:border-slate-800/60">
              <div class="font-extrabold text-xs font-mono text-slate-900 dark:text-white">₹${s.ltp.toFixed(2)}</div>
              <div class="font-bold font-mono text-rose-500 text-[10px] mt-0.5">
                ${s.todayDiff.toFixed(2)} (${s.todayPct.toFixed(2)}%)
              </div>
            </div>
          </div>
        `;
    });
    if (losersContainer) losersContainer.innerHTML = lHtml;
}

// -------------------------------------------------------------
// WATCHLIST WITH ACCOUNT FILTER & SEARCH
// -------------------------------------------------------------
function populateWatchlistAccountFilter() {
    const filterSelect = document.getElementById("watchlist-account-filter");
    if (!filterSelect) return;
    let optionsHtml = `<option value="ALL">All Accounts</option>`;
    accounts.forEach(acc => {
        optionsHtml += `<option value="${acc}">${acc}</option>`;
    });
    filterSelect.innerHTML = optionsHtml;
    filterSelect.value = wlAccountFilter;
}

function handleWatchlistAccountFilter(val) {
    wlAccountFilter = val;
    renderWatchlistTable();
}

function handleWatchlistSearch(val) {
    wlSearchQuery = (val || "").trim().toLowerCase();
    renderWatchlistTable();
}

function sortWatchlist(column) {
    if (wlSortCol === column) {
        wlSortAsc = !wlSortAsc;
    } else {
        wlSortCol = column;
        wlSortAsc = true;
    }
    renderWatchlistTable();
}

function renderWatchlistTable() {
    const tbody = document.getElementById("watchlist-body");
    if (!tbody) return;

    // Deduplicate stocks by symbol across accounts
    const uniqueStockMap = new Map();

    computedData.forEach(item => {
        if (!uniqueStockMap.has(item.symbol)) {
            uniqueStockMap.set(item.symbol, {
                ...item,
                accountList: [item.account]
            });
        } else {
            const existing = uniqueStockMap.get(item.symbol);
            if (!existing.accountList.includes(item.account)) {
                existing.accountList.push(item.account);
            }
        }
    });

    let deduplicatedList = Array.from(uniqueStockMap.values());

    // Filter by Account Dropdown
    if (wlAccountFilter !== "ALL") {
        deduplicatedList = deduplicatedList.filter(item => 
            item.accountList.includes(wlAccountFilter)
        );
    }

    // Filter by Search Query
    if (wlSearchQuery) {
        deduplicatedList = deduplicatedList.filter(item => 
            item.symbol.toLowerCase().includes(wlSearchQuery) || 
            item.accountList.some(acc => acc.toLowerCase().includes(wlSearchQuery))
        );
    }

    const counter = document.getElementById("watchlist-total-count");
    if (counter) counter.innerText = `(${deduplicatedList.length})`;

    // Sort Watchlist
    deduplicatedList.sort((a, b) => {
        let valA = a[wlSortCol];
        let valB = b[wlSortCol];

        if (typeof valA === "string") {
            return wlSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return wlSortAsc ? valA - valB : valB - valA;
    });

    ['symbol', 'ltp', 'todayPct', 'vol'].forEach(col => {
        const span = document.getElementById(`wl-sort-${col}`);
        if (span) {
            span.innerText = wlSortCol === col ? (wlSortAsc ? '↑' : '↓') : '';
        }
    });

    let html = "";
    deduplicatedList.forEach(item => {
        const isPos = item.todayPct >= 0;
        const colorClass = isPos ? "text-emerald-500" : "text-rose-500";
        const sign = isPos ? "+" : "";
        const diffSign = item.todayDiff >= 0 ? "+" : "";

        const accountBadges = item.accountList.map(acc => 
            `<span class="text-[8.5px] font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">${acc}</span>`
        ).join(" ");

        html += `
          <tr onclick="selectAccount('${item.accountList[0]}')" class="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition">
            <!-- Company / Symbol with Logo -->
            <td class="py-2 px-3">
              <div class="flex items-center gap-2.5">
                ${getStockAvatar(item.symbol)}
                <div>
                  <div class="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-1.5">
                    <span>${item.symbol}</span>
                    <span class="flex items-center gap-1">${accountBadges}</span>
                  </div>
                  <div class="text-[9.5px] text-slate-400">NSE • Equity</div>
                </div>
              </div>
            </td>

            <!-- Market Price (LTP) -->
            <td class="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white text-xs">
              ₹${item.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>

            <!-- 1D Change (+/- and %) -->
            <td class="py-2 px-3 text-right font-mono">
              <div class="font-bold text-xs ${colorClass}">
                ${diffSign}₹${Math.abs(item.todayDiff).toFixed(2)} (${sign}${item.todayPct.toFixed(2)}%)
              </div>
            </td>

            <!-- 1D Volume -->
            <td class="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-300 text-xs">
              ${fmtVol(item.vol)}
            </td>

            <!-- 52W Performance Slider -->
            <td class="py-2 px-3 text-center">
              ${generate52WBar(item.ltp, item.low52, item.high52)}
            </td>
          </tr>
        `;
    });

    tbody.innerHTML = html || `<tr><td colspan="5" class="text-center py-6 text-slate-400 font-sans">No matching stocks found.</td></tr>`;
}

// -------------------------------------------------------------
// ACCOUNT HOLDINGS TABLE
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

    let desktopHtml = "";
    let mobileHtml = "";

    accountHoldings.forEach((item, i) => {
        const isPositive = item.totalDiff >= 0;
        const isTodayPos = item.todayPct >= 0;

        const totalColor = isPositive ? "text-emerald-500" : "text-rose-500";
        const todayBadge = isTodayPos
            ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40"
            : "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40";

        desktopHtml += `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
        <td class="py-1.5 px-2.5 text-slate-400 text-[10px]">${i + 1}</td>
        <td class="py-1.5 px-2.5 font-sans font-bold text-slate-900 dark:text-slate-100 text-xs">${item.symbol}</td>
        <td class="py-1.5 px-2.5 text-right text-slate-600 dark:text-slate-300">${item.bq}</td>
        <td class="py-1.5 px-2.5 text-right text-slate-600 dark:text-slate-300">₹${item.price.toFixed(2)}</td>
        <td class="py-1.5 px-2.5 text-right text-slate-600 dark:text-slate-300">${fmtInr(item.buyValue)}</td>
        <td class="py-1.5 px-2.5 text-right font-bold text-slate-900 dark:text-white">₹${item.ltp.toFixed(2)}</td>
        <td class="py-1.5 px-2.5 text-right font-semibold text-slate-800 dark:text-slate-200">${fmtInr(item.currValue)}</td>
        <td class="py-1.5 px-2.5 text-right">
          <div class="font-bold ${totalColor}">${isPositive ? '+' : ''}${fmtInr(item.totalDiff)}</div>
          <div class="text-[9.5px] ${totalColor} opacity-90">${isPositive ? '+' : ''}${item.totalPct.toFixed(2)}%</div>
        </td>
        <td class="py-1.5 px-2.5 text-right">
          <span class="font-bold px-1.5 py-0.2 rounded text-[10px] inline-block ${todayBadge}">
            ${isTodayPos ? '+' : ''}${item.todayPct.toFixed(2)}%
          </span>
        </td>
        <td class="py-1.5 px-2.5 text-right text-[10px]">
          <div class="${item.from52Pct < 0 ? 'text-rose-400' : 'text-slate-400'}">${item.from52Pct ? item.from52Pct.toFixed(2) + '%' : '--'}</div>
          <div class="text-[9px] text-slate-500">H: ${item.high52 ? item.high52.toFixed(2) : '--'}</div>
        </td>
        <td class="py-1.5 px-2.5 text-center font-sans">
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

    const bodyElem = document.getElementById("portfolio-body");
    const mContainer = document.getElementById("mobile-cards-container");
    if (bodyElem) bodyElem.innerHTML = desktopHtml || `<tr><td colspan="11" class="text-center py-6 text-slate-400 font-sans">No positions found for <strong>${activeAccount}</strong>.</td></tr>`;
    if (mContainer) mContainer.innerHTML = mobileHtml || `<div class="text-center py-6 text-slate-400 font-sans">No positions found for <strong>${activeAccount}</strong>.</div>`;
}

function toggleAutoRefresh(start) {
    if (start) {
        refreshAllPrices();
        autoRefreshInterval = setInterval(refreshAllPrices, 5000);
    } else {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    }
}

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