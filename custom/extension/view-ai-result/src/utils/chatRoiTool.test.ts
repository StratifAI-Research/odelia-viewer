import { __setEnabledElement } from '../test-utils/__mocks__/cornerstone-core';
import {
  __resetToolGroups,
  __setToolGroup,
  annotation,
  makeToolGroup,
} from '../test-utils/__mocks__/cornerstone-tools';
import {
  CHAT_ROI_TOOL_NAME,
  ChatRoiTool,
  ensureChatRoiTool,
  removeChatRoi,
  startDrawingRoi,
  stopDrawingRoi,
} from './chatRoiTool';

/** A tool group as the send-ai mode builds it: window/level on the primary button. */
const modeToolGroup = () =>
  makeToolGroup({
    WindowLevel: { mode: 'Active', bindings: [{ mouseButton: 1 }] },
    Pan: { mode: 'Active', bindings: [{ mouseButton: 4 }] },
    Zoom: { mode: 'Active', bindings: [{ mouseButton: 2 }] },
  });

beforeEach(() => {
  jest.clearAllMocks();
  __resetToolGroups();
});

describe('ensureChatRoiTool', () => {
  it('adds the tool to the group and leaves it passive', async () => {
    // Passive, not active: left bound to the primary button it would break
    // window/level for everyone who never opens the chat panel.
    const group = modeToolGroup();
    __setToolGroup('default', group);

    expect(ensureChatRoiTool()).toBe(true);
    expect(group.addTool).toHaveBeenCalledWith(CHAT_ROI_TOOL_NAME);
    expect(group.toolOptions[CHAT_ROI_TOOL_NAME].mode).toBe('Passive');
    expect(group.toolOptions.WindowLevel.mode).toBe('Active');
  });

  it('registers the tool with cornerstone, once per page', () => {
    // Registration is a global side effect that throws on a repeat, so it is
    // memoised — hence a fresh module here rather than relying on test order.
    jest.isolateModules(() => {
      const tools = require('../test-utils/__mocks__/cornerstone-tools');
      const fresh = require('./chatRoiTool');
      tools.__setToolGroup('default', modeToolGroup());
      fresh.ensureChatRoiTool();
      fresh.ensureChatRoiTool();
      expect(tools.addTool).toHaveBeenCalledTimes(1);
    });
  });

  it('styles the region so it cannot be read as a measurement', () => {
    __setToolGroup('default', modeToolGroup());
    ensureChatRoiTool();
    const styles = (annotation.config.style.setToolGroupToolStyles as jest.Mock).mock.calls[0][1];
    expect(styles[CHAT_ROI_TOOL_NAME].lineDash).toBeTruthy();
  });

  it('does not add the tool twice to one group', () => {
    const group = modeToolGroup();
    __setToolGroup('default', group);
    ensureChatRoiTool();
    ensureChatRoiTool();
    expect(group.addTool).toHaveBeenCalledTimes(1);
  });

  it('reports failure rather than throwing when there is no tool group', () => {
    // The panel can mount in a mode that never built one.
    expect(ensureChatRoiTool()).toBe(false);
  });
});

describe('startDrawingRoi / stopDrawingRoi', () => {
  it('binds the region tool to the primary button', () => {
    const group = modeToolGroup();
    __setToolGroup('default', group);
    startDrawingRoi();
    expect(group.toolOptions[CHAT_ROI_TOOL_NAME].mode).toBe('Active');
    expect(group.toolOptions[CHAT_ROI_TOOL_NAME].bindings[0].mouseButton).toBe(1);
  });

  it('reports which tool it displaced', () => {
    __setToolGroup('default', modeToolGroup());
    expect(startDrawingRoi()).toBe('WindowLevel');
  });

  it('does not displace a tool bound to another button', () => {
    // Pan is on the middle button and must keep it.
    const group = modeToolGroup();
    __setToolGroup('default', group);
    startDrawingRoi();
    expect(group.toolOptions.Pan.mode).toBe('Active');
  });

  it('gives the primary button back when drawing ends', () => {
    // Leaving window/level unbound after one region is a surprising way to break
    // the viewer.
    const group = modeToolGroup();
    __setToolGroup('default', group);
    const previous = startDrawingRoi();
    stopDrawingRoi(previous);
    expect(group.toolOptions.WindowLevel.mode).toBe('Active');
    expect(group.toolOptions.WindowLevel.bindings[0].mouseButton).toBe(1);
    expect(group.toolOptions[CHAT_ROI_TOOL_NAME].mode).toBe('Passive');
  });

  it('still releases the region tool when nothing held the button before', () => {
    const group = makeToolGroup({});
    __setToolGroup('default', group);
    const previous = startDrawingRoi();
    expect(previous).toBeNull();
    stopDrawingRoi(previous);
    expect(group.toolOptions[CHAT_ROI_TOOL_NAME].mode).toBe('Passive');
  });

  it('returns null when there is no tool group to draw on', () => {
    expect(startDrawingRoi()).toBeNull();
  });

  it('does not throw when stopping without a tool group', () => {
    expect(() => stopDrawingRoi('WindowLevel')).not.toThrow();
  });
});

