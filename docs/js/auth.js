const AUTH_TOKEN_STORAGE_KEY = "leanos_auth_token";
const DEVICE_ID_STORAGE_KEY = "leanos_device_id";
const DEVICE_LABEL_STORAGE_KEY = "leanos_device_label";

let authBootCallback = null;
let hasBootedAfterLogin = false;
let authSessionPollId = null;
let authUiBuilt = false;
let currentAuthSession = null;

function getBackendUrlFromConfig() {
    return (window.LEANOS_CONFIG?.BACKEND_URL || "").trim().replace(/\/$/, "");
}

function getStoredAuthToken() {
    return (localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "").trim();
}

function setStoredAuthToken(token) {
    if (token) {
        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
        localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
}

function getDeviceId() {
    let deviceId = (localStorage.getItem(DEVICE_ID_STORAGE_KEY) || "").trim();
    if (!deviceId) {
        deviceId = (window.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    }
    return deviceId;
}

function getDeviceLabel() {
    let label = (localStorage.getItem(DEVICE_LABEL_STORAGE_KEY) || "").trim();
    if (!label) {
        const agent = navigator.userAgent || "Browser";
        const shortAgent = agent.length > 50 ? `${agent.slice(0, 50)}...` : agent;
        label = `${navigator.platform || "Device"} | ${shortAgent}`;
        localStorage.setItem(DEVICE_LABEL_STORAGE_KEY, label);
    }
    return label;
}

function buildAuthHeaders(extraHeaders = {}, includeJson = true) {
    const headers = { ...extraHeaders };

    if (includeJson && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    const apiKey = (window.LEANOS_CONFIG?.API_KEY || "").trim();
    if (apiKey) {
        headers["x-api-key"] = apiKey;
    }

    const token = getStoredAuthToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    headers["x-device-id"] = getDeviceId();
    headers["x-device-label"] = getDeviceLabel();

    return headers;
}

function setAuthStatus(message, isError = false) {
    const authStatus = document.getElementById("authStatus");
    if (!authStatus) return;

    authStatus.textContent = message;
    authStatus.classList.toggle("error-text", !!isError);
}

function setAuthMessage(message, isError = false) {
    const authMessage = document.getElementById("authMessage");
    if (!authMessage) return;

    authMessage.textContent = message;
    authMessage.classList.toggle("error-text", !!isError);
}

function showAuthOverlay(message = "Login required") {
    const overlay = document.getElementById("authOverlay");
    if (!overlay) return;

    overlay.classList.remove("hidden");
    setAuthMessage(message, false);
    setAuthStatus("Logged out", true);

    const usernameInput = document.getElementById("authUsername");
    const passwordInput = document.getElementById("authPassword");
    if (usernameInput) usernameInput.focus();
    if (passwordInput) passwordInput.value = "";

    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) {
        logoutButton.disabled = true;
    }
}

function hideAuthOverlay() {
    const overlay = document.getElementById("authOverlay");
    if (!overlay) return;

    overlay.classList.add("hidden");

    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) {
        logoutButton.disabled = false;
    }
}

function stopAuthSessionPoll() {
    if (authSessionPollId) {
        clearInterval(authSessionPollId);
        authSessionPollId = null;
    }
}

function startAuthSessionPoll() {
    stopAuthSessionPoll();

    authSessionPollId = setInterval(async () => {
        const token = getStoredAuthToken();
        if (!token) {
            stopAuthSessionPoll();
            return;
        }

        try {
            await validateExistingSession(false);
        } catch (error) {
            console.error(error);
        }
    }, 8000);
}

async function authFetch(path, options = {}) {
    const backendUrl = getBackendUrlFromConfig();
    if (!backendUrl) {
        throw new Error("No backend configured");
    }

    const headers = buildAuthHeaders(options.headers || {}, options.includeJson !== false);
    const response = await fetch(`${backendUrl}${path}`, {
        ...options,
        headers
    });

    if (response.status === 401) {
        await handleSessionExpired("Session expired or revoked");
        throw new Error("Unauthorized");
    }

    return response;
}

function injectAuthUi() {
    if (authUiBuilt) return;
    authUiBuilt = true;

    const style = document.createElement("style");
    style.textContent = `
        .auth-inline {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-right: 0.75rem;
            flex-wrap: wrap;
        }

        .auth-status-pill {
            font-size: 0.85rem;
            padding: 0.35rem 0.6rem;
            border-radius: 999px;
            background: rgba(255,255,255,0.08);
        }

        .auth-logout-button {
            padding: 0.45rem 0.8rem;
            border: none;
            border-radius: 10px;
            cursor: pointer;
        }

        .auth-overlay {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(7, 11, 18, 0.86);
            padding: 1rem;
        }

        .auth-card {
            width: min(420px, 100%);
            background: #111827;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 18px;
            padding: 1.25rem;
            box-shadow: 0 18px 55px rgba(0,0,0,0.35);
        }

        .auth-card h2 {
            margin-top: 0;
            margin-bottom: 0.25rem;
        }

        .auth-card p {
            margin-top: 0;
            color: #c9d3df;
        }

        .auth-form-row {
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
            margin-bottom: 0.9rem;
        }

        .auth-form-row input {
            padding: 0.75rem;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.15);
            background: rgba(255,255,255,0.04);
            color: white;
        }

        .auth-actions {
            display: flex;
            justify-content: flex-end;
        }

        .auth-actions button {
            padding: 0.75rem 1rem;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
        }

        .session-panel {
            margin-top: 0.75rem;
        }

        .session-panel h4 {
            margin: 0 0 0.5rem;
            font-size: 0.95rem;
        }

        .session-list {
            display: flex;
            flex-direction: column;
            gap: 0.45rem;
            max-height: 220px;
            overflow: auto;
        }

        .session-item {
            display: flex;
            justify-content: space-between;
            gap: 0.75rem;
            align-items: flex-start;
            padding: 0.6rem;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 10px;
        }

        .session-item small {
            display: block;
            color: #9fb1c5;
        }

        .session-item button {
            border: none;
            border-radius: 8px;
            padding: 0.4rem 0.7rem;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);

    const topbarActions = document.querySelector(".topbar-actions");
    if (topbarActions && !document.getElementById("authInline")) {
        const authInline = document.createElement("div");
        authInline.id = "authInline";
        authInline.className = "auth-inline";
        authInline.innerHTML = `
            <span id="authStatus" class="auth-status-pill muted">Logged out</span>
            <button id="logoutButton" type="button" class="auth-logout-button">Log Out</button>
        `;
        topbarActions.prepend(authInline);
    }

    const topMenu = document.getElementById("topMenu");
    if (topMenu && !document.getElementById("sessionPanel")) {
        const divider = document.createElement("div");
        divider.className = "menu-divider";

        const panel = document.createElement("div");
        panel.id = "sessionPanel";
        panel.className = "session-panel";
        panel.innerHTML = `
            <h4>Active Sessions</h4>
            <div class="form-row">
                <button id="refreshSessionsButton" type="button" class="menu-action">Refresh Sessions</button>
            </div>
            <div id="sessionList" class="session-list muted">Not logged in</div>
        `;

        topMenu.appendChild(divider);
        topMenu.appendChild(panel);
    }

    if (!document.getElementById("authOverlay")) {
        const overlay = document.createElement("div");
        overlay.id = "authOverlay";
        overlay.className = "auth-overlay hidden";
        overlay.innerHTML = `
            <div class="auth-card">
                <h2>LeanOS Login</h2>
                <p>Log in before this browser can view or sync app data.</p>
                <form id="authForm">
                    <div class="auth-form-row">
                        <label for="authUsername">Username</label>
                        <input id="authUsername" name="username" type="text" autocomplete="username" required />
                    </div>
                    <div class="auth-form-row">
                        <label for="authPassword">Password</label>
                        <input id="authPassword" name="password" type="password" autocomplete="current-password" required />
                    </div>
                    <p id="authMessage" class="muted">Login required</p>
                    <div class="auth-actions">
                        <button id="authSubmitButton" type="submit">Log In</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    bindAuthUiEvents();
}

function bindAuthUiEvents() {
    const authForm = document.getElementById("authForm");
    if (authForm && !authForm.dataset.bound) {
        authForm.dataset.bound = "true";
        authForm.addEventListener("submit", async event => {
            event.preventDefault();

            const username = document.getElementById("authUsername")?.value?.trim() || "";
            const password = document.getElementById("authPassword")?.value || "";
            await loginUser(username, password);
        });
    }

    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton && !logoutButton.dataset.bound) {
        logoutButton.dataset.bound = "true";
        logoutButton.addEventListener("click", async () => {
            await logoutUser("Logged out");
        });
    }

    const refreshSessionsButton = document.getElementById("refreshSessionsButton");
    if (refreshSessionsButton && !refreshSessionsButton.dataset.bound) {
        refreshSessionsButton.dataset.bound = "true";
        refreshSessionsButton.addEventListener("click", async () => {
            await refreshSessionList();
        });
    }
}

