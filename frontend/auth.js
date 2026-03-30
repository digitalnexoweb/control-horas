(() => {
const { createClient } = supabase;

const supabaseUrl = "https://kslcypddazdiqnvnubrx.supabase.co";
const supabaseKey = "sb_publishable_BMTlXGKImkkM_MuhH1t83g_bhNDsctI";

const LAST_EMAIL_STORAGE_KEY = "controlHorasLastEmail";
const SUPABASE_AUTH_STORAGE_KEY = "control-horas-auth";

const browserStorage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      console.warn("No se pudo leer localStorage", error);
      return null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.warn("No se pudo escribir localStorage", error);
    }
  },
  removeItem(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn("No se pudo limpiar localStorage", error);
    }
  }
};

function resolveApiBaseUrl() {
  return `${window.location.origin}/api`;
}

const API = resolveApiBaseUrl();

const client = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    storage: browserStorage
  }
});

function notify(message, type = "error") {
  const appContainer = document.getElementById("app");
  const appVisible =
    appContainer &&
    appContainer.style.display !== "none" &&
    !appContainer.hidden;

  if (typeof window.showToast === "function" && appVisible) {
    window.showToast(message, type);
    return;
  }

  console[type === "error" ? "error" : "log"]("[control-horas][auth]", message);
  alert(message);
}

function setAuthVisibility(isAuthenticated) {
  const authContainer = document.getElementById("auth-container");
  const appContainer = document.getElementById("app");

  if (authContainer) {
    authContainer.style.display = isAuthenticated ? "none" : "block";
  }

  if (appContainer) {
    appContainer.style.display = isAuthenticated ? "block" : "none";
  }
}

function setAuthView(view) {
  const loginView = document.getElementById("loginView");
  const requestView = document.getElementById("requestView");
  const showLoginViewBtn = document.getElementById("showLoginViewBtn");
  const showRequestViewBtn = document.getElementById("showRequestViewBtn");

  const isLoginView = view !== "request";

  if (loginView) {
    loginView.classList.toggle("active", isLoginView);
    loginView.hidden = !isLoginView;
  }

  if (requestView) {
    requestView.classList.toggle("active", !isLoginView);
    requestView.hidden = isLoginView;
  }

  if (showLoginViewBtn) {
    showLoginViewBtn.classList.toggle("active", isLoginView);
    showLoginViewBtn.setAttribute("aria-pressed", String(isLoginView));
  }

  if (showRequestViewBtn) {
    showRequestViewBtn.classList.toggle("active", !isLoginView);
    showRequestViewBtn.setAttribute("aria-pressed", String(!isLoginView));
  }
}

function getStoredEmail() {
  return browserStorage.getItem(LAST_EMAIL_STORAGE_KEY) || "";
}

function storeEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  browserStorage.setItem(LAST_EMAIL_STORAGE_KEY, normalizedEmail);
}

