import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import { Button, ButtonGroup } from '@ohif/ui';

function ActionButtons({ onExportClick }) {
  const { t } = useTranslation('MeasurementTable');

  return (
    <React.Fragment>
      <ButtonGroup color="black" size="inherit">
        <Button className="px-2 py-2 text-base" onClick={onExportClick}>
          {t('Export CSV')}
        </Button>
      </ButtonGroup>
    </React.Fragment>
  );
}

ActionButtons.propTypes = {
  onExportClick: PropTypes.func,
};

ActionButtons.defaultProps = {
  onExportClick: () => alert('Export'),
};

export default ActionButtons;
