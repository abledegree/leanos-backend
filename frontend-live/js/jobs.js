let jobs = loadJobs();

let activeEditJobId = null;
let activeEditJobMaterials = [];
let activeMaterialJobId = null;

let openJobsCollapsed = true;
let closedJobsCollapsed = true;

function refreshJobState() {
    jobs = loadJobs();
    inventory = loadInventory();
    transactions = loadTransactions();

    renderJobs();

    if (typeof renderInventory === "function") {
        renderInventory();
    }

    if (typeof renderTransactions === "function") {
        renderTransactions();
    }

    if (typeof renderDashboard === "function") {
        renderDashboard();
    }
}

function toggleOpenJobsSection() {
    openJobsCollapsed = !openJobsCollapsed;
    updateJobSectionVisibility();
}

function toggleClosedJobsSection() {
    closedJobsCollapsed = !closedJobsCollapsed;
    updateJobSectionVisibility();
}

function updateJobSectionVisibility() {
    if (openJobSectionContent && toggleOpenJobsButton) {
        openJobSectionContent.classList.toggle("hidden", openJobsCollapsed);
        toggleOpenJobsButton.textContent = openJobsCollapsed ? "Expand" : "Collapse";
    }

    if (closedJobSectionContent && toggleClosedJobsButton) {
        closedJobSectionContent.classList.toggle("hidden", closedJobsCollapsed);
        toggleClosedJobsButton.textContent = closedJobsCollapsed ? "Expand" : "Collapse";
    }
}

function startJob() {
    const ticket = jobInput.value.trim();

    if (!ticket) {
        alert("Please enter a job ticket");
        return;
    }

    const exists = jobs.some(j => j.ticket === ticket && j.status === "OPEN");

    if (exists) {
        alert("An open job with that ticket already exists");
        return;
    }

    const newJob = {
        id: crypto.randomUUID(),
        ticket,
        startedAt: new Date(),
        status: "OPEN",
        closedAt: null,
        notes: "",
        materials: []
    };

    jobs.push(newJob);
    saveJobs(jobs);
    refreshJobState();

    jobInput.value = "";
}

function openJobEditModal(jobId) {
    const job = jobs.find(j => j.id === jobId);
    if (!job || !jobEditModal) return;

    activeEditJobId = jobId;
    activeEditJobMaterials = structuredClone(job.materials || []);

    editJobTicketInput.value = job.ticket || "";
    editJobStatusSelect.value = job.status || "OPEN";
    editJobStartedAtInput.value = toLocalDateTimeInputValue(job.startedAt);
    editJobClosedAtInput.value = job.closedAt ? toLocalDateTimeInputValue(job.closedAt) : "";
    editJobNotesInput.value = job.notes || "";

    toggleClosedAtInput();
    renderEditJobMaterials();

    jobEditModal.classList.remove("hidden");
}

function closeJobEditModal() {
    activeEditJobId = null;
    activeEditJobMaterials = [];

    if (editJobMaterialsList) {
        editJobMaterialsList.innerHTML = "";
    }

    if (jobEditModal) {
        jobEditModal.classList.add("hidden");
    }
}

function toggleClosedAtInput() {
    if (!editJobClosedAtInput || !editJobStatusSelect) return;

    const closed = editJobStatusSelect.value === "CLOSED";
    editJobClosedAtInput.disabled = !closed;

    if (!closed) {
        editJobClosedAtInput.value = "";
    }
}

function renderEditJobMaterials() {
    if (!editJobMaterialsList) return;

    if (!activeEditJobMaterials.length) {
        editJobMaterialsList.innerHTML = `<div class="muted">No materials logged</div>`;
        return;
    }

    editJobMaterialsList.innerHTML = activeEditJobMaterials.map((material, index) => `
        <div class="row-card" data-edit-material-index="${index}">
            <div class="form-row">
                <div class="row-details" style="flex: 1 1 260px;">
                    <strong>${escapeHtml(material.itemGroup || material.itemName || "Material")}</strong><br>
                    ${escapeHtml(material.itemName || "")}
                    ${material.itemCode ? `<br><span class="muted">Item ID: ${escapeHtml(material.itemCode)}</span>` : ""}
                </div>

                <input
                    class="edit-job-material-qty"
                    type="number"
                    step="any"
                    min="0"
                    value="${Number(material.qtyUsed) || 0}"
                    data-material-index="${index}"
                    placeholder="Qty used"
                />

                <button
                    type="button"
                    class="delete-btn"
                    onclick="removeMaterialFromEditJob(${index})"
                >
                    Remove
                </button>
            </div>
        </div>
    `).join("");
}

function removeMaterialFromEditJob(index) {
    if (!Array.isArray(activeEditJobMaterials)) return;

    activeEditJobMaterials.splice(index, 1);
    renderEditJobMaterials();
}

