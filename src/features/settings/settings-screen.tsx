/**
 * Every choice the operator can make, arranged as a list of sections down the
 * left and the chosen section's fields on the right.
 *
 * Every change is saved through `set_settings` as soon as it is made, so there
 * is no Save button to forget.
 *
 * One screen used to hold all of this in a single column, which meant reading
 * past the printer to reach the print log. The window is wider than it is
 * tall, so the sections became a sidebar: the four groups stay in view, and
 * only the fields of the group being changed take up height. The sidebar is a
 * tab list, so the arrow keys move between sections.
 */

import { RefreshCwIcon } from "lucide-react";
import { connectionText, PrinterStatus } from "@/components/printer-status";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BUNDLED_LABEL_FONTS, type LabelFont } from "@/lib/label/fonts";
import {
  DARKNESS_MAX,
  DARKNESS_MIN,
  OFFSET_DOTS_MAX,
  OFFSET_DOTS_MIN,
  PRINTER_DOTS_PER_INCH_CHOICES,
  SPEED_IPS_MAX,
  SPEED_IPS_MIN,
} from "@/lib/label/replica-zpl";
import { printLogUnavailableText } from "@/lib/print-log";
import { SETTINGS_BOUNDS } from "@/lib/settings";
import type {
  PrinterDotsPerInch,
  PrinterInfo,
  PrintMethod,
  Settings,
  StorageInfo,
} from "@/lib/tauri/types";
import { NumberField } from "./number-field";

export interface SettingsScreenProps {
  /** The saved choices, or null until they have been read. */
  settings: Settings | null;
  /** Why the saved choices could not be read, or null when they were. */
  settingsError: string | null;
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

/** The sections of the screen, in the order the sidebar lists them. */
const SECTIONS = [
  { id: "printer", label: "Printer" },
  { id: "verification", label: "Verification and copies" },
  { id: "advanced", label: "Advanced" },
  { id: "print-log", label: "Print log" },
] as const;

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
    explanation: "A face whose characters are all one width, so a DIN lines up column by column.",
  },
];

/** One printer as a line in the picker: its name, then how it is attached. */
function printerOptionText(printer: PrinterInfo): string {
  const connection = connectionText(printer.connection);
  return connection.length === 0 ? printer.name : `${printer.name} · ${connection}`;
}