async function authApiFetch(path, options = {}) {
  const {
    method = "GET",
    body,
    query,
    errorMessage = "No se pudo completar la solicitud"
  } = options;

  const url = new URL(`${API}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const requestOptions = { method, headers: {} };
  if (body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url.toString(), requestOptions);
  } catch (error) {
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error || errorMessage);
  }

  return data;
}

async function getApprovalStatus(userId) {
  return authApiFetch("/auth/approval-status", {
    query: { user_id: userId },
    errorMessage: "No se pudo verificar el estado de aprobacion"
  });
}

async function requestAccess({ email, password, phone, institution, message }) {
  return authApiFetch("/auth/register-request", {
    method: "POST",
    body: {
      email,
      password,
      phone,
      institution,
      message
    },
    errorMessage: "No se pudo enviar la solicitud de acceso"
  });
}

async function enforceApprovedAccess(user) {
  if (!user?.id) return true;

  try {
    const approval = await getApprovalStatus(user.id);
    if (approval?.approved) {
      return true;
    }

    await client.auth.signOut();
    setAuthVisibility(false);
    notify(approval?.message || "Tu cuenta está pendiente de aprobación por el administrador.", "error");
    return false;
  } catch (error) {
    console.error("No se pudo verificar la aprobacion del usuario", error);
    return true;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const authForm = document.getElementById("authForm");
  const requestAccessForm = document.getElementById("requestAccessForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const requestEmailInput = document.getElementById("requestEmail");
  const requestPasswordInput = document.getElementById("requestPassword");
  const requestPasswordConfirmInput = document.getElementById("requestPasswordConfirm");
  const showLoginViewBtn = document.getElementById("showLoginViewBtn");
  const showRequestViewBtn = document.getElementById("showRequestViewBtn");

  if (!emailInput || !passwordInput) return;

  if (requestEmailInput && requestPasswordInput && requestPasswordConfirmInput) {
    setAuthView("login");
  }

  const storedEmail = getStoredEmail();
  if (storedEmail && !emailInput.value) {
    emailInput.value = storedEmail;
  }
  if (storedEmail && requestEmailInput && !requestEmailInput.value) {
    requestEmailInput.value = storedEmail;
  }

  const handleEnterLogin = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      login();
    }
  };

  if (authForm) {
    authForm.addEventListener("submit", (e) => {
      e.preventDefault();
      login();
    });
  }

  if (requestAccessForm && requestEmailInput && requestPasswordInput && requestPasswordConfirmInput) {
    requestAccessForm.addEventListener("submit", (e) => {
      e.preventDefault();
      register();
    });
  }

  if (showLoginViewBtn) {
    showLoginViewBtn.addEventListener("click", () => setAuthView("login"));
  }

  if (showRequestViewBtn) {
    showRequestViewBtn.addEventListener("click", () => setAuthView("request"));
  }

  emailInput.addEventListener("change", () => storeEmail(emailInput.value));
  emailInput.addEventListener("blur", () => storeEmail(emailInput.value));
  if (requestEmailInput) {
    requestEmailInput.addEventListener("change", () => storeEmail(requestEmailInput.value));
    requestEmailInput.addEventListener("blur", () => storeEmail(requestEmailInput.value));
  }
  emailInput.addEventListener("keydown", handleEnterLogin);
  passwordInput.addEventListener("keydown", handleEnterLogin);

  client.auth.onAuthStateChange((event, session) => {
    const isAuthenticated = Boolean(session);
    setAuthVisibility(isAuthenticated);

    if (event === "SIGNED_IN" && session?.user?.email) {
      storeEmail(session.user.email);
    }
  });
});

// INICIALIZAR
async function initUser() {
  const { data: { session } } = await client.auth.getSession();
  if (session?.user?.email) {
    storeEmail(session.user.email);
  }

  if (session?.user) {
    const hasAccess = await enforceApprovedAccess(session.user);
    if (!hasAccess) {
      return null;
    }
  }

  setAuthVisibility(Boolean(session));
  return session;
}

// LOGIN
async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email) {
    notify("Ingresá tu email", "error");
    return;
  }

  if (!password) {
    notify("Ingresá tu contraseña", "error");
    return;
  }

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error("[control-horas][auth] signInWithPassword error", error);
    notify(error.message, "error");
  } else {
    const hasAccess = await enforceApprovedAccess(data.user);
    if (!hasAccess) {
      return;
    }

    storeEmail(data.user?.email || email);
    location.reload();
  }
}

// REGISTER
async function register() {
  const email = document.getElementById("requestEmail").value.trim();
  const password = document.getElementById("requestPassword").value;
  const passwordConfirm = document.getElementById("requestPasswordConfirm").value;
  const phone = document.getElementById("requestPhone")?.value.trim() || "";
  const institution = document.getElementById("requestInstitution")?.value.trim() || "";
  const message = document.getElementById("requestMessage")?.value.trim() || "";

  if (!email) {
    notify("Ingresá un email válido", "error");
    return;
  }

  if (!password || password.length < 6) {
    notify("La contraseña debe tener al menos 6 caracteres", "error");
    return;
  }

  if (password !== passwordConfirm) {
    notify("La confirmación de contraseña no coincide", "error");
    return;
  }

  try {
    await requestAccess({
      email,
      password,
      phone,
      institution,
      message
    });
    storeEmail(email);
    const requestMessageField = document.getElementById("requestMessage");
    const requestPhoneField = document.getElementById("requestPhone");
    const requestInstitutionField = document.getElementById("requestInstitution");
    const requestEmailField = document.getElementById("requestEmail");
    const requestPasswordField = document.getElementById("requestPassword");
    const requestPasswordConfirmField = document.getElementById("requestPasswordConfirm");
    if (requestMessageField) requestMessageField.value = "";
    if (requestPhoneField) requestPhoneField.value = "";
    if (requestInstitutionField) requestInstitutionField.value = "";
    if (requestPasswordField) requestPasswordField.value = "";
    if (requestPasswordConfirmField) requestPasswordConfirmField.value = "";
    if (requestEmailField) requestEmailField.value = email;
    notify("Solicitud enviada. Cuando sea aprobada, vas a poder entrar con este mismo email y contraseña.", "success");
    setAuthView("login");
  } catch (error) {
    if (String(error.message || "").includes("envio de solicitudes de acceso")) {
      notify("El boton funciona, pero el servidor todavia no tiene configurado el envio de mails. Falta completar SMTP_PASS en el backend.", "error");
      return;
    }

    notify(error.message, "error");
  }
}

// LOGOUT
async function logout() {
  await client.auth.signOut();
  location.reload();
}

window.client = client;
window.initUser = initUser;
window.logout = logout;
window.register = register;
})();
