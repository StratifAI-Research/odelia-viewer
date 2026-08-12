import React from 'react';
import { Button } from '@ohif/ui-next';

type ActionButtonsProps = {
  name: string;
  onClick?: () => void;
};

function ActionButtons({ name, onClick = () => {} }: ActionButtonsProps) {
  return (
    <Button
      className="px-2 py-2 text-base"
      onClick={onClick}
    >
      {name}
    </Button>
  );
}

export default ActionButtons;
