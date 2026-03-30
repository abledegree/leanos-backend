let syncTimeoutId = null;
let autoSyncIntervalId = null;
let syncCycleInProgress = false;
let rerunSyncRequested = false;
let startupHydrationFinished = false;
let lastConflictSignature = null;

function getBackendUrl() {
    return (window.LEANOS_CONFIG?.BACKEND_URL || "").trim().replace(/\/$/, "");
}

function getApiHeaders() {
    if (typeof window.buildAuthHeaders === "function") {
        return window.buildAuthHeaders({}, true);
    }

    const headers = {
        "Content-Type": "application/json"
    };

    const apiKey = (window.LEANOS_CONFIG?.API_KEY || "").trim();
    if (apiKey) {
        headers["x-api-key"] = apiKey;
    }

    return headers;
}

function setSyncStatus(message, state = "idle") {
    if (!syncStatus) return;

    syncStatus.textContent = message;
    syncStatus.dataset.state = state;
    syncStatus.classList.toggle("error-text", ["offline", "blocked", "conflict"].includes(state));
}

function countRecordsFromAppData(appData) {
    return {
        jobs: Array.isArray(appData?.data?.jobs) ? appData.data.jobs.length : 0,
        inventory: Array.isArray(appData?.data?.inventory) ? appData.data.inventory.length : 0,
        transactions: Array.isArray(appData?.data?.transactions) ? appData.data.transactions.length : 0
    };
}

function totalRecordCount(appData) {
    const counts = countRecordsFromAppData(appData);
    return counts.jobs + counts.inventory + counts.transactions;
}

function hasMeaningfulData(appData) {
    return totalRecordCount(appData) > 0;
}

function sameTimestamp(a, b) {
    if (!a && !b) return true;
    return String(a || "") === String(b || "");
}

function canonicalizeForCompare(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalizeForCompare);
    }

    if (value && typeof value === "object") {
        const sortedKeys = Object.keys(value).sort();
        const output = {};
        for (const key of sortedKeys) {
            output[key] = canonicalizeForCompare(value[key]);
        }
        return output;
    }

    return value;
}

function dataPayloadsMatch(localAppData, remoteAppData) {
    const localData = canonicalizeForCompare(localAppData?.data || {});
    const remoteData = canonicalizeForCompare(remoteAppData?.data || {});
    return JSON.stringify(localData) === JSON.stringify(remoteData);
}

function refreshRuntimeDataFromStorage() {
    jobs = loadJobs();
    inventory = loadInventory();
    transactions = loadTransactions();

    if (typeof rerenderAll === "function") {
        rerenderAll();
    }
}

function applyRemoteAppData(remote, statusMessage = "Synced") {
    saveAppData(remote, {
        source: "remote",
        skipBackendSync: true,
        preserveSavedAt: true,
        statusMessage
    });

    refreshRuntimeDataFromStorage();
}

function clearConflictState(remoteSavedAt = null, message = "Synced") {
    const nowIso = new Date().toISOString();

    updateSyncMeta({
        isHydratedFromCloud: true,
        dirty: false,
        lastKnownRemoteSavedAt: remoteSavedAt || loadAppData().syncMeta?.lastKnownRemoteSavedAt || null,
        baseRemoteSavedAt: remoteSavedAt || loadAppData().syncMeta?.baseRemoteSavedAt || null,
        lastSuccessfulPullAt: nowIso,
        status: "synced",
        message,
        conflict: null
    });

    startupHydrationFinished = true;
    lastConflictSignature = null;
    setSyncStatus(message, "synced");
}

function rememberConflict(type, currentRemoteSavedAt) {
    const signature = `${type}::${currentRemoteSavedAt || "none"}`;
    if (lastConflictSignature === signature) {
        return;
    }

    lastConflictSignature = signature;
    console.warn("LeanOS sync conflict:", signature);
}

async function fetchRemoteAppData() {
    const backendUrl = getBackendUrl();
    if (!backendUrl) return null;

    const response = await fetch(`${backendUrl}/api/data`, {
        method: "GET",
        headers: getApiHeaders()
    });

    if (response.status === 401) {
        if (typeof window.handleSessionExpired === "function") {
            await window.handleSessionExpired("Logged out — sync stopped");
        }
        throw new Error("Unauthorized");
    }

    if (!response.ok) {
        throw new Error(`Backend pull failed: ${response.status}`);
    }

    return await response.json();
}

