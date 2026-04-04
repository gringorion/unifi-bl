const state = {
  activeView: "blocklists",
  blocklists: [],
  appVersion: "0.0.0",
  config: null,
  settings: null,
  session: null,
  editingId: "",
  blocklistFormBusy: false,
  loginBusy: false,
  confirmResolver: null,
};

const DEFAULT_MAX_REMOTE_GROUP_ENTRIES = 4000;
const IPSET_MAX_ENTRY_LABELS = new Map([
  [2000, "2000 (USG)"],
  [4000, "4000 (Typical)"],
  [8000, "8000 (UDM Pro / UXG)"],
]);

const dom = {
  appShell: document.querySelector("#app-shell"),
  authGate: document.querySelector("#auth-gate"),
  loginForm: document.querySelector("#login-form"),
  loginUsername: document.querySelector("#login-username"),
  loginPassword: document.querySelector("#login-password"),
  loginError: document.querySelector("#login-error"),
  loginSubmitButton: document.querySelector("#login-submit-button"),
  loginSubmitButtonIcon: document.querySelector("#login-submit-button-icon"),
  loginSubmitButtonLabel: document.querySelector("#login-submit-button-label"),
  navSessionUser: document.querySelector("#nav-session-user"),
  navSessionLabel: document.querySelector("#nav-session-label"),
  navSessionValue: document.querySelector("#nav-session-value"),
  logoutButton: document.querySelector("#logout-button"),
  appVersionFooter: document.querySelector("#app-version-footer"),
  viewTabs: Array.from(document.querySelectorAll("[data-view-target]")),
  viewPanels: Array.from(document.querySelectorAll("[data-view]")),
  createBlocklistButton: document.querySelector("#create-blocklist-button"),
  controllerModel: document.querySelector("#controller-model"),
  configList: document.querySelector("#config-list"),
  statusGrid: document.querySelector("#status-grid"),
  statusLog: document.querySelector("#status-log"),
  quickStatusNetwork: document.querySelector("#quick-status-network"),
  quickStatusSite: document.querySelector("#quick-status-site"),
  quickStatusDevices: document.querySelector("#quick-status-devices"),
  quickStatusClients: document.querySelector("#quick-status-clients"),
  blocklistsCount: document.querySelector("#blocklists-count"),
  blocklistsList: document.querySelector("#blocklists-list"),
  settingsForm: document.querySelector("#settings-form"),
  settingsNetworkBaseUrl: document.querySelector("#settings-network-base-url"),
  settingsSiteId: document.querySelector("#settings-site-id"),
  settingsIpSetMaxEntries: document.querySelector("#settings-ipset-max-entries"),
  settingsNetworkApiKey: document.querySelector("#settings-network-api-key"),
  settingsClearNetworkApiKey: document.querySelector(
    "#settings-clear-network-api-key",
  ),
  settingsSiteManagerBaseUrl: document.querySelector(
    "#settings-site-manager-base-url",
  ),
  settingsSiteManagerApiKey: document.querySelector(
    "#settings-site-manager-api-key",
  ),
  settingsClearSiteManagerApiKey: document.querySelector(
    "#settings-clear-site-manager-api-key",
  ),
  settingsAllowInsecureTls: document.querySelector(
    "#settings-allow-insecure-tls",
  ),
  saveSettingsButton: document.querySelector("#save-settings-button"),
  form: document.querySelector("#blocklist-form"),
  formId: document.querySelector("#blocklist-id"),
  formName: document.querySelector("#blocklist-name"),
  formDescription: document.querySelector("#blocklist-description"),
  formEnabled: document.querySelector("#blocklist-enabled"),
  formCidrs: document.querySelector("#blocklist-cidrs"),
  formSourceUrl: document.querySelector("#blocklist-source-url"),
  formOverflowLabel: document.querySelector("#blocklist-overflow-label"),
  formOverflowMode: document.querySelector("#blocklist-overflow-mode"),
  formOverflowTruncateOption: document.querySelector(
    "#blocklist-overflow-truncate-option",
  ),
  formRefreshInterval: document.querySelector("#blocklist-refresh-interval"),
  blocklistPlanCopy: document.querySelector("#blocklist-plan-copy"),
  blocklistPlanStatus: document.querySelector("#blocklist-plan-status"),
  blocklistPlanList: document.querySelector("#blocklist-plan-list"),
  formSubmitButton: document.querySelector("#blocklist-submit-button"),
  formSubmitButtonIcon: document.querySelector("#blocklist-submit-button-icon"),
  formSubmitButtonLabel: document.querySelector("#blocklist-submit-button-label"),
  formCancelButton: document.querySelector("#blocklist-cancel-button"),
  blocklistModal: document.querySelector("#blocklist-modal"),
  blocklistModalTitle: document.querySelector("#blocklist-modal-title"),
  blocklistModalStatus: document.querySelector("#blocklist-modal-status"),
  blocklistModalCopy: document.querySelector("#blocklist-modal-copy"),
  testButton: document.querySelector("#test-connection-button"),
  refreshButton: document.querySelector("#refresh-button"),
  syncAllButton: document.querySelector("#sync-all-button"),
  confirmModal: document.querySelector("#confirm-modal"),
  confirmModalTitle: document.querySelector("#confirm-modal-title"),
  confirmModalMessage: document.querySelector("#confirm-modal-message"),
  confirmModalCancel: document.querySelector("#confirm-modal-cancel"),
  confirmModalConfirm: document.querySelector("#confirm-modal-confirm"),
  errorDetailModal: document.querySelector("#error-detail-modal"),
  errorDetailModalTitle: document.querySelector("#error-detail-modal-title"),
  errorDetailModalStatus: document.querySelector("#error-detail-modal-status"),
  errorDetailModalCopy: document.querySelector("#error-detail-modal-copy"),
  errorDetailModalBody: document.querySelector("#error-detail-modal-body"),
  errorDetailModalClose: document.querySelector("#error-detail-modal-close"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      applySessionState(payload.session || null);
      renderSession();
      if (path !== "/api/auth/login") {
        setLoginError("Session expired. Sign in again.");
      }
    }
    throw new Error(payload.error || "Unknown error");
  }

  return payload;
}

function setBusy(button, busy) {
  if (!button) {
    return;
  }

  button.disabled = busy;
}

function setAppVersion(version) {
  const normalized = String(version || "").trim() || "0.0.0";
  state.appVersion = normalized;
  dom.appVersionFooter.textContent = `v${normalized}`;
}

