import React from 'react';
const Pass =
  (tid: string) =>
  ({ children }: any) => <div data-testid={tid}>{children}</div>;
export const FooterAction = Object.assign(Pass('footer-action'), {
  Right: Pass('footer-action-right'),
  Left: Pass('footer-action-left'),
});
export const Separator = () => <hr data-testid="separator" />;
// StudyBrowser stub: surfaces tab names + thumbnail UIDs as clickable elements so
// tests can drive onClickTab / onClickThumbnail / onDoubleClickThumbnail handlers.
export const StudyBrowser = (props: any) => {
  const tabs = props?.tabs || [];
  // Render thumbnails for the active tab only (as the real browser does),
  // keeping testids unique across tabs that share display sets (e.g. "all").
  const activeTab = tabs.find((t: any) => t.name === props?.activeTabName) || tabs[0];
  const thumbs: any[] = [];
  (activeTab?.studies || []).forEach((study: any) =>
    (study.displaySets || []).forEach((ds: any) => thumbs.push(ds))
  );
  return (
    <div
      data-testid="study-browser"
      data-count={tabs.length}
      data-active-tab={props?.activeTabName}
    >
      {tabs.map((tab: any) => (
        <button
          key={tab.name}
          data-testid={`sb-tab-${tab.name}`}
          onClick={() => props?.onClickTab?.(tab.name)}
        >
          {tab.label || tab.name}
        </button>
      ))}
      {thumbs.map((ds: any) => (
        <div
          key={ds.displaySetInstanceUID}
          data-testid={`sb-thumb-${ds.displaySetInstanceUID}`}
        >
          <button
            data-testid={`sb-thumb-click-${ds.displaySetInstanceUID}`}
            onClick={() => props?.onClickThumbnail?.(ds.displaySetInstanceUID)}
          />
          <button
            data-testid={`sb-thumb-dblclick-${ds.displaySetInstanceUID}`}
            onClick={() => props?.onDoubleClickThumbnail?.(ds.displaySetInstanceUID)}
          />
        </div>
      ))}
    </div>
  );
};
export const StudyBrowserViewOptions = Pass('study-browser-view-options');
export const StudyBrowserSort = Pass('study-browser-sort');
export const ThumbnailList = (props: any) => (
  <div
    data-testid="thumbnail-list"
    data-count={props?.thumbnails?.length}
  />
);
export const Accordion = Pass('accordion');
export const AccordionItem = Pass('accordion-item');
export const AccordionTrigger = Pass('accordion-trigger');
export const AccordionContent = Pass('accordion-content');
export const Icons = new Proxy({}, { get: () => () => <span data-testid="icon" /> });
// 3.13 moved these context hooks out of @ohif/ui into @ohif/ui-next.
export const useImageViewer = () => ({ StudyInstanceUIDs: [] as string[] });
export const useUserAuthentication = () => [
  { user: null },
  { getAuthorizationHeader: () => ({}) },
];
export const useViewportGrid = () => [
  { activeViewportId: 'v1', viewports: new Map() },
  { setActiveViewportId: jest.fn() },
];
