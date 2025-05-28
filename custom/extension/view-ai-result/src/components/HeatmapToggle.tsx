import React from 'react';
import classNames from 'classnames';
import { Icons } from '@ohif/ui-next';

const arrowClasses =
  'cursor-pointer flex items-center justify-center shrink-0 text-primary-light active:text-white hover:bg-secondary-light/60 rounded bg-black/50 p-1';

type HeatmapToggleProps = {
  onToggle: () => void;
  className?: string;
  isActive?: boolean;
};

const HeatmapToggle = ({ onToggle, className, isActive }: HeatmapToggleProps) => {
  return (
    <div className={classNames(className, 'flex')}>
      <div className={arrowClasses}>
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center justify-center"
          title={isActive ? "Hide Heatmap" : "Show Heatmap"}
        >
          <Icons.ArrowRightBold className={isActive ? "text-white" : "text-primary-light"} />
        </button>
      </div>
    </div>
  );
};

export default HeatmapToggle;