function normalizeSession(session) {
  return {
    authEnabled: Boolean(session?.authEnabled),
    authenticated:
      session?.authEnabled === false ? true : Boolean(session?.authenticated),
    username: String(session?.username || ""),
    expiresAt: session?.expiresAt || null,
    sessionDurationHours: Number(session?.sessionDurationHours) || 12,
  };
}

function applySessionState(session) {
  state.session = normalizeSession(session);
}

function isAuthenticated() {
  return Boolean(state.session && state.session.authenticated);
}

function setLoginError(message = "") {
  const normalized = String(message || "").trim();
  dom.loginError.textContent = normalized;
  dom.loginError.hidden = !normalized;
}

function renderLoginButton() {
  const busy = Boolean(state.loginBusy);
  dom.loginSubmitButton.classList.toggle("is-loading", busy);
  dom.loginSubmitButton.setAttribute("aria-busy", busy ? "true" : "false");
  dom.loginSubmitButtonIcon.className = busy
    ? "mdi mdi-loading"
    : "mdi mdi-lock-outline";
  dom.loginSubmitButtonLabel.textContent = busy ? "Signing in..." : "Sign in";
}

function setLoginBusy(busy) {
  state.loginBusy = busy;
  setBusy(dom.loginSubmitButton, busy);
  renderLoginButton();
}

function resetProtectedState() {
  state.blocklists = [];
  state.config = null;
  state.settings = null;
  state.editingId = "";

  dom.configList.innerHTML = "";
  dom.statusGrid.innerHTML = "";
  dom.statusLog.textContent = "Sign in to load controller status.";
  dom.blocklistsCount.textContent = "0 lists";
  dom.blocklistsList.innerHTML = `
    <tr>
      <td colspan="8" class="table-empty">
        Sign in to load the managed blocklists.
      </td>
    </tr>
  `;

  dom.settingsForm.reset();
  syncIpSetMaxEntriesField(DEFAULT_MAX_REMOTE_GROUP_ENTRIES);
  dom.settingsNetworkBaseUrl.value = "";
  dom.settingsSiteId.value = "";
  dom.settingsNetworkApiKey.value = "";
  dom.settingsSiteManagerBaseUrl.value = "";
  dom.settingsSiteManagerApiKey.value = "";

  renderControllerModel(null);
  setQuickStatusItem(dom.quickStatusNetwork, "Waiting", "neutral");
  setQuickStatusItem(dom.quickStatusSite, "None", "neutral");
  setQuickStatusItem(dom.quickStatusDevices, "0 online", "neutral");
  setQuickStatusItem(dom.quickStatusClients, "0 visible", "neutral");
  closeErrorDetailModal();
  resetConfirmModal();
  closeBlocklistModal();
  resetForm();
}

