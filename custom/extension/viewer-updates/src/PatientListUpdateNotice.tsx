import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import { useReleaseUpdate } from './ReleaseUpdateProvider';
import { CACHE_KEY, newer, readStorage, writeStorage } from './releaseClient';

const acknowledged = new Set<string>();

export default function PatientListUpdateNotice() {
  const { release, installed, identity, basePath } = useReleaseUpdate();
  const { t } = useTranslation();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const key =
    release && identity
      ? `${CACHE_KEY}:dismissed:${encodeURIComponent(basePath)}:${identity}:${release.version}`
      : null;

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (key && event.key === key && event.newValue === 'true') {
        acknowledged.add(key);
        setDismissedKey(key);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  if (
    !release ||
    !key ||
    !newer(release, installed) ||
    dismissedKey === key ||
    acknowledged.has(key) ||
    readStorage(key) === 'true'
  ) {
    return null;
  }
  const dismiss = () => {
    acknowledged.add(key);
    writeStorage(key, 'true');
    setDismissedKey(key);
  };

  return (
    <Dialog
      open={true}
      shouldCloseOnEsc={false}
      shouldCloseOnOverlayClick={false}
      onOpenChange={open => !open && dismiss()}
    >
      <DialogContent
        data-cy="viewer-update-notice"
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {t('ViewerUpdates:Title', 'A new ODELIA Viewer version is available')}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-foreground">
          {t(
            'ViewerUpdates:Message',
            'Version {{latest}} is available. This viewer is running {{installed}}. Contact your administrator to upgrade.',
            { latest: release.version, installed }
          )}
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              window.open(release.url, '_blank', 'noopener,noreferrer');
              dismiss();
            }}
          >
            {t('ViewerUpdates:ReleaseNotes', 'Release notes')}
          </Button>
          <Button onClick={dismiss}>{t('ViewerUpdates:Dismiss', 'Dismiss')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
