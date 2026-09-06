/**
 * Asks the project's GitHub releases for a newer version, and installs the one
 * it finds when the operator asks for it.
 *
 * The check runs when the window opens and every six hours after that. It is a
 * promise nothing waits on, so a slow or unreachable release page never holds
 * up a scan. A check that cannot be made says nothing to the operator: a
 * machine with no network, and a release page that is not public yet, both
 * look the same from here and neither is the operator's problem.
 *
 * `update-state.ts` holds the decisions this hook reports and the rule that
 * decides whether the banner is on the screen.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  checkForUpdate,
  readAppVersion,
  restartApp,
  type AvailableUpdate,
} from "@/lib/tauri/updater";
import { INITIAL_UPDATE_STATE, updateReducer, type UpdateState } from "./update-state";

/** How long the app waits between checks. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdateHandle {
  state: UpdateState;
  /** The version of the running app, or null until it has been read. */
  appVersion: string | null;
  /** Asks the releases now, which is what the Check for updates button does. */
  check: () => void;
  /** Downloads the update, installs it, and restarts the app. */
  install: () => void;
  /** Later: takes the banner off the screen until the next check. */
  later: () => void;
}

export function useUpdate(): UpdateHandle {
  const [state, dispatch] = useReducer(updateReducer, INITIAL_UPDATE_STATE);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // The update the last check found. It carries the plugin's own handle on the
  // download, so it lives here rather than in the state the screens read.
  const found = useRef<AvailableUpdate | null>(null);
  const checking = useRef(false);

  const check = useCallback(() => {
    // The button and the timer call this, and both can arrive while a check is
    // already on its way.
    if (checking.current) {
      return;
    }
    checking.current = true;
    dispatch({ type: "check-started" });
    checkForUpdate()
      .then(
        (update) => {
          found.current = update;
          dispatch(
            update === null
              ? { type: "no-update-found" }
              : { type: "update-found", version: update.version },
          );
        },
        () => {
          found.current = null;
          dispatch({ type: "check-failed" });
        },
      )
      .finally(() => {
        checking.current = false;
      });
  }, []);

  const install = useCallback(() => {
    const update = found.current;
    if (update === null) {
      return;
    }
    dispatch({ type: "download-started" });
    update
      .downloadAndInstall((progress) => dispatch({ type: "download-progress", progress }))
      .then(() => {
        dispatch({ type: "installed" });
        // Windows restarts the app itself after its installer runs, so this
        // call is what macOS needs and what Windows never reaches.
        return restartApp();
      })
      .catch(() => dispatch({ type: "install-failed" }));
  }, []);

  const later = useCallback(() => dispatch({ type: "later" }), []);

  useEffect(() => {
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [check]);

  useEffect(() => {
    let showing = true;
    readAppVersion().then(
      (version) => {
        if (showing) {
          setAppVersion(version);
        }
      },
      () => {
        // The About section shows nothing rather than a guess at the version.
      },
    );
    return () => {
      showing = false;
    };
  }, []);

  return { state, appVersion, check, install, later };
}
