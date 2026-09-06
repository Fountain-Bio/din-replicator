//! The Win32 calls behind the Windows print path.
//!
//! This is the only file in the app that calls Win32. It reads the queues with
//! `EnumPrintersW` and submits a job with the `RAW` datatype, which is what
//! makes the spooler hand the ZPL to the printer untouched. The flag mapping
//! it uses lives in [`super::status`] so that it can be tested on any
//! platform.

use std::ffi::c_void;

use ::windows::core::{HRESULT, PCWSTR, PWSTR};
use ::windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetPrinterW, OpenPrinterW,
    StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS,
    PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_2W,
};

use super::connection::connection_from_port;
use super::status::{self, state_from_flags};
use crate::printer::{PrintReceipt, PrinterError, PrinterInfo, PrinterState, PrinterTransport};

/// The flag values that `status` keeps its own copies of must stay
/// equal to the ones the `windows` crate defines. These fail the build if a
/// crate update ever changes them.
const _: () = {
    use ::windows::Win32::Graphics::Printing as win;
    assert!(status::PRINTER_STATUS_PAUSED == win::PRINTER_STATUS_PAUSED);
    assert!(status::PRINTER_STATUS_ERROR == win::PRINTER_STATUS_ERROR);
    assert!(status::PRINTER_STATUS_PAPER_JAM == win::PRINTER_STATUS_PAPER_JAM);
    assert!(status::PRINTER_STATUS_PAPER_OUT == win::PRINTER_STATUS_PAPER_OUT);
    assert!(status::PRINTER_STATUS_OFFLINE == win::PRINTER_STATUS_OFFLINE);
    assert!(status::PRINTER_STATUS_DOOR_OPEN == win::PRINTER_STATUS_DOOR_OPEN);
    assert!(status::PRINTER_ATTRIBUTE_WORK_OFFLINE == win::PRINTER_ATTRIBUTE_WORK_OFFLINE);
};

/// `HRESULT_FROM_WIN32(ERROR_INVALID_PRINTER_NAME)`. The spooler returns this
/// when no queue on the machine goes by the name it was given.
const HRESULT_INVALID_PRINTER_NAME: HRESULT = HRESULT::from_win32(1801);

/// The print queues on this Windows machine.
pub struct Spooler;

impl PrinterTransport for Spooler {
    fn list_printers(&self) -> Result<Vec<PrinterInfo>, PrinterError> {
        // PRINTER_ENUM_LOCAL covers queues installed on this machine.
        // PRINTER_ENUM_CONNECTIONS adds the shared queues this user has
        // connected to, which is how a clinic's network Zebra usually shows up.
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (buffer, count) = enum_printers(flags)?;

        let stride = size_of::<PRINTER_INFO_2W>();
        let mut printers = Vec::with_capacity(count);

        for index in 0..count {
            // SAFETY: level 2 makes the spooler lay `count` PRINTER_INFO_2W
            // records back to back at the start of `buffer`, and
            // `enum_printers` already checked that the buffer holds them all,
            // so this offset is inside it. The read is unaligned because a
            // Vec<u8> carries no alignment guarantee for the record. Copying
            // the record out is safe on its own: the pointers inside it are
            // only followed later, while `buffer` is still alive.
            let info: PRINTER_INFO_2W = unsafe {
                buffer
                    .as_ptr()
                    .add(index * stride)
                    .cast::<PRINTER_INFO_2W>()
                    .read_unaligned()
            };
            printers.push(printer_info(&info));
        }

        Ok(printers)
    }

    fn printer_state(&self, name: &str) -> Result<PrinterState, PrinterError> {
        let printer = OpenPrinter::open(name)?;
        let buffer = printer.get_printer_level_2()?;

        // SAFETY: `get_printer_level_2` asked the spooler for a level 2
        // record and returns the buffer it filled, so a PRINTER_INFO_2W sits
        // at the start of it. The read is unaligned because a Vec<u8> carries
        // no alignment guarantee. Only the two integer fields are used below,
        // so the pointers inside the record are never followed.
        let info: PRINTER_INFO_2W =
            unsafe { buffer.as_ptr().cast::<PRINTER_INFO_2W>().read_unaligned() };

        Ok(state_from_flags(info.Status, info.Attributes))
    }