async function loginUser(username, password) {
    const backendUrl = getBackendUrlFromConfig();
    if (!backendUrl) {
        setAuthMessage("No backend configured", true);
        return false;
    }

    const submitButton = document.getElementById("authSubmitButton");
    if (submitButton) submitButton.disabled = true;

    try {
        setAuthMessage("Checking login...", false);

        const response = await fetch(`${backendUrl}/api/login`, {
            method: "POST",
            headers: buildAuthHeaders({}, true),
            body: JSON.stringify({
                username,
                password,
                deviceId: getDeviceId(),
                deviceLabel: getDeviceLabel()
            })
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.token) {
            setAuthMessage(payload?.error || "Login failed", true);
            setAuthStatus("Login failed", true);
            return false;
        }

        setStoredAuthToken(payload.token);
        currentAuthSession = payload.session || null;
        hideAuthOverlay();
        setAuthStatus(`Logged in — ${currentAuthSession?.username || username}`);
        setAuthMessage("Login successful", false);
        await refreshSessionList();
        startAuthSessionPoll();

        if (!hasBootedAfterLogin && typeof authBootCallback === "function") {
            hasBootedAfterLogin = true;
            await authBootCallback();
        }

        return true;
    } catch (error) {
        console.error(error);
        setAuthMessage("Login failed — backend unavailable", true);
        setAuthStatus("Login failed", true);
        return false;
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

async function logoutUser(statusMessage = "Logged out") {
    const token = getStoredAuthToken();

    try {
        if (token) {
            await authFetch("/api/logout", {
                method: "POST"
            });
        }
    } catch (error) {
        console.error(error);
    }

    setStoredAuthToken("");
    currentAuthSession = null;
    stopAuthSessionPoll();

    if (typeof window.stopAutoSync === "function") {
        window.stopAutoSync();
    }

    setAuthStatus(statusMessage, true);
    renderSessionList([], null);
    showAuthOverlay(statusMessage);
}

async function handleSessionExpired(message = "Session expired") {
    setStoredAuthToken("");
    currentAuthSession = null;
    stopAuthSessionPoll();

    if (typeof window.stopAutoSync === "function") {
        window.stopAutoSync();
    }

    setAuthStatus(message, true);
    renderSessionList([], null);
    showAuthOverlay(message);
}

function renderSessionList(sessions = [], currentSessionId = null) {
    const sessionList = document.getElementById("sessionList");
    if (!sessionList) return;

    if (!sessions.length) {
        sessionList.innerHTML = `<div class="muted">No active sessions</div>`;
        return;
    }

    sessionList.innerHTML = sessions.map(session => {
        const isCurrent = session.id === currentSessionId;
        return `
            <div class="session-item">
                <div>
                    <strong>${session.deviceLabel || "Unknown Device"}</strong>
                    <small>${session.username || "user"}${isCurrent ? " • This device" : ""}</small>
                    <small>Last seen: ${session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString() : "Unknown"}</small>
                    <small>Session: ${session.tokenPreview || session.id}</small>
                </div>
                <div>
                    <button type="button" data-session-id="${session.id}" class="revoke-session-button">
                        ${isCurrent ? "Log Out" : "Kick Out"}
                    </button>
                </div>
            </div>
        `;
    }).join("");

    sessionList.querySelectorAll(".revoke-session-button").forEach(button => {
        if (button.dataset.bound === "true") return;
        button.dataset.bound = "true";

        button.addEventListener("click", async () => {
            const sessionId = button.getAttribute("data-session-id") || "";
            await revokeSession(sessionId);
        });
    });
}

async function refreshSessionList() {
    const token = getStoredAuthToken();
    if (!token) {
        renderSessionList([], null);
        return;
    }

    try {
        const response = await authFetch("/api/sessions", {
            method: "GET",
            includeJson: false
        });

        const payload = await response.json();
        renderSessionList(payload.sessions || [], payload.currentSessionId || null);
    } catch (error) {
        console.error(error);
    }
}

async function revokeSession(sessionId) {
    if (!sessionId) return;

    try {
        const response = await authFetch(`/api/sessions/${sessionId}/revoke`, {
            method: "POST"
        });

        const payload = await response.json().catch(() => ({}));
        if (payload.revokedCurrent) {
            await handleSessionExpired("This device was logged out");
            return;
        }

        await refreshSessionList();
    } catch (error) {
        console.error(error);
    }
}

async function validateExistingSession(showOverlayOnFail = true) {
    const token = getStoredAuthToken();
    if (!token) {
        if (showOverlayOnFail) {
            showAuthOverlay("Login required");
        }
        return false;
    }

    try {
        const response = await authFetch("/api/session", {
            method: "GET",
            includeJson: false
        });

        const payload = await response.json();
        currentAuthSession = payload.session || null;
        hideAuthOverlay();
        setAuthStatus(`Logged in — ${currentAuthSession?.username || "user"}`);
        await refreshSessionList();
        startAuthSessionPoll();
        return true;
    } catch (error) {
        console.error(error);
        if (showOverlayOnFail) {
            showAuthOverlay("Session expired. Log in again.");
        }
        return false;
    }
}

async function initializeAuthGate(onAuthenticated) {
    authBootCallback = onAuthenticated;
    injectAuthUi();

    const sessionOkay = await validateExistingSession(true);
    if (sessionOkay && !hasBootedAfterLogin && typeof authBootCallback === "function") {
        hasBootedAfterLogin = true;
        await authBootCallback();
        return true;
    }

    return sessionOkay;
}

window.getStoredAuthToken = getStoredAuthToken;
window.getDeviceId = getDeviceId;
window.buildAuthHeaders = buildAuthHeaders;
window.authFetch = authFetch;
window.handleSessionExpired = handleSessionExpired;
window.initializeAuthGate = initializeAuthGate;
window.refreshSessionList = refreshSessionList;
window.isLeanOsAuthenticated = () => !!getStoredAuthToken();