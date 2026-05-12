let currentSection = 'dashboard';
let apiData = null;
let todayData = null; // Persistencia de métricas de hoy
let charts = {};

// --- UTILS ---
const safeNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
};

const formatCurrency = (val) => {
    return `S/. ${safeNumber(val).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Selectors
const contentArea = document.getElementById('content-area');
const navBtns = document.querySelectorAll('.nav-btn');
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const pageTitle = document.getElementById('page-title');
const monthFilter = document.getElementById('month-filter');

// --- CONFIGURACIÓN DE LIMA ---
const TZ = 'America/Lima';

function getTodayString() {
    const options = { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    return formatter.format(new Date());
}

function generateMonthOptions() {
    if (!monthFilter) return;
    const todayStr = getTodayString();
    const nowParts = todayStr.split('-');
    const currentYear = nowParts[0];
    const currentMonthNum = parseInt(nowParts[1]);
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    
    monthFilter.innerHTML = '';
    for (let i = 0; i < currentMonthNum; i++) {
        const monthVal = (i + 1).toString().padStart(2, '0');
        const value = `${currentYear}-${monthVal}`;
        const text = `${monthNames[i]} ${currentYear}`;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        if ((i + 1) === currentMonthNum) option.selected = true;
        monthFilter.appendChild(option);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    generateMonthOptions();
    fetchData();
    setupEventListeners();

    // Ciclo de actualización automática (cada 5 minutos)
    setInterval(() => {
        const selectedMonth = monthFilter ? monthFilter.value : getTodayString().substring(0, 7);
        const currentMonth = getTodayString().substring(0, 7);
        if (selectedMonth === currentMonth) {
            console.log("Auto-sync: Actualizando datos en segundo plano...");
            fetchData(selectedMonth);
        }
    }, 300000); // 5 minutos
});

async function fetchData(month = '') {
    const todayStr = getTodayString();
    const currentMonth = todayStr.substring(0, 7);
    const isCurrentMonth = !month || month === currentMonth;
    const targetMonth = month || currentMonth;
    await syncWithServer(targetMonth, isCurrentMonth);
}

async function syncWithServer(month, isCurrentMonth) {
    try {
        if (!apiData) contentArea.innerHTML = '<div class="flex flex-col items-center justify-center min-h-[50vh]"><div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-violet-500 mb-4"></div><p class="text-slate-500 font-medium">Sincronizando con Meta Ads...</p></div>';
        
        const url = `/api/data?month=${month}`;
        const response = await fetch(url);
        const result = await response.json();

        if (result.status === 'error') {
            renderError(result.message);
            return;
        }

        apiData = result;
        renderCurrentSection();

        if (isCurrentMonth) {
            fetchTodayDelta();
        }
    } catch (err) {
        console.error("Sync Engine Failure:", err);
        renderError("Error de conexión con el servidor.");
    }
}

async function fetchTodayDelta() {
    try {
        const response = await fetch('/api/today');
        const result = await response.json();
        if (result.status === 'success') {
            todayData = result.data; // Guardar data persistente
            if (currentSection === 'dashboard') {
                updateHoyUIMetrics(todayData);
            }
        }
    } catch (err) {
        console.warn("Delta Update Error:", err);
    }
}

function updateHoyUIMetrics(today) {
    const cards = document.querySelectorAll('h4.text-2xl');
    if (cards.length >= 8) {
        cards[0].innerText = formatCurrency(today.spend);
        cards[1].innerText = safeNumber(today.messages).toLocaleString();
        cards[2].innerText = safeNumber(today.leads).toLocaleString();
        // cards[3] es presupuesto disponible (calculado con total mensual en renderDashboard)
        cards[4].innerText = formatCurrency(today.cpm);
        cards[5].innerText = formatCurrency(today.cpl);
        cards[6].innerText = `${safeNumber(today.ctr).toFixed(2)}%`;
        cards[7].innerText = formatCurrency(today.cpm_avg);
    }
}

function renderError(message) {
    contentArea.innerHTML = `
        <div class="flex flex-col items-center justify-center min-h-[50vh] text-center p-8 bg-white rounded-[2.5rem] border border-red-100 shadow-xl shadow-red-500/5">
            <div class="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6"><i data-lucide="alert-circle" class="w-10 h-10"></i></div>
            <h3 class="text-2xl font-bold text-slate-800 mb-2">Error de Sincronización</h3>
            <p class="text-slate-500 max-w-sm mb-8">${message}</p>
            <button onclick="window.location.reload()" class="px-8 py-3 bg-[#1E0B42] text-white rounded-2xl hover:bg-violet-900 transition-all font-bold">Reintentar Conexión</button>
        </div>
    `;
    lucide.createIcons();
}

function setupEventListeners() {
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.getAttribute('data-section');
            switchSection(section);
            if (window.innerWidth < 1024) toggleSidebar(false);
        });
    });
    if (mobileMenuToggle) mobileMenuToggle.addEventListener('click', () => toggleSidebar(true));
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
    if (monthFilter) monthFilter.addEventListener('change', (e) => fetchData(e.target.value));
}

function toggleSidebar(show) {
    if (show) {
        sidebar.classList.remove('-translate-x-full');
        sidebarOverlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        sidebarOverlay.classList.add('hidden');
    }
}

function switchSection(section) {
    currentSection = section;
    navBtns.forEach(btn => {
        if (btn.getAttribute('data-section') === section) {
            btn.classList.add('bg-violet-600', 'text-white');
            btn.classList.remove('text-violet-200/60', 'hover:bg-white/5');
        } else {
            btn.classList.remove('bg-violet-600', 'text-white');
            btn.classList.add('text-violet-200/60', 'hover:bg-white/5');
        }
    });
    const titles = { 'dashboard': 'Dashboard General', 'metrics': 'Métricas Diarias', 'campaigns': 'Análisis de Campañas', 'leads': 'Leads & Mensajes' };
    if (pageTitle) pageTitle.textContent = titles[section] || 'Dashboard';
    renderCurrentSection();
}

function renderCurrentSection() {
    if (!apiData) return;
    try {
        if (currentSection === 'dashboard') renderDashboard();
        else if (currentSection === 'metrics') renderMetricsTable();
        else if (currentSection === 'campaigns') renderCampaignsTable();
        else if (currentSection === 'leads') renderLeadsAndMessages();
        lucide.createIcons();
    } catch (err) {
        console.error("Render Error:", err);
        renderError("Error al dibujar la interfaz: " + err.message);
    }
}

function renderDashboard() {
    const kpi = apiData.kpis || {};
    const budget = safeNumber(kpi.presupuestoTotal) || 2000;
    const spent = safeNumber(kpi.gastoTotal);
    const available = Math.max(0, budget - spent);

    contentArea.innerHTML = `
        <div class="space-y-8 animate-in fade-in duration-500">
            <!-- 1. KPI CARDS HOY -->
            <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Inversión Hoy</p>
                    <h4 class="text-2xl font-black text-[#1E0B42] text-loading">...</h4>
                </div>
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Mensajes Hoy</p>
                    <h4 class="text-2xl font-black text-[#1E0B42] text-loading">...</h4>
                </div>
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Leads Hoy</p>
                    <h4 class="text-2xl font-black text-[#1E0B42] text-loading">...</h4>
                </div>
                <div class="bg-[#1E0B42] p-6 rounded-[2.5rem] shadow-xl shadow-violet-900/20">
                    <p class="text-violet-300/50 text-[10px] font-bold uppercase tracking-widest mb-1">Presupuesto Disponible</p>
                    <h4 class="text-2xl font-black text-white">${formatCurrency(available)}</h4>
                </div>

                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Costo/Mensaje Hoy</p>
                    <h4 class="text-2xl font-black text-orange-500 text-loading">...</h4>
                </div>
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Costo/Lead Hoy</p>
                    <h4 class="text-2xl font-black text-blue-500 text-loading">...</h4>
                </div>
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">CTR Promedio Hoy</p>
                    <h4 class="text-2xl font-black text-slate-800 text-loading">...</h4>
                </div>
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">CPM Promedio Hoy</p>
                    <h4 class="text-2xl font-black text-slate-800 text-loading">...</h4>
                </div>
            </section>

            <!-- 2. GRÁFICOS PRINCIPALES -->
            <section class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-2 bg-[#1E0B42] p-8 rounded-[3rem] text-white shadow-2xl shadow-violet-900/40 relative overflow-hidden">
                    <div class="relative z-10">
                        <h3 class="text-xl font-bold mb-1">Crecimiento de Resultados</h3>
                        <p class="text-violet-300/60 text-xs mb-8 uppercase tracking-widest font-bold">Evolución acumulada de conversiones</p>
                        <div class="h-[300px] w-full"><canvas id="growthChart"></canvas></div>
                    </div>
                </div>
                <div class="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center">
                    <h3 class="text-xl font-bold text-[#1E0B42] mb-1">Control de Presupuesto</h3>
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-8">Inversión mensual acumulada</p>
                    <div class="relative w-48 h-48 mb-8">
                        <canvas id="doughnutChart"></canvas>
                        <div class="absolute inset-0 flex flex-col items-center justify-center">
                            <p class="text-3xl font-black text-[#1E0B42]">${spent > 0 ? ((spent / budget) * 100).toFixed(0) : 0}%</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4 w-full">
                        <div class="bg-slate-50 p-4 rounded-2xl">
                            <p class="text-[9px] font-bold text-slate-400 uppercase mb-1">Consumido</p>
                            <p class="text-sm font-black text-slate-700">${formatCurrency(spent)}</p>
                        </div>
                        <div class="bg-violet-50 p-4 rounded-2xl">
                            <p class="text-[9px] font-bold text-violet-400 uppercase mb-1">Disponible</p>
                            <p class="text-sm font-black text-violet-700">${formatCurrency(available)}</p>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 3. EMBUDO PUBLICITARIO -->
            <section class="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                <div class="flex items-center justify-between mb-10">
                    <div>
                        <h3 class="text-xl font-bold text-[#1E0B42]">Embudo de Conversión</h3>
                        <p class="text-slate-400 text-xs uppercase tracking-widest font-bold">Rendimiento mensual del funnel</p>
                    </div>
                </div>
                ${renderFunnel()}
            </section>

            <!-- 4. COMPARATIVA DIARIA Y COSTOS -->
            <section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm">
                    <h3 class="text-xl font-bold text-[#1E0B42] mb-1">Resultados Diarios</h3>
                    <p class="text-slate-400 text-xs mb-8">Diferenciación de Mensajes y Leads</p>
                    <div class="h-[300px] w-full"><canvas id="barChart"></canvas></div>
                </div>
                <div class="bg-[#1E0B42] p-8 rounded-[3rem] text-white shadow-xl shadow-violet-900/10">
                    <h3 class="text-xl font-bold mb-1">Tendencia de Costos</h3>
                    <p class="text-violet-300/60 text-xs mb-8">Seguimiento de costos segmentados por objetivo</p>
                    <div class="h-[300px] w-full"><canvas id="costChart"></canvas></div>
                </div>
            </section>
        </div>
    `;
    initCharts();
    
    // Si ya tenemos la data de hoy, aplicarla de inmediato al volver a la pestaña
    if (todayData) {
        updateHoyUIMetrics(todayData);
    } else {
        fetchTodayDelta(); // Si no hay, forzar carga
    }
}

function renderFunnel() {
    const kpi = apiData.kpis || {};
    const reach = safeNumber(kpi.reachTotal);
    const clicks = safeNumber(kpi.clicksTotal);
    const interactions = safeNumber(kpi.interactionsTotal);
    const messages = safeNumber(kpi.mensajesTotales);
    const leads = safeNumber(kpi.leadsTotales);
    const ctr = reach > 0 ? ((clicks / reach) * 100).toFixed(2) : '0.00';

    return `
        <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 items-center">
            <div class="bg-slate-50 p-6 rounded-3xl text-center">
                <p class="text-[10px] font-bold text-slate-400 uppercase mb-2">Alcance</p>
                <p class="text-2xl font-black text-[#1E0B42]">${reach.toLocaleString()}</p>
            </div>
            <div class="hidden lg:flex justify-center text-slate-200"><i data-lucide="chevron-right"></i></div>
            <div class="bg-violet-50 p-6 rounded-3xl text-center">
                <p class="text-[10px] font-bold text-violet-400 uppercase mb-2">Clics</p>
                <p class="text-2xl font-black text-[#1E0B42]">${clicks.toLocaleString()}</p>
                <p class="text-[10px] font-bold text-violet-500 mt-1">${ctr}% CTR</p>
            </div>
            <div class="hidden lg:flex justify-center text-slate-200"><i data-lucide="chevron-right"></i></div>
            <div class="bg-orange-50 p-6 rounded-3xl text-center">
                <p class="text-[10px] font-bold text-orange-400 uppercase mb-2">Interacciones</p>
                <p class="text-2xl font-black text-[#1E0B42]">${interactions.toLocaleString()}</p>
            </div>
            <div class="hidden lg:flex justify-center text-slate-200"><i data-lucide="chevron-right"></i></div>
            <div class="bg-amber-50 p-6 rounded-3xl text-center border-2 border-amber-100">
                <p class="text-[10px] font-bold text-amber-500 uppercase mb-2">Mensajes</p>
                <p class="text-2xl font-black text-[#1E0B42]">${messages.toLocaleString()}</p>
            </div>
            <div class="hidden lg:flex justify-center text-slate-200"><i data-lucide="chevron-right"></i></div>
            <div class="bg-[#1E0B42] p-6 rounded-3xl text-center shadow-lg shadow-violet-900/20">
                <p class="text-[10px] font-bold text-violet-300/50 uppercase mb-2">Leads</p>
                <p class="text-2xl font-black text-white">${leads.toLocaleString()}</p>
            </div>
        </div>
    `;
}

function initCharts() {
    Chart.defaults.font.family = 'Outfit';
    Chart.defaults.color = '#94A3B8';
    const series = apiData.daily_series || [];
    const labels = series.map(s => s.date);

    // 1. Growth Chart
    const ctxGrowth = document.getElementById('growthChart');
    if (ctxGrowth) {
        if (charts.growth) charts.growth.destroy();
        charts.growth = new Chart(ctxGrowth, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Mensajes Acum.', data: series.map(s => s.acc_messages), borderColor: '#F97316', backgroundColor: 'transparent', tension: 0.4, borderWidth: 3, pointRadius: 2 },
                    { label: 'Leads Acum.', data: series.map(s => s.acc_leads), borderColor: '#3B82F6', backgroundColor: 'transparent', tension: 0.4, borderWidth: 3, pointRadius: 2 }
                ]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 10 }, color: '#fff' } } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } }, x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } } } }
        });
    }

    // 2. Bar Chart
    const ctxBar = document.getElementById('barChart');
    if (ctxBar) {
        if (charts.bar) charts.bar.destroy();
        charts.bar = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Mensajes', data: series.map(s => s.messages), backgroundColor: '#F97316', borderRadius: 4 },
                    { label: 'Leads', data: series.map(s => s.leads), backgroundColor: '#3B82F6', borderRadius: 4 }
                ]
            },
            options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
        });
    }

    // 3. Cost Chart
    const ctxCost = document.getElementById('costChart');
    if (ctxCost) {
        if (charts.cost) charts.cost.destroy();
        charts.cost = new Chart(ctxCost, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Costo/Msg', data: series.map(s => s.cost_per_message > 0 ? s.cost_per_message : null), borderColor: '#F97316', tension: 0.4, borderWidth: 2, pointRadius: 0 },
                    { label: 'Costo/Lead', data: series.map(s => s.cost_per_lead > 0 ? s.cost_per_lead : null), borderColor: '#3B82F6', tension: 0.4, borderWidth: 2, pointRadius: 0 }
                ]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { y: { ticks: { color: 'rgba(255,255,255,0.5)', callback: v => 'S/.' + v } }, x: { ticks: { color: 'rgba(255,255,255,0.5)' } } } }
        });
    }

    // 4. Budget Doughnut
    const ctxDoughnut = document.getElementById('doughnutChart');
    if (ctxDoughnut) {
        if (charts.doughnut) charts.doughnut.destroy();
        const spent = safeNumber(apiData.kpis.gastoTotal);
        const budget = safeNumber(apiData.kpis.presupuestoTotal) || 2000;
        const remaining = Math.max(0, budget - spent);
        charts.doughnut = new Chart(ctxDoughnut, {
            type: 'doughnut',
            data: { datasets: [{ data: [spent, remaining], backgroundColor: ['#8B5CF6', '#F1F5F9'], borderWidth: 0, cutout: '85%', borderRadius: 10 }] },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

function renderMetricsTable() {
    const series = [...(apiData.daily_series || [])].reverse();
    contentArea.innerHTML = `
        <div class="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-50/50">
                            <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha</th>
                            <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Inversión</th>
                            <th class="py-6 px-8 text-[10px] font-black text-orange-500 uppercase tracking-widest">Mensajes</th>
                            <th class="py-6 px-8 text-[10px] font-black text-blue-500 uppercase tracking-widest">Leads</th>
                            <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Costo/Msg</th>
                            <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Costo/Lead</th>
                            <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">CTR</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-50">
                        ${series.map(d => `
                            <tr class="hover:bg-slate-50/50 transition-colors">
                                <td class="py-5 px-8 font-bold text-[#1E0B42]">${d.date}</td>
                                <td class="py-5 px-8 font-medium text-slate-600">${formatCurrency(d.total_spend)}</td>
                                <td class="py-5 px-8 font-black text-orange-600">${d.messages}</td>
                                <td class="py-5 px-8 font-black text-blue-600">${d.leads}</td>
                                <td class="py-5 px-8 font-bold text-slate-500">${formatCurrency(d.cost_per_message)}</td>
                                <td class="py-5 px-8 font-bold text-slate-500">${formatCurrency(d.cost_per_lead)}</td>
                                <td class="py-5 px-8 text-slate-400 font-medium">${(safeNumber(d.clicks) / safeNumber(d.reach) * 100).toFixed(2)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function renderCampaignsTable() {
    const campaigns = apiData.campaigns || [];
    contentArea.innerHTML = `
        <div class="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
            <table class="w-full text-left">
                <thead>
                    <tr class="bg-slate-50/50">
                        <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Campaña</th>
                        <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Etapa</th>
                        <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Inversión</th>
                        <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Resultados</th>
                        <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Costo/Res</th>
                        <th class="py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">CTR</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-50">
                    ${campaigns.map(c => `
                        <tr class="hover:bg-slate-50/50 transition-colors">
                            <td class="py-5 px-8">
                                <p class="font-bold text-[#1E0B42] text-sm">${c.name}</p>
                                <p class="text-[10px] text-slate-400 font-bold uppercase">${c.objective}</p>
                            </td>
                            <td class="py-5 px-8">
                                <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase ${c.stage === 'Leads' ? 'bg-blue-50 text-blue-600' : (c.stage === 'Mensajes' ? 'bg-orange-50 text-orange-600' : 'bg-slate-100 text-slate-500')}">
                                    ${c.stage}
                                </span>
                            </td>
                            <td class="py-5 px-8 font-black text-slate-700">${formatCurrency(c.spend)}</td>
                            <td class="py-5 px-8">
                                <p class="font-black text-slate-800">${c.results}</p>
                                <p class="text-[9px] text-slate-400 uppercase font-bold">${c.result_type}</p>
                            </td>
                            <td class="py-5 px-8 font-black text-violet-600">${formatCurrency(c.cost_per_result)}</td>
                            <td class="py-5 px-8 text-slate-500 font-bold">${c.ctr}%</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderLeadsAndMessages() {
    const kpi = apiData.kpis || {};
    contentArea.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4 duration-500">
            <div class="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                <h3 class="text-2xl font-bold text-[#1E0B42] mb-10 flex items-center gap-3"><span class="w-3 h-3 bg-orange-500 rounded-full"></span> Mensajes (WhatsApp)</h3>
                <div class="space-y-6">
                    <div class="flex justify-between items-end"><p class="text-slate-400 font-bold uppercase text-xs">Total Mensajes</p><p class="text-4xl font-black text-[#1E0B42]">${kpi.mensajesTotales.toLocaleString()}</p></div>
                    <div class="flex justify-between items-end"><p class="text-slate-400 font-bold uppercase text-xs">Inversión Canal</p><p class="text-2xl font-black text-slate-700">${formatCurrency(kpi.costoPorMensaje * kpi.mensajesTotales)}</p></div>
                    <div class="bg-orange-50 p-6 rounded-3xl mt-10"><p class="text-orange-400 font-bold uppercase text-[10px] mb-1">Costo Eficiente por Mensaje</p><p class="text-4xl font-black text-orange-600">${formatCurrency(kpi.costoPorMensaje)}</p></div>
                </div>
            </div>
            <div class="bg-[#1E0B42] p-10 rounded-[3rem] text-white shadow-2xl shadow-violet-900/20">
                <h3 class="text-2xl font-bold mb-10 flex items-center gap-3"><span class="w-3 h-3 bg-blue-500 rounded-full"></span> Leads (Clientes Potenciales)</h3>
                <div class="space-y-6">
                    <div class="flex justify-between items-end"><p class="text-violet-300/50 font-bold uppercase text-xs">Total Leads</p><p class="text-4xl font-black text-white">${kpi.leadsTotales.toLocaleString()}</p></div>
                    <div class="flex justify-between items-end"><p class="text-violet-300/50 font-bold uppercase text-xs">Inversión Canal</p><p class="text-2xl font-black text-violet-200">${formatCurrency(kpi.costoPorLead * kpi.leadsTotales)}</p></div>
                    <div class="bg-white/5 p-6 rounded-3xl mt-10 border border-white/10"><p class="text-violet-300 font-bold uppercase text-[10px] mb-1">Costo Eficiente por Lead</p><p class="text-4xl font-black text-white">${formatCurrency(kpi.costoPorLead)}</p></div>
                </div>
            </div>
        </div>
    `;
}