    fn print_raw(
        &self,
        name: &str,
        bytes: &[u8],
        title: &str,
    ) -> Result<PrintReceipt, PrinterError> {
        let printer = OpenPrinter::open(name)?;

        let mut doc_name = wide(title);
        let mut datatype = wide("RAW");
        let doc_info = DOC_INFO_1W {
            pDocName: PWSTR(doc_name.as_mut_ptr()),
            // No output file: the job goes to the printer, not to disk.
            pOutputFile: PWSTR::null(),
            // RAW is what stops the spooler from rendering the ZPL as a page.
            pDatatype: PWSTR(datatype.as_mut_ptr()),
        };

        // SAFETY: the handle is open. `doc_info` and the two buffers its
        // pointers refer to live until the end of this function, and the
        // spooler only reads them during this call.
        let job_id = unsafe { StartDocPrinterW(printer.raw(), 1, &doc_info) };
        if job_id == 0 {
            return Err(PrinterError::SpoolFailed(last_error()));
        }

        let written = write_document(printer.raw(), bytes);

        // The document has to be ended whether or not the write worked. A job
        // left open holds the queue and never prints. `OpenPrinter` closes the
        // handle after this, on every path.
        // SAFETY: the handle is open and StartDocPrinterW succeeded on it.
        let _ = unsafe { EndDocPrinter(printer.raw()) };
        written?;

        Ok(PrintReceipt {
            job_id: Some(job_id.to_string()),
        })
    }
}

/// Writes the whole of `bytes` to an open job as one page.
///
/// Every page that is started is also ended, on the failure paths as well as
/// the good one, the same way `print_raw` always ends the document. A page
/// left open holds the job. When the write and the page end both fail, the
/// error from the write is the one reported, because that is the one that says
/// what went wrong first.
fn write_document(handle: PRINTER_HANDLE, bytes: &[u8]) -> Result<(), PrinterError> {
    // SAFETY: the handle is open and a document is started on it.
    unsafe { StartPagePrinter(handle) }
        .ok()
        .map_err(|error| PrinterError::SpoolFailed(error.message()))?;

    let written = write_page(handle, bytes);

    // SAFETY: the handle is open and a page is started on it.
    let ended = unsafe { EndPagePrinter(handle) }
        .ok()
        .map_err(|error| PrinterError::SpoolFailed(error.message()));

    written.and(ended)
}

/// Hands `bytes` to the spooler for the page that is currently open.
///
/// `WritePrinter` may take fewer bytes than it is offered, so the loop keeps
/// going until the spooler has taken all of them.
fn write_page(handle: PRINTER_HANDLE, bytes: &[u8]) -> Result<(), PrinterError> {
    let mut sent = 0usize;
    while sent < bytes.len() {
        let chunk = &bytes[sent..];
        let length = u32::try_from(chunk.len()).unwrap_or(u32::MAX);
        let mut taken: u32 = 0;

        // SAFETY: `chunk` points at `length` readable bytes that live for the
        // whole call, and `taken` is a live local the spooler writes into.
        unsafe { WritePrinter(handle, chunk.as_ptr() as *const c_void, length, &mut taken) }
            .ok()
            .map_err(|error| PrinterError::SpoolFailed(error.message()))?;

        if taken == 0 {
            return Err(PrinterError::SpoolFailed(
                "the spooler stopped taking the label data".to_string(),
            ));
        }
        sent += taken as usize;
    }
    Ok(())
}

/// Builds one [`PrinterInfo`] from a spooler record.
fn printer_info(info: &PRINTER_INFO_2W) -> PrinterInfo {
    // SAFETY: the spooler wrote these fields, so each is either null or a
    // null terminated UTF-16 string inside the buffer the record came from.
    // That buffer is still alive at every call site.
    let name = unsafe { read_wide(info.pPrinterName) };
    let comment = unsafe { read_wide(info.pComment) };
    let driver = unsafe { read_wide(info.pDriverName) };
    let port = unsafe { read_wide(info.pPortName) };

    let is_zebra = crate::printer::looks_like_zebra(&[&name, &comment, &driver]);

    // The comment is free text whoever installed the queue typed, so it is
    // often empty. The driver name always names the model, which is what
    // tells a Zebra apart from the office laser printer next to it.
    let description = if comment.trim().is_empty() {
        driver
    } else {
        comment
    };

    PrinterInfo {
        is_zebra,
        state: state_from_flags(info.Status, info.Attributes),
        name,
        description,
        connection: connection_from_port(&port),
    }
}

/// An open spooler handle that closes itself.
///
/// Every path through this module goes out of scope eventually, so wrapping
/// the handle is what keeps a failed print run from leaking it.
struct OpenPrinter(PRINTER_HANDLE);

