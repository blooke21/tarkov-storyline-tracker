// Renders the wiki walkthrough blocks (text, lists, items you need, screenshots)
// used for story chapters and for quests. Everything goes on the page through
// textContent/append (never as HTML), and screenshots are only linked from https.
function guideEl(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    node[key] = value;
  }
  node.append(...children);
  return node;
}

function isHttps(value) {
  return typeof value === "string" && value.startsWith("https://");
}

function renderGuideBlock(block) {
  if (block.kind === "text") {
    return guideEl("p", {}, block.text);
  }
  if (block.kind === "heading") {
    return guideEl("h5", {}, block.text);
  }
  if (block.kind === "list") {
    return guideEl("ul", {}, ...block.items.map((item) => guideEl("li", {}, item)));
  }
  if (block.kind === "items") {
    return guideEl(
      "div",
      { className: "guide-items" },
      guideEl("strong", {}, "You'll need:"),
      guideEl(
        "ul",
        {},
        ...block.items.map((item) =>
          guideEl("li", {}, `${item.name}${item.amount ? " ×" + item.amount : ""}${item.note ? " — " + item.note : ""}`)
        )
      )
    );
  }
  if (block.kind === "images") {
    const figures = block.images
      .filter((image) => isHttps(image.url) && isHttps(image.full))
      .map((image) => {
        const picture = guideEl("img", { src: image.url, alt: image.caption || "Screenshot from the wiki", loading: "lazy", referrerPolicy: "no-referrer" });
        const figure = guideEl(
          "figure",
          {},
          // No referrer: the wiki's image server answers a 404 placeholder to requests that come from 127.0.0.1.
          guideEl("a", { href: image.full, target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer", title: "Open the full-size screenshot" }, picture),
          image.caption ? guideEl("figcaption", {}, image.caption) : ""
        );
        picture.addEventListener("error", () => figure.remove());
        return figure;
      });
    return figures.length ? guideEl("div", { className: "guide-images" }, ...figures) : null;
  }
  return null;
}