async function pushAppDataToBackend(appData) {
    const backendUrl = getBackendUrl();

    if (!backendUrl) return { ok: false, reason: "no-backend" };
    if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) {
        return { ok: false, reason: "logged-out" };
    }

    try {
        setSyncStatus("Saving...", "saving");

        const response = await fetch(`${backendUrl}/api/data`, {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify(appData)
        });

        const payload = await response.json().catch(() => ({}));

        if (response.status === 401) {
            if (typeof window.handleSessionExpired === "function") {
                await window.handleSessionExpired("Logged out — sync stopped");
            }
            return { ok: false, reason: "logged-out" };
        }

        if (response.status === 409) {
            return {
                ok: false,
                reason: payload.reason || "conflict",
                current: payload.current || null,
                error: payload.error || "Conflict"
            };
        }

        if (!response.ok) {
            throw new Error(`Backend push failed: ${response.status}`);
        }

        return {
            ok: true,
            current: payload.current || null
        };
    } catch (error) {
        console.error(error);
        setSyncStatus("Offline — local changes pending", "offline");
        return { ok: false, reason: "error" };
    }
}

async function runExclusiveSync(task) {
    if (syncCycleInProgress) {
        rerunSyncRequested = true;
        return false;
    }

    syncCycleInProgress = true;

    try {
        return await task();
    } finally {
        syncCycleInProgress = false;

        if (rerunSyncRequested) {
            rerunSyncRequested = false;
            setTimeout(() => {
                runSafeReconciliationCycle("rerun");
            }, 50);
        }
    }
}

function blockBecauseNotHydrated() {
    const local = loadAppData();
    const syncMeta = local.syncMeta || {};

    updateSyncMeta({
        ...syncMeta,
        status: "blocked",
        message: "Blocked — waiting for cloud load"
    });

    setSyncStatus("Blocked — waiting for cloud load", "blocked");
}

async function useCloudVersion() {
    const confirmed = window.confirm(
        "Use the current cloud version and discard unsynced local changes on this device?"
    );

    if (!confirmed) {
        return false;
    }

    return await runExclusiveSync(async () => {
        const backendUrl = getBackendUrl();

        if (!backendUrl) {
            alert("No backend is configured, so there is no cloud version to use.");
            return false;
        }

        if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) {
            setSyncStatus("Logged out — sync stopped", "blocked");
            return false;
        }

        try {
            setSyncStatus("Loading cloud data...", "loading");

            const remote = await fetchRemoteAppData();
            const remoteSavedAt = remote?.savedAt || null;

            applyRemoteAppData(remote, "Using cloud version");
            clearConflictState(remoteSavedAt, "Synced");

            if (typeof startAutoSync === "function") {
                startAutoSync(10000);
            }

            return true;
        } catch (error) {
            console.error(error);

            if (error.message !== "Unauthorized") {
                setSyncStatus("Offline — could not load cloud version", "offline");
                alert("Could not load the cloud version right now.");
            }

            return false;
        }
    });
}

async function hydrateFromCloudAtStartup() {
    return await runExclusiveSync(async () => {
        const backendUrl = getBackendUrl();

        if (!backendUrl) {
            startupHydrationFinished = true;
            updateSyncMeta({
                isHydratedFromCloud: true,
                status: "offline",
                message: "Offline — local only"
            });
            setSyncStatus("Offline — local only", "offline");
            return true;
        }

        if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) {
            setSyncStatus("Logged out — sync stopped", "blocked");
            return false;
        }

        try {
            setSyncStatus("Loading cloud data...", "loading");
            updateSyncMeta({
                status: "loading",
                message: "Loading cloud data..."
            });

            const local = loadAppData();
            const localSyncMeta = local.syncMeta || {};
            const remote = await fetchRemoteAppData();

            const localDirty = !!localSyncMeta.dirty;
            const localMeaningful = hasMeaningfulData(local);
            const remoteMeaningful = hasMeaningfulData(remote);
            const remoteSavedAt = remote?.savedAt || null;
            const baseRemoteSavedAt = localSyncMeta.baseRemoteSavedAt || null;
            const payloadsMatch = dataPayloadsMatch(local, remote);

            if (payloadsMatch) {
                applyRemoteAppData(remote, "Synced");
                clearConflictState(remoteSavedAt, "Synced");
                return true;
            }

            if (
                localDirty &&
                localMeaningful &&
                remoteMeaningful &&
                baseRemoteSavedAt &&
                remoteSavedAt &&
                !sameTimestamp(baseRemoteSavedAt, remoteSavedAt)
            ) {
                rememberConflict("startup-conflict", remoteSavedAt);

                updateSyncMeta({
                    isHydratedFromCloud: false,
                    lastKnownRemoteSavedAt: remoteSavedAt,
                    status: "conflict",
                    message: "Conflict — local and cloud both changed",
                    conflict: {
                        type: "startup-conflict",
                        remoteSavedAt,
                        detectedAt: new Date().toISOString()
                    }
                });

                setSyncStatus("Conflict — local and cloud both changed", "conflict");
                return false;
            }

            if (remoteMeaningful || !localMeaningful) {
                applyRemoteAppData(remote, remoteMeaningful ? "Synced" : "Cloud checked");
                clearConflictState(remoteSavedAt, remoteMeaningful ? "Synced" : "Cloud checked");
            } else {
                updateSyncMeta({
                    isHydratedFromCloud: true,
                    dirty: !!localSyncMeta.dirty,
                    lastKnownRemoteSavedAt: remoteSavedAt || localSyncMeta.lastKnownRemoteSavedAt || null,
                    baseRemoteSavedAt: remoteSavedAt || localSyncMeta.baseRemoteSavedAt || null,
                    lastSuccessfulPullAt: new Date().toISOString(),
                    status: "synced",
                    message: "Cloud checked — local data kept",
                    conflict: null
                });

                startupHydrationFinished = true;
                lastConflictSignature = null;
                setSyncStatus("Cloud checked — local data kept", "synced");
            }

            return true;
        } catch (error) {
            console.error(error);

            if (error.message !== "Unauthorized") {
                updateSyncMeta({
                    isHydratedFromCloud: false,
                    status: "offline",
                    message: "Offline — startup pull failed"
                });
                setSyncStatus("Offline — startup pull failed", "offline");
            }

            return false;
        }
    });
}

