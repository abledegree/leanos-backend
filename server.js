const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.LEANOS_API_KEY || "").trim();
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "app-data.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

app.use(cors());
app.use(express.json({ limit: "5mb" }));

function ensureFolders() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function createEmptyData() {
    return {
        appName: "LeanOS",
        version: "3.0.0",
        savedAt: new Date().toISOString(),
        data: {
            jobs: [],
            inventory: [],
            transactions: []
        }
    };
}

function ensureDbFile() {
    ensureFolders();

    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(createEmptyData(), null, 2));
    }
}

function readDb() {
    ensureDbFile();
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function writeDb(data) {
    ensureDbFile();

    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const tempFile = `${DB_FILE}.tmp`;
    const backupFile = path.join(BACKUP_DIR, `app-data-${timestamp}.json`);
    const payload = JSON.stringify(data, null, 2);

    fs.writeFileSync(tempFile, payload);
    fs.renameSync(tempFile, DB_FILE);
    fs.writeFileSync(backupFile, payload);

    const backups = fs.readdirSync(BACKUP_DIR)
        .map(file => path.join(BACKUP_DIR, file))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    for (const extra of backups.slice(15)) {
        fs.unlinkSync(extra);
    }
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

app.get("/health", (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/data", requireApiKey, (req, res) => {
    res.json(readDb());
});

app.post("/api/data", requireApiKey, (req, res) => {
    const incoming = req.body;

    if (!incoming || typeof incoming !== "object" || !incoming.data) {
        res.status(400).json({ error: "Invalid app data payload" });
        return;
    }

    const current = readDb();
    const currentTime = new Date(current.savedAt || 0).getTime();
    const incomingTime = new Date(incoming.savedAt || 0).getTime();

    if (incomingTime < currentTime) {
        res.status(409).json({
            error: "Incoming data is older than current backend data",
            current
        });
        return;
    }

    writeDb({
        ...incoming,
        savedAt: new Date().toISOString()
    });

    res.json({ ok: true });
});

app.listen(PORT, () => {
    ensureDbFile();
    console.log(`LeanOS backend listening on port ${PORT}`);
});
