import { describe, expect, it } from "vitest";
import {
  INITIAL_UPDATE_STATE,
  showsUpdateBanner,
  updateReducer,
  type UpdateAction,
  type UpdateState,
} from "./update-state";

/** The version the tests offer as the newer release. */
const VERSION = "1.2.3";

/** Runs a list of actions from the starting state and returns where they land. */
function run(actions: UpdateAction[], start: UpdateState = INITIAL_UPDATE_STATE): UpdateState {
  return actions.reduce(updateReducer, start);
}

/** A state holding an update that has been found and nothing else. */
function found(): UpdateState {
  return run([{ type: "check-started" }, { type: "update-found", version: VERSION }]);
}

describe("checking", () => {
  it("finds a newer release", () => {
    expect(found()).toEqual({
      status: "available",
      version: VERSION,
      progress: null,
      upToDate: false,
      dismissed: false,
    });
  });

  it("reports an app that is the newest release", () => {
    const state = run([{ type: "check-started" }, { type: "no-update-found" }]);
    expect(state.status).toBe("idle");
    expect(state.upToDate).toBe(true);
    expect(state.version).toBeNull();
  });

  it("fails quietly when the check cannot be made", () => {
    const state = run([{ type: "check-started" }, { type: "check-failed" }]);
    expect(state.status).toBe("failed");
    expect(state.version).toBeNull();
    expect(showsUpdateBanner(state, true)).toBe(false);
  });

  it("leaves a running download alone", () => {
    const downloading = run([{ type: "download-started" }], found());
    expect(run([{ type: "check-started" }], downloading)).toEqual(downloading);
    expect(run([{ type: "no-update-found" }], downloading)).toEqual(downloading);
  });
});

describe("installing", () => {
  it("goes from available to downloading to ready", () => {
    const downloading = run([{ type: "download-started" }], found());
    expect(downloading.status).toBe("downloading");
    expect(downloading.progress).toBeNull();

    const halfway = run([{ type: "download-progress", progress: 0.5 }], downloading);
    expect(halfway.progress).toBe(0.5);

    const ready = run([{ type: "installed" }], halfway);
    expect(ready.status).toBe("ready");
    expect(ready.progress).toBe(1);
    expect(ready.version).toBe(VERSION);
  });

  it("only downloads an update that was found", () => {
    expect(run([{ type: "download-started" }])).toEqual(INITIAL_UPDATE_STATE);
  });

  it("drops the update when the install stops part way", () => {
    const state = run([{ type: "download-started" }, { type: "install-failed" }], found());
    expect(state.status).toBe("failed");
    expect(state.version).toBeNull();
    expect(showsUpdateBanner(state, true)).toBe(false);
  });
});

describe("later", () => {
  it("hides the banner and keeps the update", () => {
    const state = run([{ type: "later" }], found());
    expect(state.status).toBe("available");
    expect(state.version).toBe(VERSION);
    expect(showsUpdateBanner(state, true)).toBe(false);
  });

  it("shows the banner again on the next check", () => {
    const state = run(
      [{ type: "check-started" }, { type: "update-found", version: VERSION }],
      run([{ type: "later" }], found()),
    );
    expect(showsUpdateBanner(state, true)).toBe(true);
  });
});

describe("showsUpdateBanner", () => {
  it("waits while a print run or a verification scan is in hand", () => {
    expect(showsUpdateBanner(found(), false)).toBe(false);
    expect(showsUpdateBanner(found(), true)).toBe(true);
  });

  it("stays on the screen while the update installs", () => {
    const downloading = run([{ type: "download-started" }], found());
    expect(showsUpdateBanner(downloading, true)).toBe(true);
    expect(showsUpdateBanner(run([{ type: "installed" }], downloading), true)).toBe(true);
  });

  it("stays off while nothing has been found", () => {
    expect(showsUpdateBanner(INITIAL_UPDATE_STATE, true)).toBe(false);
    expect(showsUpdateBanner(run([{ type: "check-started" }]), true)).toBe(false);
  });
});
