/**
 * Where the app stands with the newest release, as one pure reducer.
 *
 * The check runs on its own in the background and the operator never asked for
 * it, so every decision about what to show is made here and can be read and
 * tested without a browser. `use-update.ts` is the part that talks to the
 * updater plugin.
 */

/** What the app is doing about the newest release. */
export type UpdateStatus =
  /** Nothing to do: no check has finished, or the app is the newest release. */
  | "idle"
  /** A check is on its way to the releases. */
  | "checking"
  /** A newer release exists and nothing has been downloaded yet. */
  | "available"
  /** The newer release is being downloaded and installed. */
  | "downloading"
  /** The newer release is installed and the app is about to restart. */
  | "ready"
  /** The check or the install did not finish. */
  | "failed";

export interface UpdateState {
  status: UpdateStatus;
  /** The version of the newer release, or null when there is none. */
  version: string | null;
  /**
   * How much of the download is done, from 0 to 1, or null while the size of
   * the download is unknown.
   */
  progress: number | null;
  /** True when the last check found that this app is the newest release. */
  upToDate: boolean;
  /** True when the operator pressed Later, which hides the banner. */
  dismissed: boolean;
}

export type UpdateAction =
  | { type: "check-started" }
  /** The check found a newer release. */
  | { type: "update-found"; version: string }
  /** The check found that this app is the newest release. */
  | { type: "no-update-found" }
  /** The check could not be made at all. */
  | { type: "check-failed" }
  | { type: "download-started" }
  | { type: "download-progress"; progress: number | null }
  /** The download is installed, so the app can restart into it. */
  | { type: "installed" }
  /** The download or the install stopped part way. */
  | { type: "install-failed" }
  /** Later: keep the update but take the banner off the screen. */
  | { type: "later" };

/** The state of an app that has not asked about a release yet. */
export const INITIAL_UPDATE_STATE: UpdateState = {
  status: "idle",
  version: null,
  progress: null,
  upToDate: false,
  dismissed: false,
};

export function updateReducer(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case "check-started":
      // A download that is already running holds the state. The check that
      // comes round every few hours must not throw it away.
      if (state.status === "downloading" || state.status === "ready") {
        return state;
      }
      // Later hides the banner until the next check, so a check that starts
      // brings the banner back.
      return { ...state, status: "checking", upToDate: false, dismissed: false };

    case "update-found":
      if (state.status === "downloading" || state.status === "ready") {
        return state;
      }
      return {
        status: "available",
        version: action.version,
        progress: null,
        upToDate: false,
        dismissed: false,
      };

    case "no-update-found":
      if (state.status === "downloading" || state.status === "ready") {
        return state;
      }
      return { ...INITIAL_UPDATE_STATE, upToDate: true };

    case "check-failed":
      if (state.status === "downloading" || state.status === "ready") {
        return state;
      }
      return { ...INITIAL_UPDATE_STATE, status: "failed" };

    case "download-started":
      if (state.status !== "available") {
        return state;
      }
      return { ...state, status: "downloading", progress: null };

    case "download-progress":
      if (state.status !== "downloading") {
        return state;
      }
      return { ...state, progress: action.progress };

    case "installed":
      if (state.status !== "downloading") {
        return state;
      }
      return { ...state, status: "ready", progress: 1 };

    case "install-failed":
      // The release is still out there, but this run of the app has nothing
      // more to offer the operator about it.
      return { ...INITIAL_UPDATE_STATE, status: "failed" };

    case "later":
      return { ...state, dismissed: true };
  }
}

/**
 * True when the update banner belongs on the screen.
 *
 * `idle` is the scan screen doing nothing: no print run on its way to the
 * printer and no verification scan being waited for. An update never
 * interrupts either of those, so the banner waits.
 */
export function showsUpdateBanner(state: UpdateState, idle: boolean): boolean {
  if (!idle || state.dismissed) {
    return false;
  }
  return state.status === "available" || state.status === "downloading" || state.status === "ready";
}
