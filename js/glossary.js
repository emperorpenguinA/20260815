import { GLOSSARY_TERMS } from "./glossary-terms.js";

function groupByCategory(terms) {
  const groups = new Map();
  for (const term of terms) {
    if (!groups.has(term.category)) {
      groups.set(term.category, []);
    }
    groups.get(term.category).push(term);
  }
  return groups;
}

export function renderGlossary(container, terms) {
  const groups = groupByCategory(terms);
  container.innerHTML = "";

  for (const [category, items] of groups) {
    const section = document.createElement("section");
    section.className = "glossary-category";

    const heading = document.createElement("h2");
    heading.textContent = category;
    section.appendChild(heading);

    for (const item of items) {
      const entry = document.createElement("div");
      entry.className = "glossary-entry";
      entry.id = item.id;

      const term = document.createElement("h3");
      term.textContent = item.term;
      entry.appendChild(term);

      const description = document.createElement("p");
      description.textContent = item.description;
      entry.appendChild(description);

      section.appendChild(entry);
    }

    container.appendChild(section);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("glossary-list");
  renderGlossary(container, GLOSSARY_TERMS);
});
