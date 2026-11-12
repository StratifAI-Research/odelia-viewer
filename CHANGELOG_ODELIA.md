# ODELIA Viewer changelog

What changed in each release of the ODELIA Viewer, newest first. Every `VERSION_ODELIA`
bump adds a section here, and that section becomes the release's notes on GitHub.
`CHANGELOG.md` and the package changelogs belong to OHIF upstream.

## 2.3.1

- **VolumeRenderer (OpenGL/NVIDIA):** fix division by zero for axis-aligned rays
  in the vtk volume shader and disable multisample anti-aliasing to avoid
  intermittent black frames.
- **4D loading:** load the active phase first so it can display sooner (#143).
- **Update notice:** report new platform releases, matching the stack installed
  at each site (#145).

## 2.3.0

- **AI chat panel:** traceable prompt context, 4D-correct slices, the reader's window and
  a region of interest (#132).
- **Chat:** searchable model lists, window-sized slice counts and provider-neutral labels
  (#135).
- **Update notice:** the patient list tells users when a newer viewer release is
  available (#137).
- **Deployment:** hardened, while keeping existing workflows working (#136).
- **Release process:** Docker publishing and release fixes (#141, #142).
