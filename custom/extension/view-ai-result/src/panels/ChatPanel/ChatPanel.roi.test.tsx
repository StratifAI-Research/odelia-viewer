import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  eventTarget,
  __resetMetaData,
  __setMetaData,
} from '../../test-utils/__mocks__/cornerstone-core';
import {
  __resetToolGroups,
  __setToolGroup,
  annotation,
  makeToolGroup,
} from '../../test-utils/__mocks__/cornerstone-tools';
import {
  resetMockViewportGrid,
  setMockViewportGrid,
} from '../../test-utils/__mocks__/ohif-ui-next';
import {
  installConsoleErrorFilter,
  makeServicesManager,
  withSystem,
} from '../../test-utils/harness';

import ChatPanel from './ChatPanel';

// ChatPanel harness for the chat region of interest: drawing it, scoping it, and
// what it does to the images a message carries.
const sendMessage = jest.fn();
const mockHookState: any = {
  messages: [],
  isConnected: true,
  isStreaming: false,
  error: null,
  sessionId: 'session-abcdef01',
  preprocessingStatus: null,
  preprocessingProgress: null,
  connect: jest.fn(),
  sendMessage,
  cancelGeneration: jest.fn(),
  clearHistory: jest.fn(),
  appendEvent: jest.fn(),
  switchSession: jest.fn().mockResolvedValue('session-abcdef01'),
  hydrateMessages: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('../../hooks/useChatService', () => ({ useChatService: () => mockHookState }));
jest.mock('../../hooks/useActiveStudyUID', () => ({ useActiveStudyUID: () => () => 'study-1' }));

installConsoleErrorFilter();
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
});

const IMAGE_ID = 'wadors:se-1/instances/1.2.840.SE1.12/frames/1';

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  (eventTarget as any).reset();
  __resetMetaData();
  __resetToolGroups();
  resetMockViewportGrid();
  mockHookState.messages = [];
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

  __setToolGroup(
    'default',
    makeToolGroup({ WindowLevel: { mode: 'Active', bindings: [{ mouseButton: 1 }] } })
  );
  // A 400x500 image whose instance is slice 12 of the attached series.
  __setMetaData('imagePlaneModule', IMAGE_ID, { rows: 500, columns: 400 });
  __setMetaData('generalImageModule', IMAGE_ID, { sopInstanceUID: '1.2.840.SE1.12' });
});

const instances = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ SOPInstanceUID: `1.2.840.SE1.${i + 1}` }));

const SERIES = [
  {
    displaySetInstanceUID: 'ds-1',
    StudyInstanceUID: 'study-1',
    StudyDate: '20260812',
    StudyDescription: 'Breast MRI',
    SeriesInstanceUID: 'se-1',
    SeriesDescription: 'Ax T1 post',
    SeriesNumber: 1,
    Modality: 'MR',
    numImageFrames: 20,
    images: instances(20),
  },
];

function makeDisplaySetService(displaySets: any[]) {
  return {
    EVENTS: { DISPLAY_SETS_ADDED: 'added', DISPLAY_SETS_CHANGED: 'changed' },
    getActiveDisplaySets: jest.fn(() => displaySets),
    getDisplaySetByUID: jest.fn((uid: string) =>
      displaySets.find(ds => ds.displaySetInstanceUID === uid)
    ),
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
  };
}

async function renderPanel(displaySets: any[] = SERIES) {
  setMockViewportGrid({
    activeViewportId: 'v1',
    viewports: new Map([['v1', { displaySetInstanceUIDs: ['ds-1'] }]]),
  });
  withSystem(
    makeServicesManager({
      services: {
        displaySetService: makeDisplaySetService(displaySets),
        cornerstoneViewportService: {
          getCornerstoneViewport: jest.fn(() => ({ getCurrentImageIdIndex: () => 11 })),
        },
      },
    })
  );
  await act(async () => {
    render(<ChatPanel />);
  });
}

const attachSeries = () => {
  fireEvent.click(screen.getByText('+ Add series'));
  fireEvent.click(screen.getByText('Ax T1 post'));
};

/** Finish a rectangle, as cornerstone reports it after a drag. */
const completeRectangle = async (
  points: number[][] = [
    [100, 50],
    [300, 250],
  ],
  over: any = {}
) => {
  await act(async () => {
    (eventTarget as any).dispatch('ANNOTATION_COMPLETED', {
      annotation: {
        annotationUID: 'annot-1',
        metadata: { toolName: 'ChatROI', referencedImageId: IMAGE_ID, ...over.metadata },
        data: { handles: { points } },
        ...over,
      },
    });
  });
};

const startDrawing = () => fireEvent.click(screen.getByText('▱ Select region'));

