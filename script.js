const cursorMark = document.querySelector(".cursor-mark");
const hoverThumb = document.querySelector(".hover-thumb");
const hoverThumbFrame = document.querySelector(".hover-thumb-frame");
const hoverThumbMeta = document.querySelector(".hover-thumb-meta");
const hoverThumbText = document.querySelector(".hover-thumb-text");
const rows = document.querySelectorAll(".project-row");

const thumbTemplates = {
  atlas: document.querySelector("#thumb-atlas"),
  signal: document.querySelector("#thumb-signal"),
  northstar: document.querySelector("#thumb-northstar")
};

let mouseX = 0;
let mouseY = 0;
let thumbX = 0;
let thumbY = 0;
let currentRotation = "-1deg";
let activeRow = null;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const updateCursor = () => {
  if (!cursorMark || reduceMotion) return;
  cursorMark.style.transform = `translate3d(${mouseX - 9}px, ${mouseY - 9}px, 0)`;
};

const animateThumb = () => {
  if (!hoverThumb || reduceMotion) return;

  thumbX += (mouseX + 28 - thumbX) * 0.14;
  thumbY += (mouseY - 108 - thumbY) * 0.14;

  hoverThumb.style.transform = `translate3d(${thumbX}px, ${thumbY}px, 0) scale(${activeRow ? 1 : 0.96}) rotate(${currentRotation})`;
  requestAnimationFrame(animateThumb);
};

if (!reduceMotion) {
  requestAnimationFrame(animateThumb);
}

window.addEventListener("mousemove", (event) => {
  mouseX = event.clientX;
  mouseY = event.clientY;
  if (cursorMark) {
    cursorMark.style.opacity = "1";
  }
  updateCursor();
});

window.addEventListener("mouseleave", () => {
  if (cursorMark) {
    cursorMark.style.opacity = "0";
  }
});

rows.forEach((row, index) => {
  row.style.transitionDelay = `${index * 60}ms`;
  row.classList.add("is-visible");

  row.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("a")) {
      return;
    }

    const href = row.dataset.href;
    if (href) {
      window.location.href = href;
    }
  });

  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    const href = row.dataset.href;
    if (href) {
      window.location.href = href;
    }
  });

  row.addEventListener("mouseenter", () => {
    const templateKey = row.dataset.thumbSvg;
    const template = thumbTemplates[templateKey];

    rows.forEach((item) => item.classList.remove("is-hovered"));
    row.classList.add("is-hovered");
    activeRow = row;
    currentRotation = row.dataset.rotation || "-1deg";

    if (hoverThumb && hoverThumbFrame && template) {
      hoverThumbFrame.innerHTML = template.innerHTML;
      if (hoverThumbMeta) {
        hoverThumbMeta.textContent = row.dataset.thumbMeta || "";
      }
      if (hoverThumbText) {
        hoverThumbText.textContent = row.dataset.thumbCopy || "";
      }
      hoverThumb.classList.add("is-visible");
    }
  });

  row.addEventListener("mousemove", (event) => {
    mouseX = event.clientX + 4;
    mouseY = event.clientY + 2;
    updateCursor();
  });

  row.addEventListener("mouseleave", () => {
    row.classList.remove("is-hovered");
    activeRow = null;
    if (hoverThumb) {
      hoverThumb.classList.remove("is-visible");
    }
  });
});
