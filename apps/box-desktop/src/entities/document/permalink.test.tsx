import { it, expect, vi } from "vitest";
import { documentProperty } from "@box/editor";
import { documentLink, permalinkFromLink, newPermalink, resolvePermalink, withDocumentPermalink } from "./permalink";

it("round trips Unicode and reserved permalink characters and rejects unrelated URLs", () => {
  const value = "/notes/한글 ?#&";
  expect(permalinkFromLink(documentLink(value))).toBe(value);
  for (const url of ["https://example.com", "boxmd://document?permalink=", "boxmd://document?permalink=a&permalink=b", "boxmd://document/path?permalink=a"])
    expect(() => permalinkFromLink(url)).toThrow();
});
it("creates a stable identifier without replacing an existing one or malformed YAML", () => {
  const initial = withDocumentPermalink("# 원문\n");
  expect(documentProperty(initial, "permalink")).toMatch(/^[0-9]{12}-[a-f0-9]{8}$/);
  expect(withDocumentPermalink(initial)).toBe(initial);
  const broken = "---\nkey: [\n---\nbody";
  expect(withDocumentPermalink(broken)).toBe(broken);
  const legacy = "---\npermalink: 7aa6aa2a-2fc3-4a2f-a127-418a09a80a2f\n---\nlegacy";
  expect(withDocumentPermalink(legacy)).toBe(legacy);
});
it("uses local timestamp components and four cryptographic bytes and reports random failures", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 13, 0, 1, 2));
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (!(array instanceof Uint8Array)) throw new Error("unexpected array");
    expect(array.length).toBe(4); array.set([0x00, 0x01, 0xaf, 0xff]); return array;
  });
  try {
    expect(newPermalink()).toBe("261013000102-0001afff");
    random.mockImplementation(() => { throw new Error("random unavailable"); });
    expect(() => withDocumentPermalink("body")).toThrow("random unavailable");
  } finally { random.mockRestore(); vi.useRealTimers(); }
});
it("resolves a renamed file and refuses duplicates and missing targets", async () => {
  const files = [{ path: "/workspace/renamed.md", name: "renamed.md", relativePath: "renamed.md" }];
  const read = async (path: string) => ({ path, revision: "1", content: "---\npermalink: stable\n---\nbody" });
  expect(await resolvePermalink(files, "stable", read)).toBe(files[0].path);
  await expect(resolvePermalink([...files, { ...files[0], path: "/workspace/copy.md" }], "stable", read)).rejects.toThrow("여러 개");
  await expect(resolvePermalink(files, "missing", read)).rejects.toThrow("찾지 못했습니다");
});
