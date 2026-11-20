(() => {
  const loginView = document.getElementById("loginView");
  const dashboardView = document.getElementById("dashboardView");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const webcamForm = document.getElementById("webcamForm");
  const formMessage = document.getElementById("formMessage");
  const saveButton = document.getElementById("saveButton");
  let csrfToken = "";
  let allWebcams = [];
  let pickerMap;
  let pickerMarker;

  const $ = (name) => webcamForm.elements.namedItem(name);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Ha ocurrido un error.");
    return data;
  }

  function showDashboard(username) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    document.getElementById("adminName").textContent = username;
    setTimeout(() => pickerMap && pickerMap.invalidateSize(), 100);
    initializePickerMap();
    loadAdminWebcams();
  }

  function initializePickerMap() {
    if (pickerMap) return;
    pickerMap = L.map("pickerMap").setView([40.1, -3.7], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(pickerMap);
    pickerMap.on("click", event => {
      $("latitude").value = event.latlng.lat.toFixed(6);
      $("longitude").value = event.latlng.lng.toFixed(6);
      if (pickerMarker) pickerMarker.setLatLng(event.latlng);
      else pickerMarker = L.marker(event.latlng).addTo(pickerMap);
    });
  }

  async function checkSession() {
    try {
      const data = await api("/api/session");
      csrfToken = data.csrfToken;
      showDashboard(data.username);
    } catch {
      loginView.classList.remove("hidden");
      dashboardView.classList.add("hidden");
    }
  }

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    loginError.textContent = "";
    const form = new FormData(loginForm);
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") })
      });
      csrfToken = data.csrfToken;
      loginForm.reset();
      showDashboard(data.username);
    } catch (error) {
      loginError.textContent = error.message;
    }
  });

  document.getElementById("logoutButton").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
      csrfToken = "";
      loginView.classList.remove("hidden");
      dashboardView.classList.add("hidden");
    } catch (error) {
      alert(error.message);
    }
  });

  async function loadAdminWebcams() {
    try {
      allWebcams = await api("/api/admin/webcams");
      renderTable();
      document.getElementById("totalCount").textContent = allWebcams.length;
      document.getElementById("activeCount").textContent = allWebcams.filter(w => w.active).length;
      document.getElementById("inactiveCount").textContent = allWebcams.filter(w => !w.active).length;
    } catch (error) {
      formMessage.textContent = error.message;
    }
  }

  function renderTable() {
    const term = document.getElementById("tableSearch").value.toLocaleLowerCase("es");
    const rows = allWebcams.filter(w =>
      [w.name, w.province, w.category].some(v => String(v).toLocaleLowerCase("es").includes(term))
    );
    const tbody = document.getElementById("webcamRows");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No hay webcams que mostrar.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(w => `
      <tr>
        <td><strong>${escapeHtml(w.name)}</strong></td>
        <td>${escapeHtml(w.province)}</td>
        <td>${escapeHtml(w.category)}</td>
        <td><span class="status-pill ${w.active ? "active" : "inactive"}">${w.active ? "Publicada" : "Oculta"}</span></td>
        <td><div class="table-actions">
          <button type="button" data-edit="${w.id}">Editar</button>
          <button type="button" class="delete" data-delete="${w.id}">Eliminar</button>
        </div></td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-edit]").forEach(button =>
      button.addEventListener("click", () => editWebcam(Number(button.dataset.edit))));
    tbody.querySelectorAll("[data-delete]").forEach(button =>
      button.addEventListener("click", () => deleteWebcam(Number(button.dataset.delete))));
  }

  function resetForm() {
    webcamForm.reset();
    $("id").value = "";
    $("active").checked = true;
    document.getElementById("formTitle").textContent = "Añadir webcam";
    saveButton.innerHTML = 'Guardar webcam <span>→</span>';
    document.getElementById("cancelEdit").classList.add("hidden");
    if (pickerMarker) {
      pickerMap.removeLayer(pickerMarker);
      pickerMarker = null;
    }
    formMessage.textContent = "";
    formMessage.className = "form-message";
  }

  function editWebcam(id) {
    const w = allWebcams.find(item => item.id === id);
    if (!w) return;
    $("id").value = w.id;
    $("name").value = w.name;
    $("province").value = w.province;
    $("category").value = w.category;
    $("latitude").value = w.latitude;
    $("longitude").value = w.longitude;
    $("url").value = w.url;
    $("description").value = w.description || "";
    $("active").checked = w.active;
    document.getElementById("formTitle").textContent = "Editar webcam";
    saveButton.innerHTML = 'Guardar cambios <span>→</span>';
    document.getElementById("cancelEdit").classList.remove("hidden");
    const position = [w.latitude, w.longitude];
    pickerMap.setView(position, 10);
    if (pickerMarker) pickerMarker.setLatLng(position);
    else pickerMarker = L.marker(position).addTo(pickerMap);
    document.querySelector(".form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deleteWebcam(id) {
    const w = allWebcams.find(item => item.id === id);
    if (!w || !confirm(`¿Seguro que quieres eliminar "${w.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api(`/api/admin/webcams/${id}`, { method: "DELETE" });
      await loadAdminWebcams();
      if (Number($("id").value) === id) resetForm();
    } catch (error) {
      alert(error.message);
    }
  }

  webcamForm.addEventListener("submit", async event => {
    event.preventDefault();
    formMessage.textContent = "";
    const data = Object.fromEntries(new FormData(webcamForm).entries());
    data.active = $("active").checked;
    data.latitude = Number(data.latitude);
    data.longitude = Number(data.longitude);
    const id = data.id;
    delete data.id;
    saveButton.disabled = true;
    try {
      await api(id ? `/api/admin/webcams/${id}` : "/api/admin/webcams", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(data)
      });
      formMessage.textContent = id ? "Webcam actualizada correctamente." : "Webcam añadida correctamente.";
      formMessage.classList.add("success");
      resetForm();
      await loadAdminWebcams();
    } catch (error) {
      formMessage.textContent = error.message;
      formMessage.classList.remove("success");
    } finally {
      saveButton.disabled = false;
    }
  });

  document.getElementById("cancelEdit").addEventListener("click", resetForm);
  document.getElementById("tableSearch").addEventListener("input", renderTable);

  checkSession();
})();
