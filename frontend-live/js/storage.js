const APP_STORAGE_KEY = "leanos_app_data";
const CURRENT_APP_VERSION = "3.1.15";
const CURRENT_SCHEMA_VERSION = 2;

function getCurrentDeviceId() {
    const existing = (localStorage.getItem("leanos_device_id") || "").trim();
    if (existing) return existing;

    if (typeof window.getDeviceId === "function") {
        return window.getDeviceId();
    }

    const generated = window.crypto?.randomUUID?.()
        || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    localStorage.setItem("leanos_device_id", generated);
    return generated;
}

function createDefaultSyncMeta(overrides = {}) {
    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        isHydratedFromCloud: false,
        dirty: false,
        lastKnownRemoteSavedAt: null,
        baseRemoteSavedAt: null,
        lastSuccessfulPullAt: null,
        lastSuccessfulPushAt: null,
        lastLocalMutationAt: null,
        lastEditedByDeviceId: null,
        status: "idle",
        message: "Local data ready",
        conflict: null,
        ...overrides
    };
}

function normalizeSyncMeta(syncMeta = {}) {
    return createDefaultSyncMeta({
        ...syncMeta,
        isHydratedFromCloud: !!syncMeta.isHydratedFromCloud,
        dirty: !!syncMeta.dirty,
        conflict: syncMeta.conflict || null
    });
}

function createEmptyAppData() {
    return {
        appName: "LeanOS",
        version: CURRENT_APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        syncMeta: createDefaultSyncMeta(),
        data: {
            jobs: [],
            inventory: [],
            transactions: []
        }
    };
}

function ensureIsoString(value, fallback = new Date()) {
    const date = value ? new Date(value) : new Date(fallback);
    return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}

function normalizeJobs(rawJobs) {
    if (!Array.isArray(rawJobs)) return [];

    return rawJobs.map(job => ({
        id: job.id || crypto.randomUUID(),
        ticket: job.ticket || "",
        startedAt: ensureIsoString(job.startedAt),
        status: job.status || "OPEN",
        closedAt: job.closedAt ? ensureIsoString(job.closedAt) : null,
        notes: job.notes || "",
        materials: Array.isArray(job.materials)
            ? job.materials.map(material => ({
                itemId: material.itemId || "",
                itemCode: material.itemCode || material.itemVendor || material.itemId || "",
                itemName: material.itemName || "",
                itemGroup: material.itemGroup || "",
                qtyUsed: Number(material.qtyUsed) || 0,
                unit: material.unit || ""
            }))
            : []
    }));
}

function normalizeInventory(rawInventory) {
    if (!Array.isArray(rawInventory)) return [];

    return rawInventory.map(item => ({
        id: item.id || crypto.randomUUID(),
        itemCode: (item.itemCode || item.vendor || item.id || "").trim(),
        name: item.name || "",
        group: item.group || item.name || "",
        unit: item.unit || "",
        qtyOnHand: Number(item.qtyOnHand) || 0,
        reorderThreshold: Number(item.reorderThreshold) || 0,
        reorderRequestedAt: item.reorderRequestedAt ? ensureIsoString(item.reorderRequestedAt) : null
    }));
}

function normalizeTransactions(rawTransactions) {
    if (!Array.isArray(rawTransactions)) return [];

    return rawTransactions.map(tx => ({
        id: tx.id || crypto.randomUUID(),
        type: tx.type || "UNKNOWN",
        timestamp: ensureIsoString(tx.timestamp),
        itemId: tx.itemId || "",
        itemCode: tx.itemCode || tx.itemVendor || tx.itemId || "",
        itemName: tx.itemName || "",
        itemGroup: tx.itemGroup || "",
        qty: Number(tx.qty) || 0,
        unit: tx.unit || "",
        jobId: tx.jobId || "",
        jobTicket: tx.jobTicket || "",
        note: tx.note || ""
    }));
}