function collectEditedMaterialsFromModal() {
    const qtyInputs = [...document.querySelectorAll(".edit-job-material-qty")];

    return activeEditJobMaterials.map((material, index) => {
        const qtyInput = qtyInputs.find(input => Number(input.dataset.materialIndex) === index);

        return {
            ...material,
            qtyUsed: qtyInput ? Number(qtyInput.value) || 0 : Number(material.qtyUsed) || 0
        };
    }).filter(material => material.qtyUsed > 0);
}

function restoreJobMaterialsToInventory(materials) {
    for (const material of materials) {
        const item = inventory.find(i => i.id === material.itemId);
        if (item) {
            item.qtyOnHand += Number(material.qtyUsed) || 0;
        }
    }
}

function validateAndConsumeMaterials(materials) {
    for (const material of materials) {
        const item = inventory.find(i => i.id === material.itemId);

        if (!item) {
            alert(`Inventory item not found for ${material.itemName || material.itemCode || "material"}`);
            return false;
        }

        const qty = Number(material.qtyUsed) || 0;

        if (qty <= 0) {
            alert("Material quantity must be greater than 0");
            return false;
        }

        if (item.qtyOnHand < qty) {
            alert(`Not enough inventory for ${item.group} / ${item.name} [${item.itemCode || ""}]`);
            return false;
        }
    }

    for (const material of materials) {
        const item = inventory.find(i => i.id === material.itemId);
        item.qtyOnHand -= Number(material.qtyUsed) || 0;
    }

    return true;
}

function rebuildUsageTransactionsForJob(job, materials) {
    transactions = transactions.filter(tx =>
        !(tx.type === "USAGE" && tx.jobId === job.id)
    );

    for (const material of materials) {
        transactions.push({
            id: crypto.randomUUID(),
            type: "USAGE",
            timestamp: new Date(),
            itemId: material.itemId,
            itemCode: material.itemCode || "",
            itemName: material.itemName || "",
            itemGroup: material.itemGroup || "",
            qty: Number(material.qtyUsed) || 0,
            unit: material.unit || "",
            jobId: job.id,
            jobTicket: job.ticket,
            note: "Material used on job"
        });
    }

    saveTransactions(transactions);
}

function saveEditedJob() {
    const job = jobs.find(j => j.id === activeEditJobId);

    if (!job) {
        alert("Job not found");
        return;
    }

    const ticket = editJobTicketInput.value.trim();
    if (!ticket) {
        alert("Job ticket is required");
        return;
    }

    const startedAt = parseDateTimeInput(editJobStartedAtInput.value);
    if (!startedAt) {
        alert("Valid start date/time required");
        return;
    }

    const newStatus = editJobStatusSelect.value;
    let closedAt = null;

    if (newStatus === "CLOSED") {
        closedAt = parseDateTimeInput(editJobClosedAtInput.value || editJobStartedAtInput.value);
        if (!closedAt) {
            alert("Valid close date/time required for closed jobs");
            return;
        }

        if (closedAt < startedAt) {
            alert("Close time cannot be earlier than start time");
            return;
        }
    }

    const duplicateOpen = jobs.some(j =>
        j.id !== job.id &&
        j.ticket === ticket &&
        j.status === "OPEN" &&
        newStatus === "OPEN"
    );

    if (duplicateOpen) {
        alert("Another open job already uses that ticket");
        return;
    }

    const updatedMaterials = collectEditedMaterialsFromModal();

    const oldMaterials = structuredClone(job.materials || []);
    restoreJobMaterialsToInventory(oldMaterials);

    const canConsumeUpdated = validateAndConsumeMaterials(updatedMaterials);

    if (!canConsumeUpdated) {
        validateAndConsumeMaterials(oldMaterials);
        return;
    }

    job.ticket = ticket;
    job.startedAt = startedAt;
    job.status = newStatus;
    job.closedAt = newStatus === "CLOSED" ? closedAt : null;
    job.notes = editJobNotesInput.value.trim();
    job.materials = updatedMaterials;

    saveJobs(jobs);
    saveInventory(inventory);
    rebuildUsageTransactionsForJob(job, updatedMaterials);

    refreshJobState();
    closeJobEditModal();
}

function deleteJobFromModal() {
    if (!activeEditJobId) return;

    const job = jobs.find(j => j.id === activeEditJobId);
    if (!job) return;

    const confirmed = confirm(`Delete job ${job.ticket}? This will restore its material usage and remove its usage transactions.`);
    if (!confirmed) return;

    restoreJobMaterialsToInventory(job.materials || []);

    transactions = transactions.filter(tx =>
        !(tx.type === "USAGE" && tx.jobId === job.id)
    );

    jobs = jobs.filter(j => j.id !== activeEditJobId);

    saveInventory(inventory);
    saveTransactions(transactions);
    saveJobs(jobs);

    refreshJobState();
    closeJobEditModal();
}

