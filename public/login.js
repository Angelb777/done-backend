// public/login.js
document.addEventListener("DOMContentLoaded", () => {
  const { login, register, me, api, getToken } = window.DONE_API;

  const msg = document.getElementById("msg");
  const btn = document.getElementById("btn");
  const emailEl = document.getElementById("email");
  const passEl = document.getElementById("password");
  const togglePass = document.getElementById("togglePass");
  const forgot = document.getElementById("forgot");
  const forgotRow = document.getElementById("forgotRow");

  const nameField = document.getElementById("nameField");
  const nameEl = document.getElementById("name");

  const title = document.getElementById("title");
  const hint = document.getElementById("hint");
  const toggleMode = document.getElementById("toggleMode");

  let isLogin = true;

  // ✅ Si ya hay token, entra directo
  if (getToken()) {
    location.replace("/app");
    return;
  }

  // Quita autofill raro
  setTimeout(() => { emailEl.value = ""; passEl.value = ""; if (nameEl) nameEl.value = ""; }, 0);

  function setMessage(text, kind){
    msg.textContent = text || "";
    msg.className = "msg" + (kind ? (" " + kind) : "");
  }

  function setMode(nextIsLogin){
    isLogin = nextIsLogin;

    if (isLogin){
      title.textContent = "Acceder";
      hint.textContent = "Usa tu email y contraseña. Si eres admin, verás el panel automáticamente.";
      btn.textContent = "Entrar";
      toggleMode.textContent = "No tengo cuenta";
      nameField.style.display = "none";
      forgotRow.style.display = "flex";
    } else {
      title.textContent = "Crear cuenta";
      hint.textContent = "Crea tu cuenta para empezar a usar DONE.";
      btn.textContent = "Crear cuenta";
      toggleMode.textContent = "Ya tengo cuenta";
      nameField.style.display = "grid";
      forgotRow.style.display = "none";
    }

    setMessage("", "");
  }

  setMode(true);

  toggleMode.addEventListener("click", (e) => {
    e.preventDefault();
    setMode(!isLogin);
  });

  togglePass?.addEventListener("click", () => {
    const isPass = passEl.type === "password";
    passEl.type = isPass ? "text" : "password";
    togglePass.textContent = isPass ? "Ocultar" : "Ver";
    passEl.focus();
  });

  async function goNext(){
    const meRes = await me();
    const u = meRes.user || meRes;
    location.replace(u.role === "admin" ? "/admin-panel" : "/app");
  }

  async function submit(e){
    e?.preventDefault();

    setMessage("Procesando...", "");
    btn.disabled = true;

    try{
      const email = emailEl.value.trim();
      const password = passEl.value;

      if (!email || !password) throw new Error("Rellena email y contraseña.");

      if (isLogin){
        await login(email, password);
      } else {
        const name = (nameEl?.value || "").trim();
        if (!name) throw new Error("Pon tu nombre.");
        await register(name, email, password);

        // si tu /auth/register NO devuelve token, hacemos login automático:
        if (!getToken()) await login(email, password);
      }

      setMessage("OK ✔", "ok");
      await goNext();
    }catch(err){
      console.error(err);
      setMessage(err.message || "Error", "error");
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", submit);

  [nameEl, emailEl, passEl].filter(Boolean).forEach(el => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") submit(ev);
    });
  });

  forgot?.addEventListener("click", async (e) => {
    e.preventDefault();
    setMessage("Enviando...", "");
    try{
      await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: emailEl.value.trim() })
      });
      setMessage("Si existe, te llegará un email (MVP placeholder).", "ok");
    }catch(err){
      setMessage(err.message || "No se pudo enviar", "error");
    }
  });
});
