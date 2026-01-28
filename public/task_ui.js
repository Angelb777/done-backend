// public/task_ui.js
(function () {
  const API = window.DONE_API;

  // -------------------------
  // Helpers básicos
  // -------------------------
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function absUrl(u) {
    const s = String(u || "").trim();
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    const path = s.startsWith("/") ? s : `/${s}`;
    return `${location.origin}${path}`;
  }

  function toLocalPath(url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      return u.pathname + (u.search || "");
    } catch {
      return url.startsWith("/") ? url : `/${url}`;
    }
  }

  function isImageMime(m) {
    return String(m || "").toLowerCase().startsWith("image/");
  }
  function guessIsImageByName(name) {
    const n = String(name || "").toLowerCase();
    return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".webp") || n.endsWith(".gif");
  }
  function isImageAtt(a) {
    const mime = String(a?.mime || "").toLowerCase();
    const url = String(a?.url || "").toLowerCase();
    const name = String(a?.name || "").toLowerCase();
    return (
      mime.startsWith("image/") ||
      /\.(png|jpg|jpeg|webp|gif)$/.test(url) ||
      /\.(png|jpg|jpeg|webp|gif)$/.test(name)
    );
  }

  function ddmmyy(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }

  function ddmmyyhhmm(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear() % 100).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  }

  function dueText(t) {
    if (!t?.dueDate) return "Sin fecha";
    return `Vence ${ddmmyy(t.dueDate)}`;
  }

  function assigneeName(t) {
    return (
      t?.assigneeName ||
      t?.assignee?.displayName ||
      t?.assignee?.name ||
      "-"
    );
  }

  function taskAttachments(t) {
    const raw = Array.isArray(t?.attachments)
      ? t.attachments
      : Array.isArray(t?.taskAttachments)
        ? t.taskAttachments
        : [];

    return raw
      .filter(a => a && a.url)
      .map(a => {
        const u = toLocalPath(a.url); // normalizado a ruta local
        return {
          url: u,
          name: a.name || "Archivo",
          mime: a.mime || "",
          size: a.size || 0,
          isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(u) || isImageAtt({ ...a, url: u }),
        };
      });
  }

  function openUrl(url) {
    window.open(absUrl(url), "_blank");
  }

  // -------------------------
  // Gallery (igual que ya usas)
  // -------------------------
  function renderAttachmentsGallery(atts) {
    const images = atts.filter(a => a.isImage);
    const files = atts.filter(a => !a.isImage);

    const wrap = document.createElement("div");
    wrap.className = "attwrap";

    if (images.length) {
      const show = images.slice(0, 4);
      const extra = images.length - show.length;

      if (show.length === 1) {
        const img = document.createElement("img");
        img.className = "imgone";
        img.src = toLocalPath(show[0].url);
        img.alt = show[0].name || "img";
        img.addEventListener("click", () => openUrl(show[0].url));
        wrap.appendChild(img);
      } else {
        const grid = document.createElement("div");
        grid.className = "imggrid";
        show.forEach((a, i) => {
          const cell = document.createElement("div");
          cell.className = "imgcell";
          const img = document.createElement("img");
          img.src = toLocalPath(a.url);
          img.alt = a.name || "img";
          cell.appendChild(img);

          if (i === 3 && extra > 0) {
            const over = document.createElement("div");
            over.className = "imgextra";
            over.textContent = `+${extra}`;
            cell.appendChild(over);
          }

          cell.addEventListener("click", () => openUrl(a.url));
          grid.appendChild(cell);
        });
        wrap.appendChild(grid);
      }
    }

    for (const f of files) {
      const row = document.createElement("div");
      row.className = "filetile";
      row.innerHTML = `
        <div class="fileicon">FILE</div>
        <div class="filemeta">
          <div class="filename">${escapeHtml(f.name || "Archivo")}</div>
        </div>
        <div class="fileopen">↗</div>
      `;
      row.addEventListener("click", () => openUrl(f.url));
      wrap.appendChild(row);
    }

    return wrap;
  }

  // -------------------------
  // Acciones backend
  // -------------------------
  async function toggleTask(taskId) {
    return API.api(`/tasks/${encodeURIComponent(taskId)}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
  }

  async function archiveTask(taskId) {
    return API.api(`/tasks/${encodeURIComponent(taskId)}/archive`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
  }

  // -------------------------
  // Comentarios/Subtareas modal (el mismo tuyo)
  // -------------------------
  async function openTaskCommentsModal({ taskId, title, taskAttachments = [] }) {
    if (!taskId) return;

    const modal = document.createElement("div");
    modal.className = "imgmodal";
    modal.innerHTML = `
      <div class="imgmodal-card">

        <div class="imgmodal-top">
          <div class="imgmodal-tabs">
            <button class="btn tiny" id="tabComments">Comentarios</button>
            <button class="btn tiny" id="tabSubtasks">Subtareas</button>
          </div>
          <button class="iconbtn" id="cClose">✕</button>
        </div>

        <div class="imgmodal-body">
          <div class="imgmodal-inner">

            <div class="imgmodal-title">${escapeHtml(title || "Tarea")}</div>

            ${taskAttachments.length ? `
              <div class="card" style="margin-bottom:12px;">
                <div style="font-weight:900;margin-bottom:10px;">Archivos de la tarea</div>
                <div id="cTaskAtts"></div>
              </div>
            ` : ""}

            <div class="imgmodal-scroll">
              <div id="cSubtasksPanel" class="card" style="display:none; margin-bottom:12px;">
                <div style="font-weight:900;margin-bottom:10px;">Subtareas</div>
                <div id="cSubtasksProg"></div>
                <div id="cSubtasksState" class="state"></div>
                <div id="cSubtasksList"></div>
              </div>

              <div id="cState" class="state" style="margin:6px 0;"></div>
              <div id="cList"></div>
              <div id="cPending" style="margin-top:10px;"></div>
            </div>

            <div class="imgmodal-compose">
              <button class="btn outline" id="cAttach" type="button">📎</button>
              <input id="cText" class="composer-input" placeholder="Escribe un comentario…" />
              <button class="btn outline" id="cPlus" type="button">＋</button>
              <button class="btn primary" id="cSend" type="button">Enviar</button>
            </div>

          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const cClose = modal.querySelector("#cClose");
    const cState = modal.querySelector("#cState");
    const cList = modal.querySelector("#cList");
    const cText = modal.querySelector("#cText");
    const cAttach = modal.querySelector("#cAttach");
    const cSend = modal.querySelector("#cSend");
    const cPending = modal.querySelector("#cPending");
    const cTaskAtts = modal.querySelector("#cTaskAtts");

    const tabComments = modal.querySelector("#tabComments");
    const tabSubtasks = modal.querySelector("#tabSubtasks");
    const cSubtasksPanel = modal.querySelector("#cSubtasksPanel");
    const cSubtasksState = modal.querySelector("#cSubtasksState");
    const cSubtasksList = modal.querySelector("#cSubtasksList");
    const cPlus = modal.querySelector("#cPlus");
    const cSubtasksProg = modal.querySelector("#cSubtasksProg");

    let tab = "comments";
    let subtasks = [];
    let subtasksLoading = false;

    let sending = false;
    let pending = [];
    let poll = null;

    const close = () => {
      try { clearInterval(poll); } catch (_) {}
      for (const a of pending) { try { URL.revokeObjectURL(a.url); } catch (_) {} }
      modal.remove();
    };

    cClose.addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

    if (cTaskAtts && taskAttachments.length) {
      cTaskAtts.appendChild(renderAttachmentsGallery(taskAttachments));
    }

    function setTab(name) {
      tab = name;
      const isSub = tab === "subtasks";

      if (cSubtasksPanel) cSubtasksPanel.style.display = isSub ? "" : "none";
      if (cList) cList.style.display = isSub ? "none" : "";
      if (cState) cState.style.display = isSub ? "none" : "";

      if (tabComments) tabComments.style.background = !isSub ? "#fff" : "transparent";
      if (tabSubtasks) tabSubtasks.style.background = isSub ? "#fff" : "transparent";

      if (cText) cText.placeholder = isSub ? "Nueva subtarea…" : (pending.length ? "Añade un texto (opcional)…" : "Escribe un comentario…");

      if (isSub && !subtasksLoading) loadSubtasks();
    }

    function renderSubtasks() {
      if (!cSubtasksList) return;

      if (cSubtasksProg) {
        const total = subtasks.length;
        const doneN = subtasks.filter(x => !!x.done).length;
        const percent = total ? Math.round((doneN / total) * 100) : 0;

        cSubtasksProg.innerHTML = total ? `
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:900;opacity:.7;margin-bottom:6px;">
            <div>Progreso</div>
            <div>${doneN}/${total} (${percent}%)</div>
          </div>
          <div style="height:10px;background:rgba(0,0,0,.08);border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${percent}%;background:rgba(22,129,54,.85);"></div>
          </div>
        ` : "";
      }

      cSubtasksList.innerHTML = "";

      if (!subtasks.length) {
        cSubtasksList.innerHTML = `<div class="state">Aún no hay subtareas.</div>`;
        return;
      }

      for (const s of subtasks) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "10px";
        row.style.alignItems = "center";
        row.style.padding = "8px 0";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!s.done;

        const txt = document.createElement("div");
        txt.style.flex = "1";
        txt.style.fontWeight = "700";
        txt.style.textDecoration = s.done ? "line-through" : "none";
        txt.textContent = s.text || "Subtarea";

        cb.addEventListener("change", async () => {
          const prev = s.done;
          s.done = cb.checked;
          txt.style.textDecoration = s.done ? "line-through" : "none";
          renderSubtasks();

          try {
            await API.toggleSubtask(taskId, s.id);
            await loadSubtasks();
          } catch (e) {
            s.done = prev;
            cb.checked = prev;
            txt.style.textDecoration = prev ? "line-through" : "none";
            renderSubtasks();
            alert("Error en subtarea: " + (e.message || String(e)));
          }
        });

        row.appendChild(cb);
        row.appendChild(txt);
        cSubtasksList.appendChild(row);
      }
    }

    async function loadSubtasks() {
      if (!cSubtasksState) return;
      subtasksLoading = true;
      cSubtasksState.textContent = "Cargando subtareas…";
      try {
        const raw = await API.getSubtasks(taskId);
        subtasks = Array.isArray(raw?.subtasks) ? raw.subtasks : (Array.isArray(raw) ? raw : []);
        cSubtasksState.textContent = "";
        renderSubtasks();
      } catch (e) {
        cSubtasksState.textContent = e.message || String(e);
      } finally {
        subtasksLoading = false;
      }
    }

    cPlus?.addEventListener("click", async () => {
      if (tab !== "subtasks") { setTab("subtasks"); return; }
      const text = (cText.value || "").trim();
      if (!text) return;

      try {
        cPlus.disabled = true;
        await API.createSubtask(taskId, text);
        cText.value = "";
        setTab("subtasks");
        await loadSubtasks();
      } catch (e) {
        alert("Error creando subtarea: " + (e.message || String(e)));
      } finally {
        cPlus.disabled = false;
      }
    });

    tabComments?.addEventListener("click", () => setTab("comments"));
    tabSubtasks?.addEventListener("click", () => setTab("subtasks"));
    setTab("comments");

    function renderPending() {
      if (!pending.length) {
        cPending.innerHTML = "";
        cText.placeholder = "Escribe un comentario…";
        return;
      }
      cText.placeholder = "Añade un texto (opcional)…";
      const show = pending.slice(0, 2);

      cPending.innerHTML =
        `<div style="font-weight:900;margin-bottom:6px;">Adjuntos</div>` +
        `<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">` +
        show.map((a, i) => `
          <div class="attchip" style="position:relative;">
            ${a.isImage ? `<img src="${a.url}" alt="">` : `<div class="attname">${escapeHtml(a.name)}</div>`}
            <button class="attx" data-i="${i}" style="position:absolute; top:-8px; right:-8px;">✕</button>
          </div>
        `).join("") +
        (pending.length > 2 ? `<div class="attmore">+${pending.length - 2} más</div>` : "") +
        `</div>`;

      cPending.querySelectorAll(".attx").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.i);
          const a = pending[idx];
          try { URL.revokeObjectURL(a.url); } catch (_) {}
          pending.splice(idx, 1);
          renderPending();
        });
      });
    }

    function hhmm(dateStr) {
      const d = new Date(dateStr || Date.now());
      const h = String(d.getHours()).padStart(2, "0");
      const m = String(d.getMinutes()).padStart(2, "0");
      return `${h}:${m}`;
    }

    function renderComment(c) {
      const sender = c.sender || {};
      const senderName = sender.displayName || sender.name || sender.email || c.senderName || "User";
      const text = String(c.text || "");
      const createdAt = c.createdAt || c.publishedAt || c.timestamp || new Date().toISOString();

      const atts = Array.isArray(c.attachments) ? c.attachments.map(a => ({
        url: toLocalPath(a.url),
        name: a.name || "Archivo",
        mime: a.mime || "",
        size: a.size || 0,
        isImage: isImageMime(a.mime) || guessIsImageByName(a.name) || guessIsImageByName(a.url),
      })) : [];

      const box = document.createElement("div");
      box.style.margin = "10px 0";
      box.style.padding = "12px";
      box.style.borderRadius = "14px";
      box.style.background = "rgba(0,0,0,.06)";

      box.innerHTML = `
        <div style="font-weight:900;font-size:12px;">${escapeHtml(senderName)}</div>
        ${atts.length ? `<div class="attwrap" style="margin-top:8px;"></div>` : ""}
        ${text.trim() ? `<div style="margin-top:8px;">${escapeHtml(text)}</div>` : ""}
        <div style="text-align:right; font-size:11px; opacity:.65; margin-top:8px;">${hhmm(createdAt)}</div>
      `;

      if (atts.length) {
        box.querySelector(".attwrap").appendChild(renderAttachmentsGallery(atts));
      }

      return box;
    }

    async function loadComments({ silent = false } = {}) {
      try {
        if (!silent) cState.textContent = "Cargando…";

        const raw = await API.getTaskComments(taskId, 50);
        const list = Array.isArray(raw) ? raw : (raw.comments || []);
        cList.innerHTML = "";

        if (!list.length) {
          cState.textContent = silent ? "" : "Aún no hay comentarios.";
        } else {
          cState.textContent = "";
          for (const c of list) cList.appendChild(renderComment(c));
          cList.scrollTop = cList.scrollHeight;
        }
      } catch (e) {
        cState.textContent = e.message || String(e);
      }
    }

    cAttach.addEventListener("click", () => {
      const tmp = document.createElement("input");
      tmp.type = "file";
      tmp.multiple = true;
      tmp.onchange = () => {
        const files = Array.from(tmp.files || []);
        for (const f of files) {
          const url = URL.createObjectURL(f);
          pending.push({
            file: f, url,
            name: f.name, size: f.size, mime: f.type,
            isImage: isImageMime(f.type) || guessIsImageByName(f.name),
          });
        }
        renderPending();
      };
      tmp.click();
    });

    cText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cSend.click();
      }
    });

    cSend.addEventListener("click", async () => {
      const text = cText.value.trim();
      if (sending) return;
      if (!text && !pending.length) return;

      sending = true;
      cSend.disabled = true;
      cAttach.disabled = true;
      cState.textContent = "Enviando…";

      try {
        const files = pending.map(p => p.file);
        cText.value = "";
        await API.postTaskComment({ taskId, text, files });

        for (const a of pending) { try { URL.revokeObjectURL(a.url); } catch (_) {} }
        pending = [];
        renderPending();

        await loadComments();
      } catch (e) {
        cState.textContent = e.message || String(e);
      } finally {
        sending = false;
        cSend.disabled = false;
        cAttach.disabled = false;
      }
    });

    await loadComments();
    poll = setInterval(() => loadComments({ silent: true }), 3500);
  }

  // -------------------------
  // renderTaskTile (idéntico al dashboard)
  //   + soporta opts.onRefresh() para chat
  // -------------------------
  function renderTaskTile(t, opts = {}) {
    const { showHistory = false, onRefresh = null } = opts;

    const done = String(t.status || "").toUpperCase() === "DONE";
    const canArchive = !showHistory && done;
    const canDelete = showHistory;

    const tile = document.createElement("div");
    tile.className = "tasktile";

    const color = String(t.color || "gray");
    tile.dataset.color = color;
    tile.classList.add(`task-${color}`);

    const left = document.createElement("div");
    left.className = "taskleft";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = done;
    cb.className = "taskcheck";
    cb.addEventListener("change", async () => {
      try {
        await toggleTask(t.id || t._id);
        if (typeof onRefresh === "function") await onRefresh();
      } catch (e) {
        alert("Error actualizando tarea: " + (e.message || String(e)));
        cb.checked = !cb.checked;
      }
    });

    left.appendChild(cb);

    const body = document.createElement("div");
    body.className = "taskbody";

    const top = document.createElement("div");
    top.className = "tasktop";

    // 👥 responsables (si existe tu endpoint y tu modal, aquí se deja igual “icono”)
    const btnAss = document.createElement("button");
    btnAss.className = "btn tiny";
    btnAss.innerHTML = "👥";
    btnAss.title = "Responsables";
    btnAss.addEventListener("click", (e) => {
      e.stopPropagation();
      // si no quieres responsables en chat aún, déjalo vacío
      alert("Responsables (pendiente de conectar en chat)");
    });
    top.appendChild(btnAss);

    const pill = document.createElement("div");
    pill.className = `pillstatus ${done ? "done" : "pending"}`;
    pill.textContent = done ? "Hecha" : "Pendiente";
    top.appendChild(pill);

    const pal = document.createElement("button");
    pal.className = "btn tiny";
    pal.innerHTML = "🎨";
    pal.title = "Color";
    pal.addEventListener("click", async (e) => {
      e.stopPropagation();
      const picked = prompt("Color (gray/yellow/red/blue/green/purple/orange/pink/teal):", color);
      if (!picked || picked === t.color) return;
      try {
        await API.updateTask(t.id || t._id, { color: picked });
        if (typeof onRefresh === "function") await onRefresh();
      } catch (err) {
        alert("Error cambiando color: " + (err.message || String(err)));
      }
    });
    top.appendChild(pal);

    if (canArchive) {
      const arch = document.createElement("button");
      arch.className = "btn tiny";
      arch.innerHTML = `🗄️ Historial`;
      arch.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await archiveTask(t.id || t._id);
          if (typeof onRefresh === "function") await onRefresh();
        } catch (err) {
          alert("Error enviando a historial: " + (err.message || String(err)));
        }
      });
      top.appendChild(arch);
    }

    if (canDelete) {
      const del = document.createElement("button");
      del.className = "btn tiny";
      del.style.border = "1px solid rgba(185,28,28,.35)";
      del.style.color = "#b91c1c";
      del.innerHTML = `🗑️ Borrar`;
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = confirm(`¿Borrar definitivamente "${t.title || "tarea"}"?`);
        if (!ok) return;
        try {
          await API.deleteTask(t.id || t._id);
          if (typeof onRefresh === "function") await onRefresh();
        } catch (err) {
          alert("Error borrando tarea: " + (err.message || String(err)));
        }
      });
      top.appendChild(del);
    }

    // 📅 editar fecha (simple, sin tu openModal global)
    const btnDue = document.createElement("button");
    btnDue.className = "btn tiny";
    btnDue.innerHTML = "📅";
    btnDue.title = "Editar fecha";
    btnDue.addEventListener("click", async (e) => {
      e.stopPropagation();

      const current = t.dueDate ? new Date(t.dueDate) : null;

      function toLocalInputValue(d) {
        if (!d) return "";
        const pad = (n) => String(n).padStart(2, "0");
        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const hh = pad(d.getHours());
        const mi = pad(d.getMinutes());
        return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
      }

      const v = prompt("Fecha (YYYY-MM-DDTHH:mm) o vacío para quitar:", toLocalInputValue(current));
      if (v === null) return;

      try {
        const iso = v.trim() ? new Date(v.trim()).toISOString() : null;
        await API.updateTask(t.id || t._id, { dueDate: iso });
        if (typeof onRefresh === "function") await onRefresh();
      } catch (err) {
        alert("Error guardando fecha: " + (err.message || String(err)));
      }
    });
    top.appendChild(btnDue);

    body.appendChild(top);

    const title = document.createElement("div");
    title.className = `tasktitle ${done ? "lined" : ""}`;
    title.textContent = t.title || t.text || "Tarea";
    body.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "tasksub";
    sub.textContent = `${dueText(t)} • Responsable: ${assigneeName(t)}`;
    body.appendChild(sub);

    if (done && t.completedAt) {
      const comp = document.createElement("div");
      comp.className = "taskcomp";
      comp.textContent = `Completada: ${ddmmyyhhmm(t.completedAt)}`;
      body.appendChild(comp);
    }

    // attachments (max 2)
    const atts = taskAttachments(t);
    if (atts.length) {
      const row = document.createElement("div");
      row.className = "taskatts";

      const show = atts.slice(0, 2);
      for (const a of show) {
        const u = toLocalPath(a.url);

        if (isImageAtt(a)) {
          const img = document.createElement("img");
          img.className = "attimg";
          img.src = u;
          img.alt = a.name || "img";
          img.addEventListener("click", (e) => { e.stopPropagation(); openUrl(u); });
          row.appendChild(img);
        } else {
          const chip = document.createElement("div");
          chip.className = "attfile";
          chip.innerHTML = `📎 <span>${escapeHtml(a.name || "Archivo")}</span>`;
          chip.addEventListener("click", (e) => { e.stopPropagation(); openUrl(u); });
          row.appendChild(chip);
        }
      }

      if (atts.length > 2) {
        const more = document.createElement("div");
        more.className = "attmore";
        more.textContent = `+${atts.length - 2} más`;
        row.appendChild(more);
      }

      body.appendChild(row);
    }

    tile.appendChild(left);
    tile.appendChild(body);

    tile.style.cursor = "pointer";
    tile.addEventListener("click", (e) => {
      if (
        e.target?.classList?.contains("taskcheck") ||
        e.target?.closest("button") ||
        e.target?.closest(".attimg") ||
        e.target?.closest(".attfile") ||
        e.target?.closest(".attmore")
      ) return;

      openTaskCommentsModal({
        taskId: String(t.id || t._id || ""),
        title: t.title || t.text || "Tarea",
        taskAttachments: taskAttachments(t),
      });
    });

    return tile;
  }

  // -------------------------
  // Export
  // -------------------------
  window.DONE_TASK_UI = {
    renderTaskTile,
    openTaskCommentsModal,
  };
})();
