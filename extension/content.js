const API_DEFAULT = "https://future-crm-api-mensagensrapidas.onrender.com/api";
const VAR_DEFAULTS = {
  nome: "",
  revista: "",
  valor: "",
  doi: "",
  link: "",
};
const MAGAZINE_DEFAULTS = [
  { id: "all", name: "Todas as revistas" },
];

let state = {
  token: null,
  apiBase: API_DEFAULT,
  user: null,
  messages: [],
  categories: [],
  magazines: [],
  filter: "",
  categoryId: "all",
  magazineId: "all",
  onlyFavorites: false,
  status: "",
  error: "",
  loading: false,
};

function isExtensionContextReady() {
  return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local);
}

function handleInvalidExtensionContext(error) {
  if (!String(error?.message || error || "").includes("Extension context invalidated")) {
    return false;
  }
  const body = document.getElementById("fca-body");
  if (body) {
    body.innerHTML = `
      <div class="fca-alert error">Extensao recarregada. Atualize esta aba do GHL para continuar.</div>
    `;
  }
  return true;
}

const storage = {
  get: keys => new Promise(resolve => {
    if (!isExtensionContextReady()) {
      resolve({});
      return;
    }
    try {
      chrome.storage.local.get(keys, value => resolve(value || {}));
    } catch (error) {
      if (!handleInvalidExtensionContext(error)) console.warn("Future CRM storage get failed", error);
      resolve({});
    }
  }),
  set: obj => new Promise(resolve => {
    if (!isExtensionContextReady()) {
      resolve();
      return;
    }
    try {
      chrome.storage.local.set(obj, resolve);
    } catch (error) {
      if (!handleInvalidExtensionContext(error)) console.warn("Future CRM storage set failed", error);
      resolve();
    }
  }),
};

