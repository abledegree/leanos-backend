let inventory = loadInventory();
let expandedGroups = {};
let inventorySnapshotCollapsed = true;
let reorderNoticesCollapsed = true;

const REORDER_COOLDOWN_DAYS_ABOVE_ZERO = 2;
const REORDER_COOLDOWN_DAYS_ZERO = 1;

function getInventoryLookupLabel(item) {
    return `${item.group} — ${item.name} (${item.itemCode})`;
}

function findInventoryItemFromLookupValue(value) {
    const normalized = (value || "").trim().toLowerCase();
    if (!normalized) return null;

    return inventory.find(item => {
        const exactLabel = getInventoryLookupLabel(item).toLowerCase();
        const loose = `${item.group} ${item.name} ${item.itemCode} ${item.unit}`.toLowerCase();

        return (
            exactLabel === normalized ||
            loose.includes(normalized) ||
            normalized.includes((item.itemCode || "").toLowerCase())
        );
    }) || null;
}

function openAddInventoryModal() {
    if (!addInventoryModal) return;
    addInventoryModal.classList.remove("hidden");
}

function closeAddInventoryModal() {
    if (!addInventoryModal) return;
    addInventoryModal.classList.add("hidden");
}

function openReorderDraftModal() {
    if (!reorderDraftModal) return;
    reorderDraftModal.classList.remove("hidden");
    updateReorderDraftPreview();
}

function closeReorderDraftModal() {
    if (!reorderDraftModal) return;
    reorderDraftModal.classList.add("hidden");
}

function toggleInventorySnapshot() {
    inventorySnapshotCollapsed = !inventorySnapshotCollapsed;
    updateInventorySnapshotVisibility();
}

function updateInventorySnapshotVisibility() {
    if (!inventorySnapshotContent || !toggleInventorySnapshotButton) return;

    inventorySnapshotContent.classList.toggle("hidden", inventorySnapshotCollapsed);
    toggleInventorySnapshotButton.textContent = inventorySnapshotCollapsed ? "Expand" : "Collapse";
}

function toggleReorderNotices() {
    reorderNoticesCollapsed = !reorderNoticesCollapsed;
    updateReorderNoticesVisibility();
}

function updateReorderNoticesVisibility() {
    if (!inventoryAlerts || !toggleReorderNoticesButton) return;

    inventoryAlerts.classList.toggle("hidden", reorderNoticesCollapsed);
    toggleReorderNoticesButton.textContent = reorderNoticesCollapsed ? "Expand" : "Collapse";
}

function clearAddInventoryForm() {
    if (inventoryName) inventoryName.value = "";
    if (inventoryGroup) inventoryGroup.value = "";
    if (inventoryCode) inventoryCode.value = "";
    if (inventoryUnit) inventoryUnit.value = "";
    if (inventoryThreshold) inventoryThreshold.value = "";
}

function addInventoryItem() {
    const name = inventoryName.value.trim();
    const group = inventoryGroup.value.trim();
    const itemCode = inventoryCode.value.trim();
    const unit = inventoryUnit.value.trim();
    const threshold = Number(inventoryThreshold.value);

    if (name === "" || group === "" || itemCode === "" || unit === "") {
        alert("Enter item name, material group, item ID, and unit");
        return;
    }

    if (Number.isNaN(threshold) || threshold < 0) {
        alert("Enter a valid reorder threshold");
        return;
    }

    const exists = inventory.some(
        item => item.itemCode.toLowerCase() === itemCode.toLowerCase()
    );

    if (exists) {
        alert("That item ID already exists");
        return;
    }

    const newItem = {
        id: crypto.randomUUID(),
        itemCode,
        name,
        group,
        unit,
        qtyOnHand: 0,
        reorderThreshold: threshold,
        reorderRequestedAt: null
    };

    inventory.push(newItem);

    saveInventory(inventory);
    renderInventory();

    clearAddInventoryForm();
    closeAddInventoryModal();
}

function recordReceipt() {
    const item = findInventoryItemFromLookupValue(receiptItemSearch?.value);
    const qty = Number(receiptQty.value);

    if (!item) {
        alert("Choose a valid inventory item from the search");
        return;
    }

    if (Number.isNaN(qty) || qty <= 0) {
        alert("Enter a valid received quantity");
        return;
    }

    item.qtyOnHand += qty;

    addTransaction("RECEIPT", {
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.name,
        itemGroup: item.group,
        qty,
        unit: item.unit,
        note: "Incoming inventory receipt"
    });

    saveInventory(inventory);
    renderInventory();

    if (receiptItemSearch) receiptItemSearch.value = "";
    if (receiptQty) receiptQty.value = "";
}