function renderSession() {
  const session = state.session || normalizeSession(null);
  const authenticated = Boolean(session.authenticated);
  const authEnabled = Boolean(session.authEnabled);

  dom.appShell.hidden = !authenticated;
  dom.authGate.hidden = authenticated;
  dom.navSessionLabel.textContent = authEnabled ? "User" : "Access";
  dom.navSessionValue.textContent = authEnabled
    ? session.username || "Signed in"
    : "Auth inactive";
  dom.logoutButton.hidden = !authEnabled || !authenticated;

  if (!authenticated) {
    resetProtectedState();
    setLoginError("");
    if (!state.loginBusy) {
      dom.loginUsername.focus();
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setStatusLog(value) {
  dom.statusLog.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function formatDateTime(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function truncateMiddle(value, maxLength = 48) {
  const stringValue = String(value || "");
  if (stringValue.length <= maxLength) {
    return stringValue;
  }

  const edge = Math.floor((maxLength - 3) / 2);
  return `${stringValue.slice(0, edge)}...${stringValue.slice(-edge)}`;
}

function getEffectiveCidrs(blocklist) {
  return Array.from(
    new Set([
      ...(Array.isArray(blocklist.cidrs) ? blocklist.cidrs : []),
      ...(Array.isArray(blocklist.importedCidrs) ? blocklist.importedCidrs : []),
    ]),
  ).sort();
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function formatIpSetMaxEntries(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return formatNumber(DEFAULT_MAX_REMOTE_GROUP_ENTRIES);
  }

  return (
    IPSET_MAX_ENTRY_LABELS.get(normalized) ||
    `${formatNumber(normalized)} (Custom)`
  );
}

function getConfiguredMaxEntries() {
  const maxEntries = Number(state.config?.blocklists?.maxEntries);
  return Number.isInteger(maxEntries) && maxEntries > 0
    ? maxEntries
    : DEFAULT_MAX_REMOTE_GROUP_ENTRIES;
}

function syncIpSetMaxEntriesField(value) {
  const normalized = Number(value);
  const select = dom.settingsIpSetMaxEntries;

  for (const option of Array.from(select.querySelectorAll('[data-dynamic="true"]'))) {
    option.remove();
  }

  if (Number.isInteger(normalized) && normalized > 0 && !IPSET_MAX_ENTRY_LABELS.has(normalized)) {
    const option = document.createElement("option");
    option.value = String(normalized);
    option.textContent = `${formatNumber(normalized)} (Custom)`;
    option.dataset.dynamic = "true";
    select.append(option);
  }

  select.value = String(
    Number.isInteger(normalized) && normalized > 0
      ? normalized
      : DEFAULT_MAX_REMOTE_GROUP_ENTRIES,
  );
}

function renderBlocklistOverflowFieldCopy() {
  const maxEntriesLabel = formatNumber(getConfiguredMaxEntries());
  dom.formOverflowLabel.textContent = `If the list exceeds ${maxEntriesLabel} entries`;
  dom.formOverflowTruncateOption.textContent =
    `Keep only the first ${maxEntriesLabel} CIDRs`;
}

function getBlocklistRemoteGroups(blocklist) {
  const groups = Array.isArray(blocklist?.remoteGroups) ? blocklist.remoteGroups : [];
  const normalized = groups
    .map((group) => ({
      id: String(group?.id || group?.remoteObjectId || "").trim(),
      name: String(group?.name || "").trim(),
    }))
    .filter((group) => group.id || group.name);

  if (normalized.length > 0) {
    return normalized;
  }

  const legacyRemoteObjectId = String(blocklist?.remoteObjectId || "").trim();
  if (!legacyRemoteObjectId) {
    return [];
  }

  return [
    {
      id: legacyRemoteObjectId,
      name: String(blocklist?.name || "").trim(),
    },
  ];
}

function hasRemoteGroups(blocklist) {
  return getBlocklistRemoteGroups(blocklist).length > 0;
}

function buildManagedGroupName(baseName, index, totalGroups) {
  return totalGroups > 1 ? `${baseName}_${index + 1}` : baseName;
}

function parseManualCidrsInput(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function buildBlocklistGroupPlan({
  name,
  cidrs,
  overflowMode,
  maxEntries = getConfiguredMaxEntries(),
}) {
  const safeName = String(name || "").trim() || "blocklist";
  const uniqueCidrs = Array.from(
    new Set(
      (Array.isArray(cidrs) ? cidrs : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  ).sort();
  const totalEntries = uniqueCidrs.length;
  const normalizedMode = String(overflowMode || "").trim() === "truncate"
    ? "truncate"
    : "split";

  if (totalEntries > maxEntries && normalizedMode === "split") {
    const totalGroups = Math.ceil(totalEntries / maxEntries);
    const groups = [];

    for (let index = 0; index < totalGroups; index += 1) {
      const start = index * maxEntries;
      groups.push({
        index,
        name: buildManagedGroupName(safeName, index, totalGroups),
        count: uniqueCidrs.slice(start, start + maxEntries).length,
      });
    }

    return {
      overflowMode: normalizedMode,
      maxEntries,
      totalEntries,
      truncatedCount: 0,
      groups,
    };
  }

  const keptCount = Math.min(totalEntries, maxEntries);
  return {
    overflowMode: normalizedMode,
    maxEntries,
    totalEntries,
    truncatedCount: Math.max(totalEntries - keptCount, 0),
    groups: [
      {
        index: 0,
        name: safeName,
        count: keptCount,
      },
    ],
  };
}

function getEditingBlocklist() {
  return state.blocklists.find((item) => item.id === state.editingId) || null;
}

function getFormEffectiveCidrs() {
  const editingBlocklist = getEditingBlocklist();
  const importedCidrs = Array.isArray(editingBlocklist?.importedCidrs)
    ? editingBlocklist.importedCidrs
    : [];

  return Array.from(
    new Set([...parseManualCidrsInput(dom.formCidrs.value), ...importedCidrs]),
  ).sort();
}

function getBlocklistGroupPlan(blocklist) {
  return buildBlocklistGroupPlan({
    name: blocklist?.name,
    cidrs: getEffectiveCidrs(blocklist),
    overflowMode: blocklist?.overflowMode,
    maxEntries: getConfiguredMaxEntries(),
  });
}

function getSyncStatusPresentation(blocklist) {
  const status = blocklist.lastSyncStatus || "never";

  if (status === "ok") {
    return {
      label: "Synced",
      className: "pill pill-ok",
      detail: "",
    };
  }

  if (status === "error") {
    return {
      label: "Error",
      className: "pill pill-danger",
      detail: "",
    };
  }

  if (status === "remote-deleted") {
    return {
      label: "Needs relink",
      className: "pill pill-warning",
      detail: "",
    };
  }

  return {
    label: hasRemoteGroups(blocklist) ? "Pending" : "Not synced",
    className: "pill pill-muted",
    detail: "",
  };
}

function getRefreshPresentation(blocklist) {
  if (!blocklist.sourceUrl) {
    return {
      label: "Manual only",
      detail: "",
      className: "pill pill-muted",
      canPause: false,
      buttonLabel: "Pause refresh",
      buttonIcon: "mdi-pause-circle-outline",
    };
  }

  if (!blocklist.refreshInterval) {
    return {
      label: "Manual only",
      detail: "",
      className: "pill pill-muted",
      canPause: false,
      buttonLabel: "Pause refresh",
      buttonIcon: "mdi-pause-circle-outline",
    };
  }

  if (blocklist.refreshPaused) {
    return {
      label: `Every ${blocklist.refreshInterval}`,
      detail: "",
      className: "pill pill-warning",
      canPause: true,
      buttonLabel: "Resume refresh",
      buttonIcon: "mdi-play-circle-outline",
    };
  }

  return {
    label: `Every ${blocklist.refreshInterval}`,
    detail: "",
    className: "pill pill-ok",
    canPause: true,
    buttonLabel: "Pause refresh",
    buttonIcon: "mdi-pause-circle-outline",
  };
}

function getUrlSyncPresentation(blocklist) {
  if (!blocklist.sourceUrl) {
    return {
      time: "Manual",
      detail: "",
      tone: "muted",
    };
  }

  if (blocklist.lastUrlSyncStatus === "error") {
    return {
      time: formatDateTime(blocklist.lastUrlSyncAt),
      detail: "",
      tone: "danger",
    };
  }

  if (blocklist.lastUrlSyncStatus === "ok") {
    return {
      time: formatDateTime(blocklist.lastUrlSyncAt),
      detail: "",
      tone: "ok",
    };
  }

  return {
    time: "Never",
    detail: "",
    tone: "muted",
  };
}

function getUnifiSyncPresentation(blocklist) {
  if (blocklist.lastSyncStatus === "error") {
    return {
      time: formatDateTime(blocklist.lastSyncAt || blocklist.lastUnifiSyncAt),
      detail: "",
      tone: "danger",
    };
  }

  if (blocklist.lastUnifiSyncAt) {
    return {
      time: formatDateTime(blocklist.lastUnifiSyncAt),
      detail: "",
      tone: "ok",
    };
  }

  return {
    time: "Never",
    detail: "",
    tone: "muted",
  };
}

function buildEntriesCell(blocklist, effectiveCidrs) {
  const plan = getBlocklistGroupPlan({
    ...blocklist,
    cidrs: effectiveCidrs,
    importedCidrs: [],
  });

  return `
    <div class="metric-strip">
      <span class="metric-chip metric-chip-accent">
        <small>Total</small>
        <strong>${escapeHtml(String(effectiveCidrs.length))}</strong>
      </span>
      <span class="metric-chip">
        <small>UniFi groups</small>
        <strong>${escapeHtml(String(plan.groups.length))}</strong>
      </span>
    </div>
  `;
}

function buildTimestampCell(primary, secondary, tone = "muted") {
  return `
    <div class="time-cell time-cell-${tone}">
      <strong>${escapeHtml(primary)}</strong>
      ${secondary ? `<small>${escapeHtml(secondary)}</small>` : ""}
    </div>
  `;
}

function buildStatusCell(label, className, detail = "", action = null) {
  const badge = action
    ? `
      <button
        type="button"
        class="${escapeHtml(className)} status-badge-button"
        data-action="${escapeHtml(action.name)}"
        data-id="${escapeHtml(action.id)}"
        data-error-type="${escapeHtml(action.errorType)}"
        title="${escapeHtml(action.title)}"
        aria-label="${escapeHtml(action.title)}"
      >
        ${escapeHtml(label)}
      </button>
    `
    : `<span class="${escapeHtml(className)}">${escapeHtml(label)}</span>`;

  return `
    <div class="status-cell">
      ${badge}
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </div>
  `;
}

function getBlocklistErrorDetail(blocklist, errorType = "sync") {
  if (!blocklist) {
    return null;
  }

  if (errorType === "url-sync") {
    const detail = String(
      blocklist.lastUrlSyncError || blocklist.lastSyncError || "",
    ).trim();
    if (!detail) {
      return null;
    }

    return {
      title: "Source sync error",
      summary: `${blocklist.name} failed while fetching the source URL on ${formatDateTime(blocklist.lastUrlSyncAt)}.`,
      detail,
    };
  }

  const detail = String(
    blocklist.lastSyncError || blocklist.lastUnifiSyncError || "",
  ).trim();
  if (!detail) {
    return null;
  }

  return {
    title: "UniFi sync error",
    summary: `${blocklist.name} failed while syncing to UniFi on ${formatDateTime(blocklist.lastSyncAt || blocklist.lastUnifiSyncAt)}.`,
    detail,
  };
}

function openErrorDetailModal(detail) {
  if (!detail) {
    return;
  }

  dom.errorDetailModalTitle.textContent = detail.title;
  dom.errorDetailModalStatus.textContent = "Error";
  dom.errorDetailModalStatus.className = "pill pill-danger";
  dom.errorDetailModalCopy.textContent = detail.summary;
  dom.errorDetailModalBody.textContent = detail.detail;
  dom.errorDetailModal.classList.add("is-open");
  dom.errorDetailModal.hidden = false;
  dom.errorDetailModalClose.focus();
}

function closeErrorDetailModal() {
  dom.errorDetailModal.classList.remove("is-open");
  dom.errorDetailModal.hidden = true;
  dom.errorDetailModalTitle.textContent = "Sync error";
  dom.errorDetailModalCopy.textContent = "";
  dom.errorDetailModalBody.textContent = "";
}

function getListIdentityPresentation(blocklist) {
  if (blocklist.lastSyncStatus === "error") {
    return {
      icon: "mdi-alert-circle",
      iconClassName: "list-state-icon list-state-icon-danger",
      nameBadgeClassName: "pill pill-danger list-name-badge",
      modalStatus: {
        label: "Error",
        className: "pill pill-danger",
      },
    };
  }

  if (blocklist.refreshPaused) {
    return {
      icon: "mdi-pause-circle",
      iconClassName: "list-state-icon list-state-icon-warning",
      nameBadgeClassName: "pill pill-warning list-name-badge",
      modalStatus: {
        label: "Paused",
        className: "pill pill-warning",
      },
    };
  }

  if (blocklist.lastSyncStatus === "remote-deleted") {
    return {
      icon: "mdi-alert-outline",
      iconClassName: "list-state-icon list-state-icon-warning",
      nameBadgeClassName: "pill pill-warning list-name-badge",
      modalStatus: {
        label: "Needs relink",
        className: "pill pill-warning",
      },
    };
  }

  if (blocklist.enabled) {
    return {
      icon: "mdi-check-circle",
      iconClassName: "list-state-icon list-state-icon-ok",
      nameBadgeClassName: "pill pill-ok list-name-badge",
      modalStatus: {
        label: "Enabled",
        className: "pill pill-ok",
      },
    };
  }

  return {
    icon: "mdi-close-circle-outline",
    iconClassName: "list-state-icon list-state-icon-muted",
    nameBadgeClassName: "pill pill-muted list-name-badge",
    modalStatus: {
      label: "Disabled",
      className: "pill pill-muted",
    },
  };
}

function getCurrentBlocklistIdentityPresentation() {
  if (!state.editingId) {
    return {
      modalStatus: {
        label: "Draft",
        className: "badge",
      },
    };
  }

  const currentBlocklist = state.blocklists.find((item) => item.id === state.editingId);
  if (!currentBlocklist) {
    return {
      modalStatus: {
        label: "Draft",
        className: "badge",
      },
    };
  }

  return getListIdentityPresentation({
    ...currentBlocklist,
    enabled: dom.formEnabled.checked,
  });
}

function renderConfig() {
  if (!state.config) {
    dom.configList.innerHTML = "";
    return;
  }

  renderBlocklistOverflowFieldCopy();

  const rows = [
    ["Title", state.config.appTitle],
    ["Version", state.appVersion],
    [
      "Protected access",
      state.session?.authEnabled ? "Enabled" : "Disabled",
    ],
    ["Network URL", state.config.networkBaseUrl || "Not configured"],
    [
      "Network key",
      state.config.networkApiKeyConfigured ? "Configured" : "Missing",
    ],
    ["Target site", state.config.siteId || "Auto / required for multi-site"],
    ["Site Manager URL", state.config.siteManagerBaseUrl || "Not configured"],
    [
      "Site Manager key",
      state.config.siteManagerApiKeyConfigured ? "Configured" : "Missing",
    ],
    [
      "TLS mode",
      state.config.allowInsecureTls ? "Self-signed allowed" : "Strict",
    ],
    [
      "UniFi ipset max",
      state.config.blocklists?.maxEntriesLabel ||
        formatIpSetMaxEntries(getConfiguredMaxEntries()),
    ],
    ["Intervals", (state.config.refreshIntervals || []).join(" ") || "n/a"],
  ];

  dom.configList.innerHTML = rows
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(String(value))}</dd>
        </div>
      `,
    )
    .join("");
}

function renderSettings() {
  const settings = state.settings;
  if (!settings) {
    return;
  }

  dom.settingsNetworkBaseUrl.value = settings.unifi.networkBaseUrl || "";
  dom.settingsSiteId.value = settings.unifi.siteId || "";
  syncIpSetMaxEntriesField(
    settings.unifi.blocklists?.maxEntries ?? getConfiguredMaxEntries(),
  );
  dom.settingsSiteManagerBaseUrl.value =
    settings.unifi.siteManagerBaseUrl || "";
  dom.settingsAllowInsecureTls.checked = Boolean(settings.allowInsecureTls);

  dom.settingsNetworkApiKey.value = "";
  dom.settingsSiteManagerApiKey.value = "";
  dom.settingsClearNetworkApiKey.checked = false;
  dom.settingsClearSiteManagerApiKey.checked = false;

  dom.settingsNetworkApiKey.placeholder = settings.unifi.networkApiKeyConfigured
    ? "Already configured, leave empty to keep it"
    : "Paste the UniFi API key";
  dom.settingsSiteManagerApiKey.placeholder =
    settings.unifi.siteManagerApiKeyConfigured
      ? "Already configured, leave empty to keep it"
      : "Optional";
}

function setQuickStatusItem(node, value, tone) {
  if (!node) {
    return;
  }

  node.textContent = value;
  const tile = node.closest(".status-tile");
  if (tile) {
    tile.dataset.statusTone = tone;
  }
}

function renderControllerModel(status) {
  if (!dom.controllerModel) {
    return;
  }

  const model = String(status?.network?.consoleModel || "").trim();
  const name = String(status?.network?.consoleName || "").trim();

  dom.controllerModel.textContent =
    model && name
      ? `${name} · ${model}`
      : model || name || "UniFi Network";
}

function renderStatus(status) {
  renderControllerModel(status);

  const cards = [
    {
      title: "UniFi Network",
      value: status.network?.ok ? "Connected" : "Offline",
      extra: status.network?.message || "",
    },
    {
      title: "Sites",
      value: String(status.network?.sitesCount ?? 0),
      extra: status.network?.selectedSiteId || "None",
    },
    {
      title: "Devices",
      value: String(status.network?.devicesCount ?? 0),
      extra: "Target site",
    },
    {
      title: "Clients",
      value: String(status.network?.clientsCount ?? 0),
      extra: "Target site",
    },
    {
      title: "Site Manager",
      value: status.siteManager?.ok ? "Connected" : "Ignored",
      extra: status.siteManager?.message || "",
    },
    {
      title: "Cloud hosts",
      value: String(status.siteManager?.hostsCount ?? 0),
      extra: "Optional",
    },
  ];

  dom.statusGrid.innerHTML = cards
    .map(
      (card) => `
        <article>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.value)}</p>
          <small>${escapeHtml(card.extra)}</small>
        </article>
      `,
    )
    .join("");

  setQuickStatusItem(
    dom.quickStatusNetwork,
    status.network?.ok ? "Connected" : status.network?.message || "Offline",
    status.network?.ok ? "ok" : "danger",
  );
  setQuickStatusItem(
    dom.quickStatusSite,
    status.network?.selectedSiteId || "No site",
    status.network?.selectedSiteId ? "ok" : "neutral",
  );
  setQuickStatusItem(
    dom.quickStatusDevices,
    `${status.network?.devicesCount ?? 0} online`,
    status.network?.ok ? "ok" : "neutral",
  );
  setQuickStatusItem(
    dom.quickStatusClients,
    `${status.network?.clientsCount ?? 0} visible`,
    status.network?.ok ? "ok" : "neutral",
  );
}

function renderBlocklists() {
  const count = state.blocklists.length;
  dom.blocklistsCount.textContent = pluralize(count, "list");

  if (count === 0) {
    dom.blocklistsList.innerHTML = `
      <tr>
        <td colspan="8" class="table-empty">
          No managed blocklists yet. Use "Add new list" to create the first one.
        </td>
      </tr>
    `;
    return;
  }

  dom.blocklistsList.innerHTML = state.blocklists
    .map((blocklist) => {
      const effectiveCidrs = getEffectiveCidrs(blocklist);
      const syncPresentation = getSyncStatusPresentation(blocklist);
      const refreshPresentation = getRefreshPresentation(blocklist);
      const urlPresentation = getUrlSyncPresentation(blocklist);
      const unifiPresentation = getUnifiSyncPresentation(blocklist);
      const identityPresentation = getListIdentityPresentation(blocklist);
      const syncErrorDetail = getBlocklistErrorDetail(blocklist, "sync");
      const syncErrorAction =
        blocklist.lastSyncStatus === "error" && syncErrorDetail
          ? {
              name: "show-error-detail",
              id: blocklist.id,
              errorType: "sync",
              title: `View error details for ${blocklist.name}`,
            }
          : null;

      return `
        <tr>
          <td>
            <div class="table-primary">
              <div class="table-title-line">
                <button
                  type="button"
                  class="${escapeHtml(identityPresentation.nameBadgeClassName)} list-name-button"
                  data-action="edit"
                  data-id="${escapeHtml(blocklist.id)}"
                  title="Edit list"
                  aria-label="Edit list ${escapeHtml(blocklist.name)}"
                >
                  <i class="mdi ${escapeHtml(identityPresentation.icon)} ${escapeHtml(identityPresentation.iconClassName)}" aria-hidden="true"></i>
                  <span class="list-name-badge-label">${escapeHtml(blocklist.name)}</span>
                </button>
              </div>
              <p class="table-description">
                ${escapeHtml(blocklist.description || "No description")}
              </p>
            </div>
          </td>
          <td>${buildEntriesCell(blocklist, effectiveCidrs)}</td>
          <td>
            ${buildStatusCell(
              refreshPresentation.label,
              refreshPresentation.className,
              refreshPresentation.detail,
            )}
          </td>
          <td>
            ${buildTimestampCell(
              formatDateTime(blocklist.updatedAt),
              "",
            )}
          </td>
          <td>
            ${buildTimestampCell(
              urlPresentation.time,
              urlPresentation.detail,
              urlPresentation.tone,
            )}
          </td>
          <td>
            ${buildTimestampCell(
              unifiPresentation.time,
              unifiPresentation.detail,
              unifiPresentation.tone,
            )}
          </td>
          <td>
            ${buildStatusCell(
              syncPresentation.label,
              syncPresentation.className,
              syncPresentation.detail,
              syncErrorAction,
            )}
          </td>
          <td>
            <div class="actions-wrap">
              <button
                type="button"
                class="button button-icon button-icon-primary button-small"
                data-action="sync"
                data-id="${escapeHtml(blocklist.id)}"
                title="Sync with UniFi"
                aria-label="Sync with UniFi"
              >
                <i class="mdi mdi-sync" aria-hidden="true"></i>
              </button>
              ${
                blocklist.sourceUrl
                  ? `
                    <button
                      type="button"
                      class="button button-icon button-icon-accent button-small"
                      data-action="sync-source"
                      data-id="${escapeHtml(blocklist.id)}"
                      title="Sync source URL"
                      aria-label="Sync source URL"
                    >
                      <i class="mdi mdi-cloud-download-outline" aria-hidden="true"></i>
                    </button>
                  `
                  : ""
              }
              <button
                type="button"
                class="button button-icon button-icon-neutral button-small"
                data-action="edit"
                data-id="${escapeHtml(blocklist.id)}"
                title="Edit list"
                aria-label="Edit list"
              >
                <i class="mdi mdi-pencil-outline" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="button button-icon button-icon-warning button-small"
                data-action="toggle-refresh"
                data-id="${escapeHtml(blocklist.id)}"
                ${refreshPresentation.canPause ? "" : "disabled"}
                title="${escapeHtml(refreshPresentation.buttonLabel)}"
                aria-label="${escapeHtml(refreshPresentation.buttonLabel)}"
              >
                <i class="mdi ${escapeHtml(refreshPresentation.buttonIcon)}" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="button button-icon button-icon-danger button-small"
                data-action="delete"
                data-id="${escapeHtml(blocklist.id)}"
                title="Delete list"
                aria-label="Delete list"
              >
                <i class="mdi mdi-trash-can-outline" aria-hidden="true"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderBlocklistPlan() {
  const editingBlocklist = getEditingBlocklist();
  const effectiveCidrs = getFormEffectiveCidrs();
  const importedCount = Array.isArray(editingBlocklist?.importedCidrs)
    ? editingBlocklist.importedCidrs.length
    : 0;
  const plan = buildBlocklistGroupPlan({
    name: dom.formName.value,
    cidrs: effectiveCidrs,
    overflowMode: dom.formOverflowMode.value,
    maxEntries: getConfiguredMaxEntries(),
  });
  const linkedGroups = getBlocklistRemoteGroups(editingBlocklist);

  dom.blocklistPlanStatus.textContent = pluralize(plan.groups.length, "group");
  dom.blocklistPlanStatus.className =
    plan.truncatedCount > 0
      ? "pill pill-warning"
      : plan.groups.length > 1
        ? "pill pill-ok"
        : "pill pill-muted";

  if (plan.truncatedCount > 0) {
    dom.blocklistPlanCopy.textContent =
      `UniFi will keep the first ${formatNumber(plan.maxEntries)} CIDRs and ignore ${formatNumber(plan.truncatedCount)} extra entries from the ${formatNumber(plan.totalEntries)} currently known entries.`;
  } else if (plan.groups.length > 1) {
    dom.blocklistPlanCopy.textContent =
      `${formatNumber(plan.totalEntries)} known CIDRs will be split into ${formatNumber(plan.groups.length)} UniFi groups of up to ${formatNumber(plan.maxEntries)} entries each.`;
  } else {
    dom.blocklistPlanCopy.textContent =
      `${formatNumber(plan.totalEntries)} known CIDRs will be synced to a single UniFi group.`;
  }

  if (dom.formSourceUrl.value && importedCount === 0) {
    dom.blocklistPlanCopy.textContent +=
      " Source URL entries are not counted until the first source sync completes.";
  } else if (importedCount > 0) {
    dom.blocklistPlanCopy.textContent += ` ${formatNumber(importedCount)} CIDRs currently come from the source URL.`;
  }

  dom.blocklistPlanList.innerHTML = plan.groups
    .map((group, index) => {
      const linkedGroup = linkedGroups[index] || null;
      return `
        <article class="group-plan-item">
          <div class="group-plan-item-head">
            <strong>${escapeHtml(group.name)}</strong>
            <span class="pill pill-muted">${escapeHtml(
              pluralize(group.count, "entry", "entries"),
            )}</span>
          </div>
          <p class="group-plan-item-copy">
            ${
              linkedGroup?.id
                ? `Currently linked to ${escapeHtml(truncateMiddle(linkedGroup.id, 24))}`
                : editingBlocklist
                  ? "Will be created or relinked on the next save."
                  : "Will be created on the first sync."
            }
          </p>
        </article>
      `;
    })
    .join("");
}

function setActiveView(view) {
  state.activeView = view;

  for (const tab of dom.viewTabs) {
    tab.classList.toggle("is-active", tab.dataset.viewTarget === view);
  }

  for (const panel of dom.viewPanels) {
    panel.hidden = panel.dataset.view !== view;
  }
}

function updateBlocklistModalCopy() {
  const editing = Boolean(state.editingId);
  dom.blocklistModalTitle.textContent = editing
    ? "Edit blocklist"
    : "Add a new blocklist";
  dom.blocklistModalCopy.textContent = editing
    ? "Update the managed list and apply the latest version to UniFi."
    : "Create a managed list with manual CIDRs, an optional source URL, and an optional refresh schedule.";

  const identityPresentation = getCurrentBlocklistIdentityPresentation();
  dom.blocklistModalStatus.textContent = identityPresentation.modalStatus.label;
  dom.blocklistModalStatus.className = identityPresentation.modalStatus.className;
  renderBlocklistSubmitButton();
  renderBlocklistPlan();
}

function renderBlocklistSubmitButton() {
  const editing = Boolean(state.editingId);
  const busy = Boolean(state.blocklistFormBusy);

  dom.formSubmitButton.classList.toggle("is-loading", busy);
  dom.formSubmitButton.setAttribute("aria-busy", busy ? "true" : "false");
  dom.formSubmitButtonIcon.className = busy
    ? "mdi mdi-loading"
    : editing
      ? "mdi mdi-content-save-outline"
      : "mdi mdi-plus";
  dom.formSubmitButtonLabel.textContent = busy
    ? editing
      ? "Saving changes..."
      : "Creating blocklist..."
    : editing
      ? "Save changes"
      : "Create blocklist";
}

function setBlocklistFormBusy(busy) {
  state.blocklistFormBusy = busy;
  setBusy(dom.formSubmitButton, busy);
  setBusy(dom.formCancelButton, busy);
  renderBlocklistSubmitButton();
}

function fillForm(blocklist) {
  state.editingId = blocklist.id;
  dom.formId.value = blocklist.id;
  dom.formName.value = blocklist.name;
  dom.formDescription.value = blocklist.description || "";
  dom.formEnabled.checked = Boolean(blocklist.enabled);
  dom.formCidrs.value = (blocklist.cidrs || []).join("\n");
  dom.formSourceUrl.value = blocklist.sourceUrl || "";
  dom.formOverflowMode.value = blocklist.overflowMode || "split";
  dom.formRefreshInterval.value = blocklist.refreshInterval || "";
  updateBlocklistModalCopy();
}

function resetForm() {
  state.editingId = "";
  dom.form.reset();
  dom.formId.value = "";
  dom.formEnabled.checked = true;
  dom.formOverflowMode.value = "split";
  dom.formRefreshInterval.value = "";
  updateBlocklistModalCopy();
}

function openBlocklistModal(blocklist = null) {
  if (blocklist) {
    fillForm(blocklist);
  } else {
    resetForm();
  }

  dom.blocklistModal.classList.add("is-open");
  dom.blocklistModal.hidden = false;
}

function closeBlocklistModal() {
  dom.blocklistModal.classList.remove("is-open");
  dom.blocklistModal.hidden = true;
}

function openConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  confirmClassName = "button button-primary",
}) {
  dom.confirmModalTitle.textContent = title;
  dom.confirmModalMessage.textContent = message;
  dom.confirmModalConfirm.textContent = confirmLabel;
  dom.confirmModalConfirm.className = confirmClassName;
  dom.confirmModal.classList.add("is-open");
  dom.confirmModal.hidden = false;

  return new Promise((resolve) => {
    state.confirmResolver = resolve;
  });
}

function closeConfirmModal(result) {
  dom.confirmModal.classList.remove("is-open");
  dom.confirmModal.hidden = true;
  if (state.confirmResolver) {
    state.confirmResolver(result);
    state.confirmResolver = null;
  }
}

function resetConfirmModal() {
  closeConfirmModal(false);
  dom.confirmModalTitle.textContent = "Please confirm";
  dom.confirmModalMessage.textContent = "";
  dom.confirmModalConfirm.textContent = "Confirm";
  dom.confirmModalConfirm.className = "button button-primary";
}

async function loadSession() {
  const payload = await api("/api/session");
  setAppVersion(payload.app?.version);
  applySessionState(payload.session);
  renderSession();
  return state.session;
}

async function login(event) {
  event.preventDefault();
  setLoginError("");
  setLoginBusy(true);

  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: dom.loginUsername.value,
        password: dom.loginPassword.value,
      }),
    });
    applySessionState(payload.session);
    dom.loginPassword.value = "";
    renderSession();
    await refreshAll();
  } catch (error) {
    setLoginError(error.message);
    dom.loginPassword.focus();
    dom.loginPassword.select();
  } finally {
    setLoginBusy(false);
  }
}

