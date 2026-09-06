# Releasing

Releases follow the repository's protected `develop` → `release/X.Y.Z` → `main` flow.
The release workflow publishes the same npm tarball to GitHub Packages and a GitHub
Release. Publishing that version to the public npm registry remains a deliberate local
maintainer action.

## Repository setup

- Keep the signed-commit and pull-request review rulesets enabled. Release branches
  must be created by an authorized maintainer; `main` requires merge commits.
- Allow Actions to create pull requests. The release job explicitly requests contents,
  packages, and pull-request write permissions; CI has read-only contents access.
- Make the organization `GITLEAKS_LICENSE` secret available to this repository.
- Create a fine-grained personal access token named `BACKMERGE_TOKEN` while signed
  in as `kyaulabs-bot`. Select `kyaulabs` as resource owner, **All repositories**,
  **Contents: Read-only**, **Pull requests: Read and write**, and **No expiration**.
  Approve the token if required by organization policy. If policy prohibits a
  non-expiring token, stop and ask the maintainer; do not silently choose an expiry
  or relax organization policy. Revoke and replace the token if compromised.
- Store it as the organization Actions secret `BACKMERGE_TOKEN`, also available to
  **all repositories**. Both the token's repository access and the secret's repository
  visibility must allow this repo. Do not repurpose the unrelated `BOT_TOKEN` secret.
  Bot-created PRs trigger CI and can be reviewed by `kyau`. Without `BACKMERGE_TOKEN`,
  the workflow falls back to `GITHUB_TOKEN`; those PRs do not trigger CI. A maintainer
  must close and reopen such a PR to trigger the pull-request checks.
- No npmjs.com token is needed in Actions. The workflow never publishes there.

## 1. Prepare a release branch

Start from the current `develop` branch and choose a stable Semantic Version:

```sh
git switch develop
git pull --ff-only origin develop
git switch -c release/X.Y.Z
npm version X.Y.Z --no-git-tag-version --allow-same-version
npm ci
npm run check
npm pack --dry-run
gitleaks git --redact --no-banner
git add package.json package-lock.json
git diff --cached --quiet || git commit -S \
  -m "chore(release): prepare vX.Y.Z" \
  -m "Align the manifest and lockfile for the reviewed GitHub release."
git push --set-upstream origin release/X.Y.Z
```

The manifest version, both root lockfile versions, and the release branch suffix must
match exactly. An initial release may already have the desired version and need no bump
commit. Release branches are exempt from the `<type>/<user>-<six-hex-digits>-<description>`
work-branch convention.

Open a pull request from `release/X.Y.Z` to `main`, obtain the required review, wait for
CI, and merge it with a merge commit. Use `gh-bot pr create` to open maintainer PRs as
`kyaulabs-bot`, then `gh pr review --approve` as `kyau`. Do not disable the rulesets.
Only a merged release PR from this repository automatically triggers publication.

## 2. Automated GitHub publication

After the release PR merges, `.github/workflows/release.yml`:

1. validates the merge commit's ancestry on `main`, release branch, and package metadata;
2. runs ESLint, ShellCheck, type checking, and the coverage suite;
3. builds and validates the publishable npm tarball;
4. generates release notes from Conventional Commits with git-cliff;
5. publishes the tarball to GitHub Packages;
6. creates `vX.Y.Z` and a GitHub Release with the tarball attached; and
7. opens a `main` → `develop` back-merge pull request when needed.

Review and merge the back-merge PR after CI passes to keep `develop` synchronized. Do
not delete `main` or `develop` when merging PRs.

### Recovery and troubleshooting

The workflow can be rerun after a partial failure. It refuses to overwrite an existing
tag at a different commit or a GitHub package with different tarball integrity. Existing
release assets are reconciled, and an existing back-merge PR is reused.

Manual dispatch is only a recovery path and requires the same version plus the full
release merge SHA on `main`. It does not replace the reviewed release pull request:

```sh
gh workflow run release.yml --ref main \
  -f version=X.Y.Z -f merge_sha=FULL_RELEASE_MERGE_SHA
```

If GitHub Packages returns an authorization error, check the workflow's package write
permission and the package's repository access. Only a not-found response permits a new
publication. If the back-merge PR fails to open, check Actions PR permissions and
`BACKMERGE_TOKEN` permissions, repository access, organization approval, and expiration,
then rerun the failed job. `Resource not accessible by personal access token` means
having a nonempty secret is not sufficient: verify that token's PR write permission.
Missing back-merge CI usually means the
workflow fell back to `GITHUB_TOKEN`; close and reopen the PR as a maintainer.

A rerun uses the original workflow revision. If recovery requires a workflow-code
fix, merge the fix through reviewed PRs into `develop` and `main` without using a
`release/` head for the maintenance PR into `main`. Then dispatch the corrected
workflow from `main` with the **original release merge SHA**, not the maintenance
merge SHA. This keeps the release tag and package immutable while using the corrected
automation; do not create another release for a back-merge-only repair.

## 3. Publish the identical tarball to npm

Wait for the GitHub release workflow to pass. Download its asset into a fresh directory
and publish that exact tarball, rather than rebuilding it from a potentially changed
checkout:

```sh
release_dir="$(mktemp -d)"
gh release download vX.Y.Z --repo kyaulabs/pi-images \
  --pattern 'kyaulabs-pi-images-X.Y.Z.tgz' --dir "$release_dir"
npm publish "$release_dir/kyaulabs-pi-images-X.Y.Z.tgz" \
  --registry=https://registry.npmjs.org --access=public
```

Authenticate to the public npm registry with a maintainer account that can publish the
`@kyaulabs` scope. Both registries should receive the exact version reviewed and merged
into `main`. Do not change the manifest or rebuild runtime files between publications.
