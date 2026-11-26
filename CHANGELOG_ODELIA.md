# ODELIA Viewer changelog

What changed in each release of the ODELIA Viewer, newest first. `CHANGELOG.md` and the
package changelogs belong to OHIF upstream. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with one local rule: every
version has all eight headings below, in this order, and a heading with nothing new
says N/A. CI checks the format, so the file can be exported as data
(`.github/scripts/change_control.py export`).

A pull request that users or admins would notice replaces N/A under the right heading of
`## [Unreleased]` with a line ending in its PR number, e.g. `(#150)`. **Upgrade notes**
say what sites must do when updating; **Known limitations** lists limitations that are
new or changed in that version. A release bumps `VERSION_ODELIA`, renames
`## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and adds a fresh `## [Unreleased]` with
N/A under every heading above it; that version's section, without its N/A headings,
becomes the release's notes on GitHub.

## [Unreleased]

### Added

N/A

### Changed

N/A

### Deprecated

N/A

### Removed

N/A

### Fixed

N/A

### Security

N/A

### Known limitations

N/A

### Upgrade notes

N/A

## [2.3.1] - 2026-11-12

### Added

N/A

### Changed

- **4D loading:** load the active phase first so it can display sooner (#143).
- **Update notice:** report new platform releases, matching the stack installed
  at each site (#145).

### Deprecated

N/A

### Removed

N/A

### Fixed

- **VolumeRenderer (OpenGL/NVIDIA):** fix division by zero for axis-aligned rays
  in the vtk volume shader and disable multisample anti-aliasing to avoid
  intermittent black frames (#147).

### Security

N/A

### Known limitations

N/A

### Upgrade notes

N/A

## [2.3.0] - 2026-10-23

### Added

- **AI chat panel:** traceable prompt context, 4D-correct slices, the reader's window and
  a region of interest (#132).
- **Update notice:** the patient list tells users when a newer viewer release is
  available (#137).

### Changed

- **Chat:** searchable model lists, window-sized slice counts and provider-neutral labels
  (#135).
- **Release process:** Docker publishing and release fixes (#141, #142).

### Deprecated

N/A

### Removed

N/A

### Fixed

N/A

### Security

- **Deployment:** hardened, while keeping existing workflows working (#136).

### Known limitations

N/A

### Upgrade notes

N/A
