use local_mcp_server::rmcp::model::Tool;
use serde_json::{json, Value};
use std::sync::Arc;

pub(super) const NAMES: &[&str] = &[
    "list_documents",
    "read_document",
    "search_documents",
    "create_document",
    "duplicate_document",
    "update_document",
    "delete_document",
    "restore_document",
    "get_document_metadata",
    "update_document_metadata",
    "get_document_links",
];
fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn string() -> Value {
    json!({"type":"string"})
}
fn nonempty(max: usize) -> Value {
    json!({"type":"string","minLength":1,"maxLength":max})
}
fn array(items: Value) -> Value {
    json!({"type":"array","items":items})
}
fn reference() -> Value {
    json!({"oneOf":[object(json!({"path":nonempty(8192)}), &["path"]), object(json!({"permalink":nonempty(8192)}), &["permalink"])]})
}
fn descriptor(content: bool) -> Value {
    let mut properties =
        json!({"path":string(),"revision":string(),"permalink":string(),"summary":string()});
    if content {
        properties["content"] = string();
        properties["historyWarning"] = json!({"type":["string","null"]});
    }
    object(
        properties,
        if content {
            &["path", "revision", "content"]
        } else {
            &["path", "revision"]
        },
    )
}
fn metadata() -> Value {
    object(
        json!({"path":string(),"revision":string(),"metadata":{"type":"object"},"permalink":string(),"summary":string()}),
        &["path", "revision", "metadata"],
    )
}
fn input(name: &str) -> Value {
    let paging =
        json!({"cursor":nonempty(4096),"limit":{"type":"integer","minimum":1,"maximum":100}});
    let request = nonempty(256);
    let revision = nonempty(128);
    match name {
        "list_documents" => object(paging, &[]),
        "search_documents" => {
            let mut properties = paging;
            properties["query"] = nonempty(1024);
            object(properties, &["query"])
        }
        "read_document" | "get_document_metadata" | "get_document_links" => {
            object(json!({"document":reference()}), &["document"])
        }
        "create_document" => object(
            json!({"content":string(),"requestId":request}),
            &["content", "requestId"],
        ),
        "duplicate_document" | "update_document" => object(
            json!({"document":reference(),"content":string(),"expectedRevision":revision,"requestId":request}),
            if name == "update_document" {
                &["document", "content", "expectedRevision", "requestId"]
            } else {
                &["document", "expectedRevision", "requestId"]
            },
        ),
        "delete_document" => object(
            json!({"document":reference(),"expectedRevision":revision,"requestId":request}),
            &["document", "expectedRevision", "requestId"],
        ),
        "restore_document" => object(
            json!({"trashId":nonempty(36),"requestId":request}),
            &["trashId", "requestId"],
        ),
        "update_document_metadata" => object(
            json!({"document":reference(),"patch":{"type":"object"},"remove":array(nonempty(8192)),"expectedRevision":revision,"requestId":request}),
            &[
                "document",
                "patch",
                "remove",
                "expectedRevision",
                "requestId",
            ],
        ),
        _ => unreachable!(),
    }
}
fn output(name: &str) -> Value {
    let warnings = array(object(
        json!({"path":{"type":["string","null"]},"code":string()}),
        &["path", "code"],
    ));
    let page = |field: &str, items: Value| {
        let mut properties =
            json!({"nextCursor":string(),"warnings":warnings,"truncated":{"type":"boolean"}});
        properties[field] = array(items);
        object(properties, &[field, "warnings", "truncated"])
    };
    let data = match name {
        "get_document_links" => {
            let mut target = descriptor(false);
            target["properties"]["title"] = string();
            target["required"]
                .as_array_mut()
                .unwrap()
                .push(json!("title"));
            let token = object(
                json!({"permalink":string(),"alias":{"type":["string","null"]},"raw":string(),"byteStart":{"type":"integer","minimum":0},"byteEnd":{"type":"integer","minimum":0},"state":{"type":"string","enum":["resolved","missing","duplicate","error"]},"target":target}),
                &["permalink", "alias", "raw", "byteStart", "byteEnd", "state"],
            );
            object(
                json!({"document":descriptor(false),"links":array(token.clone()),"backlinks":array(object(json!({"document":descriptor(false),"links":array(token)}), &["document","links"])),"warnings":warnings,"truncated":{"type":"boolean"}}),
                &["document", "links", "backlinks", "warnings", "truncated"],
            )
        }
        "list_documents" => page("documents", descriptor(false)),
        "search_documents" => {
            let mut item = descriptor(false);
            item["properties"]["excerpts"] = array(string());
            item["required"]
                .as_array_mut()
                .unwrap()
                .push(json!("excerpts"));
            page("matches", item)
        }
        "get_document_metadata" => metadata(),
        "update_document_metadata" => object(
            json!({"document":descriptor(true),"metadata":metadata()}),
            &["document", "metadata"],
        ),
        "delete_document" => object(
            json!({"deleted":object(json!({"path":string(),"revision":string(),"permalink":string()}), &["path","revision"]),"trashId":string(),"historyWarning":{"type":["string","null"]}}),
            &["deleted", "trashId", "historyWarning"],
        ),
        _ => object(json!({"document":descriptor(true)}), &["document"]),
    };
    json!({"type":"object","oneOf":[
        object(json!({"ok":{"const":true},"data":data}), &["ok","data"]),
        object(json!({"ok":{"const":false},"error":object(json!({"code":string(),"message":string(),"currentRevision":string()}), &["code","message"])}), &["ok","error"])
    ]})
}
pub(super) fn tool(name: &str) -> Option<Tool> {
    if !NAMES.contains(&name) {
        return None;
    }
    let description = match name {
        "create_document" => "Create an ID-named Markdown document; the server chooses its permalink and filename.",
        "duplicate_document" => "Copy a document into a new ID-named file and append 사본 to its title; keep the original unchanged.",
        "delete_document" => "Move a revision-checked document into recoverable trash without deleting connections.",
        "restore_document" => "Restore a trashId without overwriting an existing document or duplicate permalink.",
        "update_document" => "Save Markdown with mandatory expectedRevision and scope-local retry requestId.",
        "update_document_metadata" => "Patch top-level frontmatter keys, preserving other metadata, comments and body bytes.",
        "get_document_metadata" => "Read frontmatter metadata by unique permalink or relative path.",
        "get_document_links" => "Read bounded body wikilink tokens, live resolution and incoming references; explicit connections remain unchanged.",
        "read_document" => "Read Markdown and its current revision by unique permalink or relative path.",
        "list_documents" => "List relative Markdown documents with bounded paging, warnings and truncation status.",
        _ => "Search body, summary and permalink using a case-insensitive literal query with bounded excerpts.",
    };
    let mut tool = Tool::new(
        name.to_owned(),
        description,
        Arc::new(input(name).as_object().unwrap().clone()),
    );
    tool.output_schema = Some(Arc::new(output(name).as_object().unwrap().clone()));
    Some(tool)
}

