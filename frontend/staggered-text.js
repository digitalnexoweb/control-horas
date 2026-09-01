/**
 * StaggeredText — revelado escalonado de texto (equivalente vanilla del
 * componente StaggeredText de React Bits, adaptado a este proyecto sin React).
 *
 * Uso:
 *   <p class="staggered-text" data-staggered-text>Control de Horas</p>
 *
 * Atributos opcionales:
 *   data-split="chars|words"   unidad de animación (default: chars)
 *   data-stagger="45"          ms entre unidades
 *   data-duration="620"        ms de cada unidad
 *   data-delay="120"           ms antes de arrancar
 *   data-from="bottom|top"     dirección de entrada
 *   data-shift="0.9"           distancia de entrada, en em
 *   data-replay="hover"        vuelve a animar al pasar el mouse
 */
(() => {
  const SELECTOR = "[data-staggered-text]";
  const num = (value, fallback) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  function build(el) {
    if (el.dataset.stInit === "true") return;

    const source = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!source) return;

    const split = el.dataset.split === "words" ? "words" : "chars";
    const stagger = num(el.dataset.stagger, 45);
    const duration = num(el.dataset.duration, 620);
    const delay = num(el.dataset.delay, 0);
    const from = el.dataset.from === "top" ? -1 : 1;
    const shift = num(el.dataset.shift, 0.9);

    el.setAttribute("aria-label", source);
    el.style.setProperty("--st-duration", `${duration}ms`);
    el.style.setProperty("--st-shift", `${from * shift}em`);
    el.textContent = "";

    const words = source.split(" ");
    let index = 0;

    words.forEach((word, wordIndex) => {
      const wordEl = document.createElement("span");
      wordEl.className = "staggered-text__word";
      wordEl.setAttribute("aria-hidden", "true");

      const units = split === "words" ? [word] : Array.from(word);
      units.forEach((unit) => {
        const unitEl = document.createElement("span");
        unitEl.className = "staggered-text__unit";
        unitEl.style.setProperty("--st-delay", `${delay + index * stagger}ms`);
        unitEl.textContent = unit;
        wordEl.appendChild(unitEl);
        index += 1;
      });

      el.appendChild(wordEl);

      if (wordIndex < words.length - 1) {
        const space = document.createElement("span");
        space.className = "staggered-text__space";
        space.setAttribute("aria-hidden", "true");
        space.textContent = " ";
        el.appendChild(space);
      }
    });

    el.dataset.stInit = "true";

    if (el.dataset.replay === "hover") {
      el.addEventListener("mouseenter", () => replay(el));
    }
  }

  function replay(el) {
    if (el.dataset.stInit !== "true") return;
    el.classList.remove("is-revealed");
    void el.offsetWidth; // fuerza reflow para reiniciar la animación
    el.classList.add("is-revealed");
  }

  function reveal(el) {
    build(el);
    requestAnimationFrame(() => el.classList.add("is-revealed"));
  }

  function init(root = document) {
    const nodes = Array.from(root.querySelectorAll(SELECTOR));
    if (!nodes.length) return;

    if (!("IntersectionObserver" in window)) {
      nodes.forEach(reveal);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.2 }
    );

    nodes.forEach((el) => {
      build(el);
      observer.observe(el);

      // Failsafe: si el observer nunca dispara (pestaña en segundo plano,
      // navegador sin render, etc.) el texto igual se muestra.
      window.setTimeout(() => {
        if (el.classList.contains("is-revealed")) return;
        reveal(el);
        observer.unobserve(el);
      }, 2500);
    });
  }

  window.StaggeredText = { init, replay };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init());
  } else {
    init();
  }
})();
