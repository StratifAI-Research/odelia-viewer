import { __setEnabledElement } from '../test-utils/__mocks__/cornerstone-core';
import {
  __resetAnnotations,
  __resetToolGroups,
  __setAnnotation,
  __setToolGroup,
  annotation,
  makeToolGroup,
} from '../test-utils/__mocks__/cornerstone-tools';
import {
  CHAT_ROI_TOOL_NAME,
  ChatRoiTool,
  ensureChatRoiTool,
  moveChatRoiToViewportSlice,
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
  __resetAnnotations();
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

describe('moveChatRoiToViewportSlice', () => {
  // A region drawn 6mm in front of the viewport's plane, on an axial volume
  // whose normal is +z. Every corner shares that offset, as coplanar corners do.
  const drawnAt = (z: number) => {
    // ONE array behind both fields, as cornerstone really stamps it: the camera's
    // focal point is handed to the plane restriction rather than copied into it.
    const focalPoint = [0, 0, z];
    return {
      metadata: {
        toolName: CHAT_ROI_TOOL_NAME,
        referencedImageId: 'wadors:slice-16',
        // The restriction point is the one a volume viewport filters on.
        planeRestriction: { point: focalPoint },
        cameraFocalPoint: focalPoint,
        sliceIndex: 15,
      },
      data: {
        handles: {
          points: [
            [10, 20, z],
            [40, 20, z],
            [10, 60, z],
            [40, 60, z],
          ],
          textBox: { worldPosition: [50, 40, z] },
        },
      },
    };
  };

  const volumeViewport = (focalZ: number) => ({
    getCamera: () => ({ viewPlaneNormal: [0, 0, 1], focalPoint: [0, 0, focalZ] }),
    getAllVolumeIds: () => ['vol-1'],
    getCurrentImageId: () => 'wadors:whatever-cornerstone-thinks',
    getSliceIndex: () => 18,
    render: jest.fn(),
  });

  it('translates the region onto the slice on screen', () => {
    const drawn = drawnAt(6);
    __setAnnotation('annot-1', drawn);
    expect(moveChatRoiToViewportSlice('annot-1', volumeViewport(0))).toBe(true);
    expect(drawn.data.handles.points.map(p => p[2])).toEqual([0, 0, 0, 0]);
  });

  it('keeps its shape and in-plane position', () => {
    // The crop the message sends must be the same rectangle: a region that
    // changed size on a scroll would silently change the question.
    const drawn = drawnAt(6);
    __setAnnotation('annot-1', drawn);
    moveChatRoiToViewportSlice('annot-1', volumeViewport(0));
    expect(drawn.data.handles.points.map(p => [p[0], p[1]])).toEqual([
      [10, 20],
      [40, 20],
      [10, 60],
      [40, 60],
    ]);
  });

  it('takes the label with it', () => {
    const drawn = drawnAt(6);
    __setAnnotation('annot-1', drawn);
    moveChatRoiToViewportSlice('annot-1', volumeViewport(0));
    expect(drawn.data.handles.textBox.worldPosition[2]).toBe(0);
  });

  it('moves the plane cornerstone filters on, not just the corners', () => {
    // Measured against the running viewer: with only the corners translated, the
    // region stayed invisible and untouchable on the new slice, because
    // `filterAnnotationsWithinSlice` measures from `planeRestriction.point`.
    const drawn = drawnAt(6);
    __setAnnotation('annot-1', drawn);
    moveChatRoiToViewportSlice('annot-1', volumeViewport(0));
    expect(drawn.metadata.planeRestriction.point[2]).toBe(0);
  });

  it('moves the plane exactly as far as the rectangle, however many fields share it', () => {
    // The plane and the corners have to land together. Cornerstone gives
    // `planeRestriction.point` and `cameraFocalPoint` the same array, and moving
    // it once per field sent the plane twice as far — which put the region out
    // of the slice it had just been moved onto, invisible again.
    const drawn = drawnAt(6);
    __setAnnotation('annot-1', drawn);
    moveChatRoiToViewportSlice('annot-1', volumeViewport(0));
    expect(drawn.metadata.cameraFocalPoint[2]).toBe(0);
    expect(drawn.metadata.planeRestriction.point[2]).toBe(drawn.data.handles.points[0][2]);
  });

  it('records the slice index the viewport reports', () => {
    const drawn = drawnAt(6);
    __setAnnotation('annot-1', drawn);
    moveChatRoiToViewportSlice('annot-1', volumeViewport(0));
    expect(drawn.metadata.sliceIndex).toBe(18);
  });

  it('survives an annotation cornerstone stamped differently', () => {
    // Older annotations, or a tool that records fewer of these, must not throw.
    const drawn: any = {
      metadata: { toolName: CHAT_ROI_TOOL_NAME },
      data: { handles: { points: [[10, 20, 6]] } },
    };
    __setAnnotation('annot-1', drawn);
    expect(moveChatRoiToViewportSlice('annot-1', volumeViewport(0))).toBe(true);
    expect(drawn.data.handles.points[0][2]).toBe(0);
  });

  it('repaints, so the region appears on the new slice', () => {
    __setAnnotation('annot-1', drawnAt(6));
    const viewport = volumeViewport(0);
    moveChatRoiToViewportSlice('annot-1', viewport);
    expect(viewport.render).toHaveBeenCalled();
  });

  it('reports that nothing moved when it is already on the slice', () => {
    // The panel updates its slice number off this, so a false "it moved" would
    // have the chip name a slice the rectangle is not on.
    const drawn = drawnAt(0);
    __setAnnotation('annot-1', drawn);
    expect(moveChatRoiToViewportSlice('annot-1', volumeViewport(0))).toBe(false);
  });

  it('leaves referencedImageId alone on a volume viewport', () => {
    // `getCurrentImageId` has been measured naming a different slice entirely on
    // a dynamic volume, and nothing on a volume needs it: visibility there is
    // decided from the world points.
    const drawn = drawnAt(6);
    __setAnnotation('annot-1', drawn);
    moveChatRoiToViewportSlice('annot-1', volumeViewport(0));
    expect(drawn.metadata.referencedImageId).toBe('wadors:slice-16');
  });

  it('re-references the image on a stack viewport, which is filtered by it', () => {
    const drawn = drawnAt(6);
    __setAnnotation('annot-1', drawn);
    moveChatRoiToViewportSlice('annot-1', {
      getCamera: () => ({ viewPlaneNormal: [0, 0, 1], focalPoint: [0, 0, 0] }),
      getAllVolumeIds: () => [],
      getCurrentImageId: () => 'wadors:slice-19',
      render: jest.fn(),
    });
    expect(drawn.metadata.referencedImageId).toBe('wadors:slice-19');
  });

  it('does nothing without an annotation, a viewport or a camera', () => {
    expect(moveChatRoiToViewportSlice('', volumeViewport(0))).toBe(false);
    expect(moveChatRoiToViewportSlice('missing', volumeViewport(0))).toBe(false);
    __setAnnotation('annot-1', drawnAt(6));
    expect(moveChatRoiToViewportSlice('annot-1', undefined)).toBe(false);
    expect(moveChatRoiToViewportSlice('annot-1', { getCamera: () => undefined })).toBe(false);
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
