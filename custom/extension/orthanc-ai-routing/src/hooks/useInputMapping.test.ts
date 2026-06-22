import { renderHook, act } from '@testing-library/react';
import { useInputMapping } from './useInputMapping';
import type { ModelManifest } from '../services/OrthancAIService';

function series(over: Partial<any> = {}) {
  return {
    displaySetInstanceUID: 'd',
    SeriesInstanceUID: 's',
    SeriesDescription: '',
    SeriesNumber: 1,
    Modality: 'MR',
    numImageFrames: 1,
    StudyInstanceUID: 'st',
    ...over,
  };
}

const manifest: ModelManifest = {
  model_id: 'm1',
  model_name: 'M',
  version: '1',
  input_configurations: [
    {
      id: 'c1',
      name: 'cfg',
      inputs: [
        { key: 't1', label: 'T1', required: true, modality: 'MR', auto_detect_patterns: ['^T1'] },
        { key: 't2', label: 'T2', required: false, auto_detect_patterns: ['^T2'] },
      ],
    },
  ],
};

const available = [
  series({ SeriesInstanceUID: 's1', SeriesDescription: 'T1 axial', Modality: 'MR' }),
  series({ SeriesInstanceUID: 's2', SeriesDescription: 'T2 flair', Modality: 'MR' }),
];

describe('useInputMapping', () => {
  it('initializes selectedConfigId to the first config, null when manifest is null', () => {
    expect(renderHook(() => useInputMapping(manifest)).result.current.selectedConfigId).toBe('c1');
    expect(renderHook(() => useInputMapping(null)).result.current.selectedConfigId).toBeNull();
  });

  it('setSelectedConfigId switches the config and clears the mapping', () => {
    const { result } = renderHook(() => useInputMapping(manifest));
    act(() => result.current.setInputSeries('t1', 's1'));
    act(() => result.current.setSelectedConfigId('c1'));
    expect(result.current.mapping).toEqual({});
  });

  it('setInputSeries sets, overwrites, and nulls a single role key', () => {
    const { result } = renderHook(() => useInputMapping(manifest));
    act(() => result.current.setInputSeries('t1', 's1'));
    expect(result.current.mapping.t1).toBe('s1');
    act(() => result.current.setInputSeries('t1', 's2'));
    expect(result.current.mapping.t1).toBe('s2');
    act(() => result.current.setInputSeries('t1', null));
    expect(result.current.mapping.t1).toBeNull();
  });

  it('autoDetect maps by pattern + modality without reusing a UID', () => {
    const { result } = renderHook(() => useInputMapping(manifest));
    act(() => result.current.autoDetect(manifest.input_configurations[0], available));
    expect(result.current.mapping).toEqual({ t1: 's1', t2: 's2' });
    expect(result.current.isValid).toBe(true);
    expect(result.current.getInputMapping()).toEqual({ t1: 's1', t2: 's2' });
    expect(result.current.getSelectedSeriesUIDs().sort()).toEqual(['s1', 's2']);
  });

  it('autoDetect leaves unmatched required keys null and skips invalid regex', () => {
    const cfg = {
      id: 'c1',
      name: 'cfg',
      inputs: [
        { key: 't1', label: 'T1', required: true, auto_detect_patterns: ['('] }, // invalid regex
        { key: 'tx', label: 'TX', required: true, auto_detect_patterns: ['^NOPE'] },
      ],
    };
    const { result } = renderHook(() => useInputMapping({ ...manifest, input_configurations: [cfg] }));
    act(() => result.current.autoDetect(cfg, available));
    expect(result.current.mapping).toEqual({ t1: null, tx: null });
    expect(result.current.isValid).toBe(false);
  });

  it('isValid ignores optional inputs and getInputMapping drops nulls', () => {
    const { result } = renderHook(() => useInputMapping(manifest));
    act(() => result.current.setInputSeries('t1', 's1')); // required only
    expect(result.current.isValid).toBe(true);
    expect(result.current.getInputMapping()).toEqual({ t1: 's1' });
  });

  it('reset restores the first config id and empties the mapping', () => {
    const { result } = renderHook(() => useInputMapping(manifest));
    act(() => result.current.setInputSeries('t1', 's1'));
    act(() => result.current.reset());
    expect(result.current.selectedConfigId).toBe('c1');
    expect(result.current.mapping).toEqual({});
  });

  it('autoDetect does not assign the same series UID to two competing inputs', () => {
    const cfg = {
      id: 'c1',
      name: 'cfg',
      inputs: [
        { key: 'a', label: 'A', required: true, auto_detect_patterns: ['^T1'] },
        { key: 'b', label: 'B', required: false, auto_detect_patterns: ['^T1'] },
      ],
    };
    const only = [series({ SeriesInstanceUID: 's1', SeriesDescription: 'T1 axial' })];
    const { result } = renderHook(() => useInputMapping({ ...manifest, input_configurations: [cfg] }));
    act(() => result.current.autoDetect(cfg, only));
    expect(result.current.mapping.a).toBe('s1');
    expect(result.current.mapping.b).toBeNull(); // not reused
  });

  it('autoDetect works with no modality filter and an undefined SeriesDescription', () => {
    const cfg = {
      id: 'c1',
      name: 'cfg',
      inputs: [{ key: 'a', label: 'A', required: true, auto_detect_patterns: ['^T1'] }], // no modality
    };
    const srs = [
      series({ SeriesInstanceUID: 's1', SeriesDescription: undefined, Modality: 'CT' }),
      series({ SeriesInstanceUID: 's2', SeriesDescription: 'T1 axial', Modality: 'CT' }),
    ];
    const { result } = renderHook(() => useInputMapping({ ...manifest, input_configurations: [cfg] }));
    act(() => result.current.autoDetect(cfg, srs));
    expect(result.current.mapping).toEqual({ a: 's2' });
  });

  it('autoDetect returns null for an input with no auto_detect_patterns', () => {
    const cfg = {
      id: 'c1',
      name: 'cfg',
      inputs: [{ key: 'a', label: 'A', required: false }], // no auto_detect_patterns
    };
    const { result } = renderHook(() => useInputMapping({ ...manifest, input_configurations: [cfg] }));
    act(() => result.current.autoDetect(cfg, available));
    expect(result.current.mapping.a).toBeNull();
  });

  it('setSelectedConfigId switching to a different config clears the mapping', () => {
    const multi: ModelManifest = {
      ...manifest,
      input_configurations: [
        manifest.input_configurations[0],
        { id: 'c2', name: 'cfg2', inputs: [{ key: 'x', label: 'X', required: true }] },
      ],
    };
    const { result } = renderHook(() => useInputMapping(multi));
    act(() => result.current.setInputSeries('t1', 's1'));
    act(() => result.current.setSelectedConfigId('c2'));
    expect(result.current.selectedConfigId).toBe('c2');
    expect(result.current.mapping).toEqual({});
  });

  it('reset with a null manifest sets selectedConfigId to null', () => {
    const { result } = renderHook(() => useInputMapping(null));
    act(() => result.current.setInputSeries('t1', 's1'));
    act(() => result.current.reset());
    expect(result.current.selectedConfigId).toBeNull();
    expect(result.current.mapping).toEqual({});
  });

  it('isValid transitions true -> false when a required input is cleared', () => {
    const { result } = renderHook(() => useInputMapping(manifest));
    act(() => result.current.setInputSeries('t1', 's1'));
    expect(result.current.isValid).toBe(true);
    act(() => result.current.setInputSeries('t1', null));
    expect(result.current.isValid).toBe(false);
  });
});
