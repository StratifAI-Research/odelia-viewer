import React from 'react';
import PropTypes from 'prop-types';

import { Button, ButtonGroup } from '@ohif/ui';

function ActionButtons({ onClick, name }) {

  return (
    <React.Fragment>
      <ButtonGroup color="black" size="inherit">
        <Button className="px-2 py-2 text-base" onClick={onClick}>
          {name}
        </Button>
      </ButtonGroup>
    </React.Fragment>
  );
}

ActionButtons.propTypes = {
  onClick: PropTypes.func,
};

ActionButtons.defaultProps = {
  onClick: () => alert('Export'),
};

export default ActionButtons;
