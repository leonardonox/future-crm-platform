const state = {
  apiBase: localStorage.getItem("futureApiBase") || "https://future-crm-api-mensagensrapidas.onrender.com/api",
  token: localStorage.getItem("futureToken") || "",
  me: null,
  users: [],
  categories: [],
  messages: [],
  usage: [],
};

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(`${state.apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.status === 204 ? null : res.json();
}

async function readError(res) {
  const text = await res.text();
  if (!text) return `Erro ${res.status}`;
  try {
    const data = JSON.parse(text);
    return data.detail || JSON.stringify(data);
  } catch (_) {
    return text;
  }
}

function notice(text, type = "ok") {
  $("notice").textContent = text;
  $("notice").className = `notice ${type}`;
}

function clearNotice() {
  $("notice").className = "notice hidden";
}

function showApp() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("sessionText").textContent = `${state.me.name} (${state.me.role})`;
}

function showLogin() {
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
  $("apiBase").value = state.apiBase;
}

async function login() {
  state.apiBase = $("apiBase").value.trim().replace(/\/$/, "");
  const data = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value }),
  });
  state.token = data.access_token;
  localStorage.setItem("futureApiBase", state.apiBase);
  localStorage.setItem("futureToken", state.token);
  await boot();
}

async function boot() {
  try {
    state.me = await api("/me");
    if (state.me.role !== "admin") throw new Error("Apenas administradores podem usar o painel.");
    showApp();
    await refreshAll();
  } catch (error) {
    showLogin();
    if (state.token) alert(error.message);
  }
}

async function refreshAll() {
  clearNotice();
  const [users, categories, messages, usage] = await Promise.all([
    api("/admin/users"),
    api("/categories"),
    api("/messages"),
    api("/admin/usage"),
  ]);
  state.users = users;
  state.categories = categories;
  state.messages = messages;
  state.usage = usage;
  renderAll();
}

function renderAll() {
  renderCategoryOptions();
  renderMessages();
  renderCategories();
  renderUsers();
  renderUsage();
}

function renderCategoryOptions() {
  $("messageCategory").innerHTML = state.categories
    .map(category => `<option value="${category.id}">${escapeHtml(category.icon)} ${escapeHtml(category.name)} (${category.scope})</option>`)
    .join("");
}

function renderMessages() {
  const term = $("messageSearch").value.trim().toLowerCase();
  const rows = state.messages.filter(item => !term || `${item.title} ${item.content}`.toLowerCase().includes(term));
  $("messageList").innerHTML = rows.map(message => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(message.title)}</div>
        <div class="row-meta">${escapeHtml(message.category?.name || "")} · ${message.scope}</div>
        <div class="row-meta">${escapeHtml(message.content).slice(0, 180)}</div>
      </div>
      <div class="row-actions">
        <button type="button" data-edit-message="${message.id}">Editar</button>
        <button class="danger" type="button" data-delete-message="${message.id}">Excluir</button>
      </div>
    </div>
  `).join("") || empty("Nenhuma resposta cadastrada.");
}

function renderCategories() {
  $("categoryList").innerHTML = state.categories.map(category => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(category.icon)} ${escapeHtml(category.name)}</div>
        <div class="row-meta">${category.scope}</div>
      </div>
    </div>
  `).join("") || empty("Nenhuma categoria cadastrada.");
}

function renderUsers() {
  $("userList").innerHTML = state.users.map(user => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(user.name)}</div>
        <div class="row-meta">${escapeHtml(user.email)} · ${user.role} · ${user.is_active ? "ativo" : "inativo"}</div>
      </div>
      <div class="row-actions">
        <button type="button" data-edit-user="${user.id}">Editar</button>
        <button class="danger" type="button" data-delete-user="${user.id}">Desativar</button>
      </div>
    </div>
  `).join("") || empty("Nenhum usuário cadastrado.");
}