export function SettingsScreen({
  settings,
  settingsError,
  printers,
  loadingPrinters,
  storage,
  storageError,
  onChange,
  onRefreshPrinters,
}: SettingsScreenProps) {
  // Every setting lives in the print log database, so settings that cannot be
  // read mean a print log that is out of reach. There is nothing to show and
  // nothing safe to guess, so the screen says so and offers no controls.
  if (settings === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {settingsError === null
          ? "Reading the saved settings"
          : `The saved settings could not be read, so nothing on this screen can be changed and printing is off. ${settingsError}`}
      </p>
    );
  }

  return (
    <Tabs
      defaultValue={SECTIONS[0].id}
      orientation="vertical"
      className="h-full min-h-0 gap-6 sm:gap-8"
    >
      <TabsList
        variant="default"
        aria-label="Settings sections"
        className="h-fit w-44 shrink-0 flex-col items-stretch gap-1 bg-transparent p-0 sm:w-52"
      >
        {SECTIONS.map((section) => (
          <TabsTrigger
            key={section.id}
            value={section.id}
            className="h-9 w-full flex-none justify-start rounded-md px-3 text-sm data-active:bg-muted"
          >
            {section.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* The pane scrolls on its own, so a long section never makes the window
          scroll and the sidebar never leaves the screen. */}
      <div className="@container min-w-0 flex-1 overflow-y-auto pb-8">
        <div className="max-w-3xl">
          <TabsContent value="printer">
            <PrinterSection
              settings={settings}
              printers={printers}
              loadingPrinters={loadingPrinters}
              onChange={onChange}
              onRefreshPrinters={onRefreshPrinters}
            />
          </TabsContent>

          <TabsContent value="verification">
            <VerificationSection settings={settings} onChange={onChange} />
          </TabsContent>

          <TabsContent value="advanced">
            <AdvancedSection settings={settings} onChange={onChange} />
          </TabsContent>

          <TabsContent value="print-log">
            <PrintLogSection storage={storage} storageError={storageError} />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}

/** A section's heading, the line that says what it is for, and its fields. */
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
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {action}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** One labelled control with the one line that explains it. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      {children}
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

/** The two-column grid the Advanced fields sit in once there is room for it. */
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-x-8 gap-y-6 @lg:grid-cols-2">{children}</div>;
}

function PrinterSection({
  settings,
  printers,
  loadingPrinters,
  onChange,
  onRefreshPrinters,
}: {
  settings: Settings;
  printers: PrinterInfo[];
  loadingPrinters: boolean;
  onChange: (settings: Settings) => void;
  onRefreshPrinters: () => void;
}) {
  // Settings can name a printer the operating system no longer lists, which is
  // what a renamed or unplugged printer looks like from here.
  const chosenPrinter = printers.find((printer) => printer.name === settings.selectedPrinter);
  const savedPrinterMissing = settings.selectedPrinter !== null && chosenPrinter === undefined;

  // Only a label printer produces a readable replica, so those come first.
  const byName = (a: PrinterInfo, b: PrinterInfo) => a.name.localeCompare(b.name);
  const labelPrinters = printers.filter((printer) => printer.isZebra).sort(byName);
  const otherPrinters = printers.filter((printer) => !printer.isZebra).sort(byName);

  return (
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
      {/* The section heading already says what this picker is, so the picker
          carries its name for a screen reader and no second heading on screen. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Select
            value={settings.selectedPrinter ?? ""}
            onValueChange={(name) => onChange({ ...settings, selectedPrinter: name })}
          >
            <SelectTrigger id="printer" aria-label="Printer" className="h-10 w-full max-w-sm">
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
        <p className="text-sm text-muted-foreground">
          Each printer is listed with how it is attached: USB, or the address it answers on.
        </p>
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
  );
}

function VerificationSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  return (
    <Section
      title="Verification and copies"
      description="What happens after a print run, and how many replicas one print run may produce."
    >
      <div className="flex flex-col gap-2">
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
        <p className="text-sm text-muted-foreground">
          The app compares the scan of a fresh replica against the barcode payload it printed, and
          writes the result to the print log.
        </p>
      </div>

      <NumberField
        id="max-copies"
        label="Largest copy count"
        hint={`The most replicas the scan screen lets one print run produce, ${SETTINGS_BOUNDS.maxCopies.min} to ${SETTINGS_BOUNDS.maxCopies.max}.`}
        value={settings.maxCopies}
        min={SETTINGS_BOUNDS.maxCopies.min}
        max={SETTINGS_BOUNDS.maxCopies.max}
        onCommit={(maxCopies) => onChange({ ...settings, maxCopies })}
      />
    </Section>
  );
}

function AdvancedSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const currentMethod =
    PRINT_METHODS.find((method) => method.value === settings.printMethod) ?? PRINT_METHODS[0]!;
  const currentFont =
    LABEL_FONTS.find((font) => font.value === settings.labelFont) ?? LABEL_FONTS[0]!;

  return (
    <Section
      title="Advanced"
      description="These match the printer and the label stock the app was built for. A change here takes effect on the next print run."
    >
      <FieldGrid>
        <Field id="print-method" label="Print method" hint={currentMethod.explanation}>
          <Select
            value={settings.printMethod}
            onValueChange={(value) => onChange({ ...settings, printMethod: value as PrintMethod })}
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
        </Field>

        <Field
          id="label-font"
          label="Label font"
          hint={`The eye-readable line under the barcode is set in this font. ${currentFont.explanation}`}
        >
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
        </Field>

        <NumberField
          id="darkness"
          label="Darkness"
          hint={`${DARKNESS_MIN} to ${DARKNESS_MAX}. Higher is darker. Raise it when replicas look faded.`}
          value={settings.darkness}
          min={DARKNESS_MIN}
          max={DARKNESS_MAX}
          onCommit={(darkness) => onChange({ ...settings, darkness })}
        />

        <NumberField
          id="speed-ips"
          label="Speed"
          hint={`Inches per second, ${SPEED_IPS_MIN} to ${SPEED_IPS_MAX}. Slower prints darker and sharper.`}
          value={settings.speedIps}
          min={SPEED_IPS_MIN}
          max={SPEED_IPS_MAX}
          onCommit={(speedIps) => onChange({ ...settings, speedIps })}
        />

        {/* Where the printer puts the whole label, for a roll that sits a
            little off in the printer. Neither number moves anything within
            the label. */}
        <NumberField
          id="vertical-offset"
          label="Vertical position"
          hint={`Dots, ${OFFSET_DOTS_MIN} to ${OFFSET_DOTS_MAX}. A positive number moves what is printed down the label. 12 dots is a millimetre.`}
          value={settings.verticalOffsetDots}
          min={OFFSET_DOTS_MIN}
          max={OFFSET_DOTS_MAX}
          onCommit={(verticalOffsetDots) => onChange({ ...settings, verticalOffsetDots })}
        />

        <NumberField
          id="horizontal-offset"
          label="Horizontal position"
          hint={`Dots, ${OFFSET_DOTS_MIN} to ${OFFSET_DOTS_MAX}. A positive number moves what is printed to the right.`}
          value={settings.horizontalOffsetDots}
          min={OFFSET_DOTS_MIN}
          max={OFFSET_DOTS_MAX}
          onCommit={(horizontalOffsetDots) => onChange({ ...settings, horizontalOffsetDots })}
        />
      </FieldGrid>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold tracking-tight">Label stock</h3>
        <p className="text-sm text-muted-foreground">
          The size of one label on the roll and the resolution of the print head. Every dot on a
          replica is worked out from these three numbers, so the scan screen's preview changes with
          them.
        </p>
      </div>

      <FieldGrid>
        <NumberField
          id="label-width"
          label="Label width"
          hint={`Inches across the label, ${SETTINGS_BOUNDS.labelWidthInches.min} to ${SETTINGS_BOUNDS.labelWidthInches.max}.`}
          value={settings.labelWidthInches}
          min={SETTINGS_BOUNDS.labelWidthInches.min}
          max={SETTINGS_BOUNDS.labelWidthInches.max}
          step={0.05}
          decimals={2}
          onCommit={(labelWidthInches) => onChange({ ...settings, labelWidthInches })}
        />

        <NumberField
          id="label-height"
          label="Label height"
          hint={`Inches along the roll, ${SETTINGS_BOUNDS.labelHeightInches.min} to ${SETTINGS_BOUNDS.labelHeightInches.max}.`}
          value={settings.labelHeightInches}
          min={SETTINGS_BOUNDS.labelHeightInches.min}
          max={SETTINGS_BOUNDS.labelHeightInches.max}
          step={0.05}
          decimals={2}
          onCommit={(labelHeightInches) => onChange({ ...settings, labelHeightInches })}
        />

        <Field
          id="printer-dpi"
          label="Printer resolution"
          hint="Dots per inch the print head lays down. It is printed on the printer, and a wrong number makes every replica the wrong size."
        >
          <Select
            value={String(settings.printerDotsPerInch)}
            onValueChange={(value) =>
              onChange({
                ...settings,
                printerDotsPerInch: Number(value) as PrinterDotsPerInch,
              })
            }
          >
            <SelectTrigger id="printer-dpi" className="h-10 w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRINTER_DOTS_PER_INCH_CHOICES.map((choice) => (
                <SelectItem key={choice} value={String(choice)}>
                  {choice} dpi
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>
    </Section>
  );
}

function PrintLogSection({
  storage,
  storageError,
}: {
  storage: StorageInfo | null;
  storageError: string | null;
}) {
  return (
    <Section
      title="Print log"
      description="Every print run this machine records goes into one SQLite file. The history screen reads it."
    >
      {storageError !== null ? (
        <p className="text-sm text-destructive">
          Where the print log lives could not be read. {storageError}
        </p>
      ) : storage === null ? (
        <p className="text-sm text-muted-foreground">Reading where the print log lives</p>
      ) : storage.unavailable !== null ? (
        <p className="text-sm text-destructive">{printLogUnavailableText(storage.unavailable)}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs break-all text-muted-foreground">
            {storage.databasePath}
          </p>
          <p className="text-sm text-muted-foreground">
            {storage.machineWide
              ? "Every login on this computer shares one history."
              : "This history covers only the login you are using now. The app could not write to the machine-wide directory."}
          </p>
        </div>
      )}
    </Section>
  );
}
