# Releasing

How to cut a new release of Willet. The whole process is driven by a git tag — you push a `vX.Y.Z` tag, and GitHub Actions does the rest.

## TL;DR

```bash
git checkout main
git pull
git tag v0.2.0        # pick the new version (no package.json edits needed)
git push origin v0.2.0
```

Then watch the **Release** workflow in the Actions tab. When it's green, the new version is live on npm, GitHub Container Registry, and the GitHub Releases page.

## What a release publishes

A single `v*` tag fans out to:

- **npm** — `@willet/shared`, `@willet/mcp`, and `@willet/cli` (so `npm i -g @willet/mcp` / `@willet/cli` get the new version)
- **GitHub Container Registry** — the server Docker image at `ghcr.io/<owner>/willet:<version>` and `:latest`
- **GitHub Releases** — a release with auto-generated notes and the packed npm tarballs attached

## The one thing to remember: the tag is the version

You do **not** bump version numbers in `package.json` by hand. The `package.json` files stay at placeholder versions (e.g. `0.0.1`); CI overwrites them from the tag at publish time:

```
VERSION="${GITHUB_REF_NAME#v}"   # v0.2.0 -> 0.2.0
npm --no-git-tag-version version "$VERSION" --workspaces --include-workspace-root
```

So the only place you choose the version is the tag name. Use [semantic versioning](https://semver.org/): bump patch for fixes, minor for features, major for breaking changes.

## Step by step

1. **Make sure `main` is the code you want to ship.** Releases build from the tagged commit. Confirm CI is green on `main`.
2. **Pick the new version.** Look at the latest tag (`git tag --sort=-v:refname | head`) and increment per semver.
3. **Tag and push.**
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
   Use the exact form `vX.Y.Z` — the workflow only triggers on tags matching `v*`.
4. **Watch the workflow.** Open the Actions tab → the **Release** run for your tag. It runs `test` first, then publishes npm packages, builds/pushes the Docker image, and creates the GitHub Release. If `test` fails, nothing publishes.
5. **Verify.**
   ```bash
   npm view @willet/cli version   # should show your new version
   npm view @willet/mcp version
   ```
   And check the new entry on the GitHub Releases page.

## If something goes wrong

**Never delete and re-push a tag.** Re-tagging the same version produces conflicting published artifacts (npm refuses to overwrite an existing version anyway). If a release fails partway or you need to fix something, land the fix on `main` and cut the **next** patch version (e.g. `v0.2.1`).

Partial publishes are possible: npm packages publish one at a time (`@willet/shared` → `@willet/mcp` → `@willet/cli`), so a mid-job failure can leave some packages published and others not. The fix is the same — bump to a new version and tag again. Already-published versions are skipped naturally because npm won't accept a duplicate.

## Prerequisites (one-time setup, already configured)

These are wired up at the repo/org level, not per-release:

- npm publish access for the `@willet` scope (publishing uses npm provenance via the workflow's `id-token: write` permission).
- `ghcr.io` push access via the built-in `GITHUB_TOKEN`.

The workflow definition is [`.github/workflows/release.yml`](.github/workflows/release.yml).
