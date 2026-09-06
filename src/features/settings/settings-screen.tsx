/**
 * Which printer replicas go to, whether the app asks for a verification scan,
 * how many replicas one print run may produce, how the printer marks the label
 * stock, which font the eye-readable line is set in, and where the print log
 * lives.
 *
 * Every change is saved through `set_settings` as soon as it is made, so there
 * is no Save button to forget.
 *
 * The screen keeps one narrow column. Each group of settings is a titled
 * section with the same spacing, so an operator scanning down the page can
 * tell where one decision ends and the next begins.
 */

import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { PrinterStatus } from "@/components/printer-status";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { BUNDLED_LABEL_FONTS, type LabelFont } from "@/lib/label/fonts";
import { MAX_COPIES } from "@/lib/label/replica-zpl";
import { connectionText, printerConnection } from "@/lib/printer/connection";
import { clampWhole, DARKNESS_RANGE, OFFSET_DOTS_RANGE, SPEED_IPS_RANGE } from "@/lib/settings";
import type { PrinterInfo, PrintMethod, Settings, StorageInfo } from "@/lib/tauri/types";

export interface SettingsScreenProps {
  settings: Settings;
  printers: PrinterInfo[];
  /** True while the printer list is being read from the operating system. */
  loadingPrinters: boolean;
  /** Where the print log lives, or null while that is still being read. */
  storage: StorageInfo | null;
  /** Why the print log could not be asked at all, or null when it answered. */
  storageError: string | null;
  onChange: (settings: Settings) => void;
  onRefreshPrinters: () => void;
}

/** How each printing method reads, and the one line that explains it. */
const PRINT_METHODS: Array<{ value: PrintMethod; label: string; explanation: string }> = [
  {
    value: "thermalTransfer",
    label: "Thermal transfer",
    explanation: "Melts a ribbon onto the label stock.",
  },
  {
    value: "directThermal",
    label: "Direct thermal",
    explanation: "No ribbon. The heat darkens heat-sensitive label stock.",
  },
];

/** How each label font reads, and the one line that explains it. */
const LABEL_FONTS: Array<{ value: LabelFont; label: string; explanation: string }> = [
  {
    value: "printer",
    label: "Printer font",
    explanation: "The printer's own font, and the font the source labels are set in.",
  },
  {
    value: "sans",
    label: BUNDLED_LABEL_FONTS.sans.displayName,
    explanation: "A sans serif face the app sends to the printer with each label.",
  },
  {
    value: "mono",
    label: BUNDLED_LABEL_FONTS.mono.displayName,
    explanation:
      "A sans serif face whose characters are all one width, so a DIN lines up column by column.",
  },
];

/** One printer as a line in the picker: its name, then how it is attached. */
function printerOptionText(printer: PrinterInfo): string {
  const connection = connectionText(printerConnection(printer));
  return connection.length === 0 ? printer.name : `${printer.name} · ${connection}`;
}