describe('ChatPanel — chat region of interest', () => {
  it('offers a region tool once a series is attached', async () => {
    await renderPanel();
    expect(screen.queryByText('▱ Select region')).toBeNull();
    attachSeries();
    expect(screen.getByText('▱ Select region')).toBeTruthy();
  });

  it('binds the region tool to the mouse while drawing, and says so', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    expect(screen.getByText(/Drag on the image/)).toBeTruthy();
  });

  it('styles the region so it cannot be read as a measurement', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    const styles = (annotation.config.style.setToolGroupToolStyles as jest.Mock).mock.calls[0][1];
    expect(styles.ChatROI.lineDash).toBeTruthy();
  });

  it('shows the drawn region as a chip naming its slice', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    expect(screen.getByText('ROI · slice 12')).toBeTruthy();
  });

  it('defaults to the current slice only', async () => {
    // The unambiguous reading of "this region": one image, cropped.
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    expect((screen.getByLabelText('Apply region to') as HTMLSelectElement).value).toBe('slice');
    expect(screen.getByText(/Sends 1 image in total/)).toBeTruthy();
  });

  it('applies the region across the range when asked', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    fireEvent.change(screen.getByLabelText('Apply region to'), { target: { value: 'range' } });
    expect(screen.getByText(/Sends 5 images in total/)).toBeTruthy();
  });

  it('ignores annotations from other tools', async () => {
    // Touching another tool's annotation would be a bug with clinical consequences.
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle(undefined, { metadata: { toolName: 'RectangleROI' } });
    expect(screen.queryByText(/ROI · slice/)).toBeNull();
  });

  it('says so when the drag was really a click', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle([
      [100, 100],
      [101, 101],
    ]);
    expect(screen.getByText(/a click is too small to send/)).toBeTruthy();
    expect(screen.queryByText(/ROI · slice/)).toBeNull();
  });

  it('removes the region on request, on screen and in the prompt', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    fireEvent.click(screen.getByLabelText('Remove region'));
    expect(screen.queryByText(/ROI · slice/)).toBeNull();
    expect(annotation.state.removeAnnotation).toHaveBeenCalledWith('annot-1');
  });

  it('discards the region when its series is detached', async () => {
    // A rectangle left on screen that no longer reaches the model is a lie.
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    fireEvent.click(screen.getByLabelText('Remove Ax T1 post'));
    expect(screen.queryByText(/ROI · slice/)).toBeNull();
    expect(annotation.state.removeAnnotation).toHaveBeenCalledWith('annot-1');
  });

  it('pins the context when a region is drawn', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    expect(screen.getByText('Pinned')).toBeTruthy();
  });

  describe('what is sent', () => {
    const send = () => {
      fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
        target: { value: 'what is this?' },
      });
      fireEvent.click(screen.getByTitle('Send'));
    };

    it('sends the crop as fractions of the image', async () => {
      await renderPanel();
      attachSeries();
      startDrawing();
      await completeRectangle();
      send();
      const selection = sendMessage.mock.calls[0][4][0];
      // 100..300 of 400 columns, 50..250 of 500 rows.
      expect(selection.roi).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
    });

    it('sends only the region slice under the default scope', async () => {
      await renderPanel();
      attachSeries();
      startDrawing();
      await completeRectangle();
      send();
      const selection = sendMessage.mock.calls[0][4][0];
      expect(selection.sop_instance_uids).toEqual(['1.2.840.SE1.12']);
    });

    it('sends the whole sampled range under range scope, all cropped', async () => {
      await renderPanel();
      attachSeries();
      startDrawing();
      await completeRectangle();
      fireEvent.change(screen.getByLabelText('Apply region to'), { target: { value: 'range' } });
      send();
      const selection = sendMessage.mock.calls[0][4][0];
      expect(selection.sop_instance_uids).toHaveLength(5);
      expect(selection.roi).toBeTruthy();
    });

    it('records the region in the message snapshot', async () => {
      // A cropped image answers a different question from a whole slice.
      await renderPanel();
      attachSeries();
      startDrawing();
      await completeRectangle();
      send();
      const snapshot = sendMessage.mock.calls[0][3];
      expect(snapshot.series[0].roi).toMatchObject({ sliceNumber: 12, scope: 'slice' });
      expect(snapshot.series[0].sentSliceNumbers).toEqual([12]);
      expect(snapshot.requestedImageCount).toBe(1);
    });

    it('sends no region once it has been removed', async () => {
      await renderPanel();
      attachSeries();
      startDrawing();
      await completeRectangle();
      fireEvent.click(screen.getByLabelText('Remove region'));
      send();
      const selection = sendMessage.mock.calls[0][4][0];
      expect(selection.roi).toBeUndefined();
      expect(selection.sop_instance_uids).toHaveLength(5);
    });
  });
});

