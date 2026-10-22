//! ACP chat: the daemon-side client for UI-mode cards.
//!
//! The browser never speaks ACP; Tasks 4/6 build the manager, routes and
//! panel on the types defined here (`AcpClient`, `AcpEvent`, `UiChunk`).

pub(crate) mod acp;
pub(crate) mod normalize;
