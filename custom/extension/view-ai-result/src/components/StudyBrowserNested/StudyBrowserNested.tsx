import React, { useState } from 'react';
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
  const [deletingGroups, setDeletingGroups] = useState<Set<string>>(new Set());

  const viewPreset = viewPresets ? viewPresets.find(p => p.selected)?.id : 'thumbnails';

  const thumbnailMenu = MoreDropdownMenu({
    commandsManager,
    servicesManager,
    menuItemsKey: 'studyBrowser.thumbnailMenuItems',
  });

  const tabData = tabs.find(t => t.name === activeTabName);

  /**
   * Delete an AI result group (both SR and SC) from Orthanc and OHIF
   */
  const handleDeleteAIGroup = async (group: AIGroup, studyInstanceUid: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent accordion toggle

    const { displaySetService, uiDialogService, uiNotificationService } = servicesManager.services;

    // Show confirmation dialog
    const confirmed = await new Promise<boolean>((resolve) => {
      uiDialogService.show({
        id: 'delete-ai-result-confirmation',
        title: 'Delete AI Result',
        content: ({ hide }: any) => (
          <div className="p-4 bg-secondary-dark text-white">
            <p className="mb-4">
              Are you sure you want to delete this AI result?
            </p>
            <p className="mb-4 text-muted-foreground text-sm">
              <strong>{group.label}</strong>
            </p>
            <p className="mb-6 text-yellow-400 text-sm">
              ⚠️ This will permanently delete the AI result from storage. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 bg-secondary-light hover:bg-secondary-main text-white rounded"
                onClick={() => {
                  hide('delete-ai-result-confirmation');
                  resolve(false);
                }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
                onClick={() => {
                  hide('delete-ai-result-confirmation');
                  resolve(true);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ),
        containerClassName: 'max-w-md',
        shouldCloseOnEsc: true,
        shouldCloseOnOverlayClick: true,
      });
    });

    if (!confirmed) {
      return;
    }

    // Mark group as deleting
    setDeletingGroups(prev => new Set(prev).add(group.key));

    try {
      const { aiResultsService } = servicesManager.services;
      const displaySetUIDs: string[] = [];

      // Delete from both Orthanc storage and OHIF viewer
      // Note: /tools is at root level, /series is under /pacs
      const deleteResults = { viewer: 0, storage: 0, storageFailed: 0 };

      for (const displaySet of group.displaySets) {
        try {
          // Get the real display set to access SeriesInstanceUID
          const realDisplaySet = displaySetService.getDisplaySetByUID(displaySet.displaySetInstanceUID);
          displaySetUIDs.push(displaySet.displaySetInstanceUID);

          // 1. Delete from Orthanc storage
          if (realDisplaySet?.SeriesInstanceUID) {
            try {
              // Step 1: Lookup Orthanc internal ID from DICOM SeriesInstanceUID
              const lookupResponse = await fetch('/tools/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: realDisplaySet.SeriesInstanceUID
              });

              if (lookupResponse.ok) {
                const lookupData = await lookupResponse.json();
                // lookupData is array of objects: [{ Type: "Series", ID: "orthanc-id", Path: "/series/..." }]
                const seriesEntry = lookupData.find((item: any) => item.Type === 'Series');

                if (seriesEntry?.ID) {
                  // Step 2: Delete using Orthanc internal ID (series operations are under /pacs)
                  const deleteResponse = await fetch(`/pacs/series/${seriesEntry.ID}`, {
                    method: 'DELETE'
                  });

                  if (deleteResponse.ok) {
                    deleteResults.storage++;

                  } else {
                    deleteResults.storageFailed++;
                    console.error(`Failed to delete from Orthanc: ${deleteResponse.status} ${deleteResponse.statusText}`);
                  }
                } else {
                  deleteResults.storageFailed++;
                  console.warn(`No Orthanc series entry found for ${realDisplaySet.SeriesInstanceUID}`);
                }
              } else {
                deleteResults.storageFailed++;
                console.error(`Orthanc lookup failed: ${lookupResponse.status} ${lookupResponse.statusText}`);
              }
            } catch (storageErr) {
              deleteResults.storageFailed++;
              console.error(`Error deleting from Orthanc storage:`, storageErr);
            }
          }

          // 2. Delete display set from OHIF viewer (always do this)
          displaySetService.deleteDisplaySet(displaySet.displaySetInstanceUID);
          deleteResults.viewer++;

        } catch (err) {
          console.error(`Failed to delete display set ${displaySet.displaySetInstanceUID}:`, err);
        }
      }

      // Clear AI results cache after deletion
      if (aiResultsService && displaySetUIDs.length > 0) {

        aiResultsService.removeDisplaySetsFromCache(studyInstanceUid, displaySetUIDs);
      }

      // Show appropriate notification based on results
      const totalDisplaySets = group.displaySets.length;
      if (deleteResults.viewer === totalDisplaySets && deleteResults.storageFailed === 0) {
        uiNotificationService.show({
          title: 'AI Result Deleted',
          message: `Successfully deleted AI result from viewer and storage: ${group.label}`,
          type: 'success',
          duration: 3000,
        });
      } else if (deleteResults.viewer === totalDisplaySets && deleteResults.storageFailed > 0) {
        uiNotificationService.show({
          title: 'Partial Deletion',
          message: `Removed from viewer, but ${deleteResults.storageFailed} series failed to delete from storage.`,
          type: 'warning',
          duration: 5000,
        });
      } else {
        uiNotificationService.show({
          title: 'Deletion Issues',
          message: `Removed ${deleteResults.viewer}/${totalDisplaySets} from viewer. Storage deletions: ${deleteResults.storage} succeeded, ${deleteResults.storageFailed} failed.`,
          type: 'warning',
          duration: 5000,
        });
      }
    } catch (error) {
      console.error('Error deleting AI group:', error);
      uiNotificationService.show({
        title: 'Deletion Failed',
        message: error instanceof Error ? error.message : 'Failed to delete AI result',
        type: 'error',
        duration: 5000,
      });
    } finally {
      // Remove from deleting state
      setDeletingGroups(prev => {
        const next = new Set(prev);
        next.delete(group.key);
        return next;
      });
    }
  };

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
                  {study.aiGroups.map(group => {
                    const isDeleting = deletingGroups.has(group.key);

                    return (
                      <Accordion type="single" collapsible key={group.key}>
                        <AccordionItem value="group">
                          <AccordionTrigger className="first:border-0 border-t border-secondary-light hover:bg-secondary-main bg-black data-[state=open]:bg-secondary-dark cursor-pointer select-none outline-none flex items-start gap-[6px] px-4 py-2 text-[13px] min-h-[40px]">
                            <span className="mr-1 text-white mt-0.5">🤖</span>
                            <span className="flex-1 text-white whitespace-pre-line break-words text-left leading-snug">{group.label}</span>

                            {/* Delete button */}
                            <button
                              className={`ml-auto flex-shrink-0 p-1.5 rounded bg-red-600 hover:bg-red-700 text-white transition-colors ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}`}
                              onClick={(e) => handleDeleteAIGroup(group, study.studyInstanceUid, e)}
                              disabled={isDeleting}
                              title="Delete AI Result"
                            >
                              {isDeleting ? (
                                <span className="text-xs">Deleting...</span>
                              ) : (
                                <Icons.Trash className="w-4 h-4" />
                              )}
                            </button>
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
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
