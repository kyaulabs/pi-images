# Repository guidance

## Scope

`pi-images` translates the Kitty graphics emitted by Pi into image output that tmux can track. Ghostty uses Kitty Unicode placeholders. Terminals that implement SIXEL may use SIXEL.

Limit the bridge to interactive tmux sessions. Fail closed: malformed, incomplete, oversized, or unsupported image commands must not leak payload bytes to the terminal.

## Development rules

- Use strict TypeScript.
- Prefer pure JavaScript runtime dependencies.
- Preserve arbitrary byte-boundary handling in `KittyStreamTranslator`.
- Wrap Kitty uploads and virtual-placement commands in tmux passthrough.
- Emit Kitty placeholder cells as normal pane text so tmux owns their positions.
- Do not advertise SIXEL for a terminal that does not implement it.
- Keep transmission, image, pixel, and cache limits explicit and tested.
- Keep `pi-images.tmux` compatible with TPM and valid under ShellCheck.
- Add a regression test for parser, cursor, cache, protocol, or activation changes.
- Update README setup and troubleshooting text when public behavior changes.

## Verification

Run:

```sh
npm run check
npm pack --dry-run
```

Protocol changes require a visual test in the affected terminal and tmux mode. Test clearing, scrolling, resizing, redraws, and window switching when placement behavior changes.

## Branches, commits, and reviews

Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [RELEASING.md](RELEASING.md).

- Preserve existing local edits. Keep unrelated changes in separate, atomic commits.
- Branch from current `develop` using `<type>/kyau-<six-hex-digits>-<description>`.
  Generate the ID with `openssl rand -hex 3`; choose the Conventional Commit type
  appropriate to the work, for example `ci/kyau-86a415-workflow-parity`.
- Release branches are the exception: use `release/X.Y.Z` so the release workflow can
  validate the stable version. Create them as an authorized maintainer.
- Sign commits with `git commit -S`. Use detailed Conventional Commit messages with
  rationale, constraints, and validation evidence. Wrap body lines at 100 characters
  or fewer, preferably 72. Use real newlines, not literal `\n` sequences.
- Open maintainer PRs with `gh-bot pr create` as `kyaulabs-bot`. Review and merge with
  regular `gh` as `kyau`, after inspecting the diff and checks. Check identities before
  acting; do not expose authentication tokens.
- Keep rulesets enabled. `develop` and `main` require signed commits and approving
  reviews; `main` requires merge commits. Never force-push protected history, use an
  administrative merge override, or weaken checks to hide a failure.
- Pre-validate the exact final merge message with local Commitlint before calling
  `gh pr merge`. GitHub-created merge commits do not run local commit hooks. Supply
  both the validated subject and body explicitly, and use `--match-head-commit` to
  ensure the reviewed head has not changed. Do not delete `main` or `develop`.

Example merge-message validation (replace the text and PR/head placeholders):

```sh
subject='chore(release): merge vX.Y.Z (#N)'
body='Publish the reviewed package after CI and maintainer approval.'
printf '%s\n\n%s\n' "$subject" "$body" | npx --no-install commitlint --verbose
# Only continue if validation passes.
gh pr merge N --merge --match-head-commit FULL_REVIEWED_HEAD_SHA \
  --subject "$subject" --body "$body"
```

## Workflow and release operations

- Keep CI and release behavior aligned with `../pi-widgets`, retaining this repo's
  ShellCheck gate and existing greater-than-95-percent coverage thresholds.
- CI runs Node.js 22.19.0 and 24, package checks, commit-message validation, and
  full-history Gitleaks. Pin actions, keep permissions narrow, and validate workflow
  edits with actionlint and ShellCheck in addition to the package checks above.
- On this workstation, `~/bin/shellcheck` is an interactive wrapper that pipes to
  `less` and can mask failures. Use `/usr/bin/shellcheck` for reliable exit status,
  `actionlint -shellcheck /usr/bin/shellcheck`, and `PATH="/usr/bin:$PATH" npm run check`.
- Prepare a release from `develop`, matching `package.json`, both root lockfile
  versions, and `release/X.Y.Z`. Do not create an unnecessary bump/empty commit if
  the initial version already matches. Open the release PR against `main`.
- Except for an explicitly authorized and recorded exception, wait for all checks
  to pass before merging. Report failures accurately; never describe an excepted
  failing run as green.