function openMaterialModal(jobId) {
    const job = jobs.find(j => j.id === jobId);
    if (!job || !jobMaterialModal) return;

    if (job.status !== "OPEN") {
        alert("Only open jobs can receive more material.");
        return;
    }

    activeMaterialJobId = jobId;

    if (jobMaterialModalLabel) {
        jobMaterialModalLabel.textContent = `Job ${job.ticket}`;
    }

    if (jobMaterialLines) {
        jobMaterialLines.innerHTML = "";
        addMaterialLine();
    }

    jobMaterialModal.classList.remove("hidden");
}

function closeMaterialModal() {
    activeMaterialJobId = null;

    if (jobMaterialLines) {
        jobMaterialLines.innerHTML = "";
    }

    if (jobMaterialModal) {
        jobMaterialModal.classList.add("hidden");
    }
}

function renderMaterialLine(lineId) {
    const options = inventory.map(item => {
        const label = `${item.group} — ${item.name} [${item.itemCode || ""}]`;
        return `<option value="${escapeHtml(label)}"></option>`;
    }).join("");

    return `
        <div class="material-line row-card" data-line-id="${lineId}">
            <div class="form-row">
                <input
                    class="job-material-search"
                    type="text"
                    placeholder="Search material by name, group, or item ID"
                    list="jobMaterialDatalist-${lineId}"
                />
                <datalist id="jobMaterialDatalist-${lineId}">
                    ${options}
                </datalist>

                <input
                    class="job-material-qty"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Qty used"
                />

                <button
                    type="button"
                    class="delete-btn"
                    onclick="removeMaterialLine('${lineId}')"
                >
                    Remove
                </button>
            </div>
        </div>
    `;
}

function addMaterialLine() {
    if (!jobMaterialLines) return;

    const lineId = crypto.randomUUID();
    jobMaterialLines.insertAdjacentHTML("beforeend", renderMaterialLine(lineId));
}

function removeMaterialLine(lineId) {
    const line = document.querySelector(`[data-line-id="${lineId}"]`);
    if (line) {
        line.remove();
    }
}

function findInventoryItemFromSearchValue(value) {
    const normalized = value.trim().toLowerCase();

    return inventory.find(item => {
        const label = `${item.group} — ${item.name} [${item.itemCode || ""}]`.toLowerCase();
        const loose = `${item.group} ${item.name} ${item.itemCode || ""}`.toLowerCase();

        return label === normalized || loose.includes(normalized) || normalized.includes((item.itemCode || "").toLowerCase());
    });
}

function addMaterialToJob(jobId, selectedItemId, qtyUsed) {
    const job = jobs.find(j => j.id === jobId);

    if (!job) {
        alert("Selected job not found");
        return false;
    }

    if (job.status !== "OPEN") {
        alert("Cannot add materials to a closed job");
        return false;
    }

    const item = inventory.find(i => i.id === selectedItemId);

    if (!item) {
        alert("Inventory item not found");
        return false;
    }

    if (Number.isNaN(qtyUsed) || qtyUsed <= 0) {
        alert("Enter valid quantity used");
        return false;
    }

    if (item.qtyOnHand < qtyUsed) {
        alert("Not enough inventory on hand");
        return false;
    }

    item.qtyOnHand -= qtyUsed;

    if (!Array.isArray(job.materials)) {
        job.materials = [];
    }

    job.materials.push({
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.name,
        itemGroup: item.group,
        qtyUsed,
        unit: item.unit
    });

    transactions.push({
        id: crypto.randomUUID(),
        type: "USAGE",
        timestamp: new Date(),
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.name,
        itemGroup: item.group,
        qty: qtyUsed,
        unit: item.unit,
        jobId: job.id,
        jobTicket: job.ticket,
        note: "Material used on job"
    });

    saveJobs(jobs);
    saveInventory(inventory);
    saveTransactions(transactions);

    refreshJobState();
    return true;
}

function saveMaterialFromModal() {
    const lines = [...document.querySelectorAll(".material-line")];

    if (!lines.length) {
        alert("Add at least one material line");
        return;
    }

    for (const line of lines) {
        const searchInput = line.querySelector(".job-material-search");
        const qtyInput = line.querySelector(".job-material-qty");

        const item = findInventoryItemFromSearchValue(searchInput.value);
        const qtyUsed = Number(qtyInput.value);

        if (!item) {
            alert("Choose a valid inventory material from the search");
            return;
        }

        const ok = addMaterialToJob(activeMaterialJobId, item.id, qtyUsed);
        if (!ok) {
            return;
        }
    }

    closeMaterialModal();
}