export function SettingsScreen({
  settings,
  printers,
  loadingPrinters,
  storage,
  storageError,
  onChange,
  onRefreshPrinters,
}: SettingsScreenProps) {
  // Settings can name a printer the operating system no longer lists, which is
  // what a renamed or unplugged printer looks like from here.
  const chosenPrinter = printers.find((printer) => printer.name === settings.selectedPrinter);
  const savedPrinterMissing = settings.selectedPrinter !== null && chosenPrinter === undefined;

  // Only a label printer produces a readable replica, so those come first.
  const byName = (a: PrinterInfo, b: PrinterInfo) => a.name.localeCompare(b.name);
  const labelPrinters = printers.filter((printer) => printer.isZebra).sort(byName);
  const otherPrinters = printers.filter((printer) => !printer.isZebra).sort(byName);

  const currentMethod =
    PRINT_METHODS.find((method) => method.value === settings.printMethod) ?? PRINT_METHODS[0]!;
  const currentFont =
    LABEL_FONTS.find((font) => font.value === settings.labelFont) ?? LABEL_FONTS[0]!;

  return (
    <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-8 pb-12">
      <Section
        title="Printer"
        description="Replicas go to this printer. Only a label printer prints them correctly."
        action={
          <Button variant="ghost" size="sm" onClick={onRefreshPrinters} disabled={loadingPrinters}>
            <RefreshCwIcon className={loadingPrinters ? "animate-spin" : undefined} />
            {loadingPrinters ? "Reading" : "Read again"}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Select
            value={settings.selectedPrinter ?? ""}
            onValueChange={(name) => onChange({ ...settings, selectedPrinter: name })}
          >
            <SelectTrigger id="printer" className="h-10 w-full max-w-sm">
              <SelectValue placeholder="Choose a printer" />
            </SelectTrigger>
            <SelectContent>
              {labelPrinters.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Label printers</SelectLabel>
                  {labelPrinters.map((printer) => (
                    <SelectItem key={printer.name} value={printer.name}>
                      {printerOptionText(printer)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {otherPrinters.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Other printers</SelectLabel>
                  {otherPrinters.map((printer) => (
                    <SelectItem key={printer.name} value={printer.name}>
                      {printerOptionText(printer)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          {chosenPrinter !== undefined && <PrinterStatus state={chosenPrinter.state} />}
        </div>

        {savedPrinterMissing && (
          <p className="text-sm text-destructive">
            The saved printer {settings.selectedPrinter} is not connected to this computer. Choose
            another printer, or plug the saved one back in and read the list again.
          </p>
        )}

        {printers.length === 0 && !loadingPrinters && (
          <p className="text-sm text-muted-foreground">
            This computer has no printers installed. Add the label printer in the operating system's
            printer settings first.
          </p>
        )}
      </Section>

      <Separator />

      <Section
        title="Verification"
        description="The app compares the scan of a fresh replica against the barcode payload it printed, and writes the result to the print log."
      >
        <Label
          htmlFor="verify"
          className="flex w-full items-center justify-between gap-6 text-sm font-normal"
        >
          Ask for a verification scan after every print run
          <Switch
            id="verify"
            checked={settings.verifyAfterPrint}
            onCheckedChange={(checked) => onChange({ ...settings, verifyAfterPrint: checked })}
          />
        </Label>
      </Section>

      <Separator />

      <Section
        title="Copy count"
        description={`The most replicas the scan screen lets one print run produce, up to ${MAX_COPIES}.`}
      >
        <div className="flex items-center gap-3">
          <Input
            id="max-copies"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_COPIES}
            value={settings.maxCopies}
            className="h-10 w-24 text-base tabular-nums"
            onChange={(event) =>
              onChange({
                ...settings,
                maxCopies: clampWhole(Number(event.currentTarget.value), {
                  min: 1,
                  max: MAX_COPIES,
                }),
              })
            }
          />
          <Label htmlFor="max-copies" className="text-sm font-normal text-muted-foreground">
            replicas per print run
          </Label>
        </div>
      </Section>

      <Separator />

      {/* The three printing values match the label stock and the printer that
          are already in use, so this section stays shut until someone has a
          reason to open it. */}
      <Collapsible className="group/printing">
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <h2 className="text-base font-semibold tracking-tight">Printing</h2>
          <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/printing:rotate-180" />
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {currentMethod.label} · darkness {settings.darkness} · {settings.speedIps} ips ·{" "}
            {currentFont.label}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-6 pt-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="print-method" className="text-sm font-normal">
              Print method
            </Label>
            <Select
              value={settings.printMethod}
              onValueChange={(value) =>
                onChange({ ...settings, printMethod: value as PrintMethod })
              }
            >
              <SelectTrigger id="print-method" className="h-10 w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRINT_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{currentMethod.explanation}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="label-font" className="text-sm font-normal">
              Label font
            </Label>
            <Select
              value={settings.labelFont}
              onValueChange={(value) => onChange({ ...settings, labelFont: value as LabelFont })}
            >
              <SelectTrigger id="label-font" className="h-10 w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LABEL_FONTS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{currentFont.explanation}</p>
            <p className="text-sm text-muted-foreground">
              The eye-readable line under the barcode is set in this font. A replica in the printer
              font matches its source label. The other two travel to the printer with each label and
              are gone when it is switched off.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="darkness" className="text-sm font-normal">
              Darkness
            </Label>
            <Input
              id="darkness"
              type="number"
              inputMode="numeric"
              min={DARKNESS_RANGE.min}
              max={DARKNESS_RANGE.max}
              value={settings.darkness}
              className="h-10 w-24 text-base tabular-nums"
              onChange={(event) =>
                onChange({
                  ...settings,
                  darkness: clampWhole(Number(event.currentTarget.value), DARKNESS_RANGE),
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              {DARKNESS_RANGE.min} to {DARKNESS_RANGE.max}. Higher is darker. Raise it when replicas
              look faded.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="speed-ips" className="text-sm font-normal">
              Speed
            </Label>
            <Input
              id="speed-ips"
              type="number"
              inputMode="numeric"
              min={SPEED_IPS_RANGE.min}
              max={SPEED_IPS_RANGE.max}
              value={settings.speedIps}
              className="h-10 w-24 text-base tabular-nums"
              onChange={(event) =>
                onChange({
                  ...settings,
                  speedIps: clampWhole(Number(event.currentTarget.value), SPEED_IPS_RANGE),
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              Inches per second, {SPEED_IPS_RANGE.min} to {SPEED_IPS_RANGE.max}. Slower prints
              darker and sharper.
            </p>
          </div>

          {/* Where the printer puts the whole label, for a roll that sits a
              little off in the printer. Neither number moves anything within
              the label. */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="vertical-offset" className="text-sm font-normal">
              Vertical position
            </Label>
            <Input
              id="vertical-offset"
              type="number"
              inputMode="numeric"
              min={OFFSET_DOTS_RANGE.min}
              max={OFFSET_DOTS_RANGE.max}
              value={settings.verticalOffsetDots}
              className="h-10 w-24 text-base tabular-nums"
              onChange={(event) =>
                onChange({
                  ...settings,
                  verticalOffsetDots: clampWhole(
                    Number(event.currentTarget.value),
                    OFFSET_DOTS_RANGE,
                  ),
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              Dots, {OFFSET_DOTS_RANGE.min} to {OFFSET_DOTS_RANGE.max}. A positive number moves what
              is printed down the label. 12 dots is a millimetre.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="horizontal-offset" className="text-sm font-normal">
              Horizontal position
            </Label>
            <Input
              id="horizontal-offset"
              type="number"
              inputMode="numeric"
              min={OFFSET_DOTS_RANGE.min}
              max={OFFSET_DOTS_RANGE.max}
              value={settings.horizontalOffsetDots}
              className="h-10 w-24 text-base tabular-nums"
              onChange={(event) =>
                onChange({
                  ...settings,
                  horizontalOffsetDots: clampWhole(
                    Number(event.currentTarget.value),
                    OFFSET_DOTS_RANGE,
                  ),
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              Dots, {OFFSET_DOTS_RANGE.min} to {OFFSET_DOTS_RANGE.max}. A positive number moves what
              is printed to the right.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      <footer className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        <span>Print log</span>
        {storageError !== null ? (
          <span className="text-destructive">
            Where the print log lives could not be read. {storageError}
          </span>
        ) : storage === null ? (
          <span>Reading where the print log lives</span>
        ) : storage.unavailable !== null ? (
          <span className="text-destructive">
            Printing is off because the print log cannot be opened: {storage.unavailable}
          </span>
        ) : (
          <>
            <span className="font-mono text-xs break-all">{storage.databasePath}</span>
            <span>
              {storage.machineWide
                ? "Every login on this computer shares one history."
                : "This history covers only the login you are using now. The app could not write to the machine-wide directory."}
            </span>
          </>
        )}
      </footer>
    </div>
  );
}

/** One group of settings: a title, a line saying what it is for, and controls. */
function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {action}
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
