use box_document_store::{
    document_metadata, document_property, patch_document_metadata, set_document_property,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    source: String,
    key: Option<String>,
    value: Option<String>,
    #[serde(default)]
    read_only: bool,
    #[serde(default)]
    error: bool,
    #[serde(default)]
    reads: BTreeMap<String, String>,
    #[serde(default)]
    read_errors: Vec<String>,
    #[serde(default)]
    metadata: Map<String, Value>,
    #[serde(default)]
    comments: Vec<String>,
    suffix: Option<String>,
    exact: Option<String>,
}
fn patch(
    source: &str,
    changes: Value,
    remove: &[&str],
) -> Result<String, box_document_store::DocumentError> {
    patch_document_metadata(
        source,
        changes.as_object().unwrap(),
        &remove.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
    )
}

#[test]
fn reads_and_edits_the_same_fixtures_as_the_existing_typescript_adapter() {
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!(
        "../../../packages/editor/fixtures/frontmatter.json"
    ))
    .unwrap();
    assert_eq!(fixtures.len(), 31);
    for fixture in fixtures {
        let saved = if fixture.read_only {
            fixture.source.clone()
        } else {
            let result = set_document_property(
                &fixture.source,
                fixture.key.as_deref().unwrap(),
                fixture.value.as_deref().unwrap(),
            );
            if fixture.error {
                assert!(result.is_err(), "{} unexpectedly accepted", fixture.name);
                continue;
            }
            result.unwrap_or_else(|e| panic!("{}: {e:?}", fixture.name))
        };
        for (key, expected) in fixture.reads {
            assert_eq!(
                document_property(&saved, &key).unwrap(),
                expected,
                "{}: {key}",
                fixture.name
            );
        }
        for key in fixture.read_errors {
            assert!(
                document_property(&saved, &key).is_err(),
                "{}: {key}",
                fixture.name
            );
        }
        if let Some(suffix) = fixture.suffix {
            assert!(
                saved.ends_with(&suffix),
                "{} suffix changed: {saved:?}",
                fixture.name
            );
        }
        if let Some(exact) = fixture.exact {
            assert_eq!(saved, exact, "{}", fixture.name);
        }
        for comment in fixture.comments {
            assert!(saved.contains(&comment), "{} comment lost", fixture.name);
        }
        if !fixture.metadata.is_empty() {
            let actual = document_metadata(&saved).unwrap();
            for (key, value) in fixture.metadata {
                assert_eq!(actual.get(&key), Some(&value), "{}: {key}", fixture.name);
            }
        }
    }
}

#[test]
fn patches_json_types_and_removes_keys_without_changing_unrelated_source() {
    let source = "\u{feff}--- \t\r\n# keep this\r\nsummary: old # keep inline\r\nunknown: { item: [ 1, { x: true } ] } # spacing\r\nremove: old\r\n...\r\n# Body 🌱  \r\n";
    let saved = patch(
        source,
        json!({"summary":"true", "new/tilde~key":{"array":[null,true,2,"123"]}}),
        &["remove"],
    )
    .unwrap();
    assert!(saved.starts_with("\u{feff}--- \t\r\n# keep this\r\n"));
    assert!(saved.contains("unknown: { item: [ 1, { x: true } ] } # spacing\r\n"));
    assert!(saved.contains("# keep inline\r\n"));
    assert!(saved.ends_with("...\r\n# Body 🌱  \r\n"));
    let meta = document_metadata(&saved).unwrap();
    assert_eq!(meta["summary"], "true");
    assert_eq!(meta["new/tilde~key"], json!({"array":[null,true,2,"123"]}));
    assert!(!meta.contains_key("remove"));
}

#[test]
fn unsupported_json_values_do_not_prevent_unrelated_source_preserving_edits() {
    for raw in [
        "custom: !vendor { x: 1 }",
        "custom: !vendor text",
        "custom: .nan",
        "custom: {1: numeric key}",
        "custom: {? [a, b]: complex key}",
        "custom: 9007199254740992",
    ] {
        let source = format!("---\n{raw}\nsummary: old\n---\nbody");
        assert!(document_metadata(&source).is_err(), "{raw}");
        let saved = set_document_property(&source, "summary", "new").unwrap();
        assert!(saved.contains(raw), "{raw}");
        assert_eq!(document_property(&saved, "summary").unwrap(), "new");
        assert!(document_metadata(&saved).is_err());
    }
}

