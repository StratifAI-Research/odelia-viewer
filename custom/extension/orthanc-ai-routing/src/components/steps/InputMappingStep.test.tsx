import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { InputMappingStep } from './InputMappingStep';
import type { InputConfiguration } from '../../services/OrthancAIService';
import type { SeriesInfo } from '../SeriesSelector';

function series(over: Partial<SeriesInfo> = {}): SeriesInfo {
  return {
    displaySetInstanceUID: 'd',
    SeriesInstanceUID: 's1',
    SeriesDescription: 'T1 axial',
    SeriesNumber: 1,
    Modality: 'MR',
    numImageFrames: 3,
    StudyInstanceUID: 'st',
    ...over,
  };
}

const config: InputConfiguration = {
  id: 'c1',
  name: 'Dual',
  description: 'two series',
  inputs: [
    { key: 't1', label: 'T1', required: true, modality: 'MR' },
    { key: 't2', label: 'T2', required: false },
  ],
};

const available = [
  series({ SeriesInstanceUID: 's1', SeriesDescription: 'T1 axial', Modality: 'MR' }),
  series({ SeriesInstanceUID: 's2', SeriesDescription: 'CT scan', Modality: 'CT' }),
];

const base = {
  selectedConfig: config,
  availableSeries: available,
  mapping: { t1: 's1', t2: null } as Record<string, string | null>,
  onSetInputSeries: () => {},
  onAutoDetect: () => {},
  isValid: true,
  onNext: () => {},
  onBack: () => {},
};

describe('InputMappingStep', () => {
  it('auto-detects on mount when no mapping exists yet', () => {
    const onAutoDetect = jest.fn();
    render(<InputMappingStep {...base} mapping={{}} onAutoDetect={onAutoDetect} />);
    expect(onAutoDetect).toHaveBeenCalledWith(config, available);
  });

  it('does not auto-detect on mount when a mapping is already present', () => {
    const onAutoDetect = jest.fn();
    render(<InputMappingStep {...base} onAutoDetect={onAutoDetect} />);
    expect(onAutoDetect).not.toHaveBeenCalled();
  });

  it('renders required markers and a Required hint for unmapped required inputs', () => {
    render(<InputMappingStep {...base} mapping={{ t1: null, t2: null }} />);
    expect(screen.getByText('Required')).toBeTruthy(); // t1 required + unmapped
  });

  it('filters select options by the input modality', () => {
    render(<InputMappingStep {...base} />);
    // t1 is MR-only → its dropdown lists the MR series but not the CT one.
    const t1Select = screen.getAllByRole('combobox')[0];
    const t1Options = within(t1Select).getAllByRole('option').map(o => o.textContent || '');
    expect(t1Options.some(o => /T1 axial/.test(o))).toBe(true);
    expect(t1Options.some(o => /CT scan/.test(o))).toBe(false);
  });

  it('calls onSetInputSeries when a series is picked', () => {
    const onSetInputSeries = jest.fn();
    render(<InputMappingStep {...base} mapping={{ t1: null, t2: null }} onSetInputSeries={onSetInputSeries} />);
    const t1Select = screen.getAllByRole('combobox')[0];
    fireEvent.change(t1Select, { target: { value: 's1' } });
    expect(onSetInputSeries).toHaveBeenCalledWith('t1', 's1');
  });

  it('passes null to onSetInputSeries when the blank option is selected', () => {
    const onSetInputSeries = jest.fn();
    render(<InputMappingStep {...base} onSetInputSeries={onSetInputSeries} />);
    const t1Select = screen.getAllByRole('combobox')[0];
    fireEvent.change(t1Select, { target: { value: '' } });
    expect(onSetInputSeries).toHaveBeenCalledWith('t1', null);
  });

  it('labels a series by number when its description is empty', () => {
    const noDesc = series({ SeriesInstanceUID: 's3', SeriesDescription: '', SeriesNumber: 9, Modality: 'MR' });
    render(<InputMappingStep {...base} availableSeries={[noDesc]} mapping={{}} onAutoDetect={jest.fn()} />);
    expect(screen.getAllByText(/Series 9 \(MR/).length).toBeGreaterThan(0);
  });

  it('fires the Auto-detect button, and disables Next when invalid', () => {
    const onAutoDetect = jest.fn();
    render(<InputMappingStep {...base} isValid={false} onAutoDetect={onAutoDetect} />);
    fireEvent.click(screen.getByText('Auto-detect'));
    expect(onAutoDetect).toHaveBeenCalledWith(config, available);
    expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(true);
  });
});
