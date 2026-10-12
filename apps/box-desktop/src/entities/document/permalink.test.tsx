import { it, expect } from "vitest";
import { documentProperty } from "@box/editor";
import { documentLink, permalinkFromLink, resolvePermalink, withDocumentPermalink } from "./permalink";

it("round trips Unicode and reserved permalink characters and rejects unrelated URLs", () => {
  const value = "/notes/한글 ?#&";
  expect(permalinkFromLink(documentLink(value))).toBe(value);
  for (const url of ["https://example.com", "boxmd://document?permalink=", "boxmd://document?permalink=a&permalink=b", "boxmd://document/path?permalink=a"])
    expect(() => permalinkFromLink(url)).toThrow();
});
it("creates a stable identifier without replacing an existing one or malformed YAML", () => {
  const initial = withDocumentPermalink("# 원문\n");
  expect(documentProperty(initial, "permalink")).toMatch(/^[a-f0-9-]{36}$/);
  expect(withDocumentPermalink(initial)).toBe(initial);
  const broken = "---\nkey: [\n---\nbody";
  expect(withDocumentPermalink(broken)).toBe(broken);
});
it("resolves a renamed file and refuses duplicates and missing targets", async () => {
  const files = [{ path: "/workspace/renamed.md", name: "renamed.md", relativePath: "renamed.md" }];
  const read = async (path: string) => ({ path, revision: "1", content: "---\npermalink: stable\n---\nbody" });
  expect(await resolvePermalink(files, "stable", read)).toBe(files[0].path);
  await expect(resolvePermalink([...files, { ...files[0], path: "/workspace/copy.md" }], "stable", read)).rejects.toThrow("여러 개");
  await expect(resolvePermalink(files, "missing", read)).rejects.toThrow("찾지 못했습니다");
});