#[test]
fn alias_values_are_read_but_anchor_owner_edits_that_break_dependencies_fail() {
    let source = "---\nsummary: &s old\ncopy: *s\nextra: &e {x: 1}\nother: *e\n---\nbody";
    assert!(document_property(source, "copy").is_err());
    assert_eq!(document_metadata(source).unwrap()["other"], json!({"x":1}));
    assert!(patch(source, json!({"summary":"new"}), &[]).is_err());
    assert!(patch(source, json!({}), &["extra"]).is_err());
    let saved = patch(source, json!({"copy":"independent"}), &[]).unwrap();
    assert_eq!(document_property(&saved, "summary").unwrap(), "old");
    assert_eq!(document_property(&saved, "copy").unwrap(), "independent");
    assert!(saved.contains("extra: &e {x: 1}\nother: *e"));
}

#[test]
fn invalid_yaml_duplicates_alias_cycles_and_directives_never_return_replacement() {
    for raw in [
        "extra: {1: a, 0x1: b}",
        "extra: {? [a, b]: x, ? [a, b]: y}",
        "summary: *missing",
        "extra: &x [*x]",
        "%YAML 1.2\n---\nsummary: old",
        "summary: \"unclosed",
        "extra: [a, b",
        "[a, b]",
        "null",
    ] {
        let source = format!("---\n{raw}\n---\nbody");
        assert!(document_metadata(&source).is_err(), "{raw}");
        assert!(
            set_document_property(&source, "summary", "replacement").is_err(),
            "{raw}"
        );
    }
    assert!(patch("---\na: old\n---\nbody", json!({"a":"new"}), &["a"]).is_err());
    assert!(patch("body", json!({"summary":null}), &[]).is_err());
    assert!(set_document_property("body", "bad key", "new").is_err());
}

#[test]
fn comment_only_and_flow_headers_support_add_remove_and_multiple_changes() {
    for source in [
        "---\n# comments\n---\nbody",
        "---\r\n# comments\r\n---\r\nbody",
        "---\n{a: old, summary: old}\n---\nbody",
    ] {
        let saved = patch(
            source,
            json!({"a":{"nested":[1,2]},"summary":"new", "__proto__":"ordinary"}),
            &["missing"],
        )
        .unwrap();
        let metadata = document_metadata(&saved).unwrap();
        assert_eq!(metadata["a"], json!({"nested":[1,2]}));
        assert_eq!(metadata["__proto__"], "ordinary");
        assert_eq!(metadata["summary"], "new");
        if source.contains("# comments") {
            assert!(saved.contains("# comments"));
        }
        let removed = patch(&saved, json!({}), &["a", "summary", "__proto__"]).unwrap();
        assert!(document_metadata(&removed).unwrap().is_empty());
        assert!(removed.ends_with("body"));
    }
}

#[test]
fn scalar_type_changes_are_applied_as_intended() {
    for (old, new) in [
        ("!!str old", json!(true)),
        ("!!int 12", json!("true")),
        ("!!bool true", json!(null)),
        ("\"old\"", json!(12)),
    ] {
        let source = format!("---\nextra: {old} # inline\n---\nbody");
        let saved = patch(&source, json!({"extra":new}), &[]).unwrap();
        assert_eq!(document_metadata(&saved).unwrap()["extra"], new);
        assert!(saved.contains("# inline"));
        assert!(saved.ends_with("---\nbody"));
    }
}

#[test]
fn literal_folded_quoted_and_plain_multiline_values_keep_comments_when_changed() {
    for raw in [
        "| # header note\n  first\n  # part of old value\n  second\n",
        ">- # header note\r\n  first\r\n  second\r\n",
        "\"old # string\" # header note\n",
        "'old # string' # header note\n",
        "plain\n  continuation # header note\n",
    ] {
        let source = format!(
            "---\nsummary: {raw}unknown: |\n  unclosed \" quote is valid block text\n---\nbody  \n"
        );
        let saved = set_document_property(&source, "summary", "new # text").unwrap();
        assert_eq!(document_property(&saved, "summary").unwrap(), "new # text");
        assert!(saved.contains("# header note"));
        assert!(saved.contains("unknown: |\n  unclosed \" quote is valid block text\n"));
        assert!(saved.ends_with("---\nbody  \n"));
    }
}