function renderUsage() {
  $("usageList").innerHTML = state.usage.map(log => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(log.message?.title || `Mensagem #${log.message_id}`)}</div>
        <div class="row-meta">${escapeHtml(log.user?.name || `Usuário #${log.user_id}`)} · ${new Date(log.created_at).toLocaleString()} · ${escapeHtml(log.source)}</div>
      </div>
    </div>
  `).join("") || empty("Nenhum uso registrado ainda.");
}

function empty(text) {
  return `<div class="row"><div class="row-meta">${text}</div></div>`;
}

function bindEvents() {
  $("loginBtn").onclick = () => login().catch(error => alert(error.message));
  $("logoutBtn").onclick = () => {
    localStorage.removeItem("futureToken");
    state.token = "";
    showLogin();
  };
  document.querySelectorAll(".tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(item => item.classList.add("hidden"));
      tab.classList.add("active");
      $(tab.dataset.tab).classList.remove("hidden");
    };
  });
  $("messageSearch").oninput = renderMessages;
  $("messageForm").onsubmit = saveMessage;
  $("categoryForm").onsubmit = saveCategory;
  $("userForm").onsubmit = saveUser;
  $("passwordForm").onsubmit = changePassword;
  $("clearMessage").onclick = clearMessageForm;
  $("clearUser").onclick = clearUserForm;
  document.body.onclick = handleBodyClick;
}

async function handleBodyClick(event) {
  const editMessageId = event.target.dataset.editMessage;
  const deleteMessageId = event.target.dataset.deleteMessage;
  const editUserId = event.target.dataset.editUser;
  const deleteUserId = event.target.dataset.deleteUser;
  if (editMessageId) fillMessageForm(state.messages.find(item => item.id == editMessageId));
  if (editUserId) fillUserForm(state.users.find(item => item.id == editUserId));
  if (deleteMessageId && confirm("Excluir esta resposta?")) {
    await api(`/messages/${deleteMessageId}`, { method: "DELETE" });
    await refreshAll();
    notice("Resposta excluída.");
  }
  if (deleteUserId && confirm("Desativar este usuário?")) {
    await api(`/admin/users/${deleteUserId}`, { method: "DELETE" });
    await refreshAll();
    notice("Usuário desativado.");
  }
}

async function saveMessage(event) {
  event.preventDefault();
  const id = $("messageId").value;
  const payload = {
    title: $("messageTitle").value.trim(),
    content: $("messageContent").value.trim(),
    category_id: Number($("messageCategory").value),
    scope: $("messageScope").value,
  };
  await api(id ? `/messages/${id}` : "/messages", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  clearMessageForm();
  await refreshAll();
  notice("Resposta salva.");
}

async function saveCategory(event) {
  event.preventDefault();
  await api("/categories", {
    method: "POST",
    body: JSON.stringify({
      name: $("categoryName").value.trim(),
      icon: $("categoryIcon").value.trim() || "💬",
      scope: $("categoryScope").value,
    }),
  });
  $("categoryForm").reset();
  $("categoryIcon").value = "💬";
  await refreshAll();
  notice("Categoria criada.");
}

async function saveUser(event) {
  event.preventDefault();
  const id = $("userId").value;
  const payload = {
    name: $("userName").value.trim(),
    email: $("userEmail").value.trim(),
    role: $("userRole").value,
    is_active: $("userActive").checked,
  };
  if (!id || $("userPassword").value) payload.password = $("userPassword").value;
  await api(id ? `/admin/users/${id}` : "/admin/users", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  clearUserForm();
  await refreshAll();
  notice("Usuário salvo.");
}

async function changePassword(event) {
  event.preventDefault();
  const currentPassword = $("currentPassword").value;
  const newPassword = $("newPassword").value;
  const confirmPassword = $("confirmPassword").value;

  if (newPassword !== confirmPassword) {
    notice("A confirmação da senha não confere.", "error");
    return;
  }

  await api("/me/password", {
    method: "PUT",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  $("passwordForm").reset();
  notice("Senha alterada.");
}

function fillMessageForm(message) {
  $("messageId").value = message.id;
  $("messageTitle").value = message.title;
  $("messageContent").value = message.content;
  $("messageCategory").value = message.category_id;
  $("messageScope").value = message.scope;
}

function clearMessageForm() {
  $("messageId").value = "";
  $("messageTitle").value = "";
  $("messageContent").value = "";
  $("messageScope").value = "company";
}

function fillUserForm(user) {
  $("userId").value = user.id;
  $("userName").value = user.name;
  $("userEmail").value = user.email;
  $("userPassword").value = "";
  $("userPassword").placeholder = "Preencha apenas para trocar";
  $("userRole").value = user.role;
  $("userActive").checked = user.is_active;
}

function clearUserForm() {
  $("userId").value = "";
  $("userName").value = "";
  $("userEmail").value = "";
  $("userPassword").value = "";
  $("userPassword").placeholder = "Obrigatória ao criar";
  $("userRole").value = "agent";
  $("userActive").checked = true;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

bindEvents();
showLogin();
if (state.token) boot();
