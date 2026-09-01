/**
 * Formatting for the chat panel's prompt context and its per-message snapshots.
 *
 * Pure functions, deliberately separated from the panel: what a message says it
 * was answered from is a provenance claim, so the logic that produces it is
 * unit-tested rather than only exercised through the UI.
 *
 * The governing rule here is that a snapshot describes the request, not the
 * outcome. `requestedImageCount` is a bound derived from the viewer's frame
 * counts and the configured slice recipe — the middleware clamps to the real
 * volume depth (`min(num_slices, total_slices)` in `extract_slices`), so the
 * number actually sent can be lower. Every label this module produces therefore
 * says "requested"; nothing here may claim to report what the model received.
 *
 * A series carrying `sentSliceNumbers` is the one exception, and it is not really
 * one: those slices were named individually by SOPInstanceUID, and the middleware
 * either honours every one of them or refuses the message. There is no clamping
 * left to hide, so the count is exact — but the wording stays "requested" so that
 * one rule holds across the whole module.
 */

import { utilities as csUtils } from '@cornerstonejs/core';

import { formatDicomDateTime } from './dicomDateTime';
import { groupNoun } from './sliceAxis';
import type { PromptContextSnapshot, SliceRecipe, SnapshotSeries } from '../types/chatTypes';

/** Separator used throughout the panel's compact metadata lines. */
const SEP = ' · ';

/** Minimal shape needed to label a study; matches an OHIF display set. */
export interface StudyLabelSource {
  StudyInstanceUID?: string;
  StudyDate?: string;
  StudyDescription?: string;
  AccessionNumber?: string;
}

/**
 * Human label for a study: date first, then description.
 *
 * The date leads because a patient commonly has several studies and the date is
 * what distinguishes them — the user's explicit requirement that a study
 * identifier plus series description appear, rather than a bare "Series 4".
 * Falls back through description → accession → shortened UID → a fixed string,
 * so this never returns empty and a chip is never blank.
 *
 * The accession step is there because anonymised research data routinely arrives
 * with the date and description stripped and the accession left in place as the
 * cohort identifier: the UKA breast MRI set carries no (0008,0020) or (0008,1030)
 * on any instance and `UKA_1` in (0008,0050). It is shown bare — the surrounding
 * UI already says this line is the study, and a "Accession " prefix cost more
 * width than it bought.
 */
export function formatStudyLabel(study?: StudyLabelSource | null): string {
  if (!study) {
    return 'Unknown study';
  }
  // Date-only: no time is passed, so `formatDicomDateTime` yields "YYYY-MM-DD"
  // and never invents a 00:00:00 or a timezone.
  const date = formatDicomDateTime(study.StudyDate);
  const description = study.StudyDescription?.trim();

  if (date && description) {
    return `${date}${SEP}${description}`;
  }
  if (date) {
    return date;
  }
  if (description) {
    return description;
  }
  const accession = study.AccessionNumber?.trim();
  if (accession) {
    return accession;
  }
  const uid = study.StudyInstanceUID?.trim();
  if (uid) {
    // Tail, not head: DICOM UIDs share long org prefixes, so the last segment is
    // what actually distinguishes two studies.
    return `Study …${uid.slice(-8)}`;
  }
  return 'Unknown study';
}

/**
 * The one-line stand-in shown when the prompt-context panel is collapsed:
 * `UKA_1 · NCI-dyn DEV · 5 images · region`.
 *
 * Collapsing hides the controls, never the claim. What a message will carry has
 * to stay legible without expanding anything — a composer that looks empty while
 * five images are attached is the same silent disagreement the whole panel is
 * built to avoid — so the image count and the region marker survive the collapse
 * even though the sliders do not.
 */
export function formatContextSummary(input: {
  studyLabel: string;
  seriesDescriptions: string[];
  imageCount: number;
  hasRegion: boolean;
}): string {
  const parts = [input.studyLabel];

  if (input.seriesDescriptions.length === 0) {
    // Said plainly rather than omitted: "no series" is a fact about the next
    // message, not an absence of information.
    parts.push('no series');
    return parts.join(SEP);
  }

  parts.push(
    input.seriesDescriptions.length === 1
      ? input.seriesDescriptions[0]
      : `${input.seriesDescriptions.length} series`
  );
  parts.push(`${input.imageCount} image${input.imageCount === 1 ? '' : 's'}`);
  if (input.hasRegion) {
    parts.push('region');
  }
  return parts.join(SEP);
}

