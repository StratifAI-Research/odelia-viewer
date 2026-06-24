import React from 'react';
const Pass = (tid: string) => ({ children }: any) => <div data-testid={tid}>{children}</div>;
export const FooterAction = Object.assign(Pass('footer-action'), {
  Right: Pass('footer-action-right'), Left: Pass('footer-action-left'),
});
export const Separator = () => <hr data-testid="separator" />;
export const StudyBrowser = (props: any) => <div data-testid="study-browser" data-count={props?.tabs?.length} />;
export const StudyBrowserViewOptions = Pass('study-browser-view-options');
export const StudyBrowserSort = Pass('study-browser-sort');
export const ThumbnailList = (props: any) => <div data-testid="thumbnail-list" data-count={props?.thumbnails?.length} />;
export const Accordion = Pass('accordion');
export const AccordionItem = Pass('accordion-item');
export const AccordionTrigger = Pass('accordion-trigger');
export const AccordionContent = Pass('accordion-content');
export const Icons = new Proxy({}, { get: () => () => <span data-testid="icon" /> });
export const useViewportGrid = () => [{ activeViewportId: 'v1', viewports: new Map() }, { setActiveViewportId: jest.fn() }];
