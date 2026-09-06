//! The one error shape every Tauri command uses.
//!
//! The UI receives every failure as `{"code": "...", "message": "..."}`. It
//! branches on `code` and shows `message`. Codes are fixed snake case strings
//! that outlive any change to the wording, so an error type states its codes
//! once and gets the serialization from here.

use std::fmt::Display;

use serde::ser::SerializeStruct;
use serde::Serializer;

/// An error a Tauri command can return.
pub trait CommandError: Display {
    /// The stable string the UI branches on.
    fn code(&self) -> &'static str;
}

/// Writes one command error as the object the UI expects.
///
/// [`serialize_as_command_error`] wires this up, so the shape is written here
/// once and every command error keeps it.
pub fn serialize<E, S>(error: &E, serializer: S) -> Result<S::Ok, S::Error>
where
    E: CommandError + ?Sized,
    S: Serializer,
{
    let mut object = serializer.serialize_struct("CommandError", 2)?;
    object.serialize_field("code", error.code())?;
    object.serialize_field("message", &error.to_string())?;
    object.end()
}

/// Implements `serde::Serialize` for an error type that already implements
/// [`CommandError`].
#[macro_export]
macro_rules! serialize_as_command_error {
    ($error:ty) => {
        impl serde::Serialize for $error {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                $crate::command_error::serialize(self, serializer)
            }
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, thiserror::Error)]
    #[error("the label stock ran out after {0} replicas")]
    struct StockRanOut(u32);

    impl CommandError for StockRanOut {
        fn code(&self) -> &'static str {
            "stock_ran_out"
        }
    }

    crate::serialize_as_command_error!(StockRanOut);

    #[test]
    fn an_error_serialises_as_a_code_and_a_message() {
        let json = serde_json::to_value(StockRanOut(3)).unwrap();

        assert_eq!(json["code"], "stock_ran_out");
        assert_eq!(json["message"], "the label stock ran out after 3 replicas");
        assert_eq!(json.as_object().unwrap().len(), 2);
    }
}
