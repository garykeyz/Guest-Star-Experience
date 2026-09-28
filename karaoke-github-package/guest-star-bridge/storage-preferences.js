const UNITS = ["KB", "MB", "GB", "TB"];

export function formatStorageBytes(value, locale = "es") {
  let size = Math.max(0, Number(value) || 0) / 1000;
  let unitIndex = 0;
  while (size >= 1000 && unitIndex < UNITS.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }
  const maximumFractionDigits = unitIndex >= 2 || (size < 10 && unitIndex > 0) ? 1 : 0;
  return `${new Intl.NumberFormat(locale === "en" ? "en-US" : "es-ES", {
    maximumFractionDigits
  }).format(size)} ${UNITS[unitIndex]}`;
}

function storageCopy(language) {
  const english = language === "en";
  return {
    calculating: english ? "Calculating…" : "Calculando…",
    failed: english ? "Storage usage could not be calculated." : "No se pudo calcular el almacenamiento.",
    included: english
      ? "Only Guest Star-managed cache folders are included; original library files are excluded."
      : "Solo se incluyen las carpetas de caché administradas por Guest Star; los archivos originales de la biblioteca quedan excluidos.",
    stems: english ? "AI voice guide" : "Voz guía IA",
    used: english ? "used" : "utilizados",
    unavailable: english ? "Unavailable" : "No disponible",
    partial: english ? "Some folders could not be read; the total is incomplete." : "No se pudieron leer algunas carpetas; el total está incompleto.",
    nativeAudio: english ? "Temporary audio" : "Audio temporal",
    gsx: "GSX",
    legacy: english ? "Legacy" : "Legacy",
    temporary: english ? "temporary" : "temporales",
    show: english ? "Show in Finder" : "Mostrar en Finder",
    opened: english ? "The cache folder was opened in Finder." : "La carpeta de caché se abrió en Finder.",
    openedParent: english
      ? "The cache has not been created yet; Finder opened its containing folder."
      : "El caché aún no existe; Finder abrió su carpeta contenedora.",
    missing: english ? "Not created yet" : "Aún no creado",
    files: (count) => english ? `${count} ${count === 1 ? "file" : "files"}` : `${count} ${count === 1 ? "archivo" : "archivos"}`
  };
}

function folderIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h6l1.7 2H20v8.25A2.25 2.25 0 0 1 17.75 20H6.25A2.25 2.25 0 0 1 4 17.75V7.5"/></svg>';
}

export function createStoragePreferences({ request, dialog, i18n, notify, root = document } = {}) {
  const total = root.querySelector("#preferencesStorageTotal");
  const list = root.querySelector("#preferencesStorageList");
  const status = root.querySelector("#preferencesStorageStatus");
  const refreshButton = root.querySelector("#preferencesStorageRefresh");
  const doc = root.ownerDocument || root;
  let revision = 0;
  let pending = false;
  let queuedRefresh = false;
  let changeTimer;
  let lastSignature;
  let lastData;

  function render(data) {
    const language = i18n.getLanguage();
    const copy = storageCopy(language);
    lastData = data;
    total.textContent = data.complete === false ? "—" : `${formatStorageBytes(data.totalBytes, language)} ${copy.used}`;
    list.replaceChildren();
    for (const location of data.locations || []) {
      const row = doc.createElement("article");
      row.className = "preferences-storage-row";

      const kind = doc.createElement("div");
      kind.className = "preferences-storage-kind";
      const name = doc.createElement("strong");
      name.textContent = location.kind === "stems"
        ? `${copy.stems}${location.libraryName ? ` · ${location.libraryName}` : ""}`
        : copy.nativeAudio;
      const path = doc.createElement("span");
      path.className = "preferences-storage-path";
      path.textContent = location.displayPath;
      path.title = location.path;
      path.setAttribute("data-no-i18n", "");
      kind.append(name, path);

      const size = doc.createElement("div");
      size.className = "preferences-storage-size";
      const amount = doc.createElement("strong");
      amount.textContent = location.error ? "—" : formatStorageBytes(location.bytes, language);
      const detail = doc.createElement("small");
      const groups = location.breakdown
        ? [
            location.breakdown.gsx?.files ? `${copy.gsx} ${formatStorageBytes(location.breakdown.gsx.bytes, language)}` : "",
            location.breakdown.legacy?.files ? `${copy.legacy} ${formatStorageBytes(location.breakdown.legacy.bytes, language)}` : "",
            location.breakdown.temporary?.files ? `${copy.temporary} ${formatStorageBytes(location.breakdown.temporary.bytes, language)}` : ""
          ].filter(Boolean).join(" · ")
        : "";
      detail.textContent = location.error ? copy.unavailable : location.exists ? groups || copy.files(location.files) : copy.missing;
      if (location.error) detail.title = location.error;
      size.append(amount, detail);

      const actions = doc.createElement("div");
      actions.className = "preferences-storage-actions";
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "button ghost";
      button.dataset.storageReveal = location.id;
      button.title = copy.show;
      button.setAttribute("aria-label", `${copy.show}: ${name.textContent}`);
      button.innerHTML = `${folderIcon()}<span>${copy.show}</span>`;
      actions.append(button);

      row.append(kind, size, actions);
      list.append(row);
    }
    list.setAttribute("aria-busy", "false");
    status.textContent = data.complete === false ? `${copy.partial} ${copy.included}` : copy.included;
  }

  async function refresh() {
    if (pending) { queuedRefresh = true; return; }
    pending = true;
    if (changeTimer !== undefined) clearTimeout(changeTimer);
    changeTimer = undefined;
    const current = ++revision;
    const copy = storageCopy(i18n.getLanguage());
    list.setAttribute("aria-busy", "true");
    total.textContent = copy.calculating;
    try {
      const data = await request("/api/storage/usage");
      if (current === revision) render(data);
    } catch (error) {
      if (current !== revision) return;
      list.setAttribute("aria-busy", "false");
      total.textContent = "—";
      status.textContent = error?.message || copy.failed;
    } finally {
      pending = false;
      if (queuedRefresh) {
        queuedRefresh = false;
        if (dialog.open) void refresh();
      }
    }
  }

  async function reveal(id, button) {
    const copy = storageCopy(i18n.getLanguage());
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const result = await request("/api/storage/reveal", {
        method: "POST",
        body: JSON.stringify({ id })
      });
      notify(result.exact ? copy.opened : copy.openedParent);
    } catch (error) {
      notify(error.message, true);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  refreshButton.addEventListener("click", () => void refresh());
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-storage-reveal]");
    if (button) void reveal(button.dataset.storageReveal, button);
  });

  return {
    refresh,
    changed() {
      if (!dialog.open || changeTimer !== undefined) return;
      changeTimer = setTimeout(() => {
        changeTimer = undefined;
        if (dialog.open) void refresh();
      }, 500);
    },
    observeState(state) {
      // Observe only storage-relevant transitions on the existing state stream.
      // Progress ticks and playback clocks do not trigger filesystem scans.
      const signature = JSON.stringify([
        state.config?.libraryFolders || [],
        (state.stemEngine?.jobs || []).map((job) => [job.id,
          Object.entries(job.engines || {}).map(([engine, value]) => [engine, value.status])
        ])
      ]);
      if (lastSignature !== undefined && signature !== lastSignature) this.changed();
      lastSignature = signature;
    },
    renderLanguage() {
      if (lastData) render(lastData);
    }
  };
}
