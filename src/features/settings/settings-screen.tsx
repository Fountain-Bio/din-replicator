/**
 * Which printer replicas go to, whether the app asks for a verification scan,
 * how many replicas one print run may produce, and where the print log lives.
 *
 * Every change is saved through `set_settings` as soon as it is made, so there
 * is no Save button to forget.
 */

import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { PrinterStateBadge } from "@/components/printer-state-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_COPIES } from "@/lib/label/replica-zpl";
import { asCommandError, storageInfo } from "@/lib/tauri/commands";
import type { PrinterInfo, Settings, StorageInfo } from "@/lib/tauri/types";

export interface SettingsScreenProps {
  settings: Settings;
  printers: PrinterInfo[];
  /** True while the printer list is being read from the operating system. */
  loadingPrinters: boolean;
  onChange: (settings: Settings) => void;
  onRefreshPrinters: () => void;
}

export function SettingsScreen({
  settings,
  printers,
  loadingPrinters,
  onChange,
  onRefreshPrinters,
}: SettingsScreenProps) {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    storageInfo().then(
      (info) => {
        if (!cancelled) {
          setStorage(info);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setStorageError(asCommandError(reason).message);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Label htmlFor="printer" className="text-base">
            Printer
          </Label>
          <Button variant="ghost" size="sm" onClick={onRefreshPrinters} disabled={loadingPrinters}>
            <RefreshCwIcon />
            {loadingPrinters ? "Reading" : "Read again"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Replicas go to this print queue. Only a Zebra prints them correctly.
        </p>
        <Select
          value={settings.selectedPrinter ?? ""}
          onValueChange={(name) => onChange({ ...settings, selectedPrinter: name })}
        >
          <SelectTrigger id="printer" className="w-full max-w-md">
            <SelectValue placeholder="Choose a printer" />
          </SelectTrigger>
          <SelectContent>
            {printers.map((printer) => (
              <SelectItem key={printer.name} value={printer.name}>
                {printer.name}
                {printer.isZebra ? " (Zebra)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {printers.length === 0 && !loadingPrinters && (
          <p className="text-sm text-muted-foreground">
            This machine has no printers installed. Add the Zebra in the operating system's printer
            settings first.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {printers.map((printer) => (
            <li key={printer.name} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{printer.name}</span>
              {printer.description.length > 0 && (
                <span className="text-muted-foreground">{printer.description}</span>
              )}
              <PrinterStateBadge state={printer.state} />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <Label htmlFor="verify" className="flex items-center gap-3 text-base">
          <input
            id="verify"
            type="checkbox"
            className="size-5 accent-primary"
            checked={settings.verifyAfterPrint}
            onChange={(event) =>
              onChange({ ...settings, verifyAfterPrint: event.currentTarget.checked })
            }
          />
          Ask for a verification scan after every print run
        </Label>
        <p className="text-sm text-muted-foreground">
          The app compares the scan of a fresh replica against the barcode payload it printed, and
          writes the result to the print log.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <Label htmlFor="max-copies" className="text-base">
          Largest copy count
        </Label>
        <p className="text-sm text-muted-foreground">
          The most replicas the scan screen lets one print run produce, up to {MAX_COPIES}.
        </p>
        <Input
          id="max-copies"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_COPIES}
          value={settings.maxCopies}
          className="h-10 w-28 text-base tabular-nums"
          onChange={(event) => {
            const asked = Number(event.currentTarget.value);
            if (!Number.isFinite(asked)) {
              return;
            }
            const maxCopies = Math.min(Math.max(Math.round(asked), 1), MAX_COPIES);
            onChange({ ...settings, maxCopies });
          }}
        />
      </section>

      <section className="flex flex-col gap-2 border-t pt-6">
        <h2 className="text-base font-medium">Print log</h2>
        {storageError !== null ? (
          <p className="text-sm text-destructive">
            Where the print log lives could not be read. {storageError}
          </p>
        ) : storage === null ? (
          <p className="text-sm text-muted-foreground">Reading where the print log lives</p>
        ) : (
          <>
            <p className="font-mono text-sm break-all text-muted-foreground">
              {storage.databasePath}
            </p>
            <p className="text-sm text-muted-foreground">
              {storage.machineWide
                ? "Every login on this computer shares one history."
                : "This history covers only the login you are using now. The app could not write to the machine-wide directory."}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
