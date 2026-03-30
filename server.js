require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.LEANOS_API_KEY || "").trim();
const LEANOS_USERNAME = (process.env.LEANOS_USERNAME || "leanos").trim();
const LEANOS_PASSWORD = (process.env.LEANOS_PASSWORD || "changeme-now").trim();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const CURRENT_APP_VERSION = "3.1.15";
const CURRENT_SCHEMA_VERSION = 2;

const DATA_DIR = path.join(__dirname, "data");
const ACTIVE_DIR = path.join(DATA_DIR, "active");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
const ACTIVE_DB_FILE = path.join(ACTIVE_DIR, "app-data.json");
const SESSION_FILE = path.join(DATA_DIR, "sessions.json");

const SNAPSHOT_RETENTION_DAYS = 30;
const MIN_SNAPSHOTS_TO_KEEP = 10;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

function ensureFolders() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(ACTIVE_DIR, { recursive: true });
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function createEmptyData() {
    const nowIso = new Date().toISOString();

    return {
        appName: "LeanOS",
        version: CURRENT_APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: nowIso,
        syncMeta: {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            isHydratedFromCloud: true,
            dirty: false,
            lastKnownRemoteSavedAt: nowIso,
            baseRemoteSavedAt: nowIso,
            lastSuccessfulPullAt: nowIso,
            lastSuccessfulPushAt: nowIso,
            lastLocalMutationAt: null,
            lastEditedByDeviceId: null,
            status: "synced",
            message: "Synced",
            conflict: null
        },
        data: {
            jobs: [],
            inventory: [],
            transactions: []
        }
    };
}

function ensureDbFile() {
    ensureFolders();

    if (!fs.existsSync(ACTIVE_DB_FILE)) {
        writeJsonAtomic(ACTIVE_DB_FILE, createEmptyData());
    }

    if (!fs.existsSync(SESSION_FILE)) {
        writeJsonAtomic(SESSION_FILE, { sessions: [] });
    }
}

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }

        const raw = fs.readFileSync(filePath, "utf-8");
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        console.error(`Failed reading ${filePath}`, error);
        return fallback;
    }
}

