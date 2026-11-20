(() => {
  const map = L.map("map", { zoomControl: false }).setView([40.1, -3.7], 6);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const markers = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
  let webcams = [];
  let selectedCategory = "Todas";

  // Leaflet markercluster is optional; markers remain functional without it.
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function makePopup(cam) {
    const safeUrl = escapeHtml(cam.url);
    const description = cam.description
      ? `<div class="cam-description">${escapeHtml(cam.description)}</div>` : "";
    return `<div class="cam-popup">
      <h3>${escapeHtml(cam.name)}</h3>
      <div class="cam-meta">${escapeHtml(cam.province)} · ${escapeHtml(cam.category)}</div>
      <iframe src="${safeUrl}" title="Webcam: ${escapeHtml(cam.name)}"
        loading="lazy" referrerpolicy="no-referrer-when-downgrade"
        allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
      ${description}
      <a class="open-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">Abrir webcam en otra pestaña ↗</a>
    </div>`;
  }

  function renderMarkers() {
    markers.clearLayers();
    const term = document.getElementById("searchInput").value.trim().toLocaleLowerCase("es");
    const visible = webcams.filter(cam => {
      const matchesCategory = selectedCategory === "Todas" || cam.category === selectedCategory;
      const matchesTerm = !term || [cam.name, cam.province, cam.category].some(v =>
        String(v).toLocaleLowerCase("es").includes(term));
      return matchesCategory && matchesTerm;
    });

    visible.forEach(cam => {
      const icon = L.divIcon({
        className: "",
        html: '<div class="camera-pin"><span>◉</span></div>',
        iconSize: [34, 40],
        iconAnchor: [17, 38],
        popupAnchor: [0, -36]
      });
      L.marker([cam.latitude, cam.longitude], { icon })
        .bindPopup(makePopup(cam), { maxWidth: 330, minWidth: 250 })
        .addTo(markers);
    });
    markers.addTo(map);
    document.getElementById("cameraCount").textContent = visible.length;
  }

  async function loadWebcams() {
    try {
      const response = await fetch("/api/webcams");
      if (!response.ok) throw new Error("API error");
      webcams = await response.json();
      renderMarkers();
    } catch (error) {
      console.error(error);
      document.getElementById("mapError").classList.remove("hidden");
      document.getElementById("cameraCount").textContent = "0";
    }
  }

  document.getElementById("searchInput").addEventListener("input", renderMarkers);
  document.querySelectorAll(".category-chip").forEach(button => {
    button.addEventListener("click", () => {
      selectedCategory = button.dataset.category;
      document.querySelectorAll(".category-chip").forEach(b => b.classList.toggle("selected", b === button));
      renderMarkers();
    });
  });
  document.getElementById("clearFilters").addEventListener("click", () => {
    selectedCategory = "Todas";
    document.getElementById("searchInput").value = "";
    document.querySelectorAll(".category-chip").forEach(b => b.classList.toggle("selected", b.dataset.category === "Todas"));
    renderMarkers();
  });

  loadWebcams();
})();
