import { isMap, parseDocument, Document } from "yaml";

function envelope(markdown: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(markdown);
  if (!opening) return null;
  const rest = markdown.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) throw new Error("YAML front matter의 닫는 구분자가 없습니다. 원문을 확인해주세요.");
  return { opening: opening[0], raw: rest.slice(0, closing.index), suffix: rest.slice(closing.index) };
}

function yaml(raw: string) {
  const doc = parseDocument(raw, { uniqueKeys: true, schema: "core" });
  if (doc.errors.length) throw new Error("YAML front matter 오류: " + doc.errors[0].message);
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error("YAML front matter는 속성 목록이어야 합니다.");
  return doc;
}

export function documentProperty(markdown: string, key: string): string {
  const parts = envelope(markdown);
  if (!parts) return "";
  const value = yaml(parts.raw).get(key);
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${key} 속성은 문자열이어야 합니다.`);
  return value;
}

export function setDocumentProperty(markdown: string, key: string, value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("유효하지 않은 속성 이름입니다.");
  if (/[\r\n]/.test(value)) throw new Error("속성은 한 줄로 입력해주세요.");
  const parts = envelope(markdown);
  const doc = parts ? yaml(parts.raw) : new Document({});
  if (value.length) doc.set(key, value); else doc.delete(key);
  if (parts) {
    const newline = parts.opening.endsWith("\r\n") ? "\r\n" : "\n";
    return parts.opening + doc.toString({ defaultStringType: "QUOTE_DOUBLE" }).replace(/\n/g, newline) + parts.suffix;
  }
  if (!value.length) return markdown;
  const bom = markdown.startsWith("\uFEFF") ? "\uFEFF" : "";
  return bom + "---\n" + doc.toString({ defaultStringType: "QUOTE_DOUBLE" }) + "---\n" + markdown.slice(bom.length);
}
