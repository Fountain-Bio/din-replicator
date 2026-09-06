/**
 * The one sentence the app uses about a print log it cannot open.
 *
 * A print run that cannot be recorded must not happen, so the app refuses to
 * print while the print log is unreachable. The scan screen, the settings
 * screen, and the message that stops a print run all say the same thing about
 * it, which is why the wording is written once here.
 */

/**
 * Why printing is off, given the reason the Rust side gave for the print log
 * being unreachable.
 */
export function printLogUnavailableText(reason: string): string {
  return `Printing is off because the print log cannot be opened: ${reason}`;
}
