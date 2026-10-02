import React from 'react';
import { AboutModal } from '@ohif/ui-next';
import detect from 'browser-detect';
import { useTranslation } from 'react-i18next';

export default function OdeliaAboutModal() {
  const { t } = useTranslation('AboutModal');
  const { os, version, name } = detect();
  const browser = `${name ? name[0].toUpperCase() + name.slice(1) : ''} ${version || ''}`;

  return (
    <AboutModal className="w-[400px]">
      <AboutModal.ProductName>ODELIA Viewer</AboutModal.ProductName>
      <AboutModal.ProductVersion>{process.env.ODELIA_PRODUCT_VERSION}</AboutModal.ProductVersion>
      <AboutModal.Body>
        <AboutModal.DetailItem
          label={t('Based on', 'Based on')}
          value={`OHIF ${process.env.VERSION_NUMBER?.trim() || ''}`}
        />
        <AboutModal.DetailItem
          label={t('Commit Hash')}
          value={process.env.COMMIT_HASH || ''}
        />
        <AboutModal.DetailItem
          label={t('Current Browser & OS')}
          value={`${browser.trim()}, ${os || ''}`}
        />
        <AboutModal.SocialItem
          icon="SocialGithub"
          url="StratifAI-Research/odelia-viewer"
          text="github.com/StratifAI-Research/odelia-viewer"
          className="[&_a]:text-sm"
        />
      </AboutModal.Body>
    </AboutModal>
  );
}

OdeliaAboutModal.title = 'About ODELIA Viewer';
