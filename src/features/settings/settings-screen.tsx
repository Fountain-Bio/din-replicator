/**
 * Every choice the operator can make, arranged as a list of sections down the
 * left and the chosen section's fields on the right.
 *
 * Every change is saved through `set_settings` as soon as it is made, so there
 * is no Save button to forget.
 *
 * Nothing on this screen explains what a control does. A field is its label,
 * its control, and at most a unit or a range beside it. The section list names
 * the group, so the pane carries no heading of its own either. What is left is
 * short enough that a section fits the shortest window the app runs in, and
 * `ScrollPane` marks the edge when one does not.
 */

import { RefreshCwIcon } from "lucide-react";
import { connectionText, PrinterStatus } from "@/components/printer-status";
import { ScrollPane } from "@/components/scroll-pane";
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
import type { UpdateState } from "@/features/update/update-state";
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
  /** The version of the running app, or null until it has been read. */
  appVersion: string | null;
  /** Where the app stands with the newest release. */
  update: UpdateState;
  onChange: (settings: Settings) => void;
  onRefreshPrinters: () => void;
  onCheckForUpdates: () => void;
}

/** The sections of the screen, in the order the list shows them. */
const SECTIONS = [
  { id: "printer", label: "Printer" },
  { id: "verification", label: "Verification and copies" },
  { id: "advanced", label: "Advanced" },
  { id: "print-log", label: "Print log" },
  { id: "about", label: "About" },
] as const;

/** How each printing method reads in the picker. */
const PRINT_METHODS: Array<{ value: PrintMethod; label: string }> = [
  { value: "thermalTransfer", label: "Thermal transfer" },
  { value: "directThermal", label: "Direct thermal" },
];

/** How each label font reads in the picker. */
const LABEL_FONTS: Array<{ value: LabelFont; label: string }> = [
  { value: "printer", label: "Printer font" },
  { value: "sans", label: BUNDLED_LABEL_FONTS.sans.displayName },
  { value: "mono", label: BUNDLED_LABEL_FONTS.mono.displayName },
];

