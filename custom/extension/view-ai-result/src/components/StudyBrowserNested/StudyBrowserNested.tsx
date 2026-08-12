import React, { useState } from 'react';
import {
  Button,
  FooterAction,
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
import { deriveFeedbackApiBase } from '../../panels/FeedbackPanel/feedbackApi';

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
  servicesManager: AppTypes.ServicesManager;
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
  const handleDeleteAIGroup = async (
    group: AIGroup,
    studyInstanceUid: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation(); // Prevent accordion toggle

    // appInit registers all three; AppTypes marks every service optional.
    const { displaySetService, uiDialogService, uiNotificationService } =
      servicesManager.services as Required<AppTypes.Services>;

    // Resolve from `onClose` (fired on every close path: button, Esc, overlay)
    // rather than the buttons alone, so a dismissal always settles the Promise.
    // The buttons record the decision; any other close defaults to "cancel".
    const confirmed = await new Promise<boolean>(resolve => {
      let decision = false;
      uiDialogService.show({
        id: 'delete-ai-result-confirmation',
        title: 'Delete AI Result',
        // The dialog shell already supplies the surface; this only needs to set
        // a text colour, because the dialog is portalled onto <body> and would
        // otherwise inherit the browser's default black.
        content: ({ hide }: any) => (
          <div className="text-foreground">
            <p className="mb-4">Are you sure you want to delete this AI result?</p>
            <p className="text-muted-foreground mb-4 text-sm">
              <strong>{group.label}</strong>
            </p>
            <p className="mb-6 text-sm text-yellow-400">
              ⚠️ This will permanently delete the AI result from storage. This action cannot be
              undone.
            </p>
            <FooterAction>
              <FooterAction.Right>
                <Button
                  variant="secondary"
                  onClick={() => {
                    decision = false;
                    hide('delete-ai-result-confirmation');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    decision = true;
                    hide('delete-ai-result-confirmation');
                  }}
                >
                  Delete
                </Button>
              </FooterAction.Right>
            </FooterAction>
          </div>
        ),
        containerClassName: 'max-w-md',
        shouldCloseOnEsc: true,
        shouldCloseOnOverlayClick: true,
        // DialogProvider spreads show() options after its own onClose={hide}, so
        // this onClose replaces the provider's dismiss — call hide() explicitly.
        onClose: (dialogId?: string) => {
          uiDialogService.hide(dialogId ?? 'delete-ai-result-confirmation');
          resolve(decision);
        },
      });
    });

    if (!confirmed) {
      return;
    }

    // Mark group as deleting
    setDeletingGroups(prev => new Set(prev).add(group.key));

    try {
      const { aiResultsService, orthancAIService } = servicesManager.services;
      const removedDisplaySetUIDs: string[] = [];

      // Delete from both Orthanc storage and OHIF viewer.
      // Derive the Orthanc series base from app-config (same source as
      // the feedback API) so a deployment path change doesn't silently break
      // deletion. The UID→Orthanc-id lookup goes through orthancAIService, which
      // owns `/tools/lookup` (at the proxy root, distinct from the /pacs-mounted
      // series ops) together with its timeout and failure messages.
      const orthancSeriesBase = deriveFeedbackApiBase(); // e.g. '/pacs'
      const deleteResults = { viewer: 0, storage: 0, storageFailed: 0 };

      for (const displaySet of group.displaySets) {
        const uid = displaySet.displaySetInstanceUID;
        try {
          // Unresolvable UID means a stale group entry already gone from the
          // viewer. Skip it — deleteDisplaySet() splices at the findIndex result,
          // so an unknown UID would splice at -1 and drop an unrelated display set.
          const realDisplaySet = displaySetService.getDisplaySetByUID(uid);
          if (!realDisplaySet) {
            continue;
          }

          // 1. Delete from Orthanc storage. `storageOk` stays true when there is
          //    no server copy to delete; set false while the delete is pending and
          //    true again once the server copy is confirmed gone.
          let storageOk = true;
          if (realDisplaySet.SeriesInstanceUID) {
            storageOk = false;
            try {
              if (!orthancAIService) {
                // Only the send-ai mode renders this browser, and it depends on
                // orthanc-ai-routing — so this is a wiring error, not a runtime
                // state. Count it as a storage failure so the series stays in the
                // viewer rather than being hidden while it is still on the server.
                throw new Error(
                  'orthancAIService is not registered; cannot delete from Orthanc storage.'
                );
              }

              // Step 1: Lookup Orthanc internal ID from DICOM SeriesInstanceUID.
              // Throws (with a reader-facing message) on a transport or non-Orthanc
              // failure; resolves to null when Orthanc simply has no such series.
              const seriesId = await orthancAIService.lookupResourceId(
                realDisplaySet.SeriesInstanceUID,
                'Series',
                'look up the AI result series in Orthanc'
              );

              if (seriesId) {
                // Step 2: Delete using Orthanc internal ID (series operations are under /pacs)
                const deleteResponse = await fetch(`${orthancSeriesBase}/series/${seriesId}`, {
                  method: 'DELETE',
                });

                if (deleteResponse.ok) {
                  deleteResults.storage++;
                  storageOk = true;
                } else {
                  deleteResults.storageFailed++;
                  console.error(
                    `Failed to delete from Orthanc: ${deleteResponse.status} ${deleteResponse.statusText}`
                  );
                }
              } else {
                // Not in Orthanc: already absent, so removing it from the viewer
                // keeps them in sync (distinct from a lookup/network error).
                storageOk = true;
                console.warn(
                  `No Orthanc series entry found for ${realDisplaySet.SeriesInstanceUID}; treating as already deleted`
                );
              }
            } catch (storageErr) {
              deleteResults.storageFailed++;
              console.error(`Error deleting from Orthanc storage:`, storageErr);
            }
          }

          // 2. Remove from the viewer/cache only once the server copy is gone, so
          //    a failed DELETE doesn't hide a series a reload would bring back.
          if (storageOk) {
            displaySetService.deleteDisplaySet(uid);
            deleteResults.viewer++;
            removedDisplaySetUIDs.push(uid);
          }
        } catch (err) {
          console.error(`Failed to delete display set ${uid}:`, err);
        }
      }

      // Clear AI results cache only for the display sets actually removed.
      if (aiResultsService && removedDisplaySetUIDs.length > 0) {
        aiResultsService.removeDisplaySetsFromCache(studyInstanceUid, removedDisplaySetUIDs);
      }

      // Show appropriate notification based on results
      const totalDisplaySets = group.displaySets.length;
      if (deleteResults.storageFailed === 0 && deleteResults.viewer === totalDisplaySets) {
        uiNotificationService.show({
          title: 'AI Result Deleted',
          message: `Successfully deleted AI result from viewer and storage: ${group.label}`,
          type: 'success',
          duration: 3000,
        });
      } else {
        uiNotificationService.show({
          title: 'Deletion Incomplete',
          message: `Removed ${deleteResults.viewer}/${totalDisplaySets} from the viewer. ${deleteResults.storageFailed} series failed to delete from storage and were kept in the viewer to stay in sync with storage.`,
          type: 'warning',
          duration: 6000,
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
          <div className="bg-bkg-low flex h-[48px] w-full items-center justify-center gap-[10px] px-[8px] py-[10px]">
            <StudyBrowserViewOptions
              tabs={tabs}
              onSelectTab={onClickTab}
              activeTabName={activeTabName}
            />
            <StudyBrowserSort servicesManager={servicesManager} />
          </div>
        )}

        {tabData?.studies.map((study, studyIndex) => {
          const isExpanded = expandedStudyInstanceUIDs.includes(study.studyInstanceUid);

          return (
            // Fall back to the index when a study has no UID, so a
            // UID-less study can't collide with (or duplicate) another key.
            <div key={study.studyInstanceUid ?? `study-${studyIndex}`}>
              {/* Study Header */}
              <div
                className={`border-input hover:bg-accent border-t first:border-0 ${isExpanded ? 'bg-muted' : 'bg-background'} flex cursor-pointer select-none items-center gap-[6px] px-4 py-2 outline-none`}
                onClick={() => onClickStudy(study.studyInstanceUid)}
              >
                <Icons.ChevronRight
                  className={`text-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                />
                <div
                  className="text-foreground w-[160px] truncate text-[13px]"
                  title={study.date || 'No Study Date'}
                >
                  {study.date || 'No Study Date'}
                </div>
                <div
                  className="text-muted-foreground flex-1 truncate text-[13px]"
                  title={study.description}
                >
                  {study.description}
                </div>
                <div className="text-muted-foreground text-[12px]">{study.numInstances}</div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="space-y-2 pb-4">
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
                      <Accordion
                        type="single"
                        collapsible
                        key={group.key}
                      >
                        <AccordionItem value="group">
                          <AccordionTrigger className="border-input hover:bg-accent data-[state=open]:bg-muted bg-background flex min-h-[40px] cursor-pointer select-none items-start gap-[6px] border-t px-4 py-2 text-[13px] outline-none first:border-0">
                            <span className="text-foreground mr-1 mt-0.5">🤖</span>
                            <span className="text-foreground flex-1 whitespace-pre-line break-words text-left leading-snug">
                              {group.label}
                            </span>

                            {/* Delete button */}
                            <Button
                              variant="destructive"
                              size={isDeleting ? 'sm' : 'icon'}
                              className="ml-auto flex-shrink-0"
                              onClick={e => handleDeleteAIGroup(group, study.studyInstanceUid, e)}
                              disabled={isDeleting}
                              title="Delete AI Result"
                              aria-label="Delete AI Result"
                            >
                              {isDeleting ? 'Deleting…' : <Icons.Trash className="h-4 w-4" />}
                            </Button>
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
