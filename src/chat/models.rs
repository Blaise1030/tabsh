//! Model list from ACP `configOptions` (`session/new` / `set_config_option`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ModelChoice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ModelConfig {
    /// ACP `configOptions` id (usually `"model"`).
    pub config_id: String,
    pub current: String,
    pub options: Vec<ModelChoice>,
}

/// Finds the model select option in an ACP `configOptions` array.
pub(crate) fn parse_model_config(config_options: &Value) -> Option<ModelConfig> {
    let list = config_options.as_array()?;
    let opt = list.iter().find(|o| is_model_option(o))?;
    let config_id = opt.get("id").and_then(Value::as_str)?.to_string();
    let current = opt
        .get("currentValue")
        .or_else(|| opt.get("value"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let options = opt
        .get("options")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| {
                    let id = entry
                        .get("value")
                        .or_else(|| entry.get("id"))
                        .and_then(Value::as_str)?
                        .to_string();
                    let name = entry
                        .get("name")
                        .or_else(|| entry.get("title"))
                        .and_then(Value::as_str)
                        .unwrap_or(&id)
                        .to_string();
                    Some(ModelChoice { id, name })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if options.is_empty() {
        return None;
    }
    Some(ModelConfig {
        config_id,
        current,
        options,
    })
}

fn is_model_option(opt: &Value) -> bool {
    let id = opt.get("id").and_then(Value::as_str).unwrap_or("");
    let category = opt.get("category").and_then(Value::as_str).unwrap_or("");
    id.eq_ignore_ascii_case("model") || category.eq_ignore_ascii_case("model")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_model_config_reads_id_model_options() {
        let cfg = parse_model_config(&json!([
            {
                "id": "mode",
                "category": "mode",
                "currentValue": "default",
                "options": [{"value": "default", "name": "Default"}]
            },
            {
                "id": "model",
                "name": "Model",
                "category": "model",
                "currentValue": "fast",
                "options": [
                    {"value": "fast", "name": "Fast"},
                    {"value": "smart", "name": "Smart"}
                ]
            }
        ]))
        .expect("model option");
        assert_eq!(cfg.config_id, "model");
        assert_eq!(cfg.current, "fast");
        assert_eq!(cfg.options.len(), 2);
        assert_eq!(cfg.options[1].name, "Smart");
    }

    #[test]
    fn parse_model_config_matches_category_when_id_differs() {
        let cfg = parse_model_config(&json!([{
            "id": "llm",
            "category": "model",
            "currentValue": "a",
            "options": [{"id": "a", "title": "Alpha"}, {"id": "b", "title": "Beta"}]
        }]))
        .expect("category model");
        assert_eq!(cfg.config_id, "llm");
        assert_eq!(cfg.options[0].id, "a");
        assert_eq!(cfg.options[0].name, "Alpha");
    }

    #[test]
    fn parse_model_config_returns_none_without_choices() {
        assert!(parse_model_config(&json!([])).is_none());
        assert!(parse_model_config(&json!([{
            "id": "model",
            "currentValue": "x",
            "options": []
        }]))
        .is_none());
        assert!(parse_model_config(&json!({"not": "array"})).is_none());
    }
}