async function logout() {
  setBusy(dom.logoutButton, true);

  try {
    const payload = await api("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
    applySessionState(payload.session);
    dom.loginForm.reset();
    renderSession();
  } catch (error) {
    setStatusLog(error.message);
  } finally {
    setBusy(dom.logoutButton, false);
  }
}

async function loadConfig() {
  const payload = await api("/api/config");
  state.config = payload.config;
  setAppVersion(payload.config?.appVersion);
  renderConfig();
  if (!dom.blocklistModal.hidden) {
    renderBlocklistPlan();
  }
}

async function loadSettings() {
  const payload = await api("/api/settings");
  state.settings = payload.settings;
  renderSettings();
}

async function loadBlocklists() {
  const payload = await api("/api/blocklists");
  state.blocklists = payload.blocklists;
  renderBlocklists();
  if (!dom.blocklistModal.hidden) {
    updateBlocklistModalCopy();
  }
}

function removeBlocklistFromUi(blocklist) {
  if (!blocklist) {
    return;
  }

  state.blocklists = state.blocklists.filter((item) => item.id !== blocklist.id);

  if (state.editingId === blocklist.id) {
    closeBlocklistModal();
    resetForm();
  }

  renderBlocklists();
}

async function testConnection() {
  setBusy(dom.testButton, true);
  try {
    const payload = await api("/api/unifi/test");
    renderStatus(payload.status);
    setStatusLog(payload.status);
  } catch (error) {
    renderControllerModel(null);
    setQuickStatusItem(dom.quickStatusNetwork, "Offline", "danger");
    setQuickStatusItem(dom.quickStatusSite, "No site", "neutral");
    setQuickStatusItem(dom.quickStatusDevices, "0 online", "neutral");
    setQuickStatusItem(dom.quickStatusClients, "0 visible", "neutral");
    setStatusLog(error.message);
  } finally {
    setBusy(dom.testButton, false);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  setBusy(dom.saveSettingsButton, true);

  const body = {
    allowInsecureTls: dom.settingsAllowInsecureTls.checked,
    unifi: {
      networkBaseUrl: dom.settingsNetworkBaseUrl.value,
      networkApiKey: dom.settingsNetworkApiKey.value,
      clearNetworkApiKey: dom.settingsClearNetworkApiKey.checked,
      siteId: dom.settingsSiteId.value,
      blocklists: {
        maxEntries: Number(dom.settingsIpSetMaxEntries.value),
      },
      siteManagerBaseUrl: dom.settingsSiteManagerBaseUrl.value,
      siteManagerApiKey: dom.settingsSiteManagerApiKey.value,
      clearSiteManagerApiKey: dom.settingsClearSiteManagerApiKey.checked,
    },
  };

  try {
    const payload = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    state.settings = payload.settings;
    state.config = payload.config;
    renderSettings();
    renderConfig();
    setStatusLog("Configuration saved.");
    await testConnection();
  } catch (error) {
    setStatusLog(error.message);
  } finally {
    setBusy(dom.saveSettingsButton, false);
  }
}

async function createOrUpdateBlocklist(event) {
  event.preventDefault();
  setBlocklistFormBusy(true);

  const body = {
    name: dom.formName.value,
    description: dom.formDescription.value,
    enabled: dom.formEnabled.checked,
    cidrs: dom.formCidrs.value,
    sourceUrl: dom.formSourceUrl.value,
    overflowMode: dom.formOverflowMode.value,
    refreshInterval: dom.formRefreshInterval.value,
  };

  try {
    if (state.editingId) {
      await api(`/api/blocklists/${state.editingId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setStatusLog("Blocklist updated and synced to UniFi.");
    } else {
      await api("/api/blocklists", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setStatusLog("Blocklist created and synced to UniFi.");
    }

    closeBlocklistModal();
    resetForm();
    await loadBlocklists();
  } catch (error) {
    setStatusLog(error.message);
    await Promise.allSettled([loadBlocklists()]);
  } finally {
    setBlocklistFormBusy(false);
  }
}

async function removeBlocklist(id) {
  const blocklist = state.blocklists.find((item) => item.id === id);
  const groupsCount = getBlocklistGroupPlan(blocklist || {}).groups?.length || 0;
  const confirmed = await openConfirmModal({
    title: "Delete this blocklist?",
    message: `The list "${blocklist?.name || ""}" will be removed from unifi_bl and ${groupsCount > 1 ? `all ${groupsCount} linked UniFi groups will be deleted` : "its linked UniFi group will be deleted"}.`,
    confirmLabel: "Delete",
    confirmClassName: "button button-danger",
  });

  if (!confirmed) {
    return;
  }

  try {
    await api(`/api/blocklists/${id}`, {
      method: "DELETE",
    });
    removeBlocklistFromUi(blocklist);
    setStatusLog("Blocklist deleted from unifi_bl and UniFi.");
  } catch (error) {
    setStatusLog(error.message);
  }
}

async function syncBlocklist(id) {
  const blocklist = state.blocklists.find((item) => item.id === id);

  try {
    const payload = await api(`/api/blocklists/${id}/sync`, {
      method: "POST",
    });
    setStatusLog(
      `UniFi sync completed for ${blocklist?.name || "the selected blocklist"}.`,
    );
    await loadBlocklists();
    return payload;
  } catch (error) {
    setStatusLog(error.message);
    await Promise.allSettled([loadBlocklists()]);
    return null;
  }
}

async function syncBlocklistSource(id) {
  const blocklist = state.blocklists.find((item) => item.id === id);

  if (!blocklist?.sourceUrl) {
    setStatusLog("This blocklist does not have a source URL.");
    return;
  }

  try {
    const payload = await api(`/api/blocklists/${id}/sync-source`, {
      method: "POST",
    });
    const diff = payload.diff || {};
    const summary =
      payload.skipped
        ? "No source changes detected. UniFi re-apply skipped."
        : diff.unchanged
          ? "No source changes detected."
          : `Source sync completed: +${diff.addedCount || 0} / -${diff.removedCount || 0}.`;
    setStatusLog(summary);
    await loadBlocklists();
  } catch (error) {
    setStatusLog(error.message);
    await Promise.allSettled([loadBlocklists()]);
  }
}

async function toggleRefreshPause(id) {
  const blocklist = state.blocklists.find((item) => item.id === id);

  if (!blocklist?.sourceUrl || !blocklist.refreshInterval) {
    setStatusLog(
      "A source URL and refresh interval are required before refresh can be paused.",
    );
    return;
  }

  const nextPaused = !blocklist.refreshPaused;

  try {
    await api(`/api/blocklists/${id}/refresh-state`, {
      method: "PUT",
      body: JSON.stringify({ paused: nextPaused }),
    });
    setStatusLog(
      nextPaused
        ? `Automatic refresh paused for ${blocklist.name}.`
        : `Automatic refresh resumed for ${blocklist.name}.`,
    );
    await loadBlocklists();
  } catch (error) {
    setStatusLog(error.message);
  }
}

async function syncAll() {
  const confirmed = await openConfirmModal({
    title: "Sync all managed blocklists?",
    message:
      "Each managed blocklist will be applied to UniFi. Lists with a source URL will fetch the latest source before syncing.",
    confirmLabel: "Sync all",
  });

  if (!confirmed) {
    return;
  }

  setBusy(dom.syncAllButton, true);
  try {
    const payload = await api("/api/blocklists/sync-all", {
      method: "POST",
    });
    setStatusLog(payload);
    await loadBlocklists();
  } catch (error) {
    setStatusLog(error.message);
  } finally {
    setBusy(dom.syncAllButton, false);
  }
}

async function refreshAll() {
  if (!isAuthenticated()) {
    return;
  }

  await Promise.allSettled([
    loadSettings(),
    loadConfig(),
    loadBlocklists(),
    testConnection(),
  ]);
}

for (const tab of dom.viewTabs) {
  tab.addEventListener("click", () => {
    setActiveView(tab.dataset.viewTarget);
  });
}

dom.loginForm.addEventListener("submit", login);
dom.logoutButton.addEventListener("click", logout);
dom.createBlocklistButton.addEventListener("click", () => {
  setActiveView("blocklists");
  openBlocklistModal();
});

dom.settingsForm.addEventListener("submit", saveSettings);
dom.form.addEventListener("submit", createOrUpdateBlocklist);
dom.formEnabled.addEventListener("change", updateBlocklistModalCopy);
dom.formName.addEventListener("input", renderBlocklistPlan);
dom.formCidrs.addEventListener("input", renderBlocklistPlan);
dom.formSourceUrl.addEventListener("input", renderBlocklistPlan);
dom.formOverflowMode.addEventListener("change", renderBlocklistPlan);
dom.formCancelButton.addEventListener("click", () => {
  closeBlocklistModal();
  resetForm();
});
dom.testButton.addEventListener("click", testConnection);
dom.refreshButton.addEventListener("click", refreshAll);
dom.syncAllButton.addEventListener("click", syncAll);
dom.confirmModalCancel.addEventListener("click", () => closeConfirmModal(false));
dom.confirmModalConfirm.addEventListener("click", () => closeConfirmModal(true));
dom.errorDetailModalClose.addEventListener("click", closeErrorDetailModal);
dom.errorDetailModal.addEventListener("click", (event) => {
  if (event.target === dom.errorDetailModal) {
    closeErrorDetailModal();
  }
});

dom.blocklistsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action][data-id]");
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;
  const blocklist = state.blocklists.find((item) => item.id === id);

  if (!blocklist) {
    return;
  }

  if (action === "edit") {
    openBlocklistModal(blocklist);
    return;
  }

  if (action === "delete") {
    removeBlocklist(id);
    return;
  }

  if (action === "sync") {
    syncBlocklist(id);
    return;
  }

  if (action === "sync-source") {
    syncBlocklistSource(id);
    return;
  }

  if (action === "show-error-detail") {
    const detail = getBlocklistErrorDetail(
      blocklist,
      button.dataset.errorType || "sync",
    );
    if (detail) {
      openErrorDetailModal(detail);
      setStatusLog(detail.detail);
    } else {
      setStatusLog("No stored error detail is available for this blocklist.");
    }
    return;
  }

  if (action === "toggle-refresh") {
    toggleRefreshPause(id);
  }
});

dom.confirmModal.addEventListener("click", (event) => {
  if (event.target === dom.confirmModal) {
    closeConfirmModal(false);
  }
});

dom.blocklistModal.addEventListener("click", (event) => {
  if (event.target === dom.blocklistModal && !state.blocklistFormBusy) {
    closeBlocklistModal();
    resetForm();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!dom.confirmModal.hidden) {
    closeConfirmModal(false);
  }

  if (!dom.blocklistModal.hidden) {
    if (!state.blocklistFormBusy) {
      closeBlocklistModal();
      resetForm();
    }
  }
});

window.addEventListener("pageshow", () => {
  resetConfirmModal();
  closeBlocklistModal();
  resetForm();
});

async function bootstrap() {
  setActiveView("blocklists");
  resetForm();
  resetConfirmModal();
  renderLoginButton();

  try {
    await loadSession();
    if (isAuthenticated()) {
      await refreshAll();
    }
  } catch (error) {
    dom.authGate.hidden = false;
    setLoginError("Unable to reach the server. Try again in a moment.");
    dom.statusLog.textContent = error.message;
  }
}

bootstrap();
