import React from 'react';
import {
  StudyBrowserViewOptions,
  StudyBrowserSort,
  ThumbnailList,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Icons,
} from '@ohif/ui-next';
import { MoreDropdownMenu } from '@ohif/extension-default';

interface DisplaySetThumbnail {
  displaySetInstanceUID: string;
  [key: string]: any;
}

interface AIGroup {
  key: string;
  label: string;
  displaySets: DisplaySetThumbnail[];
}

interface StudyEntry {
  studyInstanceUid: string;
  date: string;
  description: string;
  numInstances: number;
  originals: DisplaySetThumbnail[];
  aiGroups: AIGroup[];
}

interface BrowserTab {
  name: string;
  label: string;
  studies: StudyEntry[];
}

interface Props {
  tabs: BrowserTab[];
  activeTabName: string;
  expandedStudyInstanceUIDs: string[];
  onClickTab: (name: string) => void;
  onClickStudy: (uid: string) => void;
  onClickThumbnail: (uid: string) => void;
  onDoubleClickThumbnail: (uid: string) => void;
  onClickUntrack?: (uid: string) => void;
  activeDisplaySetInstanceUIDs: string[];
  servicesManager: any;
  commandsManager: any;
  showSettings?: boolean;
  viewPresets?: any[];
}

export const StudyBrowserNested: React.FC<Props> = ({
  tabs,
  activeTabName,
  expandedStudyInstanceUIDs,
  onClickTab,
  onClickStudy,
  onClickThumbnail,
  onDoubleClickThumbnail,
  onClickUntrack = () => {},
  activeDisplaySetInstanceUIDs,
  servicesManager,
  commandsManager,
  showSettings = true,
  viewPresets,
}) => {
  const viewPreset = viewPresets ? viewPresets.find(p => p.selected)?.id : 'thumbnails';

  const thumbnailMenu = MoreDropdownMenu({
    commandsManager,
    servicesManager,
    menuItemsKey: 'studyBrowser.thumbnailMenuItems',
  });

  const tabData = tabs.find(t => t.name === activeTabName);

  return (
    <div className="ohif-scrollbar invisible-scrollbar bg-bkg-low flex flex-1 flex-col gap-[4px] overflow-auto">
      <div className="flex flex-col gap-[4px]">
        {showSettings && (
          <div className="w-100 bg-bkg-low flex h-[48px] items-center justify-center gap-[10px] px-[8px] py-[10px]">
            <StudyBrowserViewOptions tabs={tabs} onSelectTab={onClickTab} activeTabName={activeTabName} />
            <StudyBrowserSort servicesManager={servicesManager} />
          </div>
        )}

        {tabData?.studies.map(study => {
          const isExpanded = expandedStudyInstanceUIDs.includes(study.studyInstanceUid);

          return (
            <div key={study.studyInstanceUid}>
              {/* Study Header */}
              <div
                className={`first:border-0 border-t border-secondary-light hover:bg-secondary-main ${isExpanded ? 'bg-secondary-dark' : 'bg-black'} cursor-pointer select-none outline-none flex items-center gap-[6px] px-4 py-2`}
                onClick={() => onClickStudy(study.studyInstanceUid)}
              >
                <Icons.ChevronRight className={`transition-transform text-white ${isExpanded ? 'rotate-90' : ''}`} />
                <div className="truncate w-[160px] text-white text-[13px]" title={study.date || 'No Study Date'}>
                  {study.date || 'No Study Date'}
                </div>
                <div className="truncate flex-1 text-muted-foreground text-[13px]" title={study.description}>
                  {study.description}
                </div>
                <div className="text-muted-foreground text-[12px]">{study.numInstances}</div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="pb-4 space-y-2">
                  {/* Main series thumbnails */}
                  <ThumbnailList
                    thumbnails={study.originals}
                    onThumbnailClick={onClickThumbnail}
                    onThumbnailDoubleClick={onDoubleClickThumbnail}
                    onClickUntrack={onClickUntrack}
                    activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs as any}
                    viewPreset={viewPreset}
                    ThumbnailMenuItems={thumbnailMenu}
                  />

                  {/* AI result groups */}
                  {study.aiGroups.map(group => (
                    <Accordion type="single" collapsible key={group.key}>
                      <AccordionItem value="group">
                        <AccordionTrigger className="first:border-0 border-t border-secondary-light hover:bg-secondary-main bg-black data-[state=open]:bg-secondary-dark cursor-pointer select-none outline-none flex items-center gap-[6px] px-4 py-2 text-[13px]">

                          <span className="mr-1 text-white">🤖</span>
                          <span className="truncate text-white">{group.label}</span>
                        </AccordionTrigger>
                        <AccordionContent className="pt-1">
                          <ThumbnailList
                            thumbnails={group.displaySets}
                            onThumbnailClick={onClickThumbnail}
                            onThumbnailDoubleClick={onDoubleClickThumbnail}
                            onClickUntrack={onClickUntrack}
                            activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs as any}
                            viewPreset={viewPreset}
                            ThumbnailMenuItems={thumbnailMenu}
                          />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