function adjustInventory() {
    const item = findInventoryItemFromLookupValue(adjustItemSearch?.value);
    const qty = Number(adjustQty.value);
    const note = adjustNote.value.trim();

    if (!item) {
        alert("Choose a valid inventory item from the search");
        return;
    }

    if (Number.isNaN(qty) || qty === 0) {
        alert("Enter a valid adjustment amount");
        return;
    }

    if (item.qtyOnHand + qty < 0) {
        alert("Adjustment would make inventory negative");
        return;
    }

    item.qtyOnHand += qty;

    addTransaction("ADJUSTMENT", {
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.name,
        itemGroup: item.group,
        qty,
        unit: item.unit,
        note: note || "Manual inventory adjustment"
    });

    saveInventory(inventory);
    renderInventory();

    if (adjustItemSearch) adjustItemSearch.value = "";
    if (adjustQty) adjustQty.value = "";
    if (adjustNote) adjustNote.value = "";
}

function editInventoryItem(itemId) {
    const item = inventory.find(i => i.id === itemId);

    if (!item) {
        alert("Inventory item not found");
        return;
    }

    const newGroup = prompt("Material group:", item.group);
    if (newGroup === null) return;

    const newName = prompt("Item name:", item.name);
    if (newName === null) return;

    const newItemCode = prompt("Item ID / SKU:", item.itemCode);
    if (newItemCode === null) return;

    const newUnit = prompt("Unit:", item.unit);
    if (newUnit === null) return;

    const newThresholdRaw = prompt("Reorder threshold:", item.reorderThreshold);
    if (newThresholdRaw === null) return;

    const newThreshold = Number(newThresholdRaw);

    if (
        newGroup.trim() === "" ||
        newName.trim() === "" ||
        newItemCode.trim() === "" ||
        newUnit.trim() === "" ||
        Number.isNaN(newThreshold) ||
        newThreshold < 0
    ) {
        alert("Invalid edit values");
        return;
    }

    const duplicateCode = inventory.some(
        existing =>
            existing.id !== item.id &&
            existing.itemCode.toLowerCase() === newItemCode.trim().toLowerCase()
    );

    if (duplicateCode) {
        alert("That item ID already exists on another inventory item");
        return;
    }

    const oldItemCode = item.itemCode;
    const oldItemName = item.name;
    const oldItemGroup = item.group;

    item.group = newGroup.trim();
    item.name = newName.trim();
    item.itemCode = newItemCode.trim();
    item.unit = newUnit.trim();
    item.reorderThreshold = newThreshold;

    for (const job of jobs) {
        if (!Array.isArray(job.materials)) continue;

        for (const material of job.materials) {
            if (material.itemId === item.id) {
                material.itemCode = item.itemCode;
                material.itemName = item.name;
                material.itemGroup = item.group;
                material.unit = item.unit;
            }
        }
    }

    for (const tx of transactions) {
        if (tx.itemId === item.id) {
            tx.itemCode = item.itemCode;
            tx.itemName = item.name;
            tx.itemGroup = item.group;
            tx.unit = item.unit;

            if (tx.note === "Inventory item details updated") {
                tx.note = `Inventory item details updated from ${oldItemCode || oldItemName || oldItemGroup}`;
            }
        }
    }

    addTransaction("ITEM_EDIT", {
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.name,
        itemGroup: item.group,
        qty: 0,
        unit: item.unit,
        note: `Inventory item details updated from ${oldItemCode || oldItemName || oldItemGroup}`
    });

    saveInventory(inventory);
    saveJobs(jobs);
    saveTransactions(transactions);
    renderInventory();
    renderJobs();
}

function deleteInventoryItem(itemId) {
    const item = inventory.find(i => i.id === itemId);

    if (!item) {
        alert("Inventory item not found");
        return;
    }

    const confirmed = confirm(`Delete inventory item "${item.name}" (${item.itemCode})?`);

    if (!confirmed) {
        return;
    }

    inventory = inventory.filter(i => i.id !== itemId);

    saveInventory(inventory);
    renderInventory();
}

function toggleInventoryGroup(groupName) {
    expandedGroups[groupName] = !expandedGroups[groupName];
    renderInventory();
}

function getLowStockItems() {
    return inventory.filter(item => item.qtyOnHand <= item.reorderThreshold);
}

