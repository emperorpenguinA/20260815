import { GLOSSARY_TERMS } from "./glossary-terms.js";

const TERMS_BY_ID = new Map(GLOSSARY_TERMS.map((term) => [term.id, term]));

let activePopover = null;

function closePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
}

function openPopover(button, term) {
  closePopover();

  const popover = document.createElement("div");
  popover.className = "tooltip-popover";
  popover.innerHTML = `
    <div>${term.short}</div>
    <a href="glossary.html#${term.id}">用語集で詳しく見る →</a>
  `;

  button.parentElement.appendChild(popover);
  popover.style.top = `${button.offsetTop + button.offsetHeight + 4}px`;
  popover.style.left = `${button.offsetLeft}px`;

  activePopover = popover;
}

export function initTooltips(root) {
  root.querySelectorAll(".tooltip-icon").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const term = TERMS_BY_ID.get(button.dataset.term);
      if (!term) return;
      if (activePopover && activePopover.parentElement === button.parentElement) {
        closePopover();
        return;
      }
      openPopover(button, term);
    });
  });
}

document.addEventListener("click", closePopover);
