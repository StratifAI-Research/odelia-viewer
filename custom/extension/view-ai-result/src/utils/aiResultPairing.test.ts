import {
  findMatch,
  findMatchingHeatmap,
  findMatchingSRForHeatmap,
  referencedSopInstanceUIDs,
  ownSopInstanceUIDs,
  creationEpochMs,
  PAIRING_TIME_WINDOW_MS,
} from './aiResultPairing';

const sr = (uid: string, opts: any = {}) => ({
  displaySetInstanceUID: uid,
  Modality: 'SR',
  SeriesDescription: opts.desc,
  instance: {
    SOPInstanceUID: opts.sop,
    InstanceCreationDate: 'date' in opts ? opts.date : '20240315',
    InstanceCreationTime: 'time' in opts ? opts.time : '101010',
    ReferencedImageSequence: opts.refs
      ? opts.refs.map((r: string) => ({ ReferencedSOPInstanceUID: r }))
      : undefined,
  },
});

const sc = (uid: string, opts: any = {}) => ({
  displaySetInstanceUID: uid,
  Modality: 'SC',
  SeriesDescription: opts.desc,
  instance: {
    SOPInstanceUID: opts.sop,
    InstanceCreationDate: 'date' in opts ? opts.date : '20240315',
    InstanceCreationTime: 'time' in opts ? opts.time : '101010',
    ReferencedImageSequence: opts.refs
      ? opts.refs.map((r: string) => ({ ReferencedSOPInstanceUID: r }))
      : undefined,
  },
});

describe('referencedSopInstanceUIDs / ownSopInstanceUIDs', () => {
  it('collects referenced UIDs from nested sequences', () => {
    const ds = {
      instance: {
        SOPInstanceUID: 'self',
        CurrentRequestedProcedureEvidenceSequence: [
          {
            ReferencedSeriesSequence: [
              { ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: 'deep-1' }] },
            ],
          },
        ],
        ReferencedImageSequence: [{ ReferencedSOPInstanceUID: 'img-1' }],
      },
    };
    const refs = referencedSopInstanceUIDs(ds);
    expect(refs.has('deep-1')).toBe(true);
    expect(refs.has('img-1')).toBe(true);
    // Its own SOP UID is not a *referenced* UID.
    expect(refs.has('self')).toBe(false);
  });

  it('collects own UIDs from instance/instances/images', () => {
    const ds = {
      SOPInstanceUID: 'top',
      instance: { SOPInstanceUID: 'inst' },
      instances: [{ SOPInstanceUID: 'a' }, { SOPInstanceUID: 'b' }],
      images: [{ SOPInstanceUID: 'c' }],
    };
    const own = ownSopInstanceUIDs(ds);
    expect([...own].sort()).toEqual(['a', 'b', 'c', 'inst', 'top']);
  });
});

describe('creationEpochMs', () => {
  it('returns undefined when time is missing (preserves date+time contract)', () => {
    expect(creationEpochMs(sr('x', { time: undefined }))).toBeUndefined();
  });
  it('parses fractional seconds', () => {
    const a = creationEpochMs(sr('a', { time: '101010' }))!;
    const b = creationEpochMs(sr('b', { time: '101010.5' }))!;
    expect(b - a).toBe(500);
  });
});

describe('findMatch — time proximity', () => {
  it('matches identical date+time', () => {
    expect(findMatch(sr('sr'), [sc('sc')])?.displaySetInstanceUID).toBe('sc');
  });

  it('matches sub-second / fractional differences within the window', () => {
    const match = findMatch(sr('sr', { time: '101010' }), [sc('sc', { time: '101010.500000' })]);
    expect(match?.displaySetInstanceUID).toBe('sc');
  });

  it('matches a one-second rounding difference within the window', () => {
    expect(PAIRING_TIME_WINDOW_MS).toBeGreaterThanOrEqual(1000);
    const match = findMatch(sr('sr', { time: '101010' }), [sc('sc', { time: '101011' })]);
    expect(match?.displaySetInstanceUID).toBe('sc');
  });

  it('does not match series far apart in time', () => {
    expect(findMatch(sr('sr', { time: '101010' }), [sc('sc', { time: '120000' })])).toBeNull();
  });

  it('picks the closest candidate among several', () => {
    const match = findMatch(sr('sr', { time: '101010' }), [
      sc('far', { time: '101013' }), // 3s -> outside window
      sc('near', { time: '101011' }), // 1s -> inside window
    ]);
    expect(match?.displaySetInstanceUID).toBe('near');
  });

  it('returns null for no candidates or missing timestamps', () => {
    expect(findMatch(sr('sr'), [])).toBeNull();
    expect(findMatch(sr('sr', { time: undefined }), [sc('sc', { time: undefined })])).toBeNull();
  });
});

describe('findMatch — referenced-UID identity', () => {
  it('pairs by referenced SOP UID even when timestamps differ wildly', () => {
    const heatmap = sc('sc', { sop: 'sop-sc', time: '235959' });
    const report = sr('sr', { time: '101010', refs: ['sop-sc'] });
    expect(findMatch(report, [heatmap])?.displaySetInstanceUID).toBe('sc');
  });

  it('disambiguates same-timestamp candidates by referenced identity', () => {
    // Two heatmaps share the SR timestamp; only one is actually referenced.
    const wrong = sc('wrong', { sop: 'sop-wrong', time: '101010' });
    const right = sc('right', { sop: 'sop-right', time: '101010' });
    const report = sr('sr', { time: '101010', refs: ['sop-right'] });
    expect(findMatch(report, [wrong, right])?.displaySetInstanceUID).toBe('right');
  });

  it('pairs when the candidate references the source (reverse direction)', () => {
    const report = sr('sr', { sop: 'sop-sr', time: '000000' });
    const heatmap = sc('sc', { time: '235959', refs: ['sop-sr'] });
    expect(findMatch(report, [heatmap])?.displaySetInstanceUID).toBe('sc');
  });
});

describe('findMatchingHeatmap / findMatchingSRForHeatmap', () => {
  it('are symmetric wrappers over findMatch', () => {
    const report = sr('sr', { sop: 'sop-sr' });
    const heatmap = sc('sc', { sop: 'sop-sc', refs: ['sop-sr'] });
    expect(findMatchingHeatmap(report, [heatmap])?.displaySetInstanceUID).toBe('sc');
    expect(findMatchingSRForHeatmap(heatmap, [report])?.displaySetInstanceUID).toBe('sr');
  });

  it('uses model name only as a tiebreaker among equal candidates', () => {
    // Two heatmaps at the same instant; model-name hint breaks the tie.
    const a = sc('a', { time: '101010', desc: 'Heatmap ModelX overlay' });
    const b = sc('b', { time: '101010', desc: 'Heatmap ModelY overlay' });
    expect(
      findMatchingHeatmap(sr('sr', { time: '101010' }), [a, b], 'ModelY')?.displaySetInstanceUID
    ).toBe('b');
  });
});
