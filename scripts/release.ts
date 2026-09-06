/**
 * Cuts a release: sets one version number in every file that carries it, commits, and tags.
 *
 * Run it with `bun run release <version>`, for example `bun run release 0.2.0`. The version is
 * a bare semantic version with no leading `v`; the git tag gets the `v`.
 *
 * The app version lives in three places that have to agree, because each one is read by a
 * different tool:
 *   - `package.json` is what a person reads and what `bun` reports.
 *   - `src-tauri/tauri.conf.json` is the version the bundler stamps into the DMG and the NSIS
 *     installer, and the version tauri-action puts in the release assets' names.
 *   - `src-tauri/Cargo.toml` is the version cargo builds the binary under, which ends up in
 *     the Windows file properties.
 * `src-tauri/Cargo.lock` records the version of the local crate too, so it is refreshed
 * afterwards. Refreshing one named package leaves every other crate in the lockfile alone, so
 * a release never quietly upgrades a dependency.
 *
 * Nothing is pushed. The script prints the two push commands and stops, so a person can look
 * at the commit before the tag reaches GitHub and starts a build.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");

const packageJsonPath = join(repoRoot, "package.json");
const tauriConfPath = join(repoRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = join(repoRoot, "src-tauri", "Cargo.toml");

/** Name of the crate in `src-tauri/Cargo.toml`, used to refresh only its lockfile entry. */
const crateName = "din-replicator";

/** Branch a release is allowed to be cut from. */
const releaseBranch = "main";

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** Runs a command, sends its output to this script's own output, and fails if it fails. */
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with ${result.status}`);
}

/** Runs a command and returns its trimmed standard output. */
function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited with ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/**
 * Replaces the first match of `pattern` in a file, and fails if there is no match, so a
 * renamed key or a reformatted file stops the release instead of being skipped. A file
 * that already holds the new version matches and is left as it is.
 */
function replaceInFile(path: string, pattern: RegExp, replacement: string): void {
  const before = readFileSync(path, "utf8");
  if (!pattern.test(before)) fail(`found nothing to replace in ${path}`);
  const after = before.replace(pattern, replacement);
  if (after === before) return;
  writeFileSync(path, after);
}

const version = process.argv[2];
if (!version) fail("usage: bun run release <version>, for example: bun run release 0.2.0");

// Tauri rejects anything that is not major.minor.patch, so reject it here where the message is
// clearer than a failed build an hour later.
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`"${version}" is not a version of the form major.minor.patch, with no leading v`);
}

const tag = `v${version}`;

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== releaseBranch) {
  fail(`releases are cut from ${releaseBranch}, and this is ${branch}`);
}

if (capture("git", ["status", "--porcelain"]) !== "") {
  fail("the working tree has uncommitted changes; commit or stash them first");
}

if (capture("git", ["tag", "--list", tag]) !== "") {
  fail(`the tag ${tag} already exists`);
}

console.log(`release: setting the version to ${version}`);

// package.json: the "version" key sits at the top level, before "private", so anchor on the
// line rather than on the first "version" anywhere in the file.
replaceInFile(packageJsonPath, /^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);

// tauri.conf.json: the same shape, and the only "version" key in the file.
replaceInFile(tauriConfPath, /^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);

// Cargo.toml: the version in the [package] table is the first one in the file. Dependency
// versions come later, so the first match is the right one.
replaceInFile(cargoTomlPath, /^(version\s*=\s*)"[^"]*"/m, `$1"${version}"`);

console.log("release: refreshing Cargo.lock");
run("cargo", ["update", "-p", crateName, "--manifest-path", "src-tauri/Cargo.toml"]);

console.log("release: running bun run check");
run("bun", ["run", "check"]);

console.log("release: committing and tagging");
run("git", [
  "add",
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
]);
// The manifests may already carry this version, in which case the tag goes on the current
// commit and there is nothing to commit.
if (capture("git", ["diff", "--cached", "--name-only"]) !== "") {
  run("git", ["commit", "-m", `Release ${tag}`]);
} else {
  console.log("release: the manifests already held this version, tagging the current commit");
}
run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);

console.log(`
release: ${tag} is committed and tagged, and nothing has been pushed.

Look over the commit, then push the branch first and the tag second. Pushing the tag starts
the release workflow, which builds the installers and opens a draft GitHub release.

  git push origin ${releaseBranch}
  git push origin ${tag}
`);