function getCooldownDaysForItem(item) {
    return item.qtyOnHand === 0
        ? REORDER_COOLDOWN_DAYS_ZERO
        : REORDER_COOLDOWN_DAYS_ABOVE_ZERO;
}

function daysSinceRequested(item) {
    if (!item.reorderRequestedAt) return Infinity;

    const now = new Date();
    const last = new Date(item.reorderRequestedAt);
    const diffMs = now - last;

    return diffMs / (1000 * 60 * 60 * 24);
}

function shouldShowInReorderDraft(item) {
    if (item.qtyOnHand > item.reorderThreshold) return false;
    if (!item.reorderRequestedAt) return true;

    return daysSinceRequested(item) >= getCooldownDaysForItem(item);
}

function getDraftableReorderItems() {
    return inventory.filter(shouldShowInReorderDraft);
}

function buildReorderDraftText(items) {
    if (!items.length) {
        return "No reorder items currently need a request.";
    }

    const sortedItems = [...items].sort((a, b) => a.qtyOnHand - b.qtyOnHand);

    const lines = sortedItems.map(item =>
        `• ${item.name} | Item ID: ${item.itemCode} | On Hand: ${item.qtyOnHand} ${item.unit}`
    );

    return `Subject: Inventory Reorder Request

Hello,

Please reorder the following inventory items:

${lines.join("\n")}

Thank you.`;
}

function updateReorderDraftPreview() {
    if (!reorderDraftOutput) return;
    reorderDraftOutput.value = buildReorderDraftText(getDraftableReorderItems());
}

async function copyReorderDraft() {
    const items = getDraftableReorderItems();
    const draftText = buildReorderDraftText(items);

    if (reorderDraftOutput) {
        reorderDraftOutput.value = draftText;
    }

    if (!items.length) {
        alert("No reorder items currently need a request.");
        return;
    }

    try {
        await navigator.clipboard.writeText(draftText);
        alert("Reorder draft copied to clipboard.");
    } catch (error) {
        console.error(error);
        alert("Could not copy automatically. The draft is still shown in the box so you can copy it manually.");
    }
}

function markReorderRequested() {
    const items = getDraftableReorderItems();

    if (items.length === 0) {
        alert("No reorder items to mark as requested");
        return;
    }

    const now = new Date();

    for (const item of items) {
        item.reorderRequestedAt = now;
    }

    saveInventory(inventory);
    renderInventory();
    updateReorderDraftPreview();
    closeReorderDraftModal();
}

function renderInventoryAlerts() {
    if (!inventoryAlerts) return;

    const lowStockItems = getLowStockItems();

    inventoryAlerts.innerHTML = "";

    if (lowStockItems.length === 0) {
        inventoryAlerts.innerHTML = `<div class="muted">No reorder notices</div>`;
        return;
    }

    for (const item of lowStockItems) {
        const hiddenFromDraft = !shouldShowInReorderDraft(item);
        const cooldownDays = getCooldownDaysForItem(item);

        inventoryAlerts.innerHTML += `
            <div class="alert-card ${item.qtyOnHand === 0 ? 'critical-alert-card' : ''}">
                <strong>${escapeHtml(item.group)}</strong> — ${escapeHtml(item.name)}
                <br>
                Item ID: ${escapeHtml(item.itemCode)}
                <br>
                On Hand: ${item.qtyOnHand} ${escapeHtml(item.unit)}
                <br>
                Threshold: ${item.reorderThreshold} ${escapeHtml(item.unit)}
                ${item.reorderRequestedAt ? `<br>Last Requested: ${new Date(item.reorderRequestedAt).toLocaleString()}` : ""}
                ${hiddenFromDraft ? `<br><span class="muted">Hidden from draft until ${cooldownDays} day cooldown expires.</span>` : ""}
            </div>
        `;
    }
}

