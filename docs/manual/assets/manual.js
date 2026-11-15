// Reading and navigation work without JavaScript. Enhance search and orientation.
const compactLayout = matchMedia("(max-width: 800px)");
const contents = document.querySelector(".sidebar details");
const updateContents = () => {
  contents.open = !compactLayout.matches;
};
updateContents();
const currentPage = document.querySelector('.sidebar a[aria-current="page"]');
function revealCurrentPage() {
  if (compactLayout.matches || !currentPage) return;
  const link = currentPage.getBoundingClientRect();
  const panel = contents.getBoundingClientRect();
  const searchHeight = contents
    .querySelector(".search")
    .getBoundingClientRect().height;
  if (link.bottom > panel.bottom || link.top < panel.top + searchHeight) {
    contents.scrollTop += link.top - panel.top - searchHeight - 20;
  }
}
revealCurrentPage();
document.fonts.ready.then(() => requestAnimationFrame(revealCurrentPage));
compactLayout.addEventListener("change", () => {
  updateContents();
  revealCurrentPage();
});
document.querySelector(".sidebar nav").addEventListener("click", (event) => {
  if (compactLayout.matches && event.target.closest("a")) contents.open = false;
});

const sectionLinks = [
  ...document.querySelectorAll('.sidebar .sections a[href^="#"]'),
];
let scrollPending = false;
function updateSection() {
  scrollPending = false;
  let active;
  for (const link of sectionLinks) {
    const heading = document.getElementById(
      decodeURIComponent(link.hash.slice(1)),
    );
    if (heading.getBoundingClientRect().top <= Math.max(100, innerHeight * 0.2))
      active = link;
    link.removeAttribute("aria-current");
  }
  active?.setAttribute("aria-current", "location");
}
addEventListener(
  "scroll",
  () => {
    if (!scrollPending) {
      scrollPending = true;
      requestAnimationFrame(updateSection);
    }
  },
  { passive: true },
);
updateSection();

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
      page.querySelectorAll(".heading-link").forEach((link) => link.remove());
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
    if (event.key === "Enter" && !results.hidden && compactLayout.matches) {
      contents.open = false;
      results.tabIndex = -1;
      results.focus({ preventScroll: true });
      results.scrollIntoView({ block: "start" });
    }
  });
}
