# Release notifications

The patient list displays a blocking OHIF dialog when the newest public release of
StratifAI-Research/odelia-viewer-platform is newer than the platform version this viewer
is served by. Sites install platform releases, which pin the viewer, so a platform
release is what users can be offered. Both modern and legacy patient lists are
supported. The user must explicitly dismiss the dialog or open release notes before
using the patient list. Escape and outside clicks do not close it. Dismissal is
remembered per user and release.

The platform mounts its VERSION file next to app-config.js as `platform-version.txt`,
and the viewer reads it once per page load. A viewer without that file, such as the
standalone image, never shows the dialog. Settings → About shows the platform version
when the file is present.

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

The viewer's own version is embedded at build time, separately from the OHIF version:
platform/app/package.json productVersion, unless the Docker build argument
ODELIA_RELEASE_TAG overrides it. Both bundlers remove an optional leading v. CI never
sets the argument, so a release ships the image built from the commit that bumped
productVersion. Settings → About shows it with the underlying OHIF version and the
ODELIA repository link, also when update checks are disabled. A viewer release is a
merged productVersion bump; see the [release steps](../../../README.md#publishing-a-release).

To test update detection against the real platform release, serve an older platform
version next to app-config.js:

```sh
echo 0.0.1 > platform-version.txt
docker run --rm -p 3000:80 \
  -v "$PWD/platform-version.txt:/usr/share/nginx/html/platform-version.txt:ro" \
  stratifai/odelia-viewer:latest
```
