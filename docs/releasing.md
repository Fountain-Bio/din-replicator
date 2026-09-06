# Releasing

How to cut a release of DIN Replicator, what has to be in place for the installers to be
signed, and how to check that they are.

## The short version

```
bun run release 0.2.0
git push origin main
git push origin v0.2.0
```

Pushing the tag starts the `release` workflow. It builds on three runners and opens a draft
GitHub release with the installers attached. Read the draft, write the notes, publish it.

## What a release is made of

The `release` workflow builds three artifacts:

| Artifact                                 | Platform               | Runner                          |
| ---------------------------------------- | ---------------------- | ------------------------------- |
| `DIN Replicator_<version>_aarch64.dmg`   | macOS on Apple silicon | `blacksmith-6vcpu-macos-latest` |
| `DIN Replicator_<version>_x64-setup.exe` | Windows                | `blacksmith-4vcpu-windows-2025` |

The Windows installer is an NSIS per-machine installer, so it installs for everyone on the
computer and asks for administrator rights. It carries the WebView2 bootstrapper inside it, so
it works on a machine with no internet access and no WebView2 runtime.

There is no auto-updater. A new version is installed the same way as the first one.

## Cutting a release

`bun run release <version>` does all of this and stops before pushing:

1. Refuses to run unless the working tree is clean and the branch is `main`.
2. Writes the version into `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`, then refreshes `src-tauri/Cargo.lock` for that one crate.
3. Runs `bun run check`.
4. Commits as `Release v<version>` and creates the annotated tag `v<version>`.
5. Prints the two `git push` commands.

The version is a bare `major.minor.patch` with no leading `v`. Tauri rejects anything else.
Nothing is pushed, so there is a moment to read the commit before the tag reaches GitHub.

## The signing secrets

Signing is driven by repository secrets alone. `scripts/setup-signing.sh (pass `--apple-only`or`--azure-only` to run one half; each half stores its own secrets as soon as it completes)` is an interactive
wizard that creates every value and stores it with `gh secret set`. Run it once, and again
whenever a credential expires.

### macOS

| Secret                       | What it is                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64 text of the Developer ID Application certificate and its private key, exported from Keychain Access as a `.p12` file. |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen while exporting that `.p12` file.                                                                        |
| `KEYCHAIN_PASSWORD`          | A random string. It unlocks the throwaway keychain the job creates on the runner. It protects nothing outside that runner.   |
| `APPLE_ID`                   | Email address of the Apple account that owns the certificate.                                                                |
| `APPLE_PASSWORD`             | An app-specific password for that Apple account, from appleid.apple.com. Apple rejects the account password.                 |
| `APPLE_TEAM_ID`              | The ten character Team ID. It is also the code in brackets at the end of the certificate name.                               |

A Developer ID Application certificate is the one Apple issues for distribution outside the
Mac App Store. There is no separate `APPLE_SIGNING_IDENTITY` secret: the job imports the
certificate into a keychain, reads the identity string back out of it, and passes that to the
bundler.

Notarization is Apple scanning the signed app and issuing a ticket for it. The bundler staples
the ticket to the `.app` inside the DMG, so a Mac with no internet connection can still see
that Apple approved the app. Apple requires notarization for anything signed with a Developer
ID Application certificate.

### Windows

Azure Artifact Signing, which Microsoft used to call Azure Trusted Signing, holds the
certificate and signs on request. The private key never leaves Azure.

| Secret                                       | What it is                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `AZURE_TENANT_ID`                            | Directory (tenant) ID of the Microsoft Entra ID directory.                                         |
| `AZURE_CLIENT_ID`                            | Application (client) ID of the app registration allowed to sign.                                   |
| `AZURE_CLIENT_SECRET`                        | A client secret for that app registration. It expires, and release builds fail on the day it does. |
| `AZURE_ARTIFACT_SIGNING_ENDPOINT`            | Regional service URL of the signing account, such as `https://wus2.codesigning.azure.net`.         |
| `AZURE_ARTIFACT_SIGNING_ACCOUNT`             | Name of the Artifact Signing account.                                                              |
| `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` | Name of the certificate profile inside that account.                                               |

The app registration needs the **Artifact Signing Certificate Profile Signer** role on the
signing account. Without it, every signing call is refused.

Microsoft validates who you are before it issues a certificate, and that check takes 1 to 20
business days. It runs only in the Azure portal. Until it finishes there is no certificate
profile, so the wizard stores no Azure secret and Windows builds come out unsigned.