describe('ChatPanel — a region on a series without slice addressing', () => {
  const MULTIFRAME = [{ ...SERIES[0], numImageFrames: 40, images: instances(1) }];

  beforeEach(() => {
    // One enhanced instance covering 40 frames: the panel cannot name a slice.
    __setMetaData('generalImageModule', IMAGE_ID, { sopInstanceUID: '1.2.840.SE1.1' });
  });

  it('still sends the region, cropping whatever the recipe picks', async () => {
    // Dropping it would leave a region on screen and in the chip that never
    // reached the model.
    await renderPanel(MULTIFRAME);
    attachSeries();
    startDrawing();
    await completeRectangle();
    fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
      target: { value: 'q' },
    });
    fireEvent.click(screen.getByTitle('Send'));

    const selection = sendMessage.mock.calls[0][4][0];
    expect(selection.sop_instance_uids).toEqual([]);
    expect(selection.roi).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
  });

  it('says the region covers every slice sent, rather than offering a scope', async () => {
    // Confining it to one slice needs addressing this series does not offer.
    await renderPanel(MULTIFRAME);
    attachSeries();
    startDrawing();
    await completeRectangle();
    expect(screen.getByText('Applies to every slice sent')).toBeTruthy();
    expect(screen.queryByLabelText('Apply region to')).toBeNull();
  });

  it('records that wider scope in the snapshot', async () => {
    await renderPanel(MULTIFRAME);
    attachSeries();
    startDrawing();
    await completeRectangle();
    fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
      target: { value: 'q' },
    });
    fireEvent.click(screen.getByTitle('Send'));
    expect(sendMessage.mock.calls[0][3].series[0].roi.scope).toBe('range');
  });
});

describe('ChatPanel — a region that changes after it is drawn', () => {
  const modify = async (points: number[][], uid = 'annot-1') => {
    await act(async () => {
      (eventTarget as any).dispatch('ANNOTATION_MODIFIED', {
        annotation: {
          annotationUID: uid,
          metadata: { toolName: 'ChatROI', referencedImageId: IMAGE_ID },
          data: { handles: { points } },
        },
      });
    });
  };

  const send = () => {
    fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
      target: { value: 'q' },
    });
    fireEvent.click(screen.getByTitle('Send'));
  };

  it('follows the rectangle when it is resized', async () => {
    // A passive cornerstone tool stays editable, so without this the overlay
    // would show one rectangle while the message carried another.
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    await modify([
      [0, 0],
      [200, 250],
    ]);
    send();
    expect(sendMessage.mock.calls[0][4][0].roi).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
  });

  it('ignores edits to a rectangle it is not tracking', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    await modify(
      [
        [0, 0],
        [200, 250],
      ],
      'some-other-annotation'
    );
    send();
    expect(sendMessage.mock.calls[0][4][0].roi).toEqual({
      x: 0.25,
      y: 0.1,
      width: 0.5,
      height: 0.4,
    });
  });

  it('keeps the last good rectangle through a mid-edit sliver', async () => {
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    await modify([
      [100, 100],
      [101, 101],
    ]);
    send();
    expect(sendMessage.mock.calls[0][4][0].roi.width).toBe(0.5);
  });

  it('drops the region when something else removes it from the image', async () => {
    // A chat region is stored as an unmapped measurement, so a clinical
    // "clear measurements" deletes it. Cropping the next message to a rectangle
    // no longer on screen is exactly the silent disagreement to avoid.
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle();
    await act(async () => {
      (eventTarget as any).dispatch('ANNOTATION_REMOVED', {
        annotation: { annotationUID: 'annot-1', metadata: { toolName: 'ChatROI' } },
      });
    });
    expect(screen.queryByText(/ROI · slice/)).toBeNull();
    expect(screen.getByText(/no longer attached/)).toBeTruthy();
    send();
    expect(sendMessage.mock.calls[0][4][0].roi).toBeUndefined();
  });

  it('removes the rectangle it refused', async () => {
    // Otherwise a rejected sliver stays on the image with no way to clear it
    // from the chat.
    await renderPanel();
    attachSeries();
    startDrawing();
    await completeRectangle([
      [100, 100],
      [101, 101],
    ]);
    expect(annotation.state.removeAnnotation).toHaveBeenCalledWith('annot-1');
  });

  it('keeps the cancel control reachable after the last series is detached', async () => {
    // Otherwise the primary mouse button stays on the region tool with no way back.
    await renderPanel();
    attachSeries();
    startDrawing();
    fireEvent.click(screen.getByLabelText('Remove Ax T1 post'));
    expect(screen.queryByText(/Drag on the image/)).toBeNull();
  });
});
