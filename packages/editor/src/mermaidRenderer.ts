type Libraries = {
  mermaid: (typeof import("mermaid"))["default"];
  purify: (typeof import("dompurify"))["default"];
};
let librariesPromise: Promise<Libraries> | undefined;
let nextDiagram = 0;

function libraries() {
  return (librariesPromise ??= Promise.all([
    import("mermaid"),
    import("dompurify"),
  ])
    .then(([{ default: mermaid }, { default: purify }]) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        suppressErrorRendering: true,
        maxTextSize: 50_000,
        maxEdges: 500,
        secure: [
          "secure",
          "securityLevel",
          "startOnLoad",
          "maxTextSize",
          "maxEdges",
          "suppressErrorRendering",
          "htmlLabels",
          "flowchart",
          "dompurifyConfig",
          "themeCSS",
        ],
        flowchart: { htmlLabels: false },
        theme: "base",
        fontFamily: '"Avenir Next", "Apple SD Gothic Neo", sans-serif',
        themeVariables: {
          primaryColor: "#eae8de",
          primaryTextColor: "#223a34",
          primaryBorderColor: "#75856a",
          lineColor: "#75856a",
          secondaryColor: "#f7f5ec",
          tertiaryColor: "#d5dfcb",
        },
      });
      return { mermaid, purify };
    })
    .catch((error) => {
      librariesPromise = undefined;
      throw error;
    }));
}

/** Diagram input is parsed by Mermaid, then sanitized as SVG; callbacks are never bound. */
export async function renderMermaid(source: string): Promise<SVGSVGElement> {
  if (source.length > 50_000) throw new Error("diagramTooLarge");
  const { mermaid, purify } = await libraries();
  const id = `box-mermaid-${++nextDiagram}`;
  const container = document.createElement("div");
  container.dataset.mermaidMeasure = "";
  container.style.cssText =
    "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  document.body.append(container);
  try {
    const { svg } = await mermaid.render(id, source, container);
    const clean = purify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
    });
    const parsed = new DOMParser().parseFromString(clean, "image/svg+xml");
    const root = parsed.documentElement;
    if (root.localName !== "svg" || parsed.querySelector("parsererror"))
      throw new Error("invalidSvg");
    // A chart is a read-only block. Keep local definitions, remove navigations/resources.
    for (const element of [root, ...root.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        if (attribute.localName === "href" && !attribute.value.startsWith("#"))
          element.removeAttributeNode(attribute);
      }
    }
    return document.importNode(root, true) as unknown as SVGSVGElement;
  } finally {
    container.remove();
  }
}