The signing tool is [`artifact-signing-cli`](https://crates.io/crates/artifact-signing-cli),
installed on the runner with `cargo install`. `src-tauri/tauri.conf.json` points at it through
`bundle.windows.signCommand`:

```json
"signCommand": {
  "cmd": "cmd",
  "args": ["/C", "artifact-signing-cli", "-e", "%AZURE_ARTIFACT_SIGNING_ENDPOINT%", "%1"]
}
```

Tauri runs that command directly rather than through a shell, and it replaces the `%1`
argument with each file to sign. `artifact-signing-cli` reads the credentials, the account name
and the certificate profile name from the environment on its own, but its `-e` endpoint option
has no environment fallback, which is why the command goes through `cmd /C`: `cmd.exe` expands
`%AZURE_ARTIFACT_SIGNING_ENDPOINT%` before the tool sees it. The upshot is that no account
name, endpoint or credential is written into this repository.

## When the secrets are missing

A tag still builds. Each job checks which secrets are present, and:

- On macOS with no Apple secrets, the certificate import step is skipped, so
  `APPLE_SIGNING_IDENTITY` is never set and the bundler signs and notarizes nothing.
- On Windows with no Azure secrets, the build adds
  `--config {"bundle":{"windows":{"signCommand":null}}}`, which deletes the sign command from
  the effective configuration, so the bundler skips signing instead of failing on a missing
  tool.

Both cases write a notice into the job log saying the artifacts are unsigned. The draft release
is still created and the installers still work, but macOS shows a "cannot be opened because the
developer cannot be verified" dialog and Windows shows a SmartScreen warning, and a person has
to override each one by hand. Unsigned builds are fine for testing and wrong for a clinic.

## Checking a signed build

### macOS

Download the DMG from the release, then:

```sh
# The DMG itself is signed.
codesign --verify --strict --verbose=2 "DIN Replicator_0.2.0_aarch64.dmg"

# Mount it and check the app inside, which is what Gatekeeper actually judges.
hdiutil attach "DIN Replicator_0.2.0_aarch64.dmg"
codesign --verify --deep --strict --verbose=2 "/Volumes/DIN Replicator/DIN Replicator.app"
spctl --assess --type execute --verbose "/Volumes/DIN Replicator/DIN Replicator.app"
xcrun stapler validate "/Volumes/DIN Replicator/DIN Replicator.app"
hdiutil detach "/Volumes/DIN Replicator"
```

What a good result looks like:

- `codesign --verify` prints `valid on disk` and `satisfies its Designated Requirement`.
- `spctl --assess` prints `accepted` and `source=Notarized Developer ID`. A `source=Unnotarized
Developer ID` means the build was signed but not notarized. `rejected` means it was not
  signed.
- `xcrun stapler validate` prints `The validate action worked!`. `does not have a ticket
stapled to it` means notarization did not finish.

To see which certificate signed it:

```sh
codesign --display --verbose=4 "/Volumes/DIN Replicator/DIN Replicator.app"
```

### Windows

In a Developer Command Prompt, where `signtool` is on the path:

```
signtool verify /pa /v "DIN Replicator_0.2.0_x64-setup.exe"
```

`/pa` tells signtool to judge the signature the way Windows judges an application, rather than
against the driver signing rules. A good result ends with `Successfully verified`.

The same check in PowerShell, with nothing extra installed:

```powershell
Get-AuthenticodeSignature ".\DIN Replicator_0.2.0_x64-setup.exe" | Format-List
```

`Status` reads `Valid` and `SignerCertificate` names the certificate. `NotSigned` means the
build was unsigned. `UnknownError` usually means the signature is there but the machine cannot
reach the timestamp or revocation servers.

## Building a signed app on your own Mac

Anyone with the Developer ID Application certificate in their login keychain can produce a
signed, notarized DMG without CI. That is worth doing at least once before the secrets exist,
because it proves the certificate works.

Find the identity, then build with it:

```sh
security find-identity -v -p codesigning
APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<team id>)" bun run tauri build
```

The DMG lands in `src-tauri/target/release/bundle/dmg/`. `bun run tauri build` also notarizes
on its own when `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` are set, which is exactly what
CI does.

To notarize by hand instead, submit the DMG, wait for Apple's answer, and staple the ticket:

```sh
xcrun notarytool submit "src-tauri/target/release/bundle/dmg/DIN Replicator_0.2.0_aarch64.dmg" \
  --apple-id "<apple account email>" \
  --team-id "<team id>" \
  --password "<app-specific password>" \
  --wait
xcrun stapler staple "src-tauri/target/release/bundle/dmg/DIN Replicator_0.2.0_aarch64.dmg"
```

`--wait` blocks until Apple decides, which usually takes a few minutes. If the answer is
`Invalid`, ask for the reasons:

```sh
xcrun notarytool log <submission id> \
  --apple-id "<apple account email>" --team-id "<team id>" --password "<app-specific password>"
```

Storing the credentials once saves retyping them:

```sh
xcrun notarytool store-credentials din-replicator \
  --apple-id "<apple account email>" --team-id "<team id>"
xcrun notarytool submit "<path to dmg>" --keychain-profile din-replicator --wait
```

Windows signing cannot be done from a Mac. `artifact-signing-cli` drives `signtool` from the
Windows SDK, so the Windows installer is only ever signed on the Windows runner.

## Sources

- macOS signing and notarization: <https://v2.tauri.app/distribute/sign/macos/>
- Windows signing: <https://v2.tauri.app/distribute/sign/windows/>
- GitHub Actions pipeline: <https://v2.tauri.app/distribute/pipelines/github/>
- The build action: <https://github.com/tauri-apps/tauri-action>
- Azure Artifact Signing setup: <https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart>
- Azure Artifact Signing roles: <https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles>