- A merged release PR publishes the validated tarball to GitHub Packages, creates
  the tag and GitHub Release with git-cliff notes and the tarball asset, and opens
  a `main` → `develop` back-merge PR. Watch the release workflow to completion and
  verify the tag's commit and release asset before reporting success.
- Use the dedicated organization `BACKMERGE_TOKEN` secret for back-merge PRs.
  Its fine-grained token must be owned by `kyaulabs-bot`, use `kyaulabs` as resource
  owner, cover **all kyaulabs repositories**, and grant Contents read plus Pull
  requests read/write. The organization secret must also be visible to all repos.
  The maintainer explicitly requires **No expiration**. Confirm organization
  approval; if policy prevents a non-expiring token, ask the maintainer instead of
  choosing an expiry or relaxing policy. Revoke/replace compromised credentials.
  Do not repurpose or overwrite the unrelated `BOT_TOKEN` secret. GitHub requires token
  creation in the bot account's settings; do not claim `gh` can create a new PAT.
  Never print tokens or ask the user to paste them into chat.
- Bot-token PRs trigger CI normally. `GITHUB_TOKEN` is the fallback and does not
  trigger PR CI; if used, close/reopen the PR as a maintainer. Keep the organization
  `GITLEAKS_LICENSE` secret available.
- Review and merge the back-merge PR after checks. Verify `develop` contains the
  release commit, synchronize the local checkout, and leave a clean working tree.
- For partial failures, use the documented rerun/manual-dispatch recovery with the
  same version and full release merge SHA on `main`. Do not overwrite mismatched
  tags or package contents, republish a different tarball under the same version,
  or bypass the reviewed release flow. A rerun uses the original workflow revision;
  if workflow code needs repair, merge the fix into `develop` and then `main` via
  reviewed maintenance PRs with a non-`release/` head. Dispatch the corrected
  workflow on `main` using the original release merge SHA, preserving its tag and
  tarball. Do not accidentally trigger a new release for automation-only recovery.
- npmjs.com publication remains a manual maintainer action. Do not publish there
  or add an npm publishing token to Actions. Give the maintainer the command to
  publish the exact GitHub release tarball, rather than rebuilding it.

## Recorded v0.1.0 back-merge recovery

- Release PR #3 merged as `f6ebd4ef6bb102bbbfc5115c8e172fb064943351`.
  Release run `34051828667` successfully published GitHub Packages and created
  `v0.1.0` with its tarball, then failed to create the back-merge PR with
  `Resource not accessible by personal access token`.
- The unrelated organization `BOT_TOKEN` was present but lacked the required PR
  permission. Its presence did not prove suitability. `pi-widgets` used the
  automatic `GITHUB_TOKEN`; switching to a PAT here was intended to trigger CI.
- The maintainer requested a new, dedicated `BACKMERGE_TOKEN` owned by
  `kyaulabs-bot` for automatic back-merge PRs across all kyaulabs repositories.
  Leave `BOT_TOKEN` unchanged. Validate the new secret through the corrected
  workflow before declaring recovery complete; never waive an authorization error.
- For recovery, dispatch the corrected workflow with version `0.1.0` and the
  original merge SHA above. Preserve the published tag and tarball, verify the
  existing package integrity, and complete the reviewed back-merge into `develop`.

## Recorded v0.1.0 commit-message exception

The maintainer explicitly approved proceeding with this one historical formatting
failure during v0.1.0 preparation:

- PR #2's published merge commit `3c92e19c8dd8b2afb41c4bad1e8bf4db9cac9f70`
  (`ci: merge workflow parity with pi-widgets (#2)`) contains a 109-character body
  line. Commitlint correctly reports `body-max-line-length` against its 100-character
  limit whenever a checked commit range includes that merge.
- The three constituent signed commits pass Commitlint. Node.js 22.19.0/24 package
  checks and secret scanning passed. This is a message-formatting exception only,
  not an exception for code, tests, security, signatures, or review requirements.
- Preserve the immutable published history. Editing the PR title/body cannot change
  the merge commit; amending it would change its SHA and require a prohibited
  rewrite of `develop`. Do not relax Commitlint or add an ignore for this commit.
- Record the exception on release PR #3 and in reviews of affected runs. An affected
  release/main CI run may remain failed solely for this known line-length error;
  inspect logs to confirm there are no additional failures before proceeding.
- This permission is limited to this commit during v0.1.0 integration/release.
  New commits and merge messages must pass validation. Obtain fresh authorization
  for any unrelated failure rather than treating this as a standing waiver.