/**
 * `W:1260 L:725` — a window in the terms the viewer's own overlay uses.
 *
 * Width and centre rather than the lower/upper the code carries, because that is
 * what is printed on the image the reader is looking at, and a provenance line
 * they cannot match against the screen is not provenance.
 *
 * The conversion is cornerstone's own `toWindowLevel`, imported rather than
 * re-derived. Re-deriving it is how this line came to read `W:1259` beside an
 * overlay reading `W:1260`: width is `upper - lower + 1`, not `upper - lower`,
 * because DICOM's VOI LUT LINEAR window includes both endpoints, and the centre
 * carries the matching half-unit shift. Half a unit is invisible until it lands
 * on a rounding boundary, and then the footer disagrees with the screen.
 *
 * Formatted with `toFixed(0)` for the same reason: it is what
 * `CustomizableViewportOverlay` prints with, and it rounds halves away from zero
 * where `Math.round` rounds them up — a difference a CT window centred on a
 * negative half would show.
 */
export function formatWindow(voi: { lower: number; upper: number; invert?: boolean }): string {
  const { windowWidth, windowCenter } = csUtils.windowLevel.toWindowLevel(voi.lower, voi.upper);
  const width = windowWidth.toFixed(0);
  const centre = windowCenter.toFixed(0);
  return `W:${width} L:${centre}${voi.invert ? ' inverted' : ''}`;
}

/** Human label for a slice-selection strategy. */
export function formatSliceStrategy(recipe: SliceRecipe): string {
  switch (recipe.strategy) {
    case 'central':
      return recipe.centralPercentage != null ? `central ${recipe.centralPercentage}%` : 'central';
    case 'uniform':
      return 'uniform';
    case 'first_n':
      return 'from the start';
    case 'last_n':
      return 'from the end';
    default:
      return recipe.strategy || 'unknown strategy';
  }
}

/**
 * Just the per-series slice count: `5 slices/series`.
 *
 * Used in the collapsed message footer, which has room for the count but not the
 * strategy — the strategy appears when the snapshot is expanded.
 */
export function formatSliceCount(recipe: SliceRecipe): string {
  const plural = recipe.numSlices === 1 ? '' : 's';
  return `${recipe.numSlices} slice${plural}/series`;
}

/**
 * The slice recipe in one phrase: `5 slices/series · central 60%`.
 *
 * Describes the *recipe*, which is known exactly, rather than an outcome count.
 */
export function formatSliceRecipe(recipe: SliceRecipe): string {
  return `${formatSliceCount(recipe)}${SEP}${formatSliceStrategy(recipe)}`;
}

/**
 * Upper bound on how many images a message will send.
 *
 * Per series the middleware takes `min(num_slices, volume_depth)`. The viewer's
 * `numImageFrames` is the best available proxy for that depth, so this is exact
 * for an ordinary 3D series and an over-estimate only where the two disagree
 * (a 4D series, or frames the middleware's volume reader merges).
 *
 * A series *reporting* zero frames contributes zero, not the full request: it has
 * no images to send, and the composer's own tally says so before the message goes
 * out. Only an unusable frame count — absent, negative, not a number — falls back
 * to the full request, so a genuinely unknown depth is still never understated.
 */
export function requestedImageCount(series: SnapshotSeries[], numSlices: number): number {
  return series.reduce((total, s) => {
    // Named slices are exact, and independent of the configured count.
    if (s.sentSliceNumbers) {
      return total + s.sentSliceNumbers.length;
    }
    if (numSlices <= 0) {
      return total;
    }
    const knownDepth = Number.isFinite(s.numFrames) && s.numFrames >= 0;
    const frames = knownDepth ? s.numFrames : numSlices;
    return total + Math.min(numSlices, frames);
  }, 0);
}

/**
 * The slice numbers a series sent, listed: `18, 22, 26, … 62`.
 *
 * Listed in full rather than summarised, up to `max`, because this is the audit
 * record — "12 slices between 18 and 62" does not let a reader check which ones.
 * Past `max` the list is truncated with an explicit count of what was dropped, so
 * the reader can always tell that something was.
 */
export function formatSliceList(numbers: number[], max = 24): string {
  if (numbers.length === 0) {
    return 'none';
  }
  if (numbers.length <= max) {
    return numbers.join(', ');
  }
  const shown = numbers.slice(0, max).join(', ');
  return `${shown}, +${numbers.length - max} more`;
}

