/* ═══════════════════════════════════════════════════════════════
   STOCKLENS — app.js  (India Edition v2 — Stocks + Mutual Funds)
   Data sources:
     Stocks:       Yahoo Finance (free, no key)
     Mutual Funds: mfapi.in     (free, no key, India AMFIs)
   Portfolio saved to localStorage — no backend required.
═══════════════════════════════════════════════════════════════ */

'use strict';

// ──────────────────────────────────────────────────────────────
// CONSTANTS & CONFIG
// ──────────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 60_000;

// Initialize Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDEdhqqLRu8s5pNDzwjquRtly9ZclyjvEo",
    authDomain: "stocklens-tracker.firebaseapp.com",
    projectId: "stocklens-tracker",
    storageBucket: "stocklens-tracker.firebasestorage.app",
    messagingSenderId: "734779313039",
    appId: "1:734779313039:web:d762ab6b22a4f9061659fa",
    measurementId: "G-CBYKRBVHPB"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const MF_BASE = 'https://api.mfapi.in/mf';

const POPULAR_INDIAN_STOCKS = [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
    { symbol: 'TCS.NS', name: 'Tata Consultancy Services' },
    { symbol: 'INFY.NS', name: 'Infosys' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
    { symbol: 'ICICIBANK.NS', name: 'ICICI Bank' },
    { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever' },
    { symbol: 'ITC.NS', name: 'ITC Limited' },
    { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank' },
    { symbol: 'SBIN.NS', name: 'State Bank of India' },
    { symbol: 'WIPRO.NS', name: 'Wipro' },
    { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance' },
    { symbol: 'MARUTI.NS', name: 'Maruti Suzuki' },
    { symbol: 'TATAMOTORS.NS', name: 'Tata Motors' },
    { symbol: 'ADANIENT.NS', name: 'Adani Enterprises' },
    { symbol: 'AXISBANK.NS', name: 'Axis Bank' },
    { symbol: 'LT.NS', name: 'Larsen & Toubro' },
    { symbol: 'SUNPHARMA.NS', name: 'Sun Pharmaceutical' },
    { symbol: 'ONGC.NS', name: 'ONGC' },
    { symbol: 'POWERGRID.NS', name: 'Power Grid Corp' },
    { symbol: 'NTPC.NS', name: 'NTPC' },
];

// Popular MFs — schemeCode from AMFI / mfapi.in
const POPULAR_MFS = [
    { code: '120503', name: 'Axis Bluechip Fund - Direct Growth' },
    { code: '119598', name: 'Mirae Asset Large Cap Fund - Direct Growth' },
    { code: '120716', name: 'Parag Parikh Flexi Cap Fund - Direct Growth' },
    { code: '100356', name: 'SBI Bluechip Fund - Direct Growth' },
    { code: '120505', name: 'Axis Midcap Fund - Direct Growth' },
    { code: '118989', name: 'HDFC Mid-Cap Opportunities - Direct Growth' },
    { code: '120823', name: 'Kotak Equity Opp Fund - Direct Growth' },
    { code: '101206', name: 'HDFC Flexi Cap Fund - Direct Growth' },
    { code: '120447', name: 'DSP Tax Saver Fund - Direct Growth' },
    { code: '119775', name: 'Mirae Asset ELSS Tax Saver - Direct Growth' },
];

const CHART_COLORS = [
    '#ff6b35', '#f7931e', '#06b6d4', '#10b981', '#8b5cf6',
    '#ef4444', '#ec4899', '#f59e0b', '#14b8a6', '#6366f1',
    '#84cc16', '#0ea5e9', '#d946ef', '#fb923c', '#4f8ef7',
];

// ──────────────────────────────────────────────────────────────
// PORTFOLIO MANAGER — Firestore CRUD
// ──────────────────────────────────────────────────────────────
const PortfolioManager = {
    async load() {
        try {
            const snapshot = await db.collection("holdings").get();
            const holdings = [];
            snapshot.forEach(doc => {
                holdings.push({ id: doc.id, ...doc.data() });
            });
            return holdings;
        } catch (e) {
            console.error("Error loading holdings:", e);
            return [];
        }
    },
    async add(item) {
        // item: { type:'stock'|'mf', ticker|schemeCode, shares|units, avgCost, companyName, exchange? }
        const holdings = await this.load();
        const existing = holdings.find(h =>
            item.type === 'mf'
                ? h.type === 'mf' && h.schemeCode === item.schemeCode
                : h.type !== 'mf' && h.ticker === item.ticker.toUpperCase()
        );

        if (existing) {
            const totalUnits = existing.shares + item.shares;
            const newAvgCost = (existing.shares * existing.avgCost + item.shares * item.avgCost) / totalUnits;
            await db.collection("holdings").doc(existing.id).update({
                shares: totalUnits,
                avgCost: newAvgCost,
                companyName: item.companyName || existing.companyName
            });
        } else {
            const key = item.type === 'mf' ? item.schemeCode : item.ticker.toUpperCase();
            await db.collection("holdings").add({
                type: item.type || 'stock',
                ticker: item.type === 'mf' ? (item.schemeCode + '.MF') : item.ticker.toUpperCase(),
                schemeCode: item.schemeCode || null,
                shares: item.shares,
                avgCost: item.avgCost,
                companyName: item.companyName || key,
                exchange: item.type === 'mf' ? 'MF' : (item.ticker.toUpperCase().endsWith('.BO') ? 'BSE' : 'NSE'),
            });
        }
    },
    async update(id, shares, avgCost) {
        await db.collection("holdings").doc(id).update({
            shares,
            avgCost
        });
    },
    async remove(id) {
        await db.collection("holdings").doc(id).delete();
    },
};

// ──────────────────────────────────────────────────────────────
// YAHOO FINANCE CLIENT (Stocks)
// ──────────────────────────────────────────────────────────────
const YahooFinanceClient = {
    normaliseTicker(raw) {
        const t = raw.trim().toUpperCase();
        if (t.endsWith('.NS') || t.endsWith('.BO')) return t;
        return t + '.NS';
    },

    async fetchQuote(ticker) {
        const r = await fetch(`/api/yahoo/quote?ticker=${encodeURIComponent(ticker)}`, {
            signal: AbortSignal.timeout(10000)
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json?.chart?.result?.[0]?.meta?.regularMarketPrice)
            throw new Error(`No price data for ${ticker}`);

        const meta = json.chart.result[0].meta;
        const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
        return {
            c: meta.regularMarketPrice,
            pc: prev,
            d: meta.regularMarketPrice - prev,
            dp: prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : 0,
            name: meta.longName || meta.shortName || ticker,
            currency: meta.currency || 'INR',
        };
    },

    async searchSymbol(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const localMatches = POPULAR_INDIAN_STOCKS.filter(s =>
            s.symbol.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q)
        ).map(s => ({ symbol: s.symbol, description: s.name, type: 'Equity' }));

        try {
            const r = await fetch(`/api/yahoo/search?q=${encodeURIComponent(query)}`, {
                signal: AbortSignal.timeout(5000)
            });
            if (r.ok) {
                const data = await r.json();
                const yahooResults = (data?.quotes || [])
                    .filter(item =>
                        item.quoteType === 'EQUITY' &&
                        (item.exchange === 'NSI' || item.exchange === 'BSE' ||
                            (item.symbol || '').endsWith('.NS') || (item.symbol || '').endsWith('.BO'))
                    )
                    .map(item => ({ symbol: item.symbol, description: item.longname || item.shortname || item.symbol, type: 'Equity' }));
                const seen = new Set(localMatches.map(m => m.symbol));
                const merged = [...localMatches];
                yahooResults.forEach(r => { if (!seen.has(r.symbol)) { merged.push(r); seen.add(r.symbol); } });
                return merged.slice(0, 8);
            }
        } catch { }
        return localMatches.slice(0, 8);
    },
};

// ──────────────────────────────────────────────────────────────
// MFAPI CLIENT (Mutual Funds — India)
// ──────────────────────────────────────────────────────────────
const MFApiClient = {
    // Cache so we don't re-fetch every 60s needlessly
    _cache: {},

    async fetchNAV(schemeCode) {
        if (this._cache[schemeCode] && (Date.now() - this._cache[schemeCode].ts < 300_000)) {
            return this._cache[schemeCode].data;
        }
        const r = await fetch(`${MF_BASE}/${schemeCode}`);
        if (!r.ok) throw new Error(`MF HTTP ${r.status}`);
        const json = await r.json();
        const latest = json?.data?.[0];
        const prev = json?.data?.[1];
        if (!latest) throw new Error('No NAV data');
        const navNow = parseFloat(latest.nav);
        const navPrev = prev ? parseFloat(prev.nav) : navNow;
        const result = {
            c: navNow,
            pc: navPrev,
            d: navNow - navPrev,
            dp: navPrev ? ((navNow - navPrev) / navPrev) * 100 : 0,
            name: json.meta?.scheme_name || schemeCode,
            date: latest.date,
        };
        this._cache[schemeCode] = { ts: Date.now(), data: result };
        return result;
    },

    async fetchAllNAVs(schemeCodes) {
        const results = await Promise.allSettled(
            schemeCodes.map(c => this.fetchNAV(c).then(data => ({ code: c, data })))
        );
        const map = {};
        results.forEach(r => {
            if (r.status === 'fulfilled') map[r.value.code] = r.value.data;
        });
        return map;
    },

    async search(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        // First filter popular list
        const local = POPULAR_MFS.filter(m =>
            m.name.toLowerCase().includes(q)
        ).map(m => ({ code: m.code, name: m.name }));

        try {
            const r = await fetch(`${MF_BASE}/search?q=${encodeURIComponent(query)}`);
            if (r.ok) {
                const data = await r.json();
                const seen = new Set(local.map(m => m.code));
                const remote = (data || []).map(m => ({ code: String(m.schemeCode), name: m.schemeName }));
                remote.forEach(m => { if (!seen.has(m.code)) { local.push(m); seen.add(m.code); } });
            }
        } catch { }
        return local.slice(0, 8);
    },
};

// ──────────────────────────────────────────────────────────────
// NEWS MATCHER (Free RSS Approach)
// ──────────────────────────────────────────────────────────────
const NewsFetcher = {
    async fetchNews(holdings) {
        try {
            const companyNames = holdings
                .map(h => h.companyName.split(' ')[0].replace(/[^a-zA-Z]/g, ''))
                .filter(n => n.length > 2)
                .slice(0, 3);

            let query = 'Indian Stock Market NSE BSE';
            if (companyNames.length > 0) {
                query = `${companyNames.join(' OR ')} NSE BSE`;
            }

            const apiUrl = `/api/news?q=${encodeURIComponent(query)}`;

            let xmlText = null;
            try {
                const r = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
                if (r.ok) {
                    xmlText = await r.text();
                }
            } catch { /* ignore */ }

            if (!xmlText) return [];

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
            const items = Array.from(xmlDoc.querySelectorAll('item')).slice(0, 5);

            return items.map(item => {
                const pubDateStr = item.querySelector('pubDate')?.textContent || '';
                let published = 'Recently';
                if (pubDateStr) {
                    const d = new Date(pubDateStr);
                    const diffHours = (Date.now() - d.getTime()) / (1000 * 60 * 60);
                    if (diffHours < 24) published = `${Math.floor(diffHours)}h ago`;
                    else published = `${Math.floor(diffHours / 24)}d ago`;
                }
                return {
                    title: item.querySelector('title')?.textContent || 'Market Update',
                    link: item.querySelector('link')?.textContent || '#',
                    source: item.querySelector('source')?.textContent || 'Google News',
                    published,
                };
            });
        } catch {
            // Silently return empty — news is non-critical
            return [];
        }
    }
};

// ──────────────────────────────────────────────────────────────
// CHART MANAGER
// ──────────────────────────────────────────────────────────────
// ── Sector map for Indian stocks (ticker → sector) ──
const SECTOR_MAP = {
    // Banking & Finance
    'HDFCBANK': 'Banking', 'ICICIBANK': 'Banking', 'KOTAKBANK': 'Banking',
    'SBIN': 'Banking', 'AXISBANK': 'Banking', 'BAJFINANCE': 'Finance',
    'BAJAJFINSV': 'Finance',
    // IT
    'TCS': 'IT', 'INFY': 'IT', 'WIPRO': 'IT', 'HCLTECH': 'IT',
    'TECHM': 'IT', 'LTIM': 'IT', 'MPHASIS': 'IT',
    // Energy & Oil
    'RELIANCE': 'Energy', 'ONGC': 'Energy', 'POWERGRID': 'Energy',
    'NTPC': 'Energy', 'COALINDIA': 'Energy', 'BPCL': 'Energy', 'IOC': 'Energy',
    'ADANIGREEN': 'Energy', 'TATAPOWER': 'Energy',
    // FMCG
    'HINDUNILVR': 'FMCG', 'ITC': 'FMCG', 'NESTLEIND': 'FMCG',
    'BRITANNIA': 'FMCG', 'DABUR': 'FMCG', 'MARICO': 'FMCG', 'GODREJCP': 'FMCG',
    // Auto
    'MARUTI': 'Auto', 'TATAMOTORS': 'Auto', 'BAJAJ-AUTO': 'Auto',
    'HEROMOTOCO': 'Auto', 'EICHERMOT': 'Auto', 'M&M': 'Auto',
    // Pharma
    'SUNPHARMA': 'Pharma', 'DRREDDY': 'Pharma', 'CIPLA': 'Pharma',
    'DIVISLAB': 'Pharma', 'AUROPHARMA': 'Pharma', 'BIOCON': 'Pharma',
    // Infrastructure & Conglomerate
    'LT': 'Infra', 'ADANIENT': 'Conglomerate', 'ADANIPORTS': 'Infra',
    'L&TFH': 'Finance',
    // Telecom
    'BHARTIARTL': 'Telecom',
};

function getSector(ticker) {
    const base = ticker.replace(/\.(NS|BO)$/i, '');
    return SECTOR_MAP[base] || 'Other';
}

// CHART VIEW COLORS per category
const TYPE_COLORS = { 'Stocks': '#22c55e', 'Mutual Funds': '#8b5cf6' };
const SECTOR_COLORS = [
    '#ff6b35', '#f7931e', '#06b6d4', '#10b981', '#8b5cf6',
    '#ef4444', '#ec4899', '#f59e0b', '#14b8a6', '#6366f1',
    '#84cc16', '#0ea5e9', '#d946ef', '#fb923c', '#4f8ef7',
];

const ChartManager = {
    instance: null,
    view: 'individual',   // 'individual' | 'type' | 'sector'
    _lastHoldings: [],
    _lastQuotesMap: {},

    init() {
        const ctx = document.getElementById('allocationChart').getContext('2d');
        this.instance = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor: 'rgba(0,0,0,0.25)', borderWidth: 2, hoverOffset: 8 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.label}: ${formatINR(ctx.raw)} (${ctx.parsed.toFixed(1)}%)`,
                        },
                        backgroundColor: 'rgba(14,22,40,0.95)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        padding: 12,
                    },
                },
                animation: { animateScale: true, duration: 500 },
            },
        });

        // Bind chart view tab clicks
        document.querySelectorAll('.chart-view-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setView(btn.dataset.view));
        });
    },

    setView(view) {
        this.view = view;
        document.querySelectorAll('.chart-view-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.view === view)
        );
        this.update(this._lastHoldings, this._lastQuotesMap);
    },

    update(holdings, quotesMap) {
        if (!this.instance) return;
        this._lastHoldings = holdings;
        this._lastQuotesMap = quotesMap;

        const enriched = holdings
            .map(h => {
                const q = quotesMap[h.type === 'mf' ? h.schemeCode : h.ticker];
                const price = q ? q.c : 0;
                return { ticker: displayTicker(h.ticker), name: h.companyName, value: price * h.shares, type: h.type, rawTicker: h.ticker };
            })
            .filter(h => h.value > 0);

        if (this.view === 'type') {
            this._renderTypeView(enriched);
        } else if (this.view === 'sector') {
            this._renderSectorView(enriched);
        } else {
            this._renderIndividualView(enriched);
        }
    },

    // ── View 1: Individual holdings ──
    _renderIndividualView(enriched) {
        const sorted = [...enriched].sort((a, b) => b.value - a.value);
        const total = sorted.reduce((s, h) => s + h.value, 0);

        this._applyToChart(
            sorted.map(h => h.ticker),
            sorted.map(h => h.value),
            sorted.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
        );
        el('chartCenterValue').textContent = formatINR(total);
        el('chartCenterSub').textContent = 'Total Value';

        const legend = el('chartLegend');
        legend.innerHTML = sorted.map((h, i) => {
            const pct = total > 0 ? (h.value / total * 100).toFixed(1) : '0.0';
            return `
            <div class="legend-item">
              <div class="legend-left">
                <span class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
                <span class="legend-ticker">${h.ticker}</span>
                ${h.type === 'mf' ? '<span class="ex-badge mf" style="font-size:0.55rem;padding:0.05rem 0.3rem">MF</span>' : ''}
                <span class="legend-name">${truncate(h.name, 18)}</span>
              </div>
              <span class="legend-pct">${pct}%</span>
            </div>`;
        }).join('');
    },

    // ── View 2: Stocks vs Mutual Funds ──
    _renderTypeView(enriched) {
        const stocksVal = enriched.filter(h => h.type !== 'mf').reduce((s, h) => s + h.value, 0);
        const mfVal = enriched.filter(h => h.type === 'mf').reduce((s, h) => s + h.value, 0);
        const total = stocksVal + mfVal;

        const slices = [];
        if (stocksVal > 0) slices.push({ label: 'Stocks', value: stocksVal, color: '#22c55e' });
        if (mfVal > 0) slices.push({ label: 'Mutual Funds', value: mfVal, color: '#8b5cf6' });

        this._applyToChart(slices.map(s => s.label), slices.map(s => s.value), slices.map(s => s.color));
        el('chartCenterValue').textContent = formatINR(total);
        el('chartCenterSub').textContent = 'Total Value';

        const legend = el('chartLegend');
        legend.innerHTML = slices.map(s => {
            const pct = total > 0 ? (s.value / total * 100).toFixed(1) : '0.0';
            return `
            <div class="legend-item legend-item-large">
              <div class="legend-left">
                <span class="legend-dot" style="background:${s.color};width:12px;height:12px"></span>
                <span class="legend-ticker" style="font-size:0.9rem">${s.label}</span>
              </div>
              <div class="legend-right-stack">
                <span class="legend-pct">${pct}%</span>
                <span class="legend-val">${formatINR(s.value)}</span>
              </div>
            </div>`;
        }).join('');
    },

    // ── View 3: Sector breakdown ──
    _renderSectorView(enriched) {
        // Group by sector
        const sectors = {};
        enriched.forEach(h => {
            const sec = h.type === 'mf' ? 'Mutual Funds' : getSector(h.rawTicker);
            sectors[sec] = (sectors[sec] || 0) + h.value;
        });

        const sorted = Object.entries(sectors).sort((a, b) => b[1] - a[1]);
        const total = sorted.reduce((s, [, v]) => s + v, 0);

        // Assign colors — MF always purple, others cycle
        let colorIdx = 0;
        const colorFor = (label) => {
            if (label === 'Mutual Funds') return '#8b5cf6';
            return SECTOR_COLORS[colorIdx++ % SECTOR_COLORS.length];
        };
        const colors = sorted.map(([label]) => colorFor(label));

        this._applyToChart(sorted.map(([l]) => l), sorted.map(([, v]) => v), colors);
        el('chartCenterValue').textContent = formatINR(total);
        el('chartCenterSub').textContent = 'By Sector';

        const legend = el('chartLegend');
        legend.innerHTML = sorted.map(([label, value], i) => {
            const pct = total > 0 ? (value / total * 100).toFixed(1) : '0.0';
            return `
            <div class="legend-item">
              <div class="legend-left">
                <span class="legend-dot" style="background:${colors[i]}"></span>
                <span class="legend-ticker">${label}</span>
              </div>
              <div class="legend-right-stack">
                <span class="legend-pct">${pct}%</span>
                <span class="legend-val">${formatINR(value)}</span>
              </div>
            </div>`;
        }).join('');
    },

    _applyToChart(labels, data, colors) {
        this.instance.data.labels = labels;
        this.instance.data.datasets[0].data = data;
        this.instance.data.datasets[0].backgroundColor = colors;
        this.instance.update('active');
    },
};

// ──────────────────────────────────────────────────────────────
// UTILITY HELPERS
// ──────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function show(id) { el(id).classList.remove('hidden'); }
function hide(id) { el(id).classList.add('hidden'); }

function formatINR(n) {
    if (n == null || isNaN(n)) return '—';
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPct(n) {
    if (n == null || isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
function colorClass(n) {
    if (!n && n !== 0) return 'neutral';
    return n > 0 ? 'gain' : n < 0 ? 'loss' : 'neutral';
}
function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '…' : str;
}
function timeAgo(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
}
function displayTicker(ticker) {
    return ticker.replace(/\.(NS|BO|MF)$/i, '');
}
function tickerInitials(ticker) {
    return displayTicker(ticker).slice(0, 2).toUpperCase();
}

// ──────────────────────────────────────────────────────────────
// MAIN APP STATE
// ──────────────────────────────────────────────────────────────
const App = {
    quotesMap: {},    // key: ticker (for stocks) or schemeCode (for MFs)
    lastRefresh: null,
    refreshTimer: null,
    sortKey: null,
    sortDir: 1,
    editingId: null,
    deleteTargetId: null,
    searchTimeout: null,
    currentType: 'stock',   // 'stock' | 'mf'
    currentExchange: 'NSE',
    portfolioFilter: 'all', // 'all' | 'stock' | 'mf'
    _lastEnriched: [],      // cache for re-render without re-fetch

    // ─── BOOTSTRAP ───
    init() {
        ChartManager.init();
        this.bindEvents();
        this.renderPopularSuggestions();

        if (localStorage.getItem('stocklens_charts_hidden') === 'true') {
            document.querySelector('.main-content').classList.add('charts-hidden');
            el('toggleChartsText').textContent = 'Show Charts';
        }

        show('app');
        this.refresh();
        this.scheduleRefresh();
    },

    // ─── EVENTS ───
    bindEvents() {
        el('refreshBtn').addEventListener('click', () => this.refresh());
        el('toggleChartsBtn').addEventListener('click', () => this.toggleCharts());
        el('addHoldingBtn').addEventListener('click', () => this.openAddModal('stock'));
        el('emptyAddStockBtn').addEventListener('click', () => this.openAddModal('stock'));
        el('emptyAddMFBtn').addEventListener('click', () => this.openAddModal('mf'));

        el('closeHoldingModal').addEventListener('click', () => this.closeHoldingModal());
        el('cancelHolding').addEventListener('click', () => this.closeHoldingModal());
        el('saveHolding').addEventListener('click', () => this.handleSaveHolding());

        // Type toggle in modal
        el('typeStock').addEventListener('click', () => this.setModalType('stock'));
        el('typeMF').addEventListener('click', () => this.setModalType('mf'));

        // Exchange toggle (stocks)
        el('exNSE').addEventListener('click', () => this.setExchange('NSE'));
        el('exBSE').addEventListener('click', () => this.setExchange('BSE'));

        // Portfolio filter toggle (All / Stocks / MF)
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setPortfolioFilter(btn.dataset.filter));
        });

        // Keyboard nav in suggestions
        el('tickerInput').addEventListener('keydown', e => this.handleSuggestionKeydown(e, 'tickerSuggestions'));

        el('tickerInput').addEventListener('input', () => this.handleTickerSearch());
        el('tickerInput').addEventListener('keydown', e => { if (e.key === 'Enter') el('sharesInput').focus(); });
        el('sharesInput').addEventListener('keydown', e => { if (e.key === 'Enter') el('avgCostInput').focus(); });
        el('avgCostInput').addEventListener('keydown', e => { if (e.key === 'Enter') this.handleSaveHolding(); });

        el('cancelDelete').addEventListener('click', () => hide('deleteModal'));
        el('confirmDelete').addEventListener('click', () => this.handleConfirmDelete());

        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => this.handleSort(th.dataset.sort));
        });

        el('addHoldingModal').addEventListener('click', e => { if (e.target === el('addHoldingModal')) this.closeHoldingModal(); });
        el('deleteModal').addEventListener('click', e => { if (e.target === el('deleteModal')) hide('deleteModal'); });

        document.addEventListener('click', e => {
            const inp = el('tickerInput');
            const sug = el('tickerSuggestions');
            if (inp && sug && !inp.contains(e.target) && !sug.contains(e.target)) hide('tickerSuggestions');
        });
    },

    // ─── PORTFOLIO FILTER ───
    setPortfolioFilter(filter) {
        this.portfolioFilter = filter;
        // Update button active states
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        // Re-render using cached enriched data
        if (this._lastEnriched.length) {
            const filtered = this._applyFilter(this._lastEnriched);
            this.renderSummaryStats(filtered);
            this.renderTable(filtered);
            this.renderNavStats(filtered);
        }
    },

    _applyFilter(enriched) {
        if (this.portfolioFilter === 'stock') return enriched.filter(h => h.type !== 'mf');
        if (this.portfolioFilter === 'mf') return enriched.filter(h => h.type === 'mf');
        return enriched;
    },

    toggleCharts() {
        const mc = document.querySelector('.main-content');
        const isHidden = mc.classList.toggle('charts-hidden');
        localStorage.setItem('stocklens_charts_hidden', isHidden);
        el('toggleChartsText').textContent = isHidden ? 'Show Charts' : 'Hide Charts';
        if (!isHidden && ChartManager.instance) {
            ChartManager.instance.resize();
        }
    },

    // ─── MODAL TYPE TOGGLE ───
    setModalType(type) {
        this.currentType = type;
        el('typeStock').classList.toggle('active', type === 'stock');
        el('typeMF').classList.toggle('active', type === 'mf');

        // Show/hide exchange toggle (only for stocks)
        el('exchangeRow').classList.toggle('hidden', type === 'mf');

        if (type === 'stock') {
            el('tickerInput').placeholder = 'e.g. RELIANCE, TCS, INFY';
            el('sharesLabel').textContent = 'Number of Shares';
            el('avgCostLabel').textContent = 'Average Buy Price (₹ per share)';
            el('avgCostInput').placeholder = 'e.g. 2500.00';
        } else {
            el('tickerInput').placeholder = 'Search fund name…';
            el('sharesLabel').textContent = 'Units Held';
            el('avgCostLabel').textContent = 'Average NAV / Unit (₹)';
            el('avgCostInput').placeholder = 'e.g. 45.23';
        }

        el('tickerInput').value = '';
        el('holdingError').textContent = '';
        hide('tickerSuggestions');
        el('tickerInput').focus();
    },

    setExchange(ex) {
        this.currentExchange = ex;
        el('exNSE').classList.toggle('active', ex === 'NSE');
        el('exBSE').classList.toggle('active', ex === 'BSE');
        el('tickerInput').placeholder = ex === 'NSE' ? 'e.g. RELIANCE, TCS, INFY' : 'e.g. RELIANCE, TCS (BSE)';
    },

    // ─── REFRESH / FETCH ───
    async refresh() {
        show('loadingState');
        hide('emptyState');
        hide('holdingsTable');
        el('refreshBtn').classList.add('spinning');

        try {
            const holdings = await PortfolioManager.load();
            if (!holdings.length) { this.renderEmpty(); return; }

            const stocks = holdings.filter(h => h.type !== 'mf');
            const mfs = holdings.filter(h => h.type === 'mf');

            const [stockQuotes, mfNAVs] = await Promise.all([
                stocks.length ? this._fetchStockQuotes(stocks) : {},
                mfs.length ? MFApiClient.fetchAllNAVs(mfs.map(h => h.schemeCode)) : {},
            ]);

            this.quotesMap = { ...stockQuotes, ...mfNAVs };
            this.lastRefresh = Date.now();
            this.renderAll(holdings);
        } catch (err) {
            console.error('Refresh error:', err);
        } finally {
            hide('loadingState');
            el('refreshBtn').classList.remove('spinning');
        }
    },

    async _fetchStockQuotes(stocks) {
        const tickers = [...new Set(stocks.map(h => h.ticker))];
        const results = await Promise.allSettled(
            tickers.map(t => YahooFinanceClient.fetchQuote(t).then(data => ({ ticker: t, data })))
        );
        const map = {};
        results.forEach(r => { if (r.status === 'fulfilled') map[r.value.ticker] = r.value.data; });
        return map;
    },

    scheduleRefresh() {
        clearInterval(this.refreshTimer);
        this.refreshTimer = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
        setInterval(() => {
            if (this.lastRefresh) el('lastUpdated').textContent = 'Updated ' + timeAgo(this.lastRefresh);
        }, 15_000);
    },



    _showToast(msg) {
        let toast = el('toastMsg');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toastMsg';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.className = 'toast show';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
    },

    // ─── RENDER ───
    renderAll(holdings) {
        if (!holdings.length) {
            this.renderEmpty();
            this.renderNews([]); // pass empty to get general market news
            return;
        }
        const enriched = this.enrich(holdings);
        this._lastEnriched = enriched; // cache for filter re-renders
        const filtered = this._applyFilter(enriched);
        this.renderSummaryStats(filtered);
        this.renderTable(filtered);
        this.renderNavStats(filtered);
        this.renderTopMovers(enriched); // always show all movers
        ChartManager.update(holdings, this.quotesMap);
        this.renderNews(holdings);
        if (this.lastRefresh) el('lastUpdated').textContent = 'Updated ' + timeAgo(this.lastRefresh);
    },

    enrich(holdings) {
        return holdings.map(h => {
            // Key into quotesMap: for MFs use schemeCode, for stocks use ticker
            const qKey = h.type === 'mf' ? h.schemeCode : h.ticker;
            const q = this.quotesMap[qKey] || {};
            const currentPrice = q.c ?? null;
            const value = currentPrice != null ? currentPrice * h.shares : null;
            const invested = h.avgCost * h.shares;
            const pnl = value != null ? value - invested : null;
            const pnlPct = invested > 0 && pnl != null ? (pnl / invested) * 100 : null;
            const dayPct = q.dp ?? null;
            const dayChange = q.d ?? null;
            return { ...h, currentPrice, value, invested, pnl, pnlPct, dayPct, dayChange, q };
        });
    },

    renderEmpty() {
        hide('holdingsTable');
        hide('loadingState');
        show('emptyState');
        ['statTotalInvested', 'statCurrentValue', 'statTotalPnl', 'statTotalPnlPct', 'statHoldingsCount',
            'navTotalValue', 'navDayPnl'].forEach(id => { if (el(id)) el(id).textContent = '—'; });
    },

    renderSummaryStats(enriched) {
        const totalInvested = enriched.reduce((s, h) => s + h.invested, 0);
        const totalValue = enriched.filter(h => h.value != null).reduce((s, h) => s + h.value, 0);
        const totalPnl = totalValue - totalInvested;
        const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

        // Update labels based on active filter
        const filterLabel = this.portfolioFilter === 'stock' ? ' (Stocks)'
            : this.portfolioFilter === 'mf' ? ' (MF)' : '';

        el('statLabelInvested').textContent = 'Total Invested' + filterLabel;
        el('statLabelValue').textContent = 'Current Value' + filterLabel;
        el('statLabelPnl').textContent = 'Total P&L' + filterLabel;

        el('statTotalInvested').textContent = formatINR(totalInvested);
        el('statCurrentValue').textContent = formatINR(totalValue);

        // Show count breakdown
        const stockCount = enriched.filter(h => h.type !== 'mf').length;
        const mfCount = enriched.filter(h => h.type === 'mf').length;
        const countParts = [];
        if (stockCount) countParts.push(`${stockCount} stock${stockCount > 1 ? 's' : ''}`);
        if (mfCount) countParts.push(`${mfCount} MF${mfCount > 1 ? 's' : ''}`);
        el('statHoldingsCount').textContent = countParts.join(' + ') || enriched.length;

        el('statTotalPnl').textContent = formatINR(totalPnl);
        el('statTotalPnl').className = 'stat-value ' + colorClass(totalPnl);

        const badge = el('statTotalPnlPct');
        badge.textContent = formatPct(totalPnlPct);
        badge.className = 'stat-badge ' + (totalPnl >= 0 ? 'gain-badge' : 'loss-badge');

        el('totalPnlIcon').className = 'stat-icon ' + (totalPnl >= 0 ? 'green' : 'red');
    },

    renderNavStats(enriched) {
        const totalValue = enriched.filter(h => h.value != null).reduce((s, h) => s + h.value, 0);
        const filterLabel = this.portfolioFilter === 'stock' ? 'Stocks Value'
            : this.portfolioFilter === 'mf' ? 'MF Value' : 'Portfolio Value';
        el('navValueLabel').textContent = filterLabel;
        el('navTotalValue').textContent = formatINR(totalValue);

        // Day P&L: MF NAVs update daily, so dayChange for MFs is day's NAV move
        const dayPnl = enriched.reduce((s, h) => s + (h.dayChange != null ? h.dayChange * h.shares : 0), 0);
        const dayEl = el('navDayPnl');
        dayEl.textContent = (dayPnl >= 0 ? '+' : '-') + formatINR(Math.abs(dayPnl));
        dayEl.className = 'nav-stat-value ' + colorClass(dayPnl);
    },

    // ─── TABLE ───
    renderTable(enriched) {
        let sorted = [...enriched];
        if (this.sortKey) {
            sorted.sort((a, b) => {
                let av = a[this.sortKey], bv = b[this.sortKey];
                if (typeof av === 'string') return this.sortDir * av.localeCompare(bv);
                av = av ?? -Infinity; bv = bv ?? -Infinity;
                return this.sortDir * (av - bv);
            });
        } else {
            // Default: stocks first, then MFs
            sorted.sort((a, b) => {
                if (a.type === b.type) return 0;
                return a.type === 'stock' ? -1 : 1;
            });
        }

        const tbody = el('holdingsBody');
        let html = '';
        let lastType = null;
        sorted.forEach(h => {
            if (h.type !== lastType) {
                // Section header row
                const label = h.type === 'mf' ? '📊 Mutual Funds' : '📈 Stocks';
                html += `<tr class="section-header-row"><td colspan="10">${label}</td></tr>`;
                lastType = h.type;
            }
            html += this.rowHTML(h);
        });
        tbody.innerHTML = html;

        hide('emptyState');
        hide('loadingState');
        show('holdingsTable');

        tbody.querySelectorAll('.btn-edit-row').forEach(btn => {
            btn.addEventListener('click', () => this.openEditModal(btn.dataset.id));
        });
        tbody.querySelectorAll('.btn-del-row').forEach(btn => {
            btn.addEventListener('click', () => this.openDeleteModal(btn.dataset.id, btn.dataset.ticker));
        });
    },

    rowHTML(h) {
        const isMF = h.type === 'mf';
        const dt = displayTicker(h.ticker);
        const exBadge = isMF
            ? '<span class="ex-badge mf">MF</span>'
            : (h.ticker.endsWith('.BO') ? '<span class="ex-badge bse">BSE</span>' : '<span class="ex-badge nse">NSE</span>');

        const priceLabel = isMF ? 'NAV' : '';
        const priceStr = h.currentPrice != null
            ? (isMF ? `<span class="nav-label">NAV</span> ${formatINR(h.currentPrice)}` : formatINR(h.currentPrice))
            : '<span class="neutral">—</span>';
        const valueStr = h.value != null ? formatINR(h.value) : '—';
        const pnlStr = h.pnl != null ? formatINR(h.pnl) : '—';
        const unitsLabel = isMF ? 'units' : '';

        const dayBadge = h.dayPct != null
            ? `<span class="pct-badge ${colorClass(h.dayPct)}">${formatPct(h.dayPct)}</span>`
            : '<span class="pct-badge neutral">—</span>';
        const pnlPctBadge = h.pnlPct != null
            ? `<span class="pct-badge ${colorClass(h.pnlPct)}">${formatPct(h.pnlPct)}</span>`
            : '<span class="pct-badge neutral">—</span>';

        const rowClass = isMF ? 'mf-row' : '';

        return `
      <tr class="${rowClass}">
        <td>
          <div class="ticker-cell">
            <div class="ticker-badge ${isMF ? 'mf-badge' : ''}">${tickerInitials(h.ticker)}</div>
            <div>
              <span class="ticker-symbol">${dt}</span>
              ${exBadge}
            </div>
          </div>
        </td>
        <td><span class="company-name" title="${h.companyName}">${truncate(h.companyName, 24)}</span></td>
        <td class="num">${h.shares.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
        <td class="num">${formatINR(h.avgCost)}</td>
        <td class="num ${colorClass(h.dayPct)}">${priceStr}</td>
        <td class="num">${valueStr}</td>
        <td class="num">${dayBadge}</td>
        <td class="num ${colorClass(h.pnl)}">${pnlStr}</td>
        <td class="num">${pnlPctBadge}</td>
        <td>
          <div class="row-actions">
            <button class="btn-row-action btn-edit-row" data-id="${h.id}" title="Edit">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-row-action del btn-del-row" data-id="${h.id}" data-ticker="${h.ticker}" title="Remove">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    },

    async handleSort(key) {
        if (this.sortKey === key) { this.sortDir *= -1; }
        else { this.sortKey = key; this.sortDir = key === 'ticker' ? 1 : -1; }
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            if (th.dataset.sort === this.sortKey) th.classList.add(this.sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
        });
        const holdings = await PortfolioManager.load();
        this.renderTable(this.enrich(holdings));
    },

    // ─── TOP MOVERS ───
    renderTopMovers(enriched) {
        const withData = enriched.filter(h => h.dayPct != null).sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct));
        const container = el('topMovers');
        if (!withData.length) { container.innerHTML = '<p class="muted-text">No data yet</p>'; return; }

        container.innerHTML = withData.slice(0, 5).map(h => `
      <div class="mover-item">
        <div class="mover-left">
          <div class="ticker-badge ${h.type === 'mf' ? 'mf-badge' : ''}" style="width:30px;height:30px;font-size:0.65rem">${tickerInitials(h.ticker)}</div>
          <div>
            <div class="mover-ticker">${displayTicker(h.ticker)} ${h.type === 'mf' ? '<span class="ex-badge mf" style="font-size:0.55rem">MF</span>' : ''}</div>
            <div class="mover-price">${h.currentPrice != null ? formatINR(h.currentPrice) : '—'}</div>
          </div>
        </div>
        <span class="mover-change ${colorClass(h.dayPct)}">${formatPct(h.dayPct)}</span>
      </div>`).join('');
    },

    // ─── NEWS HTML RENDERING ───
    async renderNews(holdings) {
        const container = el('newsContainer');
        if (!container) return;

        container.innerHTML = `
            <div style="display: flex; justify-content: center; padding: 2rem;">
                <div class="spinner"></div>
            </div>
        `;

        const articles = await NewsFetcher.fetchNews(holdings);

        if (!articles.length) {
            container.innerHTML = `<p class="muted-text">Check your internet connection to view latest market news.</p>`;
            return;
        }

        container.innerHTML = articles.map(a => `
            <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="news-item">
                <div class="news-content">
                    <h4 class="news-title">${a.title}</h4>
                    <div class="news-meta">
                        <span class="news-source">${a.source}</span>
                        <span class="news-date">${a.published}</span>
                    </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="news-arrow">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </a>
        `).join('');
    },

    // ─── POPULAR CHIPS ───
    renderPopularSuggestions() {
        const container = el('popularChips');
        if (!container) return;
        const featured = POPULAR_INDIAN_STOCKS.slice(0, 6);
        container.innerHTML = featured.map(s => {
            const dt = displayTicker(s.symbol);
            return `<button class="chip-btn" data-symbol="${s.symbol}" data-name="${s.name}">${dt}</button>`;
        }).join('');
        container.querySelectorAll('.chip-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openAddModal('stock');
                el('tickerInput').value = displayTicker(btn.dataset.symbol);
                this.setExchange('NSE');
                setTimeout(() => el('sharesInput').focus(), 100);
            });
        });
    },

    // ─── ADD / EDIT MODAL ───
    openAddModal(type = 'stock') {
        this.editingId = null;
        el('holdingModalTitle').textContent = 'Add Holding';
        el('saveHolding').textContent = 'Add to Portfolio';
        el('tickerInput').disabled = false;
        el('tickerInput').value = '';
        el('sharesInput').value = '';
        el('avgCostInput').value = '';
        el('holdingError').textContent = '';
        this.setExchange('NSE');
        this.setModalType(type);
        hide('tickerSuggestions');
        show('addHoldingModal');
        setTimeout(() => el('tickerInput').focus(), 50);
    },

    async openEditModal(id) {
        const holdings = await PortfolioManager.load();
        const h = holdings.find(h => h.id === id);
        if (!h) return;
        this.editingId = id;
        el('holdingModalTitle').textContent = `Edit ${displayTicker(h.ticker)}`;
        el('saveHolding').textContent = 'Save Changes';

        this.setModalType(h.type || 'stock');
        if (h.type !== 'mf') {
            this.currentExchange = h.ticker.endsWith('.BO') ? 'BSE' : 'NSE';
            this.setExchange(this.currentExchange);
        }

        el('tickerInput').value = h.type === 'mf' ? h.companyName : displayTicker(h.ticker);
        el('tickerInput').disabled = true;
        if (h.type === 'mf') {
            el('tickerInput').dataset.selectedSchemeCode = h.schemeCode;
            el('tickerInput').dataset.selectedName = h.companyName;
        }

        el('sharesInput').value = h.shares;
        el('avgCostInput').value = h.avgCost.toFixed(4);
        el('holdingError').textContent = '';

        hide('tickerSuggestions');
        show('addHoldingModal');
        setTimeout(() => el('sharesInput').focus(), 50);
    },

    closeHoldingModal() {
        hide('addHoldingModal');
        hide('tickerSuggestions');
        this.editingId = null;
        clearTimeout(this.searchTimeout);
    },

    async handleSaveHolding() {
        const shares = parseFloat(el('sharesInput').value);
        const avgCost = parseFloat(el('avgCostInput').value);
        const errEl = el('holdingError');
        errEl.textContent = '';

        if (isNaN(shares) || shares <= 0) { errEl.textContent = `Please enter a valid number of ${this.currentType === 'mf' ? 'units' : 'shares'}.`; return; }
        if (isNaN(avgCost) || avgCost <= 0) { errEl.textContent = 'Please enter a valid price in ₹.'; return; }

        if (this.currentType === 'mf') {
            await this._saveMFHolding(shares, avgCost, errEl);
        } else {
            await this._saveStockHolding(shares, avgCost, errEl);
        }
    },

    async _saveStockHolding(shares, avgCost, errEl) {
        const rawTicker = el('tickerInput').value.trim();
        if (!rawTicker) { errEl.textContent = 'Please enter a ticker symbol.'; return; }
        const suffix = this.currentExchange === 'BSE' ? '.BO' : '.NS';
        const ticker = (rawTicker.toUpperCase().endsWith('.NS') || rawTicker.toUpperCase().endsWith('.BO'))
            ? rawTicker.toUpperCase()
            : rawTicker.toUpperCase() + suffix;

        const btn = el('saveHolding');
        btn.disabled = true; btn.textContent = 'Saving…';

        try {
            let companyName = rawTicker.toUpperCase();
            try {
                const q = await YahooFinanceClient.fetchQuote(ticker);
                if (q.name) companyName = q.name;
            } catch {
                const pop = POPULAR_INDIAN_STOCKS.find(s => s.symbol === ticker);
                if (pop) companyName = pop.name;
            }

            if (this.editingId) {
                await PortfolioManager.update(this.editingId, shares, avgCost);
            } else {
                await PortfolioManager.add({ type: 'stock', ticker, shares, avgCost, companyName });
            }
            this.closeHoldingModal();
            await this.refresh();
        } finally {
            btn.disabled = false; btn.textContent = this.editingId ? 'Save Changes' : 'Add to Portfolio';
        }
    },

    async _saveMFHolding(shares, avgCost, errEl) {
        // tickerInput holds either the search text or selected fund name
        // We need the schemeCode from the selected suggestion
        const schemeCode = el('tickerInput').dataset.selectedSchemeCode;
        const name = el('tickerInput').dataset.selectedName || el('tickerInput').value.trim();

        if (!schemeCode) { errEl.textContent = 'Please select a mutual fund from the suggestions.'; return; }

        const btn = el('saveHolding');
        btn.disabled = true; btn.textContent = 'Saving…';

        try {
            if (this.editingId) {
                await PortfolioManager.update(this.editingId, shares, avgCost);
            } else {
                await PortfolioManager.add({ type: 'mf', schemeCode, shares, avgCost, companyName: name });
            }
            this.closeHoldingModal();
            await this.refresh();
        } finally {
            btn.disabled = false; btn.textContent = this.editingId ? 'Save Changes' : 'Add to Portfolio';
        }
    },

    // ─── DELETE ───
    openDeleteModal(id, ticker) {
        this.deleteTargetId = id;
        el('deleteModalMsg').textContent = `Remove ${displayTicker(ticker)} from your portfolio ? This cannot be undone.`;
        show('deleteModal');
    },

    async handleConfirmDelete() {
        if (!this.deleteTargetId) return;
        await PortfolioManager.remove(this.deleteTargetId);
        this.deleteTargetId = null;
        hide('deleteModal');
        await this.refresh();
    },

    // ─── TICKER SEARCH (stocks) or MF SEARCH ───
    handleSuggestionKeydown(e, dropdownId) {
        const dropdown = el(dropdownId);
        if (!dropdown || dropdown.classList.contains('hidden')) return;

        const items = Array.from(dropdown.querySelectorAll('.suggestion-item'));
        if (!items.length) return;

        let activeIdx = items.findIndex(item => item.classList.contains('active'));

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = activeIdx < items.length - 1 ? activeIdx + 1 : 0;
            this._updateSuggestionSelection(items, activeIdx, dropdown);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = activeIdx > 0 ? activeIdx - 1 : items.length - 1;
            this._updateSuggestionSelection(items, activeIdx, dropdown);
        } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault();
            items[activeIdx].click();
        }
    },

    _updateSuggestionSelection(items, activeIdx, dropdown) {
        items.forEach((item, idx) => {
            if (idx === activeIdx) {
                item.classList.add('active');
                // Ensure visible
                const itemTop = item.offsetTop;
                const itemBottom = itemTop + item.offsetHeight;
                if (itemTop < dropdown.scrollTop) {
                    dropdown.scrollTop = itemTop;
                } else if (itemBottom > dropdown.scrollTop + dropdown.clientHeight) {
                    dropdown.scrollTop = itemBottom - dropdown.clientHeight;
                }
            } else {
                item.classList.remove('active');
            }
        });
    },

    handleTickerSearch() {
        clearTimeout(this.searchTimeout);
        const query = el('tickerInput').value.trim();
        // Clear stored selection when user types
        el('tickerInput').dataset.selectedSchemeCode = '';
        el('tickerInput').dataset.selectedName = '';

        if (!query) { hide('tickerSuggestions'); return; }

        this.searchTimeout = setTimeout(async () => {
            try {
                if (this.currentType === 'mf') {
                    await this._showMFSuggestions(query);
                } else {
                    await this._showStockSuggestions(query);
                }
            } catch { hide('tickerSuggestions'); }
        }, 300);
    },

    async _showStockSuggestions(query) {
        const results = await YahooFinanceClient.searchSymbol(query);
        const dropdown = el('tickerSuggestions');
        if (!results.length) { hide('tickerSuggestions'); return; }

        dropdown.innerHTML = results.map(r => {
            const dt = displayTicker(r.symbol);
            const ex = r.symbol.endsWith('.BO') ? 'BSE' : 'NSE';
            return `<div class="suggestion-item" data-symbol="${r.symbol}" data-name="${r.description || r.symbol}">
              <div class="suggestion-left">
                <span class="suggestion-ticker">${dt}</span>
                <span class="ex-badge ${ex.toLowerCase()}">${ex}</span>
                <span class="suggestion-name">${r.description || ''}</span>
              </div>
              <div class="suggestion-right">
                <span class="suggestion-price muted-text" style="font-size:0.75rem">...</span>
              </div>
            </div>`;
        }).join('');

        dropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const sym = item.dataset.symbol;
                el('tickerInput').value = displayTicker(sym);
                const ex = sym.endsWith('.BO') ? 'BSE' : 'NSE';
                this.setExchange(ex);
                hide('tickerSuggestions');
                el('sharesInput').focus();
            });
        });
        show('tickerSuggestions');

        // Fetch prices asynchronously
        results.forEach(async (r) => {
            try {
                const quote = await YahooFinanceClient.fetchQuote(r.symbol);
                const itemEl = dropdown.querySelector(`[data-symbol="${r.symbol}"]`);
                if (itemEl) {
                    const priceContainer = itemEl.querySelector('.suggestion-right');
                    const colorClass = quote.dp > 0 ? 'gain' : (quote.dp < 0 ? 'loss' : 'neutral');
                    priceContainer.innerHTML =
                        `<span class="suggestion-price" style="font-weight:600">${formatINR(quote.c)}</span>
                        <span class="${colorClass}" style="font-size:0.75rem">${formatPct(quote.dp)}</span>`;
                }
            } catch (e) { }
        });
    },

    async _showMFSuggestions(query) {
        const results = await MFApiClient.search(query);
        const dropdown = el('tickerSuggestions');
        if (!results.length) { hide('tickerSuggestions'); return; }

        dropdown.innerHTML = results.map(r =>
            `<div class="suggestion-item mf-suggestion" data-code="${r.code}" data-name="${r.name}">
                <div class="suggestion-left">
                  <span class="ex-badge mf">MF</span>
                  <span class="suggestion-ticker mf-ticker">${r.code}</span>
                  <span class="suggestion-name">${r.name}</span>
                </div>
                <div class="suggestion-right">
                  <span class="suggestion-price muted-text" style="font-size:0.75rem">...</span>
                </div>
            </div>`
        ).join('');

        dropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                el('tickerInput').value = item.dataset.name;
                el('tickerInput').dataset.selectedSchemeCode = item.dataset.code;
                el('tickerInput').dataset.selectedName = item.dataset.name;
                hide('tickerSuggestions');
                el('sharesInput').focus();
            });
        });
        show('tickerSuggestions');

        // Fetch NAVs asynchronously
        results.forEach(async (r) => {
            try {
                const navData = await MFApiClient.fetchNAV(r.code);
                const itemEl = dropdown.querySelector(`[data-code="${r.code}"]`);
                if (itemEl) {
                    const priceContainer = itemEl.querySelector('.suggestion-right');
                    const colorClass = navData.dp > 0 ? 'gain' : (navData.dp < 0 ? 'loss' : 'neutral');
                    priceContainer.innerHTML =
                        `<span class="suggestion-price" style="font-weight:600">${formatINR(navData.c)}</span>
                        <span class="${colorClass}" style="font-size:0.75rem">${formatPct(navData.dp)}</span>`;
                }
            } catch (e) { }
        });
    },
};

// ──────────────────────────────────────────────────────────────
// BOOT
// ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
