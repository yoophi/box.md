use crate::domain::document::DocumentError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionEntity {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionMembership {
    pub connection_id: String,
    pub permalink: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionSnapshot {
    pub version: u32,
    pub entities: Vec<ConnectionEntity>,
    pub memberships: Vec<ConnectionMembership>,
}

impl Default for ConnectionSnapshot {
    fn default() -> Self {
        Self {
            version: 1,
            entities: Vec::new(),
            memberships: Vec::new(),
        }
    }
}

fn identifier(value: &str) -> Result<(), DocumentError> {
    if value.trim().is_empty() || value.len() > 8192 {
        return Err(DocumentError::new(
            "invalidConnectionIdentifier",
            "연결 식별자가 올바르지 않습니다.",
        ));
    }
    Ok(())
}
fn name(value: &str) -> Result<(), DocumentError> {
    if value.is_empty()
        || value != value.trim()
        || value.chars().count() > 120
        || value.chars().any(char::is_control)
    {
        return Err(DocumentError::new(
            "invalidConnectionName",
            "연결 이름을 1~120자의 한 줄로 입력해주세요.",
        ));
    }
    Ok(())
}

impl ConnectionSnapshot {
    pub fn validate(&self) -> Result<(), DocumentError> {
        if self.version != 1 {
            return Err(DocumentError::new(
                "connectionStoreVersion",
                "지원하지 않는 연결 저장 형식입니다. 원본을 유지합니다.",
            ));
        }
        let mut ids = BTreeSet::new();
        let mut names = BTreeSet::new();
        for entity in &self.entities {
            identifier(&entity.id)?;
            name(&entity.name)?;
            if !ids.insert(entity.id.as_str()) || !names.insert(entity.name.to_lowercase()) {
                return Err(DocumentError::new(
                    "connectionStore",
                    "연결 저장소에 중복된 엔티티가 있습니다. 원본을 유지합니다.",
                ));
            }
        }
        let mut pairs = BTreeSet::new();
        for membership in &self.memberships {
            identifier(&membership.permalink)?;
            if !ids.contains(membership.connection_id.as_str())
                || !pairs.insert((&membership.connection_id, &membership.permalink))
            {
                return Err(DocumentError::new(
                    "connectionStore",
                    "연결 저장소의 관계가 올바르지 않습니다. 원본을 유지합니다.",
                ));
            }
        }
        Ok(())
    }
    pub fn create(&mut self, id: String, input: &str) -> Result<bool, DocumentError> {
        identifier(&id)?;
        let normalized = input.trim();
        name(normalized)?;
        if self
            .entities
            .iter()
            .any(|entity| entity.name.to_lowercase() == normalized.to_lowercase())
        {
            return Err(DocumentError::new(
                "connectionNameExists",
                "같은 이름의 연결 엔티티가 이미 있습니다.",
            ));
        }
        if self.entities.iter().any(|entity| entity.id == id) {
            return Err(DocumentError::new(
                "connectionIdExists",
                "같은 연결 식별자가 이미 있습니다.",
            ));
        }
        self.entities.push(ConnectionEntity {
            id,
            name: normalized.into(),
        });
        Ok(true)
    }
    fn entity(&self, id: &str) -> Result<(), DocumentError> {
        identifier(id)?;
        if !self.entities.iter().any(|entity| entity.id == id) {
            return Err(DocumentError::new(
                "connectionNotFound",
                "연결 엔티티를 찾지 못했습니다.",
            ));
        }
        Ok(())
    }
    pub fn attach(&mut self, connection_id: &str, permalink: &str) -> Result<bool, DocumentError> {
        self.entity(connection_id)?;
        identifier(permalink)?;
        if self
            .memberships
            .iter()
            .any(|item| item.connection_id == connection_id && item.permalink == permalink)
        {
            return Ok(false);
        }
        self.memberships.push(ConnectionMembership {
            connection_id: connection_id.into(),
            permalink: permalink.into(),
        });
        Ok(true)
    }
    pub fn detach(&mut self, connection_id: &str, permalink: &str) -> Result<bool, DocumentError> {
        self.entity(connection_id)?;
        identifier(permalink)?;
        let previous = self.memberships.len();
        self.memberships
            .retain(|item| !(item.connection_id == connection_id && item.permalink == permalink));
        Ok(previous != self.memberships.len())
    }
}
