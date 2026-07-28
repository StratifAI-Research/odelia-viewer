// Type-check shim for the isolated custom/ typecheck.
//
// The custom packages build with webpack + babel (types stripped, never
// checked) and at runtime resolve `@ohif/*` to the OHIF platform SOURCE
// (node_modules/@ohif/* symlinks into platform/*). Type-checking against that
// source is not viable here — it drags the entire upstream platform type
// universe (which does not currently `tsc`-parse) into the program. So for the
// isolated custom typecheck we declare every `@ohif/*` entry point as a
// shorthand ambient module, which makes all of its imports `any`. This keeps
// the checker focused on the custom code's own correctness.
// Tightening these to real types is a follow-up.
declare module '@ohif/core';
declare module '@ohif/core/types';
declare module '@ohif/ui';
declare module '@ohif/ui-next';
declare module '@ohif/extension-default';
declare module '@ohif/extension-cornerstone';
declare module '@ohif/mode-longitudinal';
