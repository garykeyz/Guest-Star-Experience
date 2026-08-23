const button = document.querySelector("#googleButton");
const status = document.querySelector("#googleStatus");

function message(value, error = false) {
  status.textContent = value;
  status.classList.toggle("error", error);
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.code || "Google Sign-In could not be completed.");
  }
  return data;
}

function loadGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("Google Sign-In could not be loaded."));
    document.head.appendChild(script);
  });
}

async function finishGoogleLogin(response) {
  if (!response?.credential) return;
  button.setAttribute("aria-busy", "true");
  message("Validando la cuenta y conectando Guest Star Bridge…");
  try {
    const data = await jsonRequest("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential, rememberLogin: true })
    });
    const name = String(data.user?.displayName || data.user?.email || "");
    button.replaceChildren();
    message(`Listo${name ? `, ${name}` : ""}. Guest Star Bridge ya inició sesión.`);
    document.title = "Guest Star Bridge · Conectado";
  } catch (error) {
    message(error instanceof Error ? error.message : String(error), true);
    button.removeAttribute("aria-busy");
  }
}

try {
  const [{ googleClientId }, google] = await Promise.all([
    jsonRequest("/api/auth/google-config"),
    loadGoogleIdentity()
  ]);
  if (!googleClientId || !google?.accounts?.id) throw new Error("Google Sign-In is not configured yet.");
  google.accounts.id.initialize({
    client_id: googleClientId,
    callback: finishGoogleLogin,
    auto_select: false,
    cancel_on_tap_outside: true
  });
  google.accounts.id.renderButton(button, {
    type: "standard",
    theme: "filled_black",
    size: "large",
    shape: "pill",
    text: "continue_with",
    width: 300
  });
  message("Selecciona la cuenta Google registrada en Guest Star.");
} catch (error) {
  message(error instanceof Error ? error.message : String(error), true);
}
