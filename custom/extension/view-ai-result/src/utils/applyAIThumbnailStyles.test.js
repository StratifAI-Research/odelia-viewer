import { applyAIThumbnailStyles, setupAIThumbnailObserver } from './applyAIThumbnailStyles';

describe('applyAIThumbnailStyles', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('does not throw when there are no matching elements', () => {
    applyAIThumbnailStyles();
    expect(() => jest.advanceTimersByTime(100)).not.toThrow();
  });

  it('applies multiline styles to a robot-emoji label inside an AI thumbnail', () => {
    document.body.innerHTML = `
      <div class="ai-result-thumbnail">
        <span class="text-base" id="target">🤖 BreastNet</span>
      </div>`;
    applyAIThumbnailStyles();
    jest.advanceTimersByTime(100);

    const el = document.getElementById('target');
    expect(el.style.whiteSpace).toBe('pre-line');
    expect(el.style.fontSize).toBe('10px');
    expect(el.style.display).toBe('-webkit-box');
    expect(el.dataset.aiStyled).toBe('true');
  });

  it('skips elements that are not inside an AI thumbnail', () => {
    document.body.innerHTML = `<span class="text-base" id="loose">🤖 free agent</span>`;
    applyAIThumbnailStyles();
    jest.advanceTimersByTime(100);
    const el = document.getElementById('loose');
    expect(el.style.whiteSpace).toBe('');
    expect(el.dataset.aiStyled).toBeUndefined();
  });

  it('leaves list-row (h-[40px]) thumbnails single-line', () => {
    document.body.innerHTML = `
      <div class="ai-result-thumbnail h-[40px]">
        <span class="text-base" id="listrow">🤖 compact</span>
      </div>`;
    applyAIThumbnailStyles();
    jest.advanceTimersByTime(100);
    const el = document.getElementById('listrow');
    expect(el.style.whiteSpace).toBe('');
    expect(el.dataset.aiStyled).toBeUndefined();
  });

  it('ignores text elements without the robot emoji', () => {
    document.body.innerHTML = `
      <div class="ai-result-thumbnail">
        <span class="text-base" id="plain">no emoji here</span>
      </div>`;
    applyAIThumbnailStyles();
    jest.advanceTimersByTime(100);
    expect(document.getElementById('plain').style.whiteSpace).toBe('');
  });

  it('relaxes constraining parent containers', () => {
    document.body.innerHTML = `
      <div class="ai-result-thumbnail">
        <div class="text-ellipsis" id="parent">
          <span class="text-base" id="child">🤖 nested</span>
        </div>
      </div>`;
    applyAIThumbnailStyles();
    jest.advanceTimersByTime(100);
    expect(document.getElementById('parent').style.whiteSpace).toBe('pre-line');
  });
});

describe('setupAIThumbnailObserver', () => {
  afterEach(() => {
    if (window.aiThumbnailObserver) {
      window.aiThumbnailObserver.disconnect();
      window.aiThumbnailObserver = undefined;
    }
  });

  it('registers a MutationObserver on the document', () => {
    setupAIThumbnailObserver();
    expect(window.aiThumbnailObserver).toBeDefined();
    expect(typeof window.aiThumbnailObserver.disconnect).toBe('function');
  });

  it('disconnects an existing observer before creating a new one', () => {
    setupAIThumbnailObserver();
    const first = window.aiThumbnailObserver;
    const disconnectSpy = jest.spyOn(first, 'disconnect');
    setupAIThumbnailObserver();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(window.aiThumbnailObserver).not.toBe(first);
  });
});