function renderInventory() {
    if (!inventoryList) {
        renderInventoryOptions();
        renderInventoryAlerts();
        updateReorderDraftPreview();
        updateInventorySnapshotVisibility();
        updateReorderNoticesVisibility();
        return;
    }

    inventoryList.innerHTML = "";

    const searchQuery = inventorySearchInput
        ? inventorySearchInput.value.trim().toLowerCase()
        : "";

    let visibleInventory = [...inventory];

    if (searchQuery) {
        visibleInventory = visibleInventory.filter(item => {
            const haystack = [item.group, item.name, item.itemCode, item.unit].join(" ").toLowerCase();
            return haystack.includes(searchQuery);
        });
    }

    if (visibleInventory.length === 0) {
        inventoryList.innerHTML = `<div class="muted">No inventory items yet</div>`;
        renderInventoryOptions();
        renderInventoryAlerts();
        updateReorderDraftPreview();
        updateInventorySnapshotVisibility();
        updateReorderNoticesVisibility();
        return;
    }

    const grouped = {};

    for (const item of visibleInventory) {
        if (!grouped[item.group]) {
            grouped[item.group] = [];
        }
        grouped[item.group].push(item);
    }

    const groupNames = Object.keys(grouped).sort();

    for (const groupName of groupNames) {
        const items = grouped[groupName];
        const groupTotal = items.reduce((sum, item) => sum + Number(item.qtyOnHand || 0), 0);
        const displayUnit = items[0]?.unit || "";
        const isExpanded = !!expandedGroups[groupName];
        const lowCount = items.filter(item => item.qtyOnHand <= item.reorderThreshold).length;

        inventoryList.innerHTML += `
            <div class="group-block">
                <button class="group-toggle compact-group-toggle" onclick="toggleInventoryGroup('${escapeHtml(groupName)}')">
                    <div class="group-toggle-left">
                        <div class="group-title">${escapeHtml(groupName)}</div>
                        <div class="group-subtitle">Variants: ${items.length}${lowCount ? ` · Low: ${lowCount}` : ""}</div>
                    </div>
                    <div class="group-toggle-right">
                        <div class="group-total-large">Total: ${groupTotal} ${escapeHtml(displayUnit)}</div>
                        <div class="group-arrow">${isExpanded ? "▾" : "▸"}</div>
                    </div>
                </button>

                ${isExpanded ? `
                    <div class="group-items">
                        ${items.map(item => `
                            <div class="row-card inventory-row compact-inventory-row ${item.qtyOnHand <= item.reorderThreshold ? "low-stock-row" : ""}">
                                <div class="row-main">
                                    <div>
                                        <div class="row-title">${escapeHtml(item.name)}</div>
                                        <div class="row-meta">Item ID: ${escapeHtml(item.itemCode)}</div>
                                        <div class="row-meta">Threshold: ${item.reorderThreshold} ${escapeHtml(item.unit)}</div>
                                    </div>
                                    <div class="row-right ${item.qtyOnHand === 0 ? 'critical-onhand' : ''}">
                                        ${item.qtyOnHand} ${escapeHtml(item.unit)}
                                    </div>
                                </div>
                                <div class="inline-actions">
                                    <button onclick="editInventoryItem('${item.id}')">Edit Item</button>
                                    <button class="delete-btn" onclick="deleteInventoryItem('${item.id}')">Delete Item</button>
                                </div>
                            </div>
                        `).join("")}
                    </div>
                ` : ""}
            </div>
        `;
    }

    renderInventoryOptions();
    renderInventoryAlerts();
    updateReorderDraftPreview();
    updateInventorySnapshotVisibility();
    updateReorderNoticesVisibility();
}

function renderInventoryOptions() {
    if (receiptItemDatalist) {
        receiptItemDatalist.innerHTML = "";
    }

    if (adjustItemDatalist) {
        adjustItemDatalist.innerHTML = "";
    }

    if (materialItemSelect) {
        materialItemSelect.innerHTML = "";
    }

    if (inventory.length === 0) {
        if (materialItemSelect) {
            materialItemSelect.innerHTML = `<option value="">No inventory items</option>`;
        }
        return;
    }

    for (const item of inventory) {
        const label = getInventoryLookupLabel(item);

        if (receiptItemDatalist) {
            receiptItemDatalist.innerHTML += `<option value="${escapeHtml(label)}"></option>`;
        }

        if (adjustItemDatalist) {
            adjustItemDatalist.innerHTML += `<option value="${escapeHtml(label)}"></option>`;
        }

        if (materialItemSelect) {
            materialItemSelect.innerHTML += `
                <option value="${item.id}">
                    ${escapeHtml(label)}
                </option>
            `;
        }
    }
}

window.toggleInventoryGroup = toggleInventoryGroup;
window.editInventoryItem = editInventoryItem;
window.deleteInventoryItem = deleteInventoryItem;
window.openAddInventoryModal = openAddInventoryModal;
window.closeAddInventoryModal = closeAddInventoryModal;
window.toggleInventorySnapshot = toggleInventorySnapshot;
window.openReorderDraftModal = openReorderDraftModal;
window.closeReorderDraftModal = closeReorderDraftModal;
window.toggleReorderNotices = toggleReorderNotices;
window.generateReorderDraft = copyReorderDraft;