/// Evaluates the deliberately small keyword set emitted above. Fixed objects
/// reject extra fields; metadata objects intentionally allow user-defined keys.
/// serde and the application perform additional domain and size validation.
pub(super) fn valid(schema: &Value, value: &Value) -> bool {
    if let Some(constant) = schema.get("const") {
        if constant != value {
            return false;
        }
    }
    if let Some(choices) = schema["oneOf"].as_array() {
        if choices.iter().filter(|s| valid(s, value)).count() != 1 {
            return false;
        }
    }
    let matches = |kind: &str| match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "integer" => value.as_u64().is_some(),
        "null" => value.is_null(),
        _ => false,
    };
    if let Some(kind) = schema["type"].as_str() {
        if !matches(kind) {
            return false;
        }
    }
    if let Some(kinds) = schema["type"].as_array() {
        if !kinds.iter().any(|k| k.as_str().is_some_and(matches)) {
            return false;
        }
    }
    if let Some(text) = value.as_str() {
        let length = text.chars().count() as u64;
        if schema["minLength"].as_u64().is_some_and(|min| length < min)
            || schema["maxLength"].as_u64().is_some_and(|max| length > max)
        {
            return false;
        }
    }
    if let Some(number) = value.as_u64() {
        if schema["minimum"].as_u64().is_some_and(|min| number < min)
            || schema["maximum"].as_u64().is_some_and(|max| number > max)
        {
            return false;
        }
    }
    if let Some(map) = value.as_object() {
        if schema["required"]
            .as_array()
            .is_some_and(|keys| keys.iter().any(|k| !map.contains_key(k.as_str().unwrap())))
        {
            return false;
        }
        if let Some(properties) = schema["properties"].as_object() {
            for (key, child) in map {
                match properties.get(key) {
                    Some(rule) if !valid(rule, child) => return false,
                    None if schema["additionalProperties"] == false => return false,
                    _ => (),
                }
            }
        }
    }
    if let Some(items) = value.as_array() {
        if let Some(rule) = schema.get("items") {
            if !items.iter().all(|v| valid(rule, v)) {
                return false;
            }
        }
    }
    true
}