impl OpenPrinter {
    fn open(name: &str) -> Result<Self, PrinterError> {
        let name_utf16 = wide(name);
        let mut handle = PRINTER_HANDLE::default();

        // SAFETY: `name_utf16` is a null terminated UTF-16 buffer that lives
        // past the call, and `handle` is a live local the spooler fills in.
        // Passing no PRINTER_DEFAULTSW asks for the default access, which
        // covers reading status and submitting a job.
        unsafe { OpenPrinterW(PCWSTR(name_utf16.as_ptr()), &mut handle, None) }.map_err(
            |error| {
                if error.code() == HRESULT_INVALID_PRINTER_NAME {
                    PrinterError::PrinterNotFound(name.to_string())
                } else {
                    PrinterError::QueryFailed(format!(
                        "could not open \"{name}\": {}",
                        error.message()
                    ))
                }
            },
        )?;

        Ok(Self(handle))
    }

    fn raw(&self) -> PRINTER_HANDLE {
        self.0
    }

    /// Reads this printer's level 2 record and returns the bytes the spooler
    /// wrote.
    fn get_printer_level_2(&self) -> Result<Vec<u8>, PrinterError> {
        let mut needed: u32 = 0;

        // SAFETY: the handle is open. The first call passes no buffer, which
        // the spooler is documented to answer by failing and writing the size
        // it needs into `needed`, so the failure is expected and ignored.
        let _ = unsafe { GetPrinterW(self.0, 2, None, &mut needed) };
        if needed == 0 {
            return Err(PrinterError::QueryFailed(last_error()));
        }

        let mut buffer = vec![0u8; needed as usize];
        // SAFETY: the handle is open and `buffer` is at least as large as the
        // spooler asked for on the sizing call.
        unsafe { GetPrinterW(self.0, 2, Some(&mut buffer), &mut needed) }
            .map_err(|error| PrinterError::QueryFailed(error.message()))?;

        // The caller reads a PRINTER_INFO_2W out of the front of this buffer,
        // so refuse a buffer too short to hold one.
        if buffer.len() < size_of::<PRINTER_INFO_2W>() {
            return Err(PrinterError::QueryFailed(
                "the spooler returned a printer record it cut short".to_string(),
            ));
        }

        Ok(buffer)
    }
}

impl Drop for OpenPrinter {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful OpenPrinterW. Drop runs
        // once per value, so the handle is closed exactly once.
        let _ = unsafe { ClosePrinter(self.0) };
    }
}

/// Lists printers at level 2.
///
/// Returns the bytes the spooler wrote and how many `PRINTER_INFO_2W` records
/// it put in them. The count is checked against the buffer size here, so
/// callers can read that many records without checking again.
fn enum_printers(flags: u32) -> Result<(Vec<u8>, usize), PrinterError> {
    let mut needed: u32 = 0;
    let mut returned: u32 = 0;

    // SAFETY: a null name means the local machine. The first call passes no
    // buffer, so the spooler fails and reports the size it needs in `needed`.
    // Both out parameters are live locals.
    let _ = unsafe { EnumPrintersW(flags, PCWSTR::null(), 2, None, &mut needed, &mut returned) };
    if needed == 0 {
        // A machine with no printers installed at all. Not a failure.
        return Ok((Vec::new(), 0));
    }

    let mut buffer = vec![0u8; needed as usize];
    // SAFETY: `buffer` is at least as large as the spooler asked for, and
    // both out parameters are live locals.
    unsafe {
        EnumPrintersW(
            flags,
            PCWSTR::null(),
            2,
            Some(&mut buffer),
            &mut needed,
            &mut returned,
        )
    }
    .map_err(|error| PrinterError::QueryFailed(error.message()))?;

    // Trust the buffer over the count. If the spooler ever reports more
    // records than it had room to write, reading them all would run off the
    // end of the buffer.
    let count = (returned as usize).min(buffer.len() / size_of::<PRINTER_INFO_2W>());
    Ok((buffer, count))
}

/// Encodes `text` as the null terminated UTF-16 that every `...W` call wants.
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Copies a spooler-owned string into a Rust `String`. A field the spooler
/// left null comes back empty.
///
/// # Safety
///
/// `text` must be null, or point at a null terminated UTF-16 string that
/// stays alive for the length of the call.
unsafe fn read_wide(text: PWSTR) -> String {
    if text.is_null() {
        return String::new();
    }
    // SAFETY: the caller promises the pointer is valid up to its terminator.
    unsafe { text.to_string() }.unwrap_or_default()
}

/// The message for whatever the last Win32 call on this thread failed with.
fn last_error() -> String {
    ::windows::core::Error::from_thread().message()
}
