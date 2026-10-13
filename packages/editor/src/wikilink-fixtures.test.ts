// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markdownToDocument } from "./index";
import fixtures from "../fixtures/wikilinks.json";
type Node = ReturnType<typeof markdownToDocument>;
function tokens(node: Node): unknown[] {
  return node.type === "wikilink" ? [node.attrs] : (node.content ?? []).flatMap(tokens);
}
describe("shared Rust/editor wikilink grammar", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => expect(tokens(markdownToDocument(fixture.body))).toEqual(fixture.links));
  }
});
