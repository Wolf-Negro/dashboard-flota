let currentSection = 'dashboard';
let apiData = null;
let todayData = null; // Persistencia de métricas de hoy
let pipelineData = null; // Persistencia de datos del pipeline
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
    if (cards.length >= 7) {
        cards[0].innerText = formatCurrency(today.spend);
        cards[1].innerText = safeNumber(today.messages).toLocaleString();
        cards[2].innerText = safeNumber(today.leads).toLocaleString();
        cards[3].innerText = formatCurrency(today.cpm);
        cards[4].innerText = formatCurrency(today.cpl);
        cards[5].innerText = `${safeNumber(today.ctr).toFixed(2)}%`;
        cards[6].innerText = formatCurrency(today.cpm_avg);
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
    const titles = { 'dashboard': 'Dashboard General', 'metrics': 'Métricas Diarias', 'pipeline': 'Visitas Agendadas' };
    const subtitles = { 'dashboard': 'Visualización en tiempo real de Meta Ads', 'pipeline': 'Estado actual de los leads dentro del proceso comercial' };

    if (pageTitle) {
        pageTitle.textContent = titles[section] || 'Dashboard';
        const subtitleEl = pageTitle.nextElementSibling;
        if (subtitleEl && subtitleEl.tagName === 'P') {
            subtitleEl.textContent = subtitles[section] || 'Métricas y resultados';
        }
    }
    renderCurrentSection();
}

function renderCurrentSection() {
    if (!apiData && currentSection !== 'pipeline') return;
    try {
        if (currentSection === 'dashboard') renderDashboard();
        else if (currentSection === 'metrics') renderMetricsTable();
        else if (currentSection === 'pipeline') renderPipelineWrapper();
        lucide.createIcons();
    } catch (err) {
        console.error("Render Error:", err);
        renderError("Error al dibujar la interfaz: " + err.message);
    }
}

async function fetchPipelineData() {
    try {
        const response = await fetch('/api/pipeline');
        const result = await response.json();
        if (result.status === 'success') {
            pipelineData = result.data;
            if (currentSection === 'pipeline') {
                renderPipeline();
            }
        } else {
            if (currentSection === 'pipeline') {
                contentArea.innerHTML = `<p class="text-red-500 font-bold p-8">Error obteniendo Pipeline: ${result.message}</p>`;
            }
        }
    } catch (err) {
        console.error("Pipeline Fetch Error:", err);
    }
}