function writeJsonAtomic(filePath, data) {
    const tempFile = `${filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, filePath);
}

function readActiveDb() {
    ensureDbFile();
    return readJsonFile(ACTIVE_DB_FILE, createEmptyData());
}

function writeActiveDb(data) {
    ensureDbFile();
    writeJsonAtomic(ACTIVE_DB_FILE, data);
}

function readSessionsFile() {
    ensureDbFile();
    const payload = readJsonFile(SESSION_FILE, { sessions: [] });
    return Array.isArray(payload.sessions) ? payload : { sessions: [] };
}

function writeSessionsFile(payload) {
    ensureDbFile();
    writeJsonAtomic(SESSION_FILE, payload);
}

function generateId(length = 16) {
    return crypto.randomBytes(length).toString("hex");
}

function maskToken(token) {
    if (!token) return "";
    if (token.length <= 10) return token;
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function cleanupExpiredSessions() {
    const now = Date.now();
    const payload = readSessionsFile();

    const nextSessions = payload.sessions.map(session => {
        if (!session.active) return session;

        const lastSeenTime = new Date(session.lastSeenAt || session.createdAt || 0).getTime();
        if (!lastSeenTime || now - lastSeenTime <= SESSION_TTL_MS) {
            return session;
        }

        return {
            ...session,
            active: false,
            revokedAt: new Date().toISOString(),
            revokeReason: "expired"
        };
    });

    writeSessionsFile({ sessions: nextSessions });
}

function createSession({ username, deviceId, deviceLabel }) {
    cleanupExpiredSessions();

    const payload = readSessionsFile();
    const nowIso = new Date().toISOString();

    const session = {
        id: generateId(12),
        token: generateId(24),
        username,
        deviceId: (deviceId || "unknown-device").trim(),
        deviceLabel: (deviceLabel || "Unknown Device").trim(),
        createdAt: nowIso,
        lastSeenAt: nowIso,
        active: true,
        revokedAt: null,
        revokeReason: null
    };

    payload.sessions.push(session);
    writeSessionsFile(payload);

    return session;
}

function findSessionByToken(token) {
    cleanupExpiredSessions();
    const payload = readSessionsFile();
    return payload.sessions.find(session => session.token === token) || null;
}

function touchSession(sessionId) {
    const payload = readSessionsFile();
    const nowIso = new Date().toISOString();

    const nextSessions = payload.sessions.map(session => {
        if (session.id !== sessionId) return session;
        return {
            ...session,
            lastSeenAt: nowIso
        };
    });

    writeSessionsFile({ sessions: nextSessions });
}

function revokeSession(sessionId, reason = "manual") {
    const payload = readSessionsFile();
    let found = null;

    const nextSessions = payload.sessions.map(session => {
        if (session.id !== sessionId) return session;
        found = session;
        return {
            ...session,
            active: false,
            revokedAt: new Date().toISOString(),
            revokeReason: reason
        };
    });

    if (!found) {
        return null;
    }

    writeSessionsFile({ sessions: nextSessions });
    return found;
}

function serializeSession(session) {
    return {
        id: session.id,
        username: session.username,
        deviceId: session.deviceId,
        deviceLabel: session.deviceLabel,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        active: session.active,
        revokedAt: session.revokedAt,
        revokeReason: session.revokeReason,
        tokenPreview: maskToken(session.token)
    };
}

function requireApiKey(req, res, next) {
    if (!API_KEY) {
        next();
        return;
    }

    const provided = (req.header("x-api-key") || "").trim();

    if (provided !== API_KEY) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    next();
}

function requireSession(req, res, next) {
    const authHeader = req.header("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
        res.status(401).json({ error: "Login required" });
        return;
    }

    const session = findSessionByToken(token);

    if (!session || !session.active) {
        res.status(401).json({ error: "Session expired" });
        return;
    }

    touchSession(session.id);
    req.session = {
        ...session,
        lastSeenAt: new Date().toISOString()
    };
    next();
}

function countRecords(data) {
    const jobs = Array.isArray(data?.jobs) ? data.jobs.length : 0;
    const inventory = Array.isArray(data?.inventory) ? data.inventory.length : 0;
    const transactions = Array.isArray(data?.transactions) ? data.transactions.length : 0;

    return {
        jobs,
        inventory,
        transactions,
        total: jobs + inventory + transactions
    };
}

function normalizePayload(payload) {
    if (!payload || typeof payload !== "object" || typeof payload.data !== "object") {
        return null;
    }

    return {
        appName: "LeanOS",
        version: payload.version || CURRENT_APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: payload.savedAt || new Date().toISOString(),
        syncMeta: {
            ...(payload.syncMeta || {})
        },
        data: {
            jobs: Array.isArray(payload.data.jobs) ? payload.data.jobs : [],
            inventory: Array.isArray(payload.data.inventory) ? payload.data.inventory : [],
            transactions: Array.isArray(payload.data.transactions) ? payload.data.transactions : []
        }
    };
}

function validateAppDataPayload(payload) {
    if (!payload || typeof payload !== "object") {
        return { ok: false, error: "Payload must be an object" };
    }

    if (payload.appName && payload.appName !== "LeanOS") {
        return { ok: false, error: "Invalid appName" };
    }

    if (typeof payload.data !== "object" || payload.data === null) {
        return { ok: false, error: "Payload must contain a data object" };
    }

    if (!Array.isArray(payload.data.jobs)) {
        return { ok: false, error: "Jobs must be an array" };
    }

    if (!Array.isArray(payload.data.inventory)) {
        return { ok: false, error: "Inventory must be an array" };
    }

    if (!Array.isArray(payload.data.transactions)) {
        return { ok: false, error: "Transactions must be an array" };
    }

    return { ok: true };
}

function createSnapshotFileName(snapshotId, reason) {
    const safeReason = String(reason || "snapshot")
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "snapshot";

    return `${new Date().toISOString().replaceAll(":", "-")}__${safeReason}__${snapshotId}.json`;
}

function getSnapshotFilePathByName(fileName) {
    return path.join(ARCHIVE_DIR, fileName);
}

function listSnapshotFileNamesSorted() {
    ensureFolders();

    return fs.readdirSync(ARCHIVE_DIR)
        .filter(name => name.endsWith(".json"))
        .sort((a, b) => {
            const aPath = getSnapshotFilePathByName(a);
            const bPath = getSnapshotFilePathByName(b);
            return fs.statSync(bPath).mtimeMs - fs.statSync(aPath).mtimeMs;
        });
}

function validateSnapshotPayload(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
        return { ok: false, error: "Snapshot must be an object" };
    }

    if (!snapshot.snapshotId || typeof snapshot.snapshotId !== "string") {
        return { ok: false, error: "Snapshot missing snapshotId" };
    }

    if (!snapshot.snapshotCreatedAt || Number.isNaN(new Date(snapshot.snapshotCreatedAt).getTime())) {
        return { ok: false, error: "Snapshot missing valid snapshotCreatedAt" };
    }

    if (!snapshot.payload) {
        return { ok: false, error: "Snapshot missing payload" };
    }

    return validateAppDataPayload(snapshot.payload);
}

function buildSnapshotRecord(activePayload, reason, meta = {}) {
    const snapshotId = generateId(8);
    const nowIso = new Date().toISOString();

    return {
        snapshotId,
        snapshotCreatedAt: nowIso,
        reason: reason || "snapshot",
        appVersion: activePayload?.version || CURRENT_APP_VERSION,
        schemaVersion: activePayload?.schemaVersion || CURRENT_SCHEMA_VERSION,
        recordCounts: countRecords(activePayload?.data || {}),
        meta: {
            ...meta
        },
        payload: activePayload
    };
}

function createSnapshot(reason, meta = {}) {
    const activePayload = readActiveDb();
    const snapshot = buildSnapshotRecord(activePayload, reason, meta);
    const fileName = createSnapshotFileName(snapshot.snapshotId, reason);
    const filePath = getSnapshotFilePathByName(fileName);

    writeJsonAtomic(filePath, snapshot);
    pruneArchiveSnapshots();

    return {
        snapshotId: snapshot.snapshotId,
        fileName,
        snapshotCreatedAt: snapshot.snapshotCreatedAt,
        reason: snapshot.reason,
        recordCounts: snapshot.recordCounts
    };
}

function loadSnapshotByFileName(fileName) {
    const filePath = getSnapshotFilePathByName(fileName);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    const snapshot = readJsonFile(filePath, null);
    if (!snapshot) return null;

    const validation = validateSnapshotPayload(snapshot);
    if (!validation.ok) {
        return {
            invalid: true,
            error: validation.error,
            snapshot
        };
    }

    return {
        invalid: false,
        snapshot
    };
}

function getSnapshotSummary(fileName) {
    const loaded = loadSnapshotByFileName(fileName);
    if (!loaded) return null;

    if (loaded.invalid) {
        return {
            fileName,
            invalid: true,
            error: loaded.error
        };
    }

    const snapshot = loaded.snapshot;
    return {
        fileName,
        snapshotId: snapshot.snapshotId,
        snapshotCreatedAt: snapshot.snapshotCreatedAt,
        reason: snapshot.reason,
        appVersion: snapshot.appVersion,
        schemaVersion: snapshot.schemaVersion,
        recordCounts: snapshot.recordCounts,
        meta: snapshot.meta || {},
        invalid: false
    };
}

function listSnapshots() {
    return listSnapshotFileNamesSorted()
        .map(getSnapshotSummary)
        .filter(Boolean);
}

function pruneArchiveSnapshots() {
    const files = listSnapshotFileNamesSorted();
    if (files.length <= MIN_SNAPSHOTS_TO_KEEP) {
        return;
    }

    const now = Date.now();
    const retentionCutoffMs = SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const summaries = files.map(fileName => {
        const filePath = getSnapshotFilePathByName(fileName);
        const stats = fs.statSync(filePath);
        return {
            fileName,
            filePath,
            mtimeMs: stats.mtimeMs,
            ageMs: now - stats.mtimeMs
        };
    });

    const keepSet = new Set(
        summaries.slice(0, MIN_SNAPSHOTS_TO_KEEP).map(item => item.fileName)
    );

    for (const entry of summaries) {
        if (keepSet.has(entry.fileName)) continue;
        if (entry.ageMs <= retentionCutoffMs) continue;

        try {
            fs.unlinkSync(entry.filePath);
        } catch (error) {
            console.error("Failed pruning snapshot:", entry.fileName, error);
        }
    }
}

function restoreSnapshotByFileName(fileName, restoreMeta = {}) {
    const loaded = loadSnapshotByFileName(fileName);

    if (!loaded) {
        return { ok: false, status: 404, error: "Snapshot not found" };
    }

    if (loaded.invalid) {
        return { ok: false, status: 400, error: loaded.error || "Snapshot is invalid" };
    }

    const snapshot = loaded.snapshot;
    const payloadValidation = validateAppDataPayload(snapshot.payload);

    if (!payloadValidation.ok) {
        return { ok: false, status: 400, error: payloadValidation.error };
    }

    const beforeRestoreSnapshot = createSnapshot("before-restore", restoreMeta);
    const nowIso = new Date().toISOString();

    const restoredPayload = {
        ...snapshot.payload,
        appName: "LeanOS",
        version: snapshot.payload.version || CURRENT_APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: nowIso,
        syncMeta: {
            ...(snapshot.payload.syncMeta || {}),
            schemaVersion: CURRENT_SCHEMA_VERSION,
            isHydratedFromCloud: true,
            dirty: false,
            lastKnownRemoteSavedAt: nowIso,
            baseRemoteSavedAt: nowIso,
            lastSuccessfulPullAt: nowIso,
            lastSuccessfulPushAt: nowIso,
            status: "synced",
            message: "Restored from snapshot",
            conflict: null
        },
        restoreMeta: {
            restoredAt: nowIso,
            sourceSnapshotId: snapshot.snapshotId,
            sourceSnapshotCreatedAt: snapshot.snapshotCreatedAt,
            beforeRestoreSnapshotId: beforeRestoreSnapshot.snapshotId,
            ...restoreMeta
        }
    };

    writeActiveDb(restoredPayload);

    return {
        ok: true,
        current: restoredPayload,
        restoredSnapshotId: snapshot.snapshotId,
        beforeRestoreSnapshotId: beforeRestoreSnapshot.snapshotId
    };
}

app.get("/health", (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

app.post("/api/login", requireApiKey, (req, res) => {
    const username = (req.body?.username || "").trim();
    const password = (req.body?.password || "").trim();
    const deviceId = (req.body?.deviceId || "").trim();
    const deviceLabel = (req.body?.deviceLabel || "").trim();

    if (!username || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
    }

    if (username !== LEANOS_USERNAME || password !== LEANOS_PASSWORD) {
        res.status(401).json({ error: "Invalid username or password" });
        return;
    }

    const session = createSession({ username, deviceId, deviceLabel });

    res.json({
        ok: true,
        token: session.token,
        session: serializeSession(session)
    });
});

app.post("/api/logout", requireApiKey, requireSession, (req, res) => {
    revokeSession(req.session.id, "logout");
    res.json({ ok: true });
});

app.get("/api/session", requireApiKey, requireSession, (req, res) => {
    res.json({
        ok: true,
        session: serializeSession(req.session)
    });
});

app.get("/api/sessions", requireApiKey, requireSession, (req, res) => {
    cleanupExpiredSessions();
    const payload = readSessionsFile();

    const sessions = payload.sessions
        .filter(session => session.active)
        .sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime())
        .map(serializeSession);

    res.json({
        ok: true,
        currentSessionId: req.session.id,
        sessions
    });
});

app.post("/api/sessions/:id/revoke", requireApiKey, requireSession, (req, res) => {
    const sessionId = (req.params.id || "").trim();

    if (!sessionId) {
        res.status(400).json({ error: "Session id is required" });
        return;
    }

    const revoked = revokeSession(sessionId, `revoked-by:${req.session.id}`);

    if (!revoked) {
        res.status(404).json({ error: "Session not found" });
        return;
    }

    res.json({
        ok: true,
        revokedSessionId: sessionId,
        revokedCurrent: sessionId === req.session.id
    });
});

app.get("/api/data", requireApiKey, requireSession, (req, res) => {
    res.json(readActiveDb());
});

app.post("/api/data", requireApiKey, requireSession, (req, res) => {
    const incoming = normalizePayload(req.body);

    if (!incoming) {
        res.status(400).json({ error: "Invalid app data payload" });
        return;
    }

    const payloadValidation = validateAppDataPayload(incoming);
    if (!payloadValidation.ok) {
        res.status(400).json({ error: payloadValidation.error });
        return;
    }

    const current = readActiveDb();
    const currentSavedAt = current.savedAt || null;
    const incomingSavedAt = incoming.savedAt || null;
    const incomingBaseRemoteSavedAt = (incoming.syncMeta?.baseRemoteSavedAt || "").trim() || null;

    const currentCounts = countRecords(current.data);
    const incomingCounts = countRecords(incoming.data);

    const currentHasData = currentCounts.total > 0;
    const incomingLooksEmpty = incomingCounts.total === 0;

    if (currentHasData && incomingLooksEmpty) {
        res.status(409).json({
            error: "Blocked empty/default local state from overwriting cloud data",
            reason: "blocked-empty",
            current
        });
        return;
    }

    if (incomingBaseRemoteSavedAt && currentSavedAt && incomingBaseRemoteSavedAt !== currentSavedAt) {
        res.status(409).json({
            error: "Conflict detected: cloud data changed after this device last hydrated",
            reason: "conflict",
            current
        });
        return;
    }

    const currentTime = new Date(currentSavedAt || 0).getTime();
    const incomingTime = new Date(incomingSavedAt || 0).getTime();

    if (!incomingBaseRemoteSavedAt && incomingTime < currentTime) {
        res.status(409).json({
            error: "Incoming data is older than current backend data",
            reason: "remote-newer",
            current
        });
        return;
    }

    const nowIso = new Date().toISOString();

    const nextPayload = {
        ...incoming,
        appName: "LeanOS",
        version: incoming.version || CURRENT_APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: nowIso,
        syncMeta: {
            ...(incoming.syncMeta || {}),
            schemaVersion: CURRENT_SCHEMA_VERSION,
            isHydratedFromCloud: true,
            dirty: false,
            lastKnownRemoteSavedAt: nowIso,
            baseRemoteSavedAt: nowIso,
            lastSuccessfulPushAt: nowIso,
            status: "synced",
            message: "Synced",
            conflict: null
        },
        lastEditedBySessionId: req.session.id,
        lastEditedByDeviceId: req.session.deviceId || null
    };

    writeActiveDb(nextPayload);

    res.json({
        ok: true,
        current: nextPayload
    });
});

/**
 * Archive / snapshot routes
 */

app.get("/api/archive", requireApiKey, requireSession, (req, res) => {
    pruneArchiveSnapshots();

    const snapshots = listSnapshots();

    res.json({
        ok: true,
        retentionDays: SNAPSHOT_RETENTION_DAYS,
        minSnapshotsKept: MIN_SNAPSHOTS_TO_KEEP,
        snapshots
    });
});

app.get("/api/archive/:fileName", requireApiKey, requireSession, (req, res) => {
    const fileName = (req.params.fileName || "").trim();

    if (!fileName) {
        res.status(400).json({ error: "Snapshot fileName is required" });
        return;
    }

    const loaded = loadSnapshotByFileName(fileName);

    if (!loaded) {
        res.status(404).json({ error: "Snapshot not found" });
        return;
    }

    if (loaded.invalid) {
        res.status(400).json({ error: loaded.error || "Snapshot is invalid" });
        return;
    }

    res.json({
        ok: true,
        snapshot: loaded.snapshot
    });
});

app.post("/api/archive/:fileName/restore", requireApiKey, requireSession, (req, res) => {
    const fileName = (req.params.fileName || "").trim();

    if (!fileName) {
        res.status(400).json({ error: "Snapshot fileName is required" });
        return;
    }

    const result = restoreSnapshotByFileName(fileName, {
        requestedBySessionId: req.session.id,
        requestedByDeviceId: req.session.deviceId || null,
        requestedByUsername: req.session.username || null
    });

    if (!result.ok) {
        res.status(result.status || 400).json({ error: result.error || "Restore failed" });
        return;
    }

    res.json({
        ok: true,
        current: result.current,
        restoredSnapshotId: result.restoredSnapshotId,
        beforeRestoreSnapshotId: result.beforeRestoreSnapshotId
    });
});

/**
 * Protected destructive replace/import route.
 * Use this for local-file imports or future admin recovery tools.
 */
app.post("/api/data/replace", requireApiKey, requireSession, (req, res) => {
    const incoming = normalizePayload(req.body);

    if (!incoming) {
        res.status(400).json({ error: "Invalid replacement payload" });
        return;
    }

    const payloadValidation = validateAppDataPayload(incoming);
    if (!payloadValidation.ok) {
        res.status(400).json({ error: payloadValidation.error });
        return;
    }

    const beforeReplaceSnapshot = createSnapshot("before-replace", {
        requestedBySessionId: req.session.id,
        requestedByDeviceId: req.session.deviceId || null,
        requestedByUsername: req.session.username || null
    });

    const nowIso = new Date().toISOString();

    const nextPayload = {
        ...incoming,
        appName: "LeanOS",
        version: incoming.version || CURRENT_APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: nowIso,
        syncMeta: {
            ...(incoming.syncMeta || {}),
            schemaVersion: CURRENT_SCHEMA_VERSION,
            isHydratedFromCloud: true,
            dirty: false,
            lastKnownRemoteSavedAt: nowIso,
            baseRemoteSavedAt: nowIso,
            lastSuccessfulPullAt: nowIso,
            lastSuccessfulPushAt: nowIso,
            status: "synced",
            message: "Replaced from import/restore",
            conflict: null
        },
        replaceMeta: {
            replacedAt: nowIso,
            beforeReplaceSnapshotId: beforeReplaceSnapshot.snapshotId,
            requestedBySessionId: req.session.id,
            requestedByDeviceId: req.session.deviceId || null
        }
    };

    writeActiveDb(nextPayload);

    res.json({
        ok: true,
        current: nextPayload,
        beforeReplaceSnapshotId: beforeReplaceSnapshot.snapshotId
    });
});

/**
 * Optional manual snapshot route.
 * Handy for admin/recovery tooling later.
 */
app.post("/api/archive/create", requireApiKey, requireSession, (req, res) => {
    const reason = (req.body?.reason || "manual").trim();

    const snapshot = createSnapshot(reason, {
        requestedBySessionId: req.session.id,
        requestedByDeviceId: req.session.deviceId || null,
        requestedByUsername: req.session.username || null
    });

    res.json({
        ok: true,
        snapshot
    });
});

app.listen(PORT, () => {
    ensureDbFile();
    cleanupExpiredSessions();
    pruneArchiveSnapshots();
    console.log(`LeanOS backend listening on port ${PORT}`);
});