async function runSafeReconciliationCycle(reason = "auto") {
    return await runExclusiveSync(async () => {
        const backendUrl = getBackendUrl();

        if (!backendUrl) {
            setSyncStatus("Offline — local only", "offline");
            return false;
        }

        if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) {
            setSyncStatus("Logged out — sync stopped", "blocked");
            return false;
        }

        const local = loadAppData();
        const syncMeta = local.syncMeta || {};

        if (!startupHydrationFinished || !syncMeta.isHydratedFromCloud) {
            try {
                const remote = await fetchRemoteAppData();
                const remoteSavedAt = remote?.savedAt || null;

                if (dataPayloadsMatch(local, remote)) {
                    applyRemoteAppData(remote, "Synced");
                    clearConflictState(remoteSavedAt, "Synced");
                    return true;
                }
            } catch (error) {
                console.error(error);
            }

            blockBecauseNotHydrated();
            return false;
        }

        try {
            setSyncStatus(syncMeta.dirty ? "Saving..." : "Checking cloud...", syncMeta.dirty ? "saving" : "loading");

            const remote = await fetchRemoteAppData();
            const remoteSavedAt = remote?.savedAt || null;
            const localDirty = !!syncMeta.dirty;
            const localBaseRemoteSavedAt = syncMeta.baseRemoteSavedAt || null;
            const localKnownRemoteSavedAt = syncMeta.lastKnownRemoteSavedAt || null;
            const localMeaningful = hasMeaningfulData(local);
            const remoteMeaningful = hasMeaningfulData(remote);
            const payloadsMatch = dataPayloadsMatch(local, remote);

            if (payloadsMatch) {
                applyRemoteAppData(remote, "Synced");
                clearConflictState(remoteSavedAt, "Synced");
                return true;
            }

            if (localDirty) {
                if (!localMeaningful && remoteMeaningful) {
                    rememberConflict("blocked-empty-local", remoteSavedAt);

                    updateSyncMeta({
                        status: "blocked",
                        message: "Blocked — empty local data cannot overwrite cloud",
                        lastKnownRemoteSavedAt: remoteSavedAt || localKnownRemoteSavedAt,
                        conflict: {
                            type: "blocked-empty-local",
                            remoteSavedAt,
                            detectedAt: new Date().toISOString()
                        }
                    });

                    setSyncStatus("Blocked — empty local data cannot overwrite cloud", "blocked");
                    return false;
                }

                if (
                    localBaseRemoteSavedAt &&
                    remoteSavedAt &&
                    !sameTimestamp(localBaseRemoteSavedAt, remoteSavedAt)
                ) {
                    rememberConflict("concurrent-change", remoteSavedAt);

                    updateSyncMeta({
                        status: "conflict",
                        message: "Conflict — local and cloud both changed",
                        lastKnownRemoteSavedAt: remoteSavedAt,
                        conflict: {
                            type: "concurrent-change",
                            remoteSavedAt,
                            detectedAt: new Date().toISOString()
                        }
                    });

                    setSyncStatus("Conflict — local and cloud both changed", "conflict");
                    return false;
                }

                const pushed = await pushAppDataToBackend(local);

                if (pushed.ok && pushed.current) {
                    applyRemoteAppData(pushed.current, "Synced");
                    clearConflictState(pushed.current?.savedAt || remoteSavedAt, "Synced");
                    return true;
                }

                if (["conflict", "remote-newer", "blocked-empty"].includes(pushed.reason)) {
                    const current = pushed.current || remote;
                    const currentSavedAt = current?.savedAt || remoteSavedAt || null;

                    if (current && dataPayloadsMatch(local, current)) {
                        applyRemoteAppData(current, "Synced");
                        clearConflictState(currentSavedAt, "Synced");
                        return true;
                    }

                    rememberConflict(pushed.reason, currentSavedAt);

                    updateSyncMeta({
                        status: pushed.reason === "blocked-empty" ? "blocked" : "conflict",
                        message: pushed.reason === "blocked-empty"
                            ? "Blocked — empty local data cannot overwrite cloud"
                            : "Conflict — cloud is newer than local",
                        lastKnownRemoteSavedAt: currentSavedAt || localKnownRemoteSavedAt,
                        conflict: {
                            type: pushed.reason,
                            remoteSavedAt: currentSavedAt,
                            detectedAt: new Date().toISOString()
                        }
                    });

                    if (!localMeaningful && current?.data) {
                        applyRemoteAppData(current, "Pulled newer cloud data");
                        clearConflictState(currentSavedAt, "Pulled newer cloud data");
                        return true;
                    }

                    setSyncStatus(
                        pushed.reason === "blocked-empty"
                            ? "Blocked — empty local data cannot overwrite cloud"
                            : "Conflict — cloud is newer than local",
                        pushed.reason === "blocked-empty" ? "blocked" : "conflict"
                    );

                    return false;
                }

                if (pushed.reason === "logged-out") {
                    return false;
                }

                setSyncStatus("Offline — local changes pending", "offline");
                return false;
            }

            if (remoteSavedAt && !sameTimestamp(remoteSavedAt, localKnownRemoteSavedAt || local.savedAt || null)) {
                applyRemoteAppData(remote, "Synced");
                clearConflictState(remoteSavedAt, "Synced");
                return true;
            }

            clearConflictState(remoteSavedAt || localKnownRemoteSavedAt || null, "Synced");
            return true;
        } catch (error) {
            console.error(error);

            if (error.message !== "Unauthorized") {
                updateSyncMeta({
                    status: "offline",
                    message: "Offline — sync failed"
                });
                setSyncStatus("Offline — sync failed", "offline");
            }

            return false;
        }
    });
}

