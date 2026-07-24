// Botón volver arriba
window.addEventListener("scroll", () => {
  const btn = document.getElementById("back-to-top");
  if (btn) btn.classList.toggle("visible", window.scrollY > 300);
});

// Hamburger → dropdown nav
document.addEventListener("DOMContentLoaded", () => {
  const hamburger = document.getElementById("hamburger");
  const dropdownNav = document.getElementById("header-dropdown-nav");

  if (hamburger && dropdownNav) {
    hamburger.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownNav.classList.toggle("open");
      hamburger.classList.toggle("open");
    });

    // Cerrar al hacer click fuera
    document.addEventListener("click", (e) => {
      if (!dropdownNav.contains(e.target) && !hamburger.contains(e.target)) {
        dropdownNav.classList.remove("open");
        hamburger.classList.remove("open");
      }
    });

    // Cerrar al elegir un ítem
    dropdownNav.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        dropdownNav.classList.remove("open");
        hamburger.classList.remove("open");
      });
    });
  }

  // Buscador
  const searchForm = document.getElementById("search-form");
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = document.getElementById("search-input").value.trim();
      if (q) window.location.href = `productos.html?buscar=${encodeURIComponent(q)}`;
    });
  }

  // Año dinámico copyright
  document.querySelectorAll(".copyright-year").forEach(el => {
    el.textContent = new Date().getFullYear();
  });
});