function migrateLegacyStorageTo2_0_0() {
    const legacyJobs = JSON.parse(localStorage.getItem("jobs") || "[]");
    const legacyInventory = JSON.parse(localStorage.getItem("inventory") || "[]");
    const legacyTransactions = JSON.parse(localStorage.getItem("transactions") || "[]");

    return {
        appName: "LeanOS",
        version: "2.0.0",
        savedAt: new Date().toISOString(),
        data: {
            jobs: normalizeJobs(legacyJobs),
            inventory: normalizeInventory(legacyInventory),
            transactions: normalizeTransactions(legacyTransactions)
        }
    };
}

function migrate2_0_0To3_0_0(appData) {
    return {
        ...appData,
        version: "3.0.0",
        data: {
            jobs: normalizeJobs(appData.data?.jobs || []),
            inventory: normalizeInventory(appData.data?.inventory || []),
            transactions: normalizeTransactions(appData.data?.transactions || [])
        }
    };
}

function migrateAppData(appData) {
    let migrated = structuredClone(appData);
    let changed = false;

    if (!migrated.version) {
        migrated = migrateLegacyStorageTo2_0_0();
        changed = true;
    }

    if (migrated.version === "2.0.0") {
        migrated = migrate2_0_0To3_0_0(migrated);
        changed = true;
    }

    if (!migrated.data) {
        migrated = createEmptyAppData();
        changed = true;
    }

    const normalized = {
        ...migrated,
        appName: "LeanOS",
        version: CURRENT_APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: migrated.savedAt || new Date().toISOString(),
        syncMeta: normalizeSyncMeta(migrated.syncMeta || {}),
        data: {
            jobs: normalizeJobs(migrated.data.jobs || []),
            inventory: normalizeInventory(migrated.data.inventory || []),
            transactions: normalizeTransactions(migrated.data.transactions || [])
        }
    };

    if (normalized.version !== migrated.version || normalized.schemaVersion !== migrated.schemaVersion) {
        changed = true;
    }

    return { data: normalized, changed };
}

function readStoredAppData() {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error("Failed to parse stored app data:", error);
        return null;
    }
}

function loadAppData() {
    const stored = readStoredAppData();

    if (!stored) {
        const hasLegacyData =
            localStorage.getItem("jobs") ||
            localStorage.getItem("inventory") ||
            localStorage.getItem("transactions");

        const initial = hasLegacyData
            ? migrateLegacyStorageTo2_0_0()
            : createEmptyAppData();

        const migrated = migrateAppData(initial).data;
        localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
    }

    const result = migrateAppData(stored);

    if (result.changed) {
        localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(result.data));
    }

    return result.data;
}

function getSyncMeta() {
    return normalizeSyncMeta(loadAppData().syncMeta || {});
}

function saveAppData(appData, options = {}) {
    const previous = readStoredAppData() || createEmptyAppData();
    const previousSyncMeta = normalizeSyncMeta(previous.syncMeta || {});
    const source = options.source || "local";
    const nowIso = new Date().toISOString();

    const payload = {
        ...appData,
        appName: "LeanOS",
        version: CURRENT_APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: options.preserveSavedAt
            ? (appData.savedAt || previous.savedAt || nowIso)
            : nowIso,
        data: {
            jobs: normalizeJobs(appData.data?.jobs || []),
            inventory: normalizeInventory(appData.data?.inventory || []),
            transactions: normalizeTransactions(appData.data?.transactions || [])
        }
    };

    let nextSyncMeta = normalizeSyncMeta(appData.syncMeta || previousSyncMeta);

    if (source === "remote") {
        const remoteSavedAt = appData.savedAt || payload.savedAt || nowIso;

        nextSyncMeta = normalizeSyncMeta({
            ...nextSyncMeta,
            isHydratedFromCloud: true,
            dirty: false,
            lastKnownRemoteSavedAt: remoteSavedAt,
            baseRemoteSavedAt: remoteSavedAt,
            lastSuccessfulPullAt: nowIso,
            status: "synced",
            message: options.statusMessage || "Synced",
            conflict: null
        });
    } else if (source === "system") {
        nextSyncMeta = normalizeSyncMeta({
            ...nextSyncMeta,
            ...(options.syncMetaPatch || {})
        });
    } else {
        nextSyncMeta = normalizeSyncMeta({
            ...nextSyncMeta,
            dirty: true,
            status: "saving",
            message: "Local changes pending sync",
            conflict: null,
            lastLocalMutationAt: nowIso,
            lastEditedByDeviceId: getCurrentDeviceId()
        });
    }

    payload.syncMeta = nextSyncMeta;

    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(payload));

    if (!options.skipBackendSync && typeof window.queueBackendSync === "function") {
        window.queueBackendSync(payload);
    }
}

