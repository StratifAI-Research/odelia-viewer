import React from 'react';
import { installConsoleErrorFilter } from '../../test-utils/harness';
import { render, screen, fireEvent } from '@testing-library/react';
import { StudyBrowserNested } from './StudyBrowserNested';

const makeServices = (over: any = {}) => ({
  services: {
    displaySetService: { getDisplaySetByUID: jest.fn(), deleteDisplaySet: jest.fn() },
    uiDialogService: { show: jest.fn() },
    uiNotificationService: { show: jest.fn() },
    aiResultsService: { removeDisplaySetsFromCache: jest.fn() },
    ...over,
  },
});

const study = (over: any = {}) => ({
  studyInstanceUid: 'study-1',
  date: '2024-03-15',
  description: 'Breast MRI',
  numInstances: 3,
  originals: [{ displaySetInstanceUID: 'orig-1' }, { displaySetInstanceUID: 'orig-2' }],
  aiGroups: [
    {
      key: 'grp-1',
      label: 'BreastNet result',
      displaySets: [{ displaySetInstanceUID: 'ai-1' }],
    },
  ],
  ...over,
});

const baseProps = (over: any = {}) => ({
  tabs: [{ name: 'all', label: 'All', studies: [study()] }],
  activeTabName: 'all',
  expandedStudyInstanceUIDs: [],
  onClickTab: jest.fn(),
  onClickStudy: jest.fn(),
  onClickThumbnail: jest.fn(),
  onDoubleClickThumbnail: jest.fn(),
  activeDisplaySetInstanceUIDs: [],
  servicesManager: makeServices(),
  commandsManager: { runCommand: jest.fn() },
  ...over,
});

// Swallow only the testing-library/React ReactDOMTestUtils.act deprecation
// (environmental, fires on effect-driven first renders), re-emit anything else.
installConsoleErrorFilter();

describe('StudyBrowserNested', () => {
  it('renders the settings row when showSettings is true (default)', () => {
    render(<StudyBrowserNested {...baseProps()} />);
    expect(screen.getByTestId('study-browser-view-options')).toBeTruthy();
    expect(screen.getByTestId('study-browser-sort')).toBeTruthy();
  });

  it('omits the settings row when showSettings is false', () => {
    render(<StudyBrowserNested {...baseProps({ showSettings: false })} />);
    expect(screen.queryByTestId('study-browser-view-options')).toBeNull();
  });

  it('renders the study header for the active tab', () => {
    render(<StudyBrowserNested {...baseProps()} />);
    expect(screen.getByText('2024-03-15')).toBeTruthy();
    expect(screen.getByText('Breast MRI')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders no studies when the active tab does not match any tab', () => {
    render(<StudyBrowserNested {...baseProps({ activeTabName: 'missing' })} />);
    expect(screen.queryByText('Breast MRI')).toBeNull();
  });

  it('keeps expanded content collapsed when the study is not expanded', () => {
    render(<StudyBrowserNested {...baseProps()} />);
    expect(screen.queryByTestId('thumbnail-list')).toBeNull();
  });

  it('shows thumbnail lists and the AI group when the study is expanded', () => {
    render(<StudyBrowserNested {...baseProps({ expandedStudyInstanceUIDs: ['study-1'] })} />);
    const lists = screen.getAllByTestId('thumbnail-list');
    // one for originals, one per AI group
    expect(lists).toHaveLength(2);
    expect(lists[0].getAttribute('data-count')).toBe('2');
    expect(lists[1].getAttribute('data-count')).toBe('1');
    expect(screen.getByText('BreastNet result')).toBeTruthy();
  });

  it('fires onClickStudy when the study header is clicked', () => {
    const onClickStudy = jest.fn();
    render(<StudyBrowserNested {...baseProps({ onClickStudy })} />);
    fireEvent.click(screen.getByText('Breast MRI'));
    expect(onClickStudy).toHaveBeenCalledWith('study-1');
  });

  it('shows a delete-confirmation dialog when the AI group delete button is clicked', () => {
    const services = makeServices();
    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: services })}
      />
    );
    const deleteBtn = screen.getByTitle('Delete AI Result');
    fireEvent.click(deleteBtn);
    expect(services.services.uiDialogService.show).toHaveBeenCalledTimes(1);
    const arg = services.services.uiDialogService.show.mock.calls[0][0];
    expect(arg.id).toBe('delete-ai-result-confirmation');
  });

  it('falls back to "No Study Date" when the study has no date', () => {
    const props = baseProps();
    props.tabs[0].studies = [study({ date: '' })];
    render(<StudyBrowserNested {...props} />);
    expect(screen.getByText('No Study Date')).toBeTruthy();
  });
});
