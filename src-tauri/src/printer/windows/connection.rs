//! Turns the Windows spooler's port name into a [`PrinterConnection`].
//!
//! The Win32 call that reads a printer's port name only exists on Windows,
//! but the port name is a plain string and the mapping is string matching, so
//! it lives here, apart from `spooler.rs`, and compiles and runs under
//! `cargo test` on macOS as well, the same way [`super::status`] does for the
//! spooler's status flags.

use std::net::IpAddr;

use crate::printer::{ConnectionKind, PrinterConnection};

/// Reads a [`PrinterConnection`] out of a `PRINTER_INFO_2W` port name.
///
/// Windows names a port after how the queue reaches the printer. A USB port
/// is named `USB001` and the like. A network port is named `IP_<address>` by
/// the standard TCP/IP port monitor, is a bare IP address for some vendor
/// port monitors, or is named `WSD...` (Web Services for Devices) or a UNC
/// share path such as `\\server\printer`. Anything else, including `LPT1`,
/// `COM1`, `FILE:`, and `PORTPROMPT:`, is a port this app has no way to
/// classify.
pub fn connection_from_port(port: &str) -> PrinterConnection {
    if port.starts_with("USB") {
        return PrinterConnection {
            kind: ConnectionKind::Usb,
            host: None,
        };
    }

    if let Some(address) = port.strip_prefix("IP_") {
        return PrinterConnection {
            kind: ConnectionKind::Network,
            host: Some(address.to_string()),
        };
    }

    // A vendor port monitor can name its port with the bare address, with no
    // prefix to recognise. Parsing it as an IP address is the only way to
    // tell such a port from one of the other named forms.
    if port.parse::<IpAddr>().is_ok() {
        return PrinterConnection {
            kind: ConnectionKind::Network,
            host: Some(port.to_string()),
        };
    }

    if port.starts_with("WSD") || port.starts_with('\\') {
        return PrinterConnection {
            kind: ConnectionKind::Network,
            host: None,
        };
    }

    PrinterConnection {
        kind: ConnectionKind::Other,
        host: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_usb_port_is_a_usb_connection_with_no_host() {
        assert_eq!(
            connection_from_port("USB001"),
            PrinterConnection {
                kind: ConnectionKind::Usb,
                host: None,
            }
        );
    }

    #[test]
    fn a_standard_tcpip_port_gives_the_address_after_the_prefix() {
        assert_eq!(
            connection_from_port("IP_192.168.1.20"),
            PrinterConnection {
                kind: ConnectionKind::Network,
                host: Some("192.168.1.20".into()),
            }
        );
    }

    #[test]
    fn a_bare_ip_address_port_is_a_network_connection() {
        assert_eq!(
            connection_from_port("192.168.1.20"),
            PrinterConnection {
                kind: ConnectionKind::Network,
                host: Some("192.168.1.20".into()),
            }
        );
    }

    #[test]
    fn a_bare_ipv6_address_port_is_a_network_connection() {
        assert_eq!(
            connection_from_port("fe80::1"),
            PrinterConnection {
                kind: ConnectionKind::Network,
                host: Some("fe80::1".into()),
            }
        );
    }

    #[test]
    fn a_web_services_port_is_a_network_connection_with_no_host() {
        assert_eq!(
            connection_from_port("WSD-3d275858-3aa5-4c56-91ff-a4d417e5d310"),
            PrinterConnection {
                kind: ConnectionKind::Network,
                host: None,
            }
        );
    }

    #[test]
    fn a_unc_share_port_is_a_network_connection_with_no_host() {
        assert_eq!(
            connection_from_port("\\\\lab-print\\zebra_lab"),
            PrinterConnection {
                kind: ConnectionKind::Network,
                host: None,
            }
        );
    }

    /// A parallel port, a serial port, the port that writes to a file, and the
    /// port that asks the operator where to print. None of them says how the
    /// printer is reached.
    #[test]
    fn a_port_that_names_no_connection_is_other() {
        for port in ["LPT1:", "COM1:", "FILE:", "PORTPROMPT:"] {
            assert_eq!(
                connection_from_port(port),
                PrinterConnection {
                    kind: ConnectionKind::Other,
                    host: None,
                },
                "port {port} should be other"
            );
        }
    }
}
