/**
 * Everything this app knows about ISBT 128 donation numbers: reading a scan,
 * checking a DIN, computing the check character, and building the barcode
 * payload and the eye-readable text. Pure TypeScript with no DOM and no Tauri.
 */

export { checkCharacter } from "./check-character";
export {
  barcodePayload,
  eyeReadable,
  validateDin,
  type DinInvalidReason,
  type DinValidation,
  type EyeReadable,
} from "./din";
export { parseScan, type NotDinReason, type ScanForm, type ScanResult } from "./scan";
