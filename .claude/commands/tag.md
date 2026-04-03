Create a new release tag and push it to trigger CI.

1. Find the latest tag: `git tag --sort=-v:refname | head -1`
2. Increment the patch version (project uses `0.0.x` format pre-1.0)
3. Create an annotated tag: `git tag -a v0.0.X -m "v0.0.X: <short description>"`
4. Push it: `git push origin v0.0.X`

This triggers the release workflow (npm pack, Docker build+push to ghcr.io, GitHub release).

Never delete and recreate tags — always increment to the next version.