function queueBackendSync(appData) {
    const backendUrl = getBackendUrl();
    if (!backendUrl) return;
    if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) return;

    const syncMeta = appData?.syncMeta || loadAppData().syncMeta || {};
    if (!syncMeta.isHydratedFromCloud || !startupHydrationFinished) {
        blockBecauseNotHydrated();
        return;
    }

    clearTimeout(syncTimeoutId);
    syncTimeoutId = setTimeout(() => {
        runSafeReconciliationCycle("local-change");
    }, 600);
}

function startAutoSync(intervalMs = 10000) {
    const backendUrl = getBackendUrl();

    if (!backendUrl) {
        setSyncStatus("Offline — local only", "offline");
        return;
    }

    if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) {
        setSyncStatus("Logged out — sync stopped", "blocked");
        return;
    }

    if (!startupHydrationFinished || !loadAppData().syncMeta?.isHydratedFromCloud) {
        blockBecauseNotHydrated();
        return;
    }

    if (autoSyncIntervalId) {
        clearInterval(autoSyncIntervalId);
    }

    autoSyncIntervalId = setInterval(async () => {
        if (typeof window.isLeanOsAuthenticated === "function" && !window.isLeanOsAuthenticated()) {
            stopAutoSync();
            setSyncStatus("Logged out — sync stopped", "blocked");
            return;
        }

        await runSafeReconciliationCycle("auto");
    }, intervalMs);
}

function stopAutoSync() {
    if (autoSyncIntervalId) {
        clearInterval(autoSyncIntervalId);
        autoSyncIntervalId = null;
    }

    clearTimeout(syncTimeoutId);
    syncTimeoutId = null;
}

window.queueBackendSync = queueBackendSync;
window.hydrateFromCloudAtStartup = hydrateFromCloudAtStartup;
window.runSafeReconciliationCycle = runSafeReconciliationCycle;
window.startAutoSync = startAutoSync;
window.stopAutoSync = stopAutoSync;
window.useCloudVersion = useCloudVersion;