function updateSyncMeta(syncMetaPatch = {}) {
    const appData = loadAppData();

    saveAppData(appData, {
        source: "system",
        preserveSavedAt: true,
        skipBackendSync: true,
        syncMetaPatch
    });
}

function getJobs() {
    return loadAppData().data.jobs.map(job => ({
        ...job,
        startedAt: new Date(job.startedAt),
        closedAt: job.closedAt ? new Date(job.closedAt) : null
    }));
}

function getInventory() {
    return loadAppData().data.inventory.map(item => ({
        ...item,
        reorderRequestedAt: item.reorderRequestedAt ? new Date(item.reorderRequestedAt) : null
    }));
}

function getTransactions() {
    return loadAppData().data.transactions.map(tx => ({
        ...tx,
        timestamp: new Date(tx.timestamp)
    }));
}

function saveJobs(jobs) {
    const appData = loadAppData();
    appData.data.jobs = normalizeJobs(jobs);
    saveAppData(appData, { source: "local" });
}

function saveInventory(inventory) {
    const appData = loadAppData();
    appData.data.inventory = normalizeInventory(inventory);
    saveAppData(appData, { source: "local" });
}

function saveTransactions(transactions) {
    const appData = loadAppData();
    appData.data.transactions = normalizeTransactions(transactions);
    saveAppData(appData, { source: "local" });
}

function loadJobs() {
    return getJobs();
}

function loadInventory() {
    return getInventory();
}

function loadTransactions() {
    return getTransactions();
}

function exportAppData() {
    const appData = loadAppData();
    downloadTextFile(
        `leanos-backup-${new Date().toISOString().replaceAll(":", "-")}.json`,
        JSON.stringify(appData, null, 2)
    );
}

async function replaceCloudData(importedAppData) {
    const backendUrl = (window.LEANOS_CONFIG?.BACKEND_URL || "").trim().replace(/\/$/, "");

    if (!backendUrl) {
        throw new Error("No backend configured");
    }

    if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) {
        throw new Error("Login required");
    }

    if (typeof window.setSyncStatus === "function") {
        window.setSyncStatus("Replacing cloud data...", "saving");
    }

    const headers = typeof window.buildAuthHeaders === "function"
        ? window.buildAuthHeaders({}, true)
        : {
            "Content-Type": "application/json"
        };

    const response = await fetch(`${backendUrl}/api/data/replace`, {
        method: "POST",
        headers,
        body: JSON.stringify(importedAppData)
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload?.error || "Replace failed");
    }

    return payload.current || null;
}

function importAppData(file) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
        try {
            const parsed = JSON.parse(reader.result);
            const result = migrateAppData(parsed);

            const confirmed = window.confirm(
                "Importing will replace the active cloud dataset and create a safety snapshot first. Continue?"
            );

            if (!confirmed) {
                return;
            }

            const replacedCloudData = await replaceCloudData(result.data);

            if (replacedCloudData) {
                saveAppData(replacedCloudData, {
                    source: "remote",
                    skipBackendSync: true,
                    preserveSavedAt: true,
                    statusMessage: "Imported and synced"
                });
            } else {
                saveAppData(result.data, {
                    source: "remote",
                    skipBackendSync: true,
                    preserveSavedAt: true,
                    statusMessage: "Imported and synced"
                });
            }

            if (typeof window.stopAutoSync === "function") {
                window.stopAutoSync();
            }

            if (typeof window.startAutoSync === "function") {
                window.startAutoSync(10000);
            }

            location.reload();
        } catch (error) {
            console.error(error);
            alert(`Import failed. ${error.message || "That file is not valid LeanOS data."}`);
        }
    };

    reader.readAsText(file);
}