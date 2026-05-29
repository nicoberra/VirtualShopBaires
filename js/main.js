// Ocultar buscador al bajar, mostrar solo al llegar arriba del todo
window.addEventListener("scroll", () => {
  const strip = document.querySelector(".search-strip");
  if (!strip) return;
  if (window.scrollY > 10) {
    strip.classList.add("hidden");
  } else {
    strip.classList.remove("hidden");
  }
});

// Nav mobile toggle
document.addEventListener("DOMContentLoaded", () => {
  const hamburger = document.getElementById("hamburger");
  const navInner = document.getElementById("nav-inner");
  if (hamburger && navInner) {
    hamburger.addEventListener("click", () => {
      navInner.classList.toggle("open");
    });
  }

  // Cerrar nav al hacer click fuera
  document.addEventListener("click", (e) => {
    if (navInner && !navInner.contains(e.target) && !hamburger?.contains(e.target)) {
      navInner.classList.remove("open");
    }
  });

  // Marcar nav activo
  const links = document.querySelectorAll(".nav-inner a");
  links.forEach(link => {
    if (link.href === window.location.href) link.classList.add("active");
  });

  // Buscador
  const searchForm = document.getElementById("search-form");
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = document.getElementById("search-input").value.trim();
      if (q) window.location.href = `productos.html?buscar=${encodeURIComponent(q)}`;
    });
  }
});
