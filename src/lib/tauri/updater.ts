/**
 * The version this app is running, and the release that would replace it.
 *
 * Tauri's updater plugin and its process plugin only answer inside the app
 * window. `bun run dev` in a plain browser has neither, so these calls go to
 * the development mock in `dev-mock.ts`, the same way the commands in
 * `commands.ts` do. A browser with no mock is told there is no update rather
 * than being sent to a plugin that is not there.
 *
 * The update itself comes from the project's GitHub releases. `docs/releasing.md`
 * describes what a release holds and how the app decides to accept one.
 */

import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { HAS_TAURI_HOST } from "./commands";

/**
 * True when these calls go to the development mock rather than to Tauri. It is
 * worked out here, from `import.meta.env.DEV`, so that a production build can
 * drop every mock branch in this module along with the module behind it.
 */
const USING_DEVELOPMENT_MOCK = import.meta.env.DEV && !HAS_TAURI_HOST;

/**
 * How much of an update has been downloaded, from 0 to 1, or null while the
 * size of the download is unknown.
 */
export type DownloadProgress = number | null;

/** A release that is newer than the running app. */
export interface AvailableUpdate {
  /** The version of the release, such as `1.2.3`. */
  version: string;
  /**
   * Downloads the release and installs it, reporting how far the download has
   * got as it goes. The app has to be restarted afterwards to run it.
   */
  downloadAndInstall: (onProgress: (progress: DownloadProgress) => void) => Promise<void>;
}

/** The version of the running app, such as `0.1.0`. */
export async function readAppVersion(): Promise<string> {
  if (USING_DEVELOPMENT_MOCK) {
    const { mockAppVersion } = await import("./dev-mock");
    return mockAppVersion();
  }
  return getVersion();
}

/**
 * Asks the releases for a version newer than this one.
 *
 * Answers null when there is nothing newer. The call rejects when the question
 * could not be asked at all, which is what a machine with no network and a
 * release page that is not public both look like from here.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (USING_DEVELOPMENT_MOCK) {
    const { mockUpdate } = await import("./dev-mock");
    return mockUpdate();
  }
  if (!HAS_TAURI_HOST) {
    return null;
  }
  const update = await check();
  if (update === null) {
    return null;
  }
  return {
    version: update.version,
    downloadAndInstall: (onProgress) => {
      // The plugin reports the size once and then one chunk at a time, so the
      // share downloaded is added up here. A release that arrives without a
      // size leaves the share unknown for the whole download.
      let expectedBytes = 0;
      let downloadedBytes = 0;
      return update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            expectedBytes = event.data.contentLength ?? 0;
            onProgress(expectedBytes === 0 ? null : 0);
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            onProgress(expectedBytes === 0 ? null : Math.min(downloadedBytes / expectedBytes, 1));
            break;
          case "Finished":
            onProgress(1);
            break;
        }
      });
    },
  };
}

/** Closes the app and starts it again, which is how an update takes effect. */
export async function restartApp(): Promise<void> {
  if (USING_DEVELOPMENT_MOCK) {
    return;
  }
  await relaunch();
}