/**
 * How a series' slices were chosen: `18–62 of 103 · 12 slices` when the slices
 * were named, or the configured recipe when they could not be.
 *
 * The two cases are worded differently on purpose. A range names exactly which
 * pixels went out; a recipe only says how the service would pick them.
 */
export function formatSeriesSliceSource(series: SnapshotSeries, recipe: SliceRecipe): string {
  if (series.sentSliceNumbers && series.rangeStart != null && series.rangeEnd != null) {
    const span =
      series.rangeStart === series.rangeEnd
        ? `${series.rangeStart}`
        : `${series.rangeStart}–${series.rangeEnd}`;
    const plural = series.sentSliceNumbers.length === 1 ? '' : 's';
    // The axis the range was expressed on, which on a 4D series is the slice
    // count and not the frame count. `sliceCount` is absent on snapshots taken
    // before phases existed, where the two were the same thing.
    const total = series.sliceCount ?? series.numFrames;
    const parts = [`${span} of ${total}`, `${series.sentSliceNumbers.length} slice${plural}`];
    // Never omitted once a series has more than one group: on a dynamic study it
    // is what makes two identical-looking slices different findings.
    //
    // Read under both names. Transcripts persisted before the rename carry
    // `phaseNumber`/`phaseCount` and no tag, and a message that recorded which
    // one it sent must not come back saying nothing.
    //
    // What compatibility owes them is the ordinal, not the word: the old code
    // called any 4D split a phase, so an old diffusion snapshot recorded a
    // b-value under that name. With no tag to check, the neutral "group" is the
    // most that can truthfully be said about it.
    const groupNumber = series.dimensionGroupNumber ?? series.phaseNumber;
    const groupTotal = series.dimensionGroupCount ?? series.phaseCount;
    if (groupNumber != null && groupTotal != null) {
      const noun = series.dimensionGroupNumber != null ? groupNoun(series.splittingTag) : 'group';
      parts.push(`${noun} ${groupNumber} of ${groupTotal}`);
    }
    // Which window the model saw. Stated either way — "auto" is a fact about the
    // images too, and a reader checking an old answer needs to know the window
    // was not theirs.
    parts.push(series.voi ? formatWindow(series.voi) : 'auto window');
    return parts.join(SEP);
  }
  return formatSliceRecipe(recipe);
}

/**
 * The collapsed one-line footer shown under every message:
 * `Ax T1 post · 8 images · Gemma 4`.
 *
 * Deliberately short. The side panel is ~270px wide, and anything longer elides
 * mid-word — an elided provenance line is worse than a terse one, because the
 * reader cannot tell what was dropped. The slice recipe is therefore left to the
 * expanded view; the image count is the number that matters at a glance.
 *
 * `modelLabel` is passed in (already shortened) rather than derived here, so
 * this module stays free of display-name policy.
 */
export function formatSnapshotSummary(snapshot: PromptContextSnapshot, modelLabel: string): string {
  const parts: string[] = [];

  if (snapshot.series.length === 1) {
    parts.push(snapshot.series[0].description);
  } else if (snapshot.series.length > 1) {
    parts.push(`${snapshot.series.length} series`);
  } else {
    // No images were attached — say so plainly. A message answered from
    // conversation text alone must not look like it was answered from imaging.
    parts.push('No images');
  }

  if (snapshot.series.length > 0) {
    const plural = snapshot.requestedImageCount === 1 ? '' : 's';
    parts.push(`${snapshot.requestedImageCount} image${plural}`);
  }

  if (modelLabel) {
    parts.push(modelLabel);
  }
  return parts.join(SEP);
}

/**
 * Build the immutable snapshot for one outgoing message.
 *
 * Called once at send time. The result is stored on the message and never
 * recomputed, which is the whole point: scrolling back must show what a question
 * was actually asked about, not what the viewport happens to show later.
 */
export function buildPromptContextSnapshot(input: {
  studyInstanceUID: string;
  study?: StudyLabelSource | null;
  series: SnapshotSeries[];
  provider: 'local' | 'cloud';
  model: string;
  sliceRecipe: SliceRecipe;
}): PromptContextSnapshot {
  return {
    studyInstanceUID: input.studyInstanceUID,
    studyLabel: formatStudyLabel(input.study),
    // Copied, not referenced: the panel's selection keeps mutating after send.
    series: input.series.map(s => ({ ...s })),
    provider: input.provider,
    model: input.model,
    sliceRecipe: { ...input.sliceRecipe },
    requestedImageCount: requestedImageCount(input.series, input.sliceRecipe.numSlices),
  };
}
