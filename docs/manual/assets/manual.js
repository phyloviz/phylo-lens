// The manual is ordinary HTML. This script only adds optional full-text search.
if (matchMedia("(max-width: 800px)").matches) {
  document.querySelector(".sidebar details").open = false;
}

const input = document.querySelector("#manual-search");
const results = document.querySelector("#search-results");
const navigation = [...document.querySelectorAll("nav a[data-page]")];
let index;
let request = 0;

async function readPages() {
  return Promise.all(
    navigation.map(async (link) => {
      const url = new URL(link.href);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not read the manual.");
      const page = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const article = page.querySelector("article");
      return {
        title: link.textContent.trim(),
        url: url.href,
        text: article.textContent.replace(/\s+/g, " ").trim(),
      };
    }),
  );
}

if (location.protocol === "http:" || location.protocol === "https:") {
  input.disabled = false;
  input.addEventListener("input", async () => {
    const current = ++request;
    const query = input.value.trim().toLocaleLowerCase();
    results.replaceChildren();
    results.hidden = query.length < 2;
    if (results.hidden) return;
    const heading = document.createElement("h2");
    heading.textContent = "Search results";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Searching…";
    results.append(heading, status);
    try {
      index ??= readPages().catch((error) => {
        index = undefined;
        throw error;
      });
      const pages = await index;
      if (current !== request) return;
      const terms = query.split(/\s+/);
      const matches = pages.filter((page) =>
        terms.every((term) => page.text.toLocaleLowerCase().includes(term)),
      );
      status.textContent = `${matches.length} ${matches.length === 1 ? "page" : "pages"} found.`;
      const list = document.createElement("ul");
      for (const match of matches) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = match.url;
        link.textContent = match.title;
        const snippet = document.createElement("p");
        const start = Math.max(
          0,
          match.text.toLocaleLowerCase().indexOf(terms[0]) - 45,
        );
        snippet.textContent = `${start ? "…" : ""}${match.text.slice(start, start + 180)}…`;
        item.append(link, snippet);
        list.append(item);
      }
      results.append(list);
    } catch {
      if (current !== request) return;
      status.textContent =
        "Search is unavailable. Use the contents to browse the manual.";
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      ++request;
      input.value = "";
      results.hidden = true;
    }
  });
}