function renderPipelineWrapper() {
    if (pipelineData) {
        renderPipeline();
    } else {
        contentArea.innerHTML = '<div class="flex flex-col items-center justify-center min-h-[50vh]"><div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-violet-500 mb-4"></div><p class="text-slate-500 font-medium">Conectando con GoHighLevel...</p></div>';
        fetchPipelineData();
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
            <section class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative">
                    <div class="flex justify-between items-start mb-4">
                        <div class="w-12 h-12 bg-violet-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-violet-600/30">
                            <i data-lucide="zap" class="w-6 h-6"></i>
                        </div>
                        <span class="bg-violet-100 text-violet-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase">Actual</span>
                    </div>
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Inversión Hoy</p>
                    <h4 class="text-2xl font-black text-[#1E0B42] text-loading">...</h4>
                </div>
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative">
                    <div class="flex justify-between items-start mb-4">
                        <div class="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-orange-500/30">
                            <i data-lucide="users" class="w-6 h-6"></i>
                        </div>
                        <span class="bg-orange-100 text-orange-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase">Live</span>
                    </div>
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Mensajes Hoy</p>
                    <h4 class="text-2xl font-black text-[#1E0B42] text-loading">...</h4>
                </div>
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative">
                    <div class="flex justify-between items-start mb-4">
                        <div class="w-12 h-12 bg-rose-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-rose-500/30">
                            <i data-lucide="target" class="w-6 h-6"></i>
                        </div>
                        <span class="bg-rose-100 text-rose-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase">Live</span>
                    </div>
                    <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Leads Hoy</p>
                    <h4 class="text-2xl font-black text-[#1E0B42] text-loading">...</h4>
                </div>
            </section>

            <!-- 2. EMBUDO PUBLICITARIO -->
            <section class="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                <div class="flex items-center justify-between mb-10">
                    <div>
                        <h3 class="text-xl font-bold text-[#1E0B42]">Embudo de Conversión</h3>
                        <p class="text-slate-400 text-xs uppercase tracking-widest font-bold">Rendimiento mensual del funnel</p>
                    </div>
                </div>
                ${renderFunnel()}
            </section>

            <!-- 3. GRÁFICOS PRINCIPALES -->
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

            <!-- 4. COMPARATIVA DIARIA -->
            <section class="w-full">
                <div class="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm">
                    <h3 class="text-xl font-bold text-[#1E0B42] mb-1">Resultados Diarios</h3>
                    <p class="text-slate-400 text-xs mb-8">Diferenciación de Mensajes y Leads</p>
                    <div class="h-[300px] w-full"><canvas id="barChart"></canvas></div>
                </div>
            </section>

            <!-- 5. KPIS SECUNDARIOS Y COSTOS DE EFICIENCIA -->
            <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
    const visits = safeNumber(kpi.visitsTotal);
    const messages = safeNumber(kpi.mensajesTotales);
    const leads = safeNumber(kpi.leadsTotales);

    const contactos = messages + leads;

    const ctr = reach > 0 ? ((clicks / reach) * 100).toFixed(2) : '0.00';
    const clicksToVisits = clicks > 0 ? ((visits / clicks) * 100).toFixed(2) : '0.00';
    const visitsToContacts = visits > 0 ? ((contactos / visits) * 100).toFixed(2) : '0.00';

    const spent = safeNumber(kpi.gastoTotal);
    const cpc = clicks > 0 ? (spent / clicks) : 0;
    const cpl = leads > 0 ? (spent / leads) : 0;

    return `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-12 items-center">
            <div class="md:col-span-2">
                <div class="funnel-container">
                    <!-- Stage 1: Alcance -->
                    <div class="funnel-stage stage-reach">
                        <p class="funnel-label text-slate-500">Alcance (Reach)</p>
                        <p class="funnel-value text-[#1E0B42]">${reach.toLocaleString()}</p>
                        <div class="conversion-tag text-slate-500">${ctr}% CTR</div>
                    </div>
                    <!-- Stage 2: Clics -->
                    <div class="funnel-stage stage-clicks">
                        <p class="funnel-label text-orange-600/60">Clics en el enlace</p>
                        <p class="funnel-value text-[#1E0B42]">${clicks.toLocaleString()}</p>
                        <div class="conversion-tag text-orange-500">${clicksToVisits}% Conv.</div>
                    </div>
                    <!-- Stage 3: Visitas -->
                    <div class="funnel-stage stage-visits">
                        <p class="funnel-label text-orange-700/60">Visitas a la página</p>
                        <p class="funnel-value text-[#1E0B42]">${visits.toLocaleString()}</p>
                        <div class="conversion-tag text-orange-600">${visitsToContacts}% Conv.</div>
                    </div>
                    <!-- Stage 4: Contactos -->
                    <div class="funnel-stage stage-contacts">
                        <p class="funnel-label text-white/80">Contactos generados</p>
                        <p class="funnel-value text-white mb-1">${contactos.toLocaleString()}</p>
                        <p class="text-[10px] sm:text-xs text-white/70 font-bold tracking-widest max-w-[85%] mx-auto text-center leading-tight">${messages.toLocaleString()} mensajes<br class="md:hidden"> + ${leads.toLocaleString()} leads</p>
                    </div>
                </div>
            </div>
            <div class="space-y-6">
                <!-- COSTO POR CLIC -->
                <div class="p-8 bg-violet-50/80 rounded-[2.5rem] border border-violet-100 relative group overflow-hidden">
                    <div class="absolute top-0 right-0 p-6 opacity-20 text-violet-400 group-hover:scale-110 transition-transform">
                        <i data-lucide="mouse-pointer-click" class="w-12 h-12"></i>
                    </div>
                    <p class="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-3">Costo por Clic Promedio</p>
                    <h4 class="text-4xl font-black text-[#1E0B42] mb-1">${formatCurrency(cpc)}</h4>
                    <p class="text-[10px] text-slate-400 font-medium">Inversión por cada clic generado</p>
                </div>
                <!-- COSTO POR LEAD -->
                <div class="p-8 bg-[#1E0B42] rounded-[2.5rem] relative group overflow-hidden shadow-xl shadow-violet-900/20">
                    <div class="absolute top-0 right-0 p-6 opacity-20 text-violet-300 group-hover:scale-110 transition-transform">
                        <i data-lucide="user-check" class="w-12 h-12"></i>
                    </div>
                    <p class="text-[10px] font-bold text-violet-300/60 uppercase tracking-widest mb-3">Costo por Lead Promedio</p>
                    <h4 class="text-4xl font-black text-white mb-1">${formatCurrency(cpl)}</h4>
                    <p class="text-[10px] text-violet-300/40 font-medium">Eficiencia de captación mensual</p>
                </div>
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


function renderPipeline() {
    if (!pipelineData) return;
    const { totalActive, newToday, scheduled, won, lost, stages, opportunities } = pipelineData;

    // Colores para el embudo visual
    const colors = ['bg-orange-500', 'bg-blue-500', 'bg-violet-500', 'bg-fuchsia-500', 'bg-rose-500', 'bg-emerald-500'];

    contentArea.innerHTML = `
        <!-- 1. Cards Superiores -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 animate-in slide-in-from-bottom-4 duration-500">
            <div class="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
                <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2">Oportunidades de Hoy</p>
                <h4 class="text-4xl font-black text-[#1E0B42]">${totalActive}</h4>
            </div>
            <div class="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center relative overflow-hidden">
                <div class="absolute top-0 right-0 w-24 h-24 bg-orange-500/10 rounded-bl-full -mr-4 -mt-4"></div>
                <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 relative z-10">Leads Nuevos Hoy</p>
                <h4 class="text-4xl font-black text-orange-500 relative z-10">+${newToday}</h4>
            </div>
            <div class="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
                <p class="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2">Citas Agendadas Hoy</p>
                <h4 class="text-4xl font-black text-blue-500">${scheduled}</h4>
            </div>
            <div class="bg-[#1E0B42] p-8 rounded-[2.5rem] shadow-xl text-white flex flex-col justify-center relative overflow-hidden">
                <div class="absolute inset-0 bg-gradient-to-br from-violet-600/20 to-transparent"></div>
                <p class="text-violet-300/60 text-[10px] font-bold uppercase tracking-widest mb-2 relative z-10">Ganados Hoy</p>
                <h4 class="text-4xl font-black text-emerald-400 relative z-10">${won}</h4>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <!-- 2. Embudo Visual -->
            <div class="lg:col-span-1 bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm animate-in slide-in-from-bottom-6 duration-700">
                <h3 class="text-xl font-bold text-[#1E0B42] mb-1">Distribución de Hoy</h3>
                <p class="text-slate-400 text-xs mb-8">Volumen de prospectos ingresados hoy</p>
                <div class="space-y-4">
                    ${stages.map((stage, i) => {
        const pct = totalActive > 0 ? Math.round((stage.count / totalActive) * 100) : 0;
        const colorClass = colors[i % colors.length];
        return `
                            <div>
                                <div class="flex justify-between text-sm mb-1">
                                    <span class="font-bold text-slate-700">${stage.name}</span>
                                    <span class="font-black text-[#1E0B42]">${stage.count} <span class="text-slate-400 font-medium text-xs ml-1">(${pct}%)</span></span>
                                </div>
                                <div class="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                                    <div class="${colorClass} h-3 rounded-full transition-all duration-1000" style="width: ${pct}%"></div>
                                </div>
                            </div>
                        `;
    }).join('')}
                </div>
            </div>

            <!-- 3. Tabla de Gestión -->
            <div class="lg:col-span-2 bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col animate-in slide-in-from-bottom-8 duration-700">
                <div class="p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h3 class="text-xl font-bold text-[#1E0B42] mb-1">Leads Ingresados Hoy</h3>
                        <p class="text-slate-400 text-xs">Ordenados del más reciente al más antiguo</p>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-white border-b border-slate-100">
                                <th class="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Lead</th>
                                <th class="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Etapa</th>
                                <th class="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Estado</th>
                                <th class="py-4 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Ingreso</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-50">
                            ${opportunities.map(opp => {
        const dateObj = new Date(opp.createdAt);
        const dateStr = dateObj.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        return `
                                    <tr class="hover:bg-slate-50/50 transition-colors">
                                        <td class="py-4 px-8">
                                            <p class="font-bold text-[#1E0B42] text-sm">${opp.name}</p>
                                            <p class="text-xs text-slate-400 mt-0.5">${opp.phone}</p>
                                        </td>
                                        <td class="py-4 px-8">
                                            <span class="px-3 py-1 bg-violet-50 text-violet-700 rounded-lg text-xs font-bold">${opp.stage}</span>
                                        </td>
                                        <td class="py-4 px-8">
                                            <span class="px-3 py-1 ${opp.status === 'open' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'} rounded-lg text-xs font-bold uppercase tracking-wide">${opp.status}</span>
                                        </td>
                                        <td class="py-4 px-8 text-xs font-medium text-slate-500">${dateStr}</td>
                                    </tr>
                                `;
    }).join('')}
                            ${opportunities.length === 0 ? '<tr><td colspan="4" class="py-8 text-center text-slate-400 font-medium">No hay oportunidades en el pipeline</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    lucide.createIcons();
}
