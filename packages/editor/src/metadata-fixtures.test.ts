import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { documentProperty, setDocumentProperty } from "./metadata";
import fixtureData from "../fixtures/frontmatter.json";

type Fixture = {
  name: string;
  source: string;
  key?: string;
  value?: string;
  readOnly?: boolean;
  error?: boolean;
  reads?: Partial<Record<string, string>>;
  readErrors?: string[];
  metadata?: Record<string, unknown>;
  comments?: string[];
  suffix?: string;
  exact?: string;
};

// The Rust adapter reads the same data file. Compare properties and preserved
// suffix bytes; existing YAML quoting is not a cross-parser output contract.
const fixtures: Fixture[] = fixtureData;

describe("shared frontmatter fixtures", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      if (fixture.error) {
        expect(() => setDocumentProperty(fixture.source, fixture.key!, fixture.value!)).toThrow();
        return;
      }
      const saved = fixture.readOnly
        ? fixture.source
        : setDocumentProperty(fixture.source, fixture.key!, fixture.value!);
      for (const [key, value] of Object.entries(fixture.reads ?? {})) {
        expect(documentProperty(saved, key)).toBe(value);
      }
      for (const key of fixture.readErrors ?? []) {
        expect(() => documentProperty(saved, key)).toThrow();
      }
      if (fixture.suffix !== undefined) expect(saved.endsWith(fixture.suffix)).toBe(true);
      if (fixture.exact !== undefined) expect(saved).toBe(fixture.exact);
      for (const comment of fixture.comments ?? []) expect(saved).toContain(comment);
      if (fixture.metadata) {
        const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(saved)!;
        const rest = saved.slice(opening[0].length);
        const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest)!;
        const values = parseDocument(rest.slice(0, closing.index), { schema: "core" }).toJS();
        for (const [key, value] of Object.entries(fixture.metadata)) expect(values[key]).toEqual(value);
      }
    });
  }
});
