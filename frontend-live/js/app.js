let appEventsBound = false;
let appInitialized = false;

function toggleTopMenu(forceOpen = null) {
    if (!topMenu || !menuToggleButton) return;

    const shouldOpen = forceOpen === null
        ? topMenu.classList.contains("hidden")
        : forceOpen;

    topMenu.classList.toggle("hidden", !shouldOpen);
    menuToggleButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function bindAppEvents() {
    if (appEventsBound) return;
    appEventsBound = true;

    if (startJobButton) {
        startJobButton.addEventListener("click", startJob);
    }

    if (addMaterialButton) {
        addMaterialButton.addEventListener("click", addMaterial);
    }

    if (addInventoryButton) {
        addInventoryButton.addEventListener("click", addInventoryItem);
    }

    if (openAddInventoryModalButton) {
        openAddInventoryModalButton.addEventListener("click", openAddInventoryModal);
    }

    if (closeAddInventoryModalButton) {
        closeAddInventoryModalButton.addEventListener("click", closeAddInventoryModal);
    }

    if (receiveInventoryButton) {
        receiveInventoryButton.addEventListener("click", recordReceipt);
    }

    if (adjustInventoryButton) {
        adjustInventoryButton.addEventListener("click", adjustInventory);
    }

    if (toggleInventorySnapshotButton) {
        toggleInventorySnapshotButton.addEventListener("click", toggleInventorySnapshot);
    }

    if (toggleReorderNoticesButton) {
        toggleReorderNoticesButton.addEventListener("click", toggleReorderNotices);
    }

    if (openReorderDraftModalButton) {
        openReorderDraftModalButton.addEventListener("click", openReorderDraftModal);
    }

    if (closeReorderDraftModalButton) {
        closeReorderDraftModalButton.addEventListener("click", closeReorderDraftModal);
    }

    if (generateReorderDraftButton) {
        generateReorderDraftButton.addEventListener("click", generateReorderDraft);
    }

    if (markReorderRequestedButton) {
        markReorderRequestedButton.addEventListener("click", markReorderRequested);
    }

    if (inventorySearchInput && typeof renderInventory === "function") {
        inventorySearchInput.addEventListener("input", renderInventory);
    }

    if (jobSearchInput && typeof renderJobs === "function") {
        jobSearchInput.addEventListener("input", renderJobs);
    }

    if (jobFilterSelect && typeof renderJobs === "function") {
        jobFilterSelect.addEventListener("change", renderJobs);
    }

    if (toggleOpenJobsButton) {
        toggleOpenJobsButton.addEventListener("click", toggleOpenJobsSection);
    }

    if (toggleClosedJobsButton) {
        toggleClosedJobsButton.addEventListener("click", toggleClosedJobsSection);
    }

    if (toggleDashboardReordersButton) {
        toggleDashboardReordersButton.addEventListener("click", toggleDashboardReorders);
    }

    if (toggleDashboardMaterialsButton) {
        toggleDashboardMaterialsButton.addEventListener("click", toggleDashboardMaterials);
    }

    if (transactionSearchInput && typeof renderTransactions === "function") {
        transactionSearchInput.addEventListener("input", renderTransactions);
    }

    if (exportDataButton) {
        exportDataButton.addEventListener("click", exportAppData);
    }

    if (importDataInput) {
        importDataInput.addEventListener("change", event => {
            importAppData(event.target.files?.[0]);
            event.target.value = "";
            toggleTopMenu(false);
        });
    }

    if (useCloudVersionButton) {
        useCloudVersionButton.addEventListener("click", async () => {
            const okay = await useCloudVersion();
            if (okay) {
                toggleTopMenu(false);
            }
        });
    }

    if (menuToggleButton) {
        menuToggleButton.addEventListener("click", () => {
            toggleTopMenu();
        });
    }

    if (topMenu) {
        topMenu.addEventListener("click", event => {
            const clickedLink = event.target.closest("a, button, label");
            if (clickedLink) {
                if (!clickedLink.closest(".menu-file-button")) {
                    toggleTopMenu(false);
                }
            }
        });
    }

    document.addEventListener("click", event => {
        if (!topMenu || !menuToggleButton) return;

        const clickedInsideMenu = topMenu.contains(event.target);
        const clickedMenuButton = menuToggleButton.contains(event.target);

        if (!clickedInsideMenu && !clickedMenuButton) {
            toggleTopMenu(false);
        }
    });

    if (closeJobEditModalButton) {
        closeJobEditModalButton.addEventListener("click", closeJobEditModal);
    }

    if (saveJobEditButton) {
        saveJobEditButton.addEventListener("click", saveEditedJob);
    }

    if (deleteJobFromModalButton) {
        deleteJobFromModalButton.addEventListener("click", deleteJobFromModal);
    }

    if (editJobStatusSelect) {
        editJobStatusSelect.addEventListener("change", toggleClosedAtInput);
    }

    if (closeJobMaterialModalButton) {
        closeJobMaterialModalButton.addEventListener("click", closeMaterialModal);
    }

    if (saveJobMaterialButton) {
        saveJobMaterialButton.addEventListener("click", saveMaterialFromModal);
    }

    if (addMaterialLineButton) {
        addMaterialLineButton.addEventListener("click", addMaterialLine);
    }

    if (jobEditModal) {
        jobEditModal.addEventListener("click", event => {
            if (event.target === jobEditModal) {
                closeJobEditModal();
            }
        });
    }

    if (jobMaterialModal) {
        jobMaterialModal.addEventListener("click", event => {
            if (event.target === jobMaterialModal) {
                closeMaterialModal();
            }
        });
    }

    if (addInventoryModal) {
        addInventoryModal.addEventListener("click", event => {
            if (event.target === addInventoryModal) {
                closeAddInventoryModal();
            }
        });
    }

    if (reorderDraftModal) {
        reorderDraftModal.addEventListener("click", event => {
            if (event.target === reorderDraftModal) {
                closeReorderDraftModal();
            }
        });
    }
}

function rerenderAll() {
    if (typeof renderInventory === "function") {
        renderInventory();
    }

    if (typeof renderJobs === "function") {
        renderJobs();
    }

    if (typeof renderTransactions === "function") {
        renderTransactions();
    }

    if (typeof renderDashboard === "function") {
        renderDashboard();
    }
}

async function initializeApp() {
    if (appInitialized) {
        return;
    }

    appInitialized = true;

    jobs = loadJobs();
    inventory = loadInventory();
    transactions = loadTransactions();

    rerenderAll();

    let hydrationSucceeded = false;

    if (typeof hydrateFromCloudAtStartup === "function") {
        hydrationSucceeded = await hydrateFromCloudAtStartup();

        jobs = loadJobs();
        inventory = loadInventory();
        transactions = loadTransactions();

        rerenderAll();
    }

    if (hydrationSucceeded && typeof startAutoSync === "function") {
        startAutoSync(10000);
    }
}

async function bootLeanOsApp() {
    bindAppEvents();
    await initializeApp();
}

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof initializeAuthGate === "function") {
        await initializeAuthGate(bootLeanOsApp);
    } else {
        await bootLeanOsApp();
    }
});

document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) return;
    if (typeof runSafeReconciliationCycle !== "function") return;

    await runSafeReconciliationCycle("tab-visible");

    jobs = loadJobs();
    inventory = loadInventory();
    transactions = loadTransactions();

    rerenderAll();

    if (typeof window.refreshSessionList === "function") {
        await window.refreshSessionList();
    }
});

window.addEventListener("beforeunload", () => {
    if (typeof stopAutoSync === "function") {
        stopAutoSync();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        toggleTopMenu(false);

        if (jobEditModal && !jobEditModal.classList.contains("hidden")) {
            closeJobEditModal();
        }

        if (jobMaterialModal && !jobMaterialModal.classList.contains("hidden")) {
            closeMaterialModal();
        }

        if (addInventoryModal && !addInventoryModal.classList.contains("hidden")) {
            closeAddInventoryModal();
        }

        if (reorderDraftModal && !reorderDraftModal.classList.contains("hidden")) {
            closeReorderDraftModal();
        }
    }
});