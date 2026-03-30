let dashboardReordersCollapsed = true;
let dashboardMaterialsCollapsed = true;

function toggleDashboardReorders() {
    dashboardReordersCollapsed = !dashboardReordersCollapsed;
    updateDashboardSectionVisibility();
}

function toggleDashboardMaterials() {
    dashboardMaterialsCollapsed = !dashboardMaterialsCollapsed;
    updateDashboardSectionVisibility();
}

function updateDashboardSectionVisibility() {
    if (dashboardReordersContent && toggleDashboardReordersButton) {
        dashboardReordersContent.classList.toggle("hidden", dashboardReordersCollapsed);
        toggleDashboardReordersButton.textContent = dashboardReordersCollapsed ? "Expand" : "Collapse";
    }

    if (dashboardMaterialsContent && toggleDashboardMaterialsButton) {
        dashboardMaterialsContent.classList.toggle("hidden", dashboardMaterialsCollapsed);
        toggleDashboardMaterialsButton.textContent = dashboardMaterialsCollapsed ? "Expand" : "Collapse";
    }
}

function renderDashboard() {
    if (!dashboardStats && !dashboardMaterials && !dashboardReorders) return;

    const closedJobs = jobs.filter(j => j.status === "CLOSED");
    const now = new Date();

    const dayStart = startOfDay(now);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    const completedToday = closedJobs.filter(j => isSameOrAfter(j.closedAt, dayStart)).length;
    const completedWeek = closedJobs.filter(j => isSameOrAfter(j.closedAt, weekStart)).length;
    const completedMonth = closedJobs.filter(j => isSameOrAfter(j.closedAt, monthStart)).length;
    const completedAll = closedJobs.length;

    const avgMs = closedJobs.length
        ? closedJobs.reduce((sum, j) => sum + (new Date(j.closedAt) - new Date(j.startedAt)), 0) / closedJobs.length
        : 0;

    if (dashboardStats) {
        dashboardStats.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-label">Completed Today</div><div class="stat-value">${completedToday}</div></div>
                <div class="stat-card"><div class="stat-label">Completed This Week</div><div class="stat-value">${completedWeek}</div></div>
                <div class="stat-card"><div class="stat-label">Completed This Month</div><div class="stat-value">${completedMonth}</div></div>
                <div class="stat-card"><div class="stat-label">Completed All Time</div><div class="stat-value">${completedAll}</div></div>
                <div class="stat-card"><div class="stat-label">Avg Turnaround</div><div class="stat-value">${avgMs ? formatDuration(0, avgMs) : "0m 0s"}</div></div>
                <div class="stat-card"><div class="stat-label">Open Jobs</div><div class="stat-value">${jobs.filter(j => j.status === "OPEN").length}</div></div>
            </div>
        `;
    }

    if (dashboardReorders) {
        const lowStockItems = inventory.filter(item => item.qtyOnHand <= item.reorderThreshold);

        dashboardReorders.innerHTML = lowStockItems.length
            ? lowStockItems.map(item => `
                <div class="alert-card ${item.qtyOnHand === 0 ? 'critical-alert-card' : ''}">
                    <strong>${escapeHtml(item.group)}</strong> — ${escapeHtml(item.name)}
                    <br>
                    Item ID: ${escapeHtml(item.itemCode)}
                    <br>
                    On Hand: ${item.qtyOnHand} ${escapeHtml(item.unit)}
                    <br>
                    Threshold: ${item.reorderThreshold} ${escapeHtml(item.unit)}
                    ${item.reorderRequestedAt ? `<br>Last Requested: ${new Date(item.reorderRequestedAt).toLocaleString()}` : ""}
                </div>
            `).join("")
            : `<div class="muted">No reorder notices</div>`;
    }

    if (dashboardMaterials) {
        const usage = {};

        for (const tx of transactions) {
            if (tx.type !== "USAGE") continue;

            const key = tx.itemGroup || tx.itemName || tx.itemCode || "Unknown";
            usage[key] = (usage[key] || 0) + Number(tx.qty || 0);
        }

        const ranked = Object.entries(usage).sort((a, b) => b[1] - a[1]);

        dashboardMaterials.innerHTML = ranked.length
            ? ranked.map(([name, qty]) => `
                <div class="row-card">
                    <div class="row-main">
                        <div class="row-title">${escapeHtml(name)}</div>
                    </div>
                    <div class="row-right">${qty}</div>
                </div>
            `).join("")
            : `<div class="muted">No material usage yet</div>`;
    }

    updateDashboardSectionVisibility();
}