/** How each printer resolution reads in the picker. */
const PRINTER_DOTS_PER_INCH: Array<{ value: PrinterDotsPerInch; label: string }> =
  PRINTER_DOTS_PER_INCH_CHOICES.map((choice) => ({ value: choice, label: `${choice} dpi` }));

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
  appVersion,
  update,
  onChange,
  onRefreshPrinters,
  onCheckForUpdates,
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
    <Tabs defaultValue={SECTIONS[0].id} orientation="vertical" className="h-full min-h-0 gap-6">
      <TabsList
        aria-label="Settings sections"
        // The section list is the whole navigation of this screen, so an arrow
        // key shows the section it lands on. Base UI otherwise waits for Enter
        // or Space, which would leave the list and the pane out of step.
        activateOnFocus
        className="h-fit w-40 shrink-0 flex-col items-stretch gap-0.5 bg-transparent p-0"
      >
        {SECTIONS.map((section) => (
          <TabsTrigger
            key={section.id}
            value={section.id}
            className="h-8 w-full flex-none justify-start rounded-md px-2.5 text-sm font-normal data-active:bg-muted"
          >
            {section.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <ScrollPane className="@container">
        <div className="max-w-4xl pb-2">
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

          <TabsContent value="about">
            <AboutSection
              appVersion={appVersion}
              update={update}
              onCheckForUpdates={onCheckForUpdates}
            />
          </TabsContent>
        </div>
      </ScrollPane>
    </Tabs>
  );
}

/** One labelled control. */
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** The grid the fields sit in, one column at a time as the window allows. */
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-x-6 gap-y-5 @sm:grid-cols-2 @2xl:grid-cols-3">{children}</div>;
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
  const asOptions = (group: PrinterInfo[]) =>
    group
      .sort(byName)
      .map((printer) => ({ value: printer.name, label: printerOptionText(printer) }));
  // Base UI reads the groups to put the chosen printer's line on the trigger,
  // and the same array draws the popup, so the two can never disagree.
  const printerGroups = [
    { value: "Label printers", items: asOptions(printers.filter((printer) => printer.isZebra)) },
    { value: "Other printers", items: asOptions(printers.filter((printer) => !printer.isZebra)) },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="printer" className="text-sm font-normal">
          Printer
        </Label>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Select
            items={printerGroups}
            value={settings.selectedPrinter}
            onValueChange={(selectedPrinter) => onChange({ ...settings, selectedPrinter })}
          >
            <SelectTrigger id="printer" className="h-9 w-full max-w-sm min-w-56">
              <SelectValue placeholder="Choose a printer" />
            </SelectTrigger>
            <SelectContent>
              {printerGroups.map((group) => (
                <SelectGroup key={group.value}>
                  <SelectLabel>{group.value}</SelectLabel>
                  {group.items.map((printer) => (
                    <SelectItem key={printer.value} value={printer.value}>
                      {printer.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {chosenPrinter !== undefined && <PrinterStatus state={chosenPrinter.state} />}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onRefreshPrinters}
            disabled={loadingPrinters}
          >
            <RefreshCwIcon className={loadingPrinters ? "animate-spin" : undefined} />
            {loadingPrinters ? "Reading" : "Read again"}
          </Button>
        </div>
      </div>

      {savedPrinterMissing && (
        <p className="text-sm text-destructive">
          {settings.selectedPrinter} is not connected to this computer.
        </p>
      )}

      {printers.length === 0 && !loadingPrinters && (
        <p className="text-sm text-muted-foreground">No printers are installed on this computer.</p>
      )}
    </div>
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
    <div className="flex max-w-md flex-col gap-6">
      <Label
        htmlFor="verify"
        className="flex w-full items-center justify-between gap-6 text-sm font-normal"
      >
        Verification scan after every print run
        <Switch
          id="verify"
          checked={settings.verifyAfterPrint}
          onCheckedChange={(checked) => onChange({ ...settings, verifyAfterPrint: checked })}
        />
      </Label>

      <NumberField
        id="max-copies"
        label="Largest copy count"
        suffix={`${SETTINGS_BOUNDS.maxCopies.min} to ${SETTINGS_BOUNDS.maxCopies.max}`}
        value={settings.maxCopies}
        min={SETTINGS_BOUNDS.maxCopies.min}
        max={SETTINGS_BOUNDS.maxCopies.max}
        onCommit={(maxCopies) => onChange({ ...settings, maxCopies })}
      />
    </div>
  );
}

function AdvancedSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <FieldGrid>
        <Field id="print-method" label="Print method">
          <Select
            items={PRINT_METHODS}
            value={settings.printMethod}
            onValueChange={(printMethod) => {
              if (printMethod !== null) {
                onChange({ ...settings, printMethod });
              }
            }}
          >
            <SelectTrigger id="print-method" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PRINT_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field id="label-font" label="Label font">
          <Select
            items={LABEL_FONTS}
            value={settings.labelFont}
            onValueChange={(labelFont) => {
              if (labelFont !== null) {
                onChange({ ...settings, labelFont });
              }
            }}
          >
            <SelectTrigger id="label-font" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {LABEL_FONTS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <NumberField
          id="darkness"
          label="Darkness"
          suffix={`${DARKNESS_MIN} to ${DARKNESS_MAX}`}
          value={settings.darkness}
          min={DARKNESS_MIN}
          max={DARKNESS_MAX}
          onCommit={(darkness) => onChange({ ...settings, darkness })}
        />

        <NumberField
          id="speed-ips"
          label="Speed"
          suffix="ips"
          value={settings.speedIps}
          min={SPEED_IPS_MIN}
          max={SPEED_IPS_MAX}
          onCommit={(speedIps) => onChange({ ...settings, speedIps })}
        />

        {/* Where the printer puts the whole label, for a roll that sits a
            little off in the printer. Neither number moves anything within the
            label. */}
        <NumberField
          id="vertical-offset"
          label="Vertical position"
          suffix="dots"
          value={settings.verticalOffsetDots}
          min={OFFSET_DOTS_MIN}
          max={OFFSET_DOTS_MAX}
          onCommit={(verticalOffsetDots) => onChange({ ...settings, verticalOffsetDots })}
        />

        <NumberField
          id="horizontal-offset"
          label="Horizontal position"
          suffix="dots"
          value={settings.horizontalOffsetDots}
          min={OFFSET_DOTS_MIN}
          max={OFFSET_DOTS_MAX}
          onCommit={(horizontalOffsetDots) => onChange({ ...settings, horizontalOffsetDots })}
        />
      </FieldGrid>

      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold tracking-tight">Label stock</h3>
        <Separator className="flex-1" />
      </div>

      <FieldGrid>
        <NumberField
          id="label-width"
          label="Label width"
          suffix="in"
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
          suffix="in"
          value={settings.labelHeightInches}
          min={SETTINGS_BOUNDS.labelHeightInches.min}
          max={SETTINGS_BOUNDS.labelHeightInches.max}
          step={0.05}
          decimals={2}
          onCommit={(labelHeightInches) => onChange({ ...settings, labelHeightInches })}
        />

        <Field id="printer-dpi" label="Printer resolution">
          <Select
            items={PRINTER_DOTS_PER_INCH}
            value={settings.printerDotsPerInch}
            onValueChange={(printerDotsPerInch) => {
              if (printerDotsPerInch !== null) {
                onChange({ ...settings, printerDotsPerInch });
              }
            }}
          >
            <SelectTrigger id="printer-dpi" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PRINTER_DOTS_PER_INCH.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>
    </div>
  );
}

function PrintLogSection({
  storage,
  storageError,
}: {
  storage: StorageInfo | null;
  storageError: string | null;
}) {
  if (storageError !== null) {
    return <p className="text-sm text-destructive">{storageError}</p>;
  }
  if (storage === null) {
    return <p className="text-sm text-muted-foreground">Reading the print log</p>;
  }
  if (storage.unavailable !== null) {
    return (
      <p className="text-sm text-destructive">{printLogUnavailableText(storage.unavailable)}</p>
    );
  }

  return (
    <dl className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground">File</dt>
        <dd className="font-mono text-xs break-all">{storage.databasePath}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground">History</dt>
        <dd>{storage.machineWide ? "Shared by every login" : "This login only"}</dd>
      </div>
    </dl>
  );
}

/** What the Check for updates button has to report, or null before it is used. */
function checkResultText(update: UpdateState): string | null {
  switch (update.status) {
    case "checking":
      return "Checking";
    case "available":
    case "downloading":
    case "ready":
      return `Version ${update.version} is available.`;
    case "failed":
      return "The check did not finish.";
    case "idle":
      return update.upToDate ? "Up to date" : null;
  }
}

function AboutSection({
  appVersion,
  update,
  onCheckForUpdates,
}: {
  appVersion: string | null;
  update: UpdateState;
  onCheckForUpdates: () => void;
}) {
  const result = checkResultText(update);

  return (
    <div className="flex flex-col gap-5">
      <dl className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">App</dt>
          <dd>DIN Replicator</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="tabular-nums">{appVersion ?? "Reading the version"}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="outline"
          size="lg"
          onClick={onCheckForUpdates}
          disabled={update.status === "checking" || update.status === "downloading"}
        >
          Check for updates
        </Button>
        {result !== null && <p className="text-sm text-muted-foreground">{result}</p>}
      </div>

      <p className="text-sm text-muted-foreground">
        Updates come from the project's GitHub releases.
      </p>
    </div>
  );
}