describe('removeChatRoi', () => {
  it('removes exactly the annotation it was given', () => {
    // By UID, not by clearing the tool's annotations: anything else on the image
    // has to survive.
    removeChatRoi('annot-1');
    expect(annotation.state.removeAnnotation).toHaveBeenCalledWith('annot-1');
  });

  it('ignores an empty UID', () => {
    removeChatRoi('');
    expect(annotation.state.removeAnnotation).not.toHaveBeenCalled();
  });

  it('survives cornerstone rejecting the removal', () => {
    (annotation.state.removeAnnotation as jest.Mock).mockImplementationOnce(() => {
      throw new Error('gone already');
    });
    expect(() => removeChatRoi('annot-1')).not.toThrow();
  });
});

describe('picking the region up', () => {
  // Cornerstone decides what a mouse-down is for by asking each tool whether the
  // point is near it, so this predicate is the whole difference between a region
  // that can be dragged into place and one that is stuck where it was drawn.
  const ELEMENT = {} as never;
  const DRAWN = {
    data: {
      handles: {
        points: [
          [100, 50, 0],
          [300, 50, 0],
          [100, 250, 0],
          [300, 250, 0],
        ],
      },
    },
  };

  const near = (point: number[]) =>
    (new ChatRoiTool() as any).isPointNearTool(ELEMENT, DRAWN, point, 6, 'mouse');

  beforeEach(() => {
    // World coordinates land on canvas unchanged here; the mapping is
    // cornerstone's business, not this tool's.
    __setEnabledElement({ viewport: { worldToCanvas: (p: number[]) => [p[0], p[1]] } });
  });

  it('claims the middle of the rectangle', () => {
    // The gesture a reader will actually try. Cornerstone's own hit test says no
    // here — it only reaches a few pixels around the outline — so the drag would
    // otherwise window/level the image and leave the region behind.
    expect(near([200, 150])).toBe(true);
  });

  it('still claims the outline, where the resize handles are', () => {
    expect(near([100, 150])).toBe(true);
    expect(near([300, 250])).toBe(true);
  });

  it('leaves the rest of the image alone', () => {
    // Window/level has to keep working everywhere the region is not.
    expect(near([50, 150])).toBe(false);
    expect(near([200, 400])).toBe(false);
  });

  it('declines rather than throwing when the viewport cannot be resolved', () => {
    __setEnabledElement(undefined);
    expect(near([200, 150])).toBe(false);
  });

  it('declines when the annotation has no rectangle yet', () => {
    expect(
      (new ChatRoiTool() as any).isPointNearTool(ELEMENT, { data: {} }, [200, 150], 6, 'mouse')
    ).toBe(false);
  });
});

describe('chat ROI styling', () => {
  it('sets a selected variant for every colour it sets', () => {
    // Cornerstone resolves a style by appending the annotation's state, and a
    // freshly drawn annotation is selected. A missing Selected variant falls back
    // to cornerstone's default green — the colour of a selected measurement.
    __setToolGroup('default', modeToolGroup());
    ensureChatRoiTool();
    const styles = (annotation.config.style.setToolGroupToolStyles as jest.Mock).mock.calls[0][1][
      CHAT_ROI_TOOL_NAME
    ];
    Object.keys(styles)
      .filter(key => /Color$/.test(key) || key === 'color')
      .forEach(key => {
        const base = key === 'color' ? 'color' : key;
        expect(styles[`${base}Selected`]).toBeTruthy();
      });
  });
});
