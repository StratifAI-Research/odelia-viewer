# Viewer release notifications

The patient list displays a blocking OHIF dialog when the public
StratifAI-Research/odelia-viewer GitHub release is newer than the loaded viewer's
productVersion. Both modern and legacy patient lists are supported. The user must explicitly dismiss the dialog or open release notes before
using the patient list. Escape and outside clicks do not close it. Dismissal is remembered per user and release.

Configure in app-config.js:

```js
viewerUpdates: {
  enabled: false, // Disable external checks, for example in offline installations.
  checkIntervalHours: 24,
},
```

Stable production builds enable checks by default; development and test builds
disable them unless explicitly enabled. Intervals are clamped to 1–168 hours.
GitHub requests omit credentials and the page referrer. Allow api.github.com in
CSP connect-src if checks are enabled. No GitHub token is needed or supported.

Checks are cached per browser origin. GitHub's unauthenticated rate limit is
shared by public IP, so many clients behind one network can still exhaust it.
Failures stay silent and retry after a cooldown. Private repositories and
nightly release tracking are not supported.

The viewer version is embedded at build time, separately from the OHIF version.
Release CI passes the Git tag as the Docker build argument ODELIA_RELEASE_TAG.
Both bundlers remove an optional leading v and embed that value; builds without
the argument fall back to platform/app/package.json productVersion.

Only release CI enforces that its Git tag matches productVersion. Manual builds
can override the version to test update detection against the real GitHub release:

```sh
docker build --build-arg ODELIA_RELEASE_TAG=v0.0.1 -t odelia-viewer:update-test .
```

This is a build argument, not a runtime container environment setting. Publish a
stable GitHub release only after its corresponding Docker image is available.