#[test]
fn missing_and_null_patch_values_and_input_errors_are_explicit() {
    assert_eq!(patch("body", json!({"summary":""}), &[]).unwrap(), "body");
    assert_eq!(document_metadata("body").unwrap(), Map::new());
    assert_eq!(patch("body", json!({}), &["missing"]).unwrap(), "body");
    assert!(patch("body", json!({"permalink":"two\r\nlines"}), &[]).is_err());
    assert!(patch("body", json!({}), &["same", "same"]).is_err());
    let saved = patch("body", json!({"normal":null,"summary":"  ","":true}), &[]).unwrap();
    assert_eq!(document_metadata(&saved).unwrap()["normal"], Value::Null);
    assert_eq!(document_metadata(&saved).unwrap()[""], true);
    assert_eq!(document_property(&saved, "summary").unwrap(), "  ");
}

#[test]
fn core_schema_types_and_unsafe_json_numbers_are_not_silently_coerced() {
    let source = "---\nleading: 0755\nyes: yes\noff: off\nnullValue: ~\nsigned: -12\nexponent: 1e2\nhex: 0x10\nforceString: ! true\nsummary: |\n  first\n  second\n---\nbody";
    let meta = document_metadata(source).unwrap();
    assert_eq!(meta["leading"], 755);
    assert_eq!(meta["yes"], "yes");
    assert_eq!(meta["off"], "off");
    assert_eq!(meta["nullValue"], Value::Null);
    assert_eq!(meta["signed"], -12);
    assert_eq!(meta["exponent"].as_f64(), Some(100.0));
    assert_eq!(meta["hex"], 16);
    assert_eq!(meta["forceString"], "true");
    assert_eq!(
        document_property(source, "summary").unwrap(),
        "first\nsecond\n"
    );
    for scalar in [
        "9007199254740992",
        "-9007199254740992",
        "18446744073709551616",
        "1e9999",
        ".inf",
        "-.Inf",
        ".NaN",
    ] {
        assert!(
            document_metadata(&format!("---\nx: {scalar}\n---\nbody")).is_err(),
            "{scalar}"
        );
    }
    for raw in [
        "x: !!int abc",
        "x: !!bool nope",
        "x: !!map text",
        "x: !!str [a,b]",
    ] {
        let source = format!("---\n{raw}\n---\nbody");
        assert!(document_metadata(&source).is_err(), "{raw}");
        let saved = set_document_property(&source, "summary", "new").unwrap();
        assert!(saved.contains(raw));
    }
    for raw in ["x: {1: a, 1.0: b}", "x: {true: a, True: b}"] {
        assert!(
            set_document_property(&format!("---\n{raw}\n---\nbody"), "summary", "new").is_err(),
            "{raw}"
        );
    }
}

#[test]
fn mixed_line_endings_and_escaped_json_keys_keep_untouched_source() {
    let source = "---\r\n# first\r\nsummary: old # inline\nunknown: [ a, {b: 2} ]\r\n\"quoted/key~\": old\n---\r\nbody 🌱  \n";
    let saved = patch(
        source,
        json!({"summary":"new","quoted/key~":[1,false]}),
        &[],
    )
    .unwrap();
    assert!(saved.contains("# first\r\n"));
    assert!(saved.contains("# inline\n"));
    assert!(saved.contains("unknown: [ a, {b: 2} ]\r\n"));
    assert!(saved.ends_with("---\r\nbody 🌱  \n"));
    assert_eq!(
        document_metadata(&saved).unwrap()["quoted/key~"],
        json!([1, false])
    );
}

#[test]
fn alias_expansion_and_deep_inputs_return_bounded_errors() {
    let nested = "[".repeat(130) + "0" + &"]".repeat(130);
    assert!(document_metadata(&format!("---\nx: {nested}\n---\nbody")).is_err());
    let mut graph = String::from("---\na0: &a0 [0,0]\n");
    for i in 1..20 {
        graph.push_str(&format!("a{i}: &a{i} [*a{}, *a{}]\n", i - 1, i - 1));
    }
    graph.push_str("---\nbody");
    assert!(document_metadata(&graph).is_err());
    assert!(set_document_property(&graph, "summary", "new").is_ok());
}

