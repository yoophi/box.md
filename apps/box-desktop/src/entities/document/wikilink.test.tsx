import { expect, it, vi } from "vitest";
import { resolveDocumentTargets, resolvePermalink } from "./permalink";
import type { DocumentSnapshot, WorkspaceSnapshot } from "@box/contracts";

function workspace(contents: Record<string, string>, truncated = false) {
  const snapshot: WorkspaceSnapshot = {
    path: "/workspace", truncated,
    documents: Object.keys(contents).map((path) => ({ path, name: path.split("/").pop()!, relativePath: path.slice("/workspace/".length) })),
  };
  const read = vi.fn(async (path: string): Promise<DocumentSnapshot> => ({ path, content: contents[path], revision: "1" }));
  return { snapshot, read };
}

it("uses metadata title, actual Markdown heading then filename, never a code example", async () => {
  const fixture = workspace({
    "/workspace/meta.md": "---\npermalink: meta\ntitle: 메타 제목\n---\n# 다른 제목",
    "/workspace/heading.md": "---\npermalink: heading\n---\n```md\n# 가짜 제목\n```\n\n# **실제** 제목 🌱",
    "/workspace/fallback.md": "---\npermalink: fallback\n---\n일반 본문",
  });
  const targets = await resolveDocumentTargets(fixture.snapshot, ["meta", "heading", "fallback"], fixture.read);
  expect([...targets.values()]).toEqual([
    { state: "resolved", title: "메타 제목" },
    { state: "resolved", title: "실제 제목 🌱" },
    { state: "resolved", title: "fallback.md" },
  ]);
});

it("resolves latest title and renamed path by stable permalink", async () => {
  const fixture = workspace({ "/workspace/new-name.md": "---\npermalink: stable\n---\n# 최신 제목" });
  expect((await resolveDocumentTargets(fixture.snapshot, ["stable"], fixture.read)).get("stable")).toEqual({ state: "resolved", title: "최신 제목" });
  expect(await resolvePermalink(fixture.snapshot.documents, "stable", fixture.read)).toBe("/workspace/new-name.md");
});

it("distinguishes duplicates, missing and malformed metadata and uses safe map keys", async () => {
  const fixture = workspace({
    "/workspace/one.md": "---\npermalink: duplicate\n---\n# 첫 문서",
    "/workspace/two.md": "---\npermalink: duplicate\n---\n# 다른 문서",
    "/workspace/broken.md": "---\npermalink: [\n---\n# 잘못된 YAML",
    "/workspace/proto.md": "---\npermalink: __proto__\n---\n# 예약된 이름",
  });
  const targets = await resolveDocumentTargets(fixture.snapshot, ["duplicate", "absent", "__proto__"], fixture.read);
  expect(targets.get("duplicate")!.state).toBe("duplicate");
  expect(targets.get("absent")!.state).toBe("missing");
  expect(targets.get("__proto__")).toEqual({ state: "resolved", title: "예약된 이름" });
  await expect(resolvePermalink(fixture.snapshot.documents, "duplicate", fixture.read)).rejects.toThrow("여러 개");
});

it("does not choose a possibly ambiguous document from a partial listing or failed read", async () => {
  const fixture = workspace({ "/workspace/one.md": "---\npermalink: stable\n---\n# 문서" }, true);
  expect((await resolveDocumentTargets(fixture.snapshot, ["stable"], fixture.read)).get("stable")!.state).toBe("error");
  expect(fixture.read).not.toHaveBeenCalled();
  fixture.snapshot.truncated = false;
  fixture.read.mockRejectedValue(new Error("read failed"));
  expect((await resolveDocumentTargets(fixture.snapshot, ["stable"], fixture.read)).get("stable")!.state).toBe("error");
});

it("reports an invalid title property instead of rendering an arbitrary object", async () => {
  const fixture = workspace({ "/workspace/one.md": "---\npermalink: stable\ntitle: [wrong]\n---\n# 문서" });
  expect((await resolveDocumentTargets(fixture.snapshot, ["stable"], fixture.read)).get("stable")!.state).toBe("error");
});