function closeJobFromCard(jobId) {
    const job = jobs.find(j => j.id === jobId);

    if (!job) {
        alert("Job not found");
        return;
    }

    if (job.status !== "OPEN") {
        alert("Job is already closed");
        return;
    }

    job.status = "CLOSED";
    job.closedAt = new Date();

    saveJobs(jobs);
    refreshJobState();
}

function reopenJob(jobId) {
    const job = jobs.find(j => j.id === jobId);

    if (!job) {
        alert("Job not found");
        return;
    }

    job.status = "OPEN";
    job.closedAt = null;

    saveJobs(jobs);
    refreshJobState();
}

function renderJobCard(job) {
    const materials = job.materials || [];
    const notesHtml = job.notes
        ? `<div class="row-details"><strong>Notes:</strong> ${escapeHtml(job.notes)}</div>`
        : "";

    const materialsHtml = materials.length
        ? materials.map(m =>
            `${escapeHtml(m.itemGroup || m.itemName)} / ${escapeHtml(m.itemName)} [${escapeHtml(m.itemCode || "")}] (${m.qtyUsed} ${escapeHtml(m.unit)})`
        ).join(" · ")
        : `<span class="muted">No materials</span>`;

    const meta = job.status === "OPEN"
        ? `Started ${new Date(job.startedAt).toLocaleString()} · OPEN`
        : `Closed ${new Date(job.closedAt).toLocaleString()} · ${formatDuration(job.startedAt, job.closedAt)}`;

    const statusButton = job.status === "OPEN"
        ? `<button onclick="closeJobFromCard('${job.id}')">Close Job</button>`
        : `<button onclick="reopenJob('${job.id}')">Append / Reopen</button>`;

    const addMaterialButtonHtml = job.status === "OPEN"
        ? `<button onclick="openMaterialModal('${job.id}')">Add Material</button>`
        : "";

    return `
        <div class="row-card ${job.status === "CLOSED" ? "closed-row" : ""}">
            <div class="row-main">
                <div class="row-title">Job ${escapeHtml(job.ticket)}</div>
                <div class="row-meta">${meta}</div>
            </div>

            <div class="row-details">
                <strong>Started:</strong> ${new Date(job.startedAt).toLocaleString()}
                ${job.status === "CLOSED" && job.closedAt ? `<br><strong>Closed:</strong> ${new Date(job.closedAt).toLocaleString()}` : ""}
                <br><strong>Materials:</strong> ${materialsHtml}
            </div>

            ${notesHtml}

            <div class="inline-actions">
                <button onclick="openJobEditModal('${job.id}')">Edit Job</button>
                ${addMaterialButtonHtml}
                ${statusButton}
            </div>
        </div>
    `;
}

function renderJobs() {
    if (!openJobList || !closedJobList) return;

    const filter = jobFilterSelect ? jobFilterSelect.value : "ALL";
    const searchQuery = jobSearchInput ? jobSearchInput.value.trim().toLowerCase() : "";

    function matchesSearch(job) {
        if (!searchQuery) return true;

        const materialText = (job.materials || [])
            .map(m => `${m.itemGroup || ""} ${m.itemName || ""} ${m.itemCode || ""}`)
            .join(" ");

        const notesText = job.notes || "";
        const dateText = [
            new Date(job.startedAt).toLocaleDateString(),
            new Date(job.startedAt).toLocaleString(),
            job.closedAt ? new Date(job.closedAt).toLocaleDateString() : "",
            job.closedAt ? new Date(job.closedAt).toLocaleString() : ""
        ].join(" ");

        const haystack = `${job.ticket} ${job.status} ${materialText} ${notesText} ${dateText}`.toLowerCase();
        return haystack.includes(searchQuery);
    }

    const visibleOpenJobs = jobs.filter(job =>
        job.status === "OPEN" &&
        (filter === "ALL" || filter === "OPEN") &&
        matchesSearch(job)
    );

    const visibleClosedJobs = jobs.filter(job =>
        job.status === "CLOSED" &&
        (filter === "ALL" || filter === "CLOSED") &&
        matchesSearch(job)
    );

    openJobList.innerHTML = visibleOpenJobs.length
        ? visibleOpenJobs.map(renderJobCard).join("")
        : `<div class="muted">No matching open jobs</div>`;

    closedJobList.innerHTML = visibleClosedJobs.length
        ? visibleClosedJobs.map(renderJobCard).join("")
        : `<div class="muted">No matching closed jobs</div>`;

    updateJobSectionVisibility();
}

window.openJobEditModal = openJobEditModal;
window.openMaterialModal = openMaterialModal;
window.closeJobFromCard = closeJobFromCard;
window.reopenJob = reopenJob;
window.removeMaterialLine = removeMaterialLine;
window.addMaterialLine = addMaterialLine;
window.removeMaterialFromEditJob = removeMaterialFromEditJob;
window.toggleOpenJobsSection = toggleOpenJobsSection;
window.toggleClosedJobsSection = toggleClosedJobsSection;