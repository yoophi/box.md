mod domain;
mod frontmatter;
mod ports;
mod scoped_fs;

pub use domain::{DocumentError, DocumentSnapshot, ScopedListing, ScopedWarning, TrashSnapshot};
pub use frontmatter::{
    document_metadata, document_property, patch_document_metadata, set_document_property,
};
pub use ports::{DocumentRepository, ScopedDocumentRepository};
pub use scoped_fs::{ScopedFsDocumentRepository, validate_relative_document_path};