#[test]
fn replacing_alias_keeps_its_inline_comment_and_the_anchor() {
    let source = "---\nextra: &v {x: 1}\ncopy: *v # note\n---\nbody";
    let saved = patch(source, json!({"copy":false}), &[]).unwrap();
    assert!(saved.contains("extra: &v {x: 1}\n"));
    assert!(saved.contains("# note\n"));
    assert_eq!(document_metadata(&saved).unwrap()["copy"], false);
    assert_eq!(document_metadata(&saved).unwrap()["extra"], json!({"x":1}));
}

#[test]
fn string_keys_do_not_edit_numeric_or_complex_keys_with_similar_spelling() {
    for raw in [
        "1: original\n0755: original\n",
        "{1: original, 0755: original}",
    ] {
        let source = format!("---\n{raw}\n---\nbody");
        assert_eq!(document_property(&source, "1").unwrap(), "");
        let saved = patch(&source, json!({"1":{"x":1}, "0755":"new"}), &[]).unwrap();
        assert!(saved.contains("1: original"));
        assert!(saved.contains("0755: original"));
        assert_eq!(document_property(&saved, "0755").unwrap(), "new");
        let removed = patch(&saved, json!({}), &["1", "0755"]).unwrap();
        assert!(removed.contains("1: original"));
        assert!(removed.contains("0755: original"));
        assert!(removed.ends_with("---\nbody"));
    }
    let source = "---\n? [a, b]\n: original\nsummary: old\n---\nbody";
    let saved = set_document_property(source, "summary", "new").unwrap();
    assert!(saved.contains("? [a, b]\n: original\n"));
    assert_eq!(document_property(&saved, "summary").unwrap(), "new");
}

#[test]
fn flow_trailing_commas_and_inter_entry_comments_survive_removal() {
    let source = "---\n{a: 1, # keep\n b: [2, 3], c: 4,}\n---\nbody";
    let saved = patch(source, json!({"new":"value"}), &[]).unwrap();
    assert!(saved.contains("# keep\n"));
    let removed = patch(&saved, json!({}), &["b", "a", "c", "new"]).unwrap();
    assert!(removed.contains("# keep\n"));
    assert!(document_metadata(&removed).unwrap().is_empty());
    assert!(removed.ends_with("---\nbody"));
}

#[test]
fn indented_headers_keep_original_bytes_and_never_emit_the_parser_parent() {
    for raw in [
        "  summary: old\r\n  unknown: { x: 1 }\r\n",
        "# leading\n  summary: old\n  unknown: { x: 1 }\n",
        "  {summary: old, unknown: { x: 1 },}\n",
        "  __box_frontmatter__: keep\n",
    ] {
        let newline = if raw.contains("\r\n") { "\r\n" } else { "\n" };
        let source = format!("---{newline}{raw}---{newline}body");
        let saved = set_document_property(&source, "summary", "new").unwrap();
        assert_eq!(document_property(&saved, "summary").unwrap(), "new");
        if raw.contains("unknown:") {
            assert!(saved.contains("unknown: { x: 1 }"));
        }
        let metadata = document_metadata(&saved).unwrap();
        if raw.contains("__box_frontmatter__") {
            assert_eq!(metadata["__box_frontmatter__"], "keep");
        } else {
            assert!(!metadata.contains_key("__box_frontmatter__"));
        }
        let removed = patch_document_metadata(
            &saved,
            &Map::new(),
            &metadata.keys().cloned().collect::<Vec<_>>(),
        )
        .unwrap();
        assert!(document_metadata(&removed).unwrap().is_empty());
        assert!(!removed.contains("__box_frontmatter__"));
        assert!(removed.ends_with(&format!("---{newline}body")));
    }
    for raw in ["!custom key: a\nkey: b", "!!int abc: a\nabc: b"] {
        let source = format!("---\n{raw}\n---\nbody");
        assert!(set_document_property(&source, "summary", "new").is_err());
    }
}