async function api(path, options = {}) {
  const res = await fetch(`${state.apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    await logout("Sessão expirada. Entre novamente.");
    throw new Error("Sessão expirada.");
  }

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  if (res.status === 204) return null;
  return res.json();
}

async function readError(res) {
  try {
    const data = await res.json();
    return data.detail || data.message || JSON.stringify(data);
  } catch (_) {
    return res.text();
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  renderBody();
}

function findMessageBox() {
  const selectors = ["textarea", "input[type='text']", "[contenteditable='true']", "div[role='textbox']"];

  for (const selector of selectors) {
    const items = [...document.querySelectorAll(selector)].filter(el => el.offsetParent !== null);
    const candidate = items.reverse().find(el => {
      const hint = `${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`;
      return /message|mensagem|reply|resposta|text/i.test(hint) || el.isContentEditable || el.tagName === "TEXTAREA";
    });
    if (candidate) return candidate;
  }

  return null;
}

function insertText(text) {
  const box = findMessageBox();
  if (!box) {
    setState({ error: "Campo de mensagem não encontrado. Clique no chat e tente novamente." });
    return;
  }

  box.focus();
  if (box.tagName === "TEXTAREA" || box.tagName === "INPUT") {
    box.value = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  setState({ status: "Resposta inserida.", error: "" });
}

function render() {
  if (document.getElementById("future-crm-btn")) return;

  const btn = document.createElement("button");
  btn.id = "future-crm-btn";
  btn.type = "button";
  btn.textContent = "⚡ Future";
  btn.onclick = () => document.getElementById("future-crm-panel")?.classList.toggle("fca-hidden");
  document.body.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "future-crm-panel";
  panel.className = "fca-hidden";
  panel.innerHTML = `
    <div class="fca-head">
      <div>
        <div class="fca-brand">Future CRM</div>
        <div class="fca-head-sub">Respostas rapidas</div>
      </div>
      <button class="fca-icon-btn" id="fca-close" type="button" title="Fechar">×</button>
    </div>
    <div class="fca-body" id="fca-body"></div>
  `;
  document.body.appendChild(panel);

  document.getElementById("fca-close").onclick = () => panel.classList.add("fca-hidden");
  renderBody();
}

function renderBody() {
  const body = document.getElementById("fca-body");
  if (!body) return;

  if (!state.token) {
    renderLogin(body);
    return;
  }

  renderMessages(body);
}

function renderLogin(body) {
  body.innerHTML = `
    ${renderNotice()}
    <div class="fca-login-title">Acesso da equipe</div>
    <label class="fca-label" for="fca-email">E-mail</label>
    <input class="fca-input" id="fca-email" autocomplete="username" placeholder="usuario@empresa.com">
    <label class="fca-label" for="fca-pass">Senha</label>
    <input class="fca-input" id="fca-pass" type="password" autocomplete="current-password" placeholder="Senha">
    <button class="fca-btn fca-full" id="fca-login" type="button">${state.loading ? "Entrando..." : "Entrar"}</button>
    <p class="fca-small">Admin inicial: admin@futurecrm.com / 123456</p>
  `;

  document.getElementById("fca-login").onclick = login;
}

function renderMessages(body) {
  const messages = filteredMessages();
  const magazines = availableMagazines();
  const selectedMagazine = magazines.find(item => item.id === state.magazineId) || magazines[0];
  const effectiveMagazineId = selectedMagazine.id;
  body.innerHTML = `
    ${renderNotice()}
    <div class="fca-userbar">
      <div class="fca-user-row">
        <span class="fca-avatar">${escapeHtml(initials(state.user?.name || "Atendente"))}</span>
        <div>
          <div class="fca-user-name">${escapeHtml(state.user?.name || "Atendente")}</div>
          <div class="fca-user-meta">${escapeHtml(selectedMagazine.name)}</div>
        </div>
      </div>
      <button class="fca-link-btn" id="fca-logout" type="button">Sair</button>
    </div>
    <div class="fca-label-row">
      <label class="fca-label" for="fca-magazine-filter">Revista em atendimento</label>
      <div class="fca-magazine-actions">
        <button class="fca-add-magazine" id="fca-add-magazine" type="button">+ Adicionar</button>
        ${effectiveMagazineId !== "all" ? `
          <button class="fca-mini-link" id="fca-edit-magazine" type="button">Editar</button>
          <button class="fca-mini-link danger" id="fca-delete-magazine" type="button">Excluir</button>
        ` : ""}
      </div>
    </div>
    <select class="fca-select fca-context-select" id="fca-magazine-filter">
      ${magazines.map(magazine => `<option value="${magazine.id}" ${effectiveMagazineId === magazine.id ? "selected" : ""}>${escapeHtml(magazine.name)}</option>`).join("")}
    </select>
    <div class="fca-search-wrap"><span>⌕</span><input class="fca-input fca-search" id="fca-search" placeholder="Buscar resposta..." value="${escapeAttr(state.filter)}"></div>
    <div class="fca-filters-grid">
      <select class="fca-select" id="fca-category-filter">
        <option value="all">Todas as categorias</option>
        <option value="favorites" ${state.onlyFavorites ? "selected" : ""}>Favoritas</option>
        ${state.categories.map(category => `<option value="${category.id}" ${String(state.categoryId) === String(category.id) && !state.onlyFavorites ? "selected" : ""}>${escapeHtml(category.icon)} ${escapeHtml(category.name)}</option>`).join("")}
      </select>
    </div>
    <div class="fca-actions fca-toolbar">
      <button class="fca-btn" id="fca-new" type="button">+ Nova</button>
      <button class="fca-btn secondary" id="fca-bulk" type="button">Em massa</button>
      <button class="fca-btn secondary" id="fca-sync" type="button">${state.loading ? "Sincronizando..." : "Sincronizar"}</button>
    </div>
    <div class="fca-count">${messages.length} resposta${messages.length === 1 ? "" : "s"} neste contexto</div>
    <div id="fca-list">
      ${messages.length ? messages.map(renderMessageCard).join("") : '<div class="fca-empty">Nenhuma resposta encontrada.</div>'}
    </div>
  `;

  document.getElementById("fca-magazine-filter").onchange = async e => {
    await storage.set({ selectedMagazineId: e.target.value });
    setState({ magazineId: e.target.value, status: "", error: "" });
  };
  document.getElementById("fca-add-magazine").onclick = addMagazine;
  const editMagazineBtn = document.getElementById("fca-edit-magazine");
  const deleteMagazineBtn = document.getElementById("fca-delete-magazine");
  if (editMagazineBtn) editMagazineBtn.onclick = editMagazine;
  if (deleteMagazineBtn) deleteMagazineBtn.onclick = deleteMagazine;
  document.getElementById("fca-search").oninput = e => setState({ filter: e.target.value, status: "", error: "" });
  document.getElementById("fca-category-filter").onchange = e => {
    if (e.target.value === "favorites") {
      setState({ onlyFavorites: true, categoryId: "all", status: "", error: "" });
      return;
    }
    setState({ onlyFavorites: false, categoryId: e.target.value, status: "", error: "" });
  };
  document.getElementById("fca-sync").onclick = () => sync();
  document.getElementById("fca-logout").onclick = () => logout();
  document.getElementById("fca-new").onclick = () => editMessage();
  document.getElementById("fca-bulk").onclick = () => editBulkMessages();

  body.querySelectorAll("[data-insert]").forEach(button => {
    button.onclick = () => {
      const message = state.messages.find(item => item.id == button.dataset.insert);
      if (message) {
        insertText(applyVars(message.content));
        logUsage(message.id);
      }
    };
  });

  body.querySelectorAll("[data-favorite]").forEach(button => {
    button.onclick = () => toggleFavorite(button.dataset.favorite);
  });

  body.querySelectorAll("[data-pin]").forEach(button => {
    button.onclick = () => togglePin(button.dataset.pin);
  });

  body.querySelectorAll("[data-edit]").forEach(button => {
    button.onclick = () => editMessage(state.messages.find(item => item.id == button.dataset.edit));
  });

  body.querySelectorAll("[data-del]").forEach(button => {
    button.onclick = () => removeMessage(button.dataset.del);
  });

  bindCardDrag();
}

function filteredMessages() {
  const term = state.filter.trim().toLowerCase();
  const magazine = availableMagazines().find(item => item.id === state.magazineId);
  return state.messages
    .filter(message => !term || `${message.title} ${message.content} ${message.category?.name || ""}`.toLowerCase().includes(term))
    .filter(message => matchesMagazine(message, magazine))
    .filter(message => !state.onlyFavorites || message.is_favorite)
    .filter(message => state.categoryId === "all" || String(message.category_id) === String(state.categoryId))
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned)
      || orderValue(a) - orderValue(b)
      || Number(b.is_favorite) - Number(a.is_favorite)
      || a.title.localeCompare(b.title));
}

function orderValue(message) {
  return Number.isFinite(Number(message.sort_order)) ? Number(message.sort_order) : 0;
}

function availableMagazines() {
  const merged = [MAGAZINE_DEFAULTS[0], ...state.magazines.map(magazine => ({
    id: magazine.key,
    dbId: magazine.id,
    name: magazine.name,
  }))];
  const seen = new Set();
  return merged.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function addMagazine() {
  const name = prompt("Nome da revista:");
  const cleanName = String(name || "").trim();
  if (!cleanName) return;

  const magazine = { id: normalizeKey(cleanName), name: cleanName };
  if (!magazine.id) return;

  try {
    const saved = await api("/magazines", {
      method: "POST",
      body: JSON.stringify({ name: cleanName }),
    });
    await storage.set({ selectedMagazineId: saved.key });
    await sync("Revista adicionada.");
    setState({ magazineId: saved.key });
  } catch (error) {
    setState({ error: error.message || "Falha ao adicionar revista." });
  }
}

async function editMagazine() {
  const current = availableMagazines().find(item => item.id === state.magazineId);
  if (!current || current.id === "all" || !current.dbId) return;

  const name = prompt("Novo nome da revista:", current.name);
  const cleanName = String(name || "").trim();
  if (!cleanName) return;

  const magazine = { id: normalizeKey(cleanName), name: cleanName };
  if (!magazine.id) return;

  try {
    const saved = await api(`/magazines/${current.dbId}`, {
      method: "PUT",
      body: JSON.stringify({ name: cleanName }),
    });
    await storage.set({ selectedMagazineId: saved.key });
    await sync("Revista atualizada.");
    setState({ magazineId: saved.key });
  } catch (error) {
    setState({ error: error.message || "Falha ao editar revista." });
  }
}

async function deleteMagazine() {
  const current = availableMagazines().find(item => item.id === state.magazineId);
  if (!current || current.id === "all" || !current.dbId) return;
  if (!confirm(`Excluir a revista "${current.name}"?`)) return;

  try {
    await api(`/magazines/${current.dbId}`, { method: "DELETE" });
    await storage.set({ selectedMagazineId: "all" });
    await sync("Revista excluida.");
    setState({ magazineId: "all" });
  } catch (error) {
    setState({ error: error.message || "Falha ao excluir revista." });
  }
}

function magazineOptions(includeAll = true) {
  const magazines = availableMagazines();
  return includeAll ? magazines : magazines.filter(item => item.id !== "all");
}

function matchesMagazine(message, magazine) {
  if (!magazine || magazine.id === "all") return true;
  const haystack = normalizeKey(`${message.title} ${message.content} ${message.category?.name || ""}`);
  return haystack.includes(magazine.id) || haystack.includes(normalizeKey(magazine.name));
}

function messageMagazineId(message) {
  const title = normalizeKey(message?.title || "");
  const fullText = normalizeKey(`${message?.title || ""} ${message?.content || ""} ${message?.category?.name || ""}`);
  const found = magazineOptions(false).find(item => title.startsWith(`${item.id}-`) || fullText.includes(item.id));
  return found?.id || (state.magazineId !== "all" ? state.magazineId : "");
}

function renderMessageCard(message) {
  const pinned = Boolean(message.is_pinned);
  return `
    <div class="fca-card ${pinned ? "pinned" : ""}" data-card-id="${message.id}" draggable="${pinned ? "false" : "true"}">
      <div class="fca-card-top">
        <div>
          <div class="fca-title">${escapeHtml(message.title)}</div>
          <div class="fca-card-meta">
            <span class="fca-small">${escapeHtml(message.category?.name || "Sem categoria")}</span>
            ${pinned ? '<span class="fca-pin-badge">Fixada</span>' : ""}
          </div>
        </div>
        <button class="fca-star ${message.is_favorite ? "active" : ""}" data-favorite="${message.id}" type="button" title="Favoritar">★</button>
      </div>
      <div class="fca-preview">${escapeHtml(message.content)}</div>
      <div class="fca-order-actions">
        <button class="fca-order-btn ${pinned ? "active" : ""}" data-pin="${message.id}" type="button">${pinned ? "Soltar" : "Fixar"}</button>
      </div>
      <div class="fca-actions">
        <button class="fca-btn" data-insert="${message.id}" type="button">Inserir</button>
        <button class="fca-btn secondary" data-edit="${message.id}" type="button">Editar</button>
        <button class="fca-btn danger" data-del="${message.id}" type="button">Excluir</button>
      </div>
    </div>
  `;
}

function renderNotice() {
  if (state.error) return `<div class="fca-alert error">${escapeHtml(state.error)}</div>`;
  if (state.status) return `<div class="fca-alert success">${escapeHtml(state.status)}</div>`;
  return "";
}

function applyVars(text) {
  const magazine = availableMagazines().find(item => item.id === state.magazineId);
  const revista = magazine?.id === "all" ? "" : magazine?.name || "";
  const values = { ...VAR_DEFAULTS, revista, ...extractContactVars() };
  return String(text).replace(/\{\{(nome|revista|valor|doi|link|telefone|email)\}\}/g, (_, key) => values[key] ?? "");
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractContactVars() {
  const pageText = document.body.innerText || "";
  const titleCandidates = [
    document.querySelector("h1")?.innerText,
    document.querySelector("h2")?.innerText,
    document.querySelector("[data-testid*='contact']")?.innerText,
    document.querySelector("[class*='contact']")?.innerText,
  ].filter(Boolean);
  const email = pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = pageText.match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}/)?.[0] || "";
  const rawName = titleCandidates[0] || "";
  const name = rawName.split("\n").map(item => item.trim()).find(item => item.length > 2 && !item.includes("@")) || "";
  return { nome: name, email, telefone: phone };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "F").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

async function login() {
  const email = document.getElementById("fca-email").value.trim();
  const password = document.getElementById("fca-pass").value;
  const apiBase = API_DEFAULT;

  if (!email || !password || !apiBase) {
    setState({ error: "Preencha e-mail e senha." });
    return;
  }

  state.apiBase = apiBase;
  setState({ loading: true, error: "", status: "" });

  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    state.token = data.access_token;
    await storage.set({ token: state.token, apiBase: state.apiBase });
    await sync("Login realizado.");
  } catch (error) {
    setState({ error: error.message || "Não foi possível entrar.", loading: false });
  }
}

async function logout(message = "") {
  state.token = null;
  state.user = null;
  state.messages = [];
  state.categories = [];
  await storage.set({ token: null });
  setState({ status: message, error: "", loading: false });
}

async function sync(status = "Mensagens sincronizadas.") {
  setState({ loading: true, error: "", status: "" });

  try {
    const [user, categories, messages, magazines] = await Promise.all([api("/me"), api("/categories"), api("/messages"), api("/magazines")]);
    await storage.set({ cachedCategories: categories, cachedMessages: messages, cachedMagazines: magazines, cachedUser: user });
    setState({ user, categories, messages, magazines, status, loading: false });
  } catch (error) {
    const cached = await storage.get(["cachedCategories", "cachedMessages", "cachedMagazines", "cachedUser"]);
    if (cached.cachedMessages?.length) {
      setState({
        user: cached.cachedUser || null,
        categories: cached.cachedCategories || [],
        messages: cached.cachedMessages || [],
        magazines: cached.cachedMagazines || [],
        error: "Sem conexão com a API. Mostrando últimas respostas sincronizadas.",
        loading: false,
      });
      return;
    }
    setState({ error: error.message || "Falha ao sincronizar.", loading: false });
  }
}

async function editMessage(message = null) {
  const body = document.getElementById("fca-body");
  const categoryOptions = state.categories
    .map(category => `<option value="${category.id}" ${message?.category_id == category.id ? "selected" : ""}>${escapeHtml(category.icon)} ${escapeHtml(category.name)}</option>`)
    .join("");
  const selectedMagazineId = message ? messageMagazineId(message) : (state.magazineId !== "all" ? state.magazineId : "");
  const magazineSelectOptions = [
    `<option value="" ${selectedMagazineId ? "" : "selected"}>Selecione a revista</option>`,
    ...magazineOptions(false)
    .map(magazine => `<option value="${magazine.id}" ${selectedMagazineId === magazine.id ? "selected" : ""}>${escapeHtml(magazine.name)}</option>`)
  ]
    .join("");

  const canSaveCompany = state.user?.role === "admin";
  body.innerHTML = `
    ${renderNotice()}
    <div class="fca-form-head">
      <div>
        <div class="fca-form-title">${message ? "Editar resposta" : "Nova resposta"}</div>
        <div class="fca-user-meta">Escolha a revista para filtrar depois.</div>
      </div>
    </div>
    <label class="fca-label" for="fca-message-magazine">Revista da resposta</label>
    <select class="fca-select" id="fca-message-magazine">${magazineSelectOptions}</select>
    <label class="fca-label" for="fca-title">Título</label>
    <input class="fca-input" id="fca-title" placeholder="Título" value="${escapeAttr(message?.title || "")}">
    <label class="fca-label" for="fca-category">Categoria</label>
    <select class="fca-select" id="fca-category">${categoryOptions}</select>
    <label class="fca-label" for="fca-scope">Visibilidade</label>
    <select class="fca-select" id="fca-scope" ${!canSaveCompany ? "disabled" : ""}>
      <option value="user" ${message?.scope !== "company" ? "selected" : ""}>Pessoal</option>
      <option value="company" ${message?.scope === "company" ? "selected" : ""}>Empresa</option>
    </select>
    <label class="fca-label" for="fca-content">Mensagem</label>
    <textarea class="fca-area" id="fca-content" placeholder="Mensagem">${escapeHtml(message?.content || "")}</textarea>
    <div class="fca-row">
      <button class="fca-btn" id="fca-save" type="button">${state.loading ? "Salvando..." : "Salvar"}</button>
      <button class="fca-btn secondary" id="fca-cancel" type="button">Cancelar</button>
    </div>
  `;

  document.getElementById("fca-cancel").onclick = () => renderBody();
  document.getElementById("fca-save").onclick = () => saveMessage(message);
}

async function saveMessage(message = null) {
  const payload = {
    title: document.getElementById("fca-title").value.trim(),
    content: document.getElementById("fca-content").value.trim(),
    category_id: Number(document.getElementById("fca-category").value),
    scope: document.getElementById("fca-scope")?.value || "user",
  };
  const selectedMagazineId = document.getElementById("fca-message-magazine")?.value;
  const magazine = magazineOptions(false).find(item => item.id === selectedMagazineId);
  if (!magazine) {
    setState({ error: "Escolha a revista da resposta." });
    editMessage(message);
    return;
  }
  if (magazine) {
    payload.title = stripMagazinePrefix(payload.title);
    if (!matchesTextMagazine(payload.title, magazine)) {
      payload.title = `${magazine.name} - ${payload.title}`;
    }
  }

  if (!payload.title || !payload.content || !payload.category_id) {
    setState({ error: "Preencha título, categoria e mensagem." });
    editMessage(message);
    return;
  }

  setState({ loading: true, error: "", status: "" });

  try {
    await api(message ? `/messages/${message.id}` : "/messages", {
      method: message ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    await sync("Resposta salva.");
  } catch (error) {
    setState({ error: error.message || "Falha ao salvar.", loading: false });
    editMessage(message);
  }
}

function bulkRowTemplate(index, title = "", content = "") {
  return `
    <div class="fca-bulk-row" data-bulk-row>
      <div class="fca-bulk-row-head">
        <span>Resposta ${index}</span>
        <button class="fca-mini-link danger" data-remove-bulk-row type="button">Remover</button>
      </div>
      <label class="fca-label">Pergunta ou titulo</label>
      <input class="fca-input" data-bulk-title placeholder="Ex: Solicitar ORCID" value="${escapeAttr(title)}">
      <label class="fca-label">Resposta</label>
      <textarea class="fca-area fca-bulk-area" data-bulk-content placeholder="Texto que sera inserido no atendimento">${escapeHtml(content)}</textarea>
    </div>
  `;
}

function refreshBulkRowNumbers() {
  document.querySelectorAll("[data-bulk-row]").forEach((row, index) => {
    const label = row.querySelector(".fca-bulk-row-head span");
    if (label) label.textContent = `Resposta ${index + 1}`;
  });
}

function addBulkRow(title = "", content = "") {
  const list = document.getElementById("fca-bulk-list");
  if (!list) return;
  const nextIndex = list.querySelectorAll("[data-bulk-row]").length + 1;
  list.insertAdjacentHTML("beforeend", bulkRowTemplate(nextIndex, title, content));
  const row = list.querySelector("[data-bulk-row]:last-child");
  const removeButton = row?.querySelector("[data-remove-bulk-row]");
  if (removeButton) {
    removeButton.onclick = () => {
      if (list.querySelectorAll("[data-bulk-row]").length <= 1) return;
      row.remove();
      refreshBulkRowNumbers();
    };
  }
  refreshBulkRowNumbers();
}

function editBulkMessages() {
  const body = document.getElementById("fca-body");
  const selectedMagazineId = state.magazineId !== "all" ? state.magazineId : "";
  const magazineSelectOptions = [
    `<option value="" ${selectedMagazineId ? "" : "selected"}>Selecione a revista</option>`,
    ...magazineOptions(false)
      .map(magazine => `<option value="${magazine.id}" ${selectedMagazineId === magazine.id ? "selected" : ""}>${escapeHtml(magazine.name)}</option>`)
  ].join("");
  const categoryOptions = state.categories
    .map(category => `<option value="${category.id}">${escapeHtml(category.icon)} ${escapeHtml(category.name)}</option>`)
    .join("");
  const canSaveCompany = state.user?.role === "admin";

  body.innerHTML = `
    ${renderNotice()}
    <div class="fca-form-head">
      <div>
        <div class="fca-form-title">Cadastrar em massa</div>
        <div class="fca-user-meta">Preencha uma pergunta e uma resposta por linha.</div>
      </div>
    </div>
    <label class="fca-label" for="fca-bulk-magazine">Revista das respostas</label>
    <select class="fca-select" id="fca-bulk-magazine">${magazineSelectOptions}</select>
    <label class="fca-label" for="fca-bulk-category">Categoria</label>
    <select class="fca-select" id="fca-bulk-category">${categoryOptions}</select>
    <label class="fca-label" for="fca-bulk-scope">Visibilidade</label>
    <select class="fca-select" id="fca-bulk-scope" ${!canSaveCompany ? "disabled" : ""}>
      <option value="user" selected>Pessoal</option>
      <option value="company">Empresa</option>
    </select>
    <div id="fca-bulk-list" class="fca-bulk-list">
      ${[1, 2, 3].map(index => bulkRowTemplate(index)).join("")}
    </div>
    <div class="fca-row">
      <button class="fca-btn secondary" id="fca-add-bulk-row" type="button">+ Adicionar linha</button>
    </div>
    <div class="fca-row fca-bulk-footer">
      <button class="fca-btn" id="fca-save-bulk" type="button">${state.loading ? "Salvando..." : "Salvar todas"}</button>
      <button class="fca-btn secondary" id="fca-cancel-bulk" type="button">Cancelar</button>
    </div>
  `;

  document.getElementById("fca-add-bulk-row").onclick = () => addBulkRow();
  document.getElementById("fca-cancel-bulk").onclick = () => renderBody();
  document.getElementById("fca-save-bulk").onclick = saveBulkMessages;
  body.querySelectorAll("[data-remove-bulk-row]").forEach(button => {
    button.onclick = () => {
      const rows = body.querySelectorAll("[data-bulk-row]");
      if (rows.length <= 1) return;
      button.closest("[data-bulk-row]")?.remove();
      refreshBulkRowNumbers();
    };
  });
}

async function saveBulkMessages() {
  const magazine = magazineOptions(false).find(item => item.id === document.getElementById("fca-bulk-magazine")?.value);
  if (!magazine) {
    setState({ error: "Escolha a revista das respostas." });
    editBulkMessages();
    return;
  }

  const categoryId = Number(document.getElementById("fca-bulk-category").value);
  const scope = document.getElementById("fca-bulk-scope")?.value || "user";
  const rows = [...document.querySelectorAll("[data-bulk-row]")].map(row => ({
    title: row.querySelector("[data-bulk-title]")?.value.trim() || "",
    content: row.querySelector("[data-bulk-content]")?.value.trim() || "",
  })).filter(row => row.title || row.content);

  if (!rows.length) {
    setState({ error: "Preencha pelo menos uma pergunta e uma resposta." });
    editBulkMessages();
    return;
  }

  const invalid = rows.find(row => row.title.length < 2 || !row.content);
  if (invalid) {
    setState({ error: "Cada linha precisa ter pergunta/titulo e resposta." });
    editBulkMessages();
    return;
  }

  const messages = rows.map(row => {
    let title = stripMagazinePrefix(row.title);
    if (!matchesTextMagazine(title, magazine)) {
      title = `${magazine.name} - ${title}`;
    }
    return { title, content: row.content, category_id: categoryId, scope };
  });

  setState({ loading: true, error: "", status: "" });

  try {
    await createBulkMessages(messages);
    await sync(`${messages.length} respostas cadastradas.`);
  } catch (error) {
    setState({ error: error.message || "Falha ao cadastrar respostas.", loading: false });
    editBulkMessages();
  }
}

async function createBulkMessages(messages) {
  try {
    return await api("/messages/bulk", {
      method: "POST",
      body: JSON.stringify({ messages }),
    });
  } catch (error) {
    if (!String(error.message || "").includes("Method Not Allowed")) {
      throw error;
    }
    for (const message of messages) {
      await api("/messages", {
        method: "POST",
        body: JSON.stringify(message),
      });
    }
    return messages;
  }
}

function matchesTextMagazine(text, magazine) {
  const value = normalizeKey(text);
  return value.includes(magazine.id) || value.includes(normalizeKey(magazine.name));
}

function stripMagazinePrefix(title) {
  let value = String(title || "").trim();
  for (const magazine of magazineOptions(false)) {
    const prefix = `${magazine.name} - `;
    if (value.toLowerCase().startsWith(prefix.toLowerCase())) {
      value = value.slice(prefix.length).trim();
    }
  }
  return value;
}

async function removeMessage(id) {
  if (!confirm("Excluir esta resposta?")) return;

  setState({ loading: true, error: "", status: "" });
  try {
    await api(`/messages/${id}`, { method: "DELETE" });
    await sync("Resposta excluída.");
  } catch (error) {
    setState({ error: error.message || "Falha ao excluir.", loading: false });
  }
}

async function toggleFavorite(id) {
  const message = state.messages.find(item => item.id == id);
  if (!message) return;

  const method = message.is_favorite ? "DELETE" : "POST";
  try {
    await api(`/messages/${id}/favorite`, { method });
    state.messages = state.messages.map(item => item.id == id ? { ...item, is_favorite: !item.is_favorite } : item);
    setState({ status: message.is_favorite ? "Removida dos favoritos." : "Adicionada aos favoritos.", error: "" });
  } catch (error) {
    setState({ error: error.message || "Falha ao favoritar." });
  }
}

async function togglePin(id) {
  const message = state.messages.find(item => item.id == id);
  if (!message) return;

  const nextPinned = !message.is_pinned;
  try {
    await api(`/messages/${id}/pin`, { method: nextPinned ? "POST" : "DELETE" });
    state.messages = state.messages.map(item => item.id == id ? { ...item, is_pinned: nextPinned } : item);
    await storage.set({ cachedMessages: state.messages });
    setState({
      status: nextPinned ? "Mensagem fixada." : "Mensagem solta.",
      error: "",
    });
  } catch (error) {
    setState({ error: preferenceSaveError(error, "fixar mensagem") });
  }
}

function preferenceSaveError(error, action) {
  const message = String(error?.message || error || "");
  if (/not found|method not allowed/i.test(message)) {
    return `Nao foi possivel ${action} no PostgreSQL. Atualize a API publicada e tente novamente.`;
  }
  return message || `Falha ao ${action}.`;
}

function bindCardDrag() {
  const list = document.getElementById("fca-list");
  if (!list) return;

  list.querySelectorAll("[data-card-id]").forEach(card => {
    card.addEventListener("dragstart", event => {
      if (card.draggable === false || card.getAttribute("draggable") === "false") return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.dataset.cardId);
      card.classList.add("dragging");
    });

    card.addEventListener("dragend", () => card.classList.remove("dragging"));

    card.addEventListener("dragover", event => {
      if (card.getAttribute("draggable") === "false") return;
      event.preventDefault();
      card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));

    card.addEventListener("drop", event => {
      event.preventDefault();
      card.classList.remove("drag-over");
      const draggedId = event.dataTransfer.getData("text/plain");
      const targetId = card.dataset.cardId;
      if (!draggedId || draggedId === targetId || card.getAttribute("draggable") === "false") return;
      reorderDraggedMessage(draggedId, targetId);
    });
  });
}

async function reorderDraggedMessage(draggedId, targetId) {
  const visible = filteredMessages().filter(message => !message.is_pinned);
  const from = visible.findIndex(message => String(message.id) === String(draggedId));
  const to = visible.findIndex(message => String(message.id) === String(targetId));
  if (from < 0 || to < 0) return;

  const nextVisible = [...visible];
  const [moved] = nextVisible.splice(from, 1);
  nextVisible.splice(to, 0, moved);
  const orderById = new Map(nextVisible.map((message, position) => [String(message.id), position]));

  try {
    await api("/messages/reorder", {
      method: "POST",
      body: JSON.stringify({ message_ids: nextVisible.map(message => message.id) }),
    });
    state.messages = state.messages.map(message => {
      if (!orderById.has(String(message.id))) return message;
      return { ...message, sort_order: orderById.get(String(message.id)) };
    });
    await storage.set({ cachedMessages: state.messages });
    setState({
      status: "Ordem atualizada.",
      error: "",
    });
  } catch (error) {
    setState({ error: preferenceSaveError(error, "salvar a ordem") });
  }
}

async function logUsage(id) {
  try {
    await api(`/messages/${id}/usage`, {
      method: "POST",
      body: JSON.stringify({ source: "extension" }),
    });
  } catch (error) {
    console.warn("Future CRM usage log failed", error);
  }
}

(async function init() {
  const saved = await storage.get(["token", "apiBase", "cachedCategories", "cachedMessages", "cachedMagazines", "cachedUser", "selectedMagazineId"]);
  state.token = saved.token;
  state.apiBase = API_DEFAULT;
  await storage.set({ apiBase: API_DEFAULT });
  state.user = saved.cachedUser || null;
  state.categories = saved.cachedCategories || [];
  state.messages = saved.cachedMessages || [];
  state.magazines = saved.cachedMagazines || [];
  state.magazineId = saved.selectedMagazineId || "all";
  render();

  if (state.token) {
    await sync("");
  }
})();
