import React from 'react';
import { Icons } from '@ohif/ui-next';
import classNames from 'classnames';

type AIResultsSelectorProps = {
  onResultChange: (direction: 'next' | 'prev') => void;
  className?: string;
  isActive?: boolean;
};

const AIResultsSelector = ({ onResultChange, className, isActive }: AIResultsSelectorProps) => {
  const arrowClasses = classNames(
    'cursor-pointer flex items-center justify-center shrink-0 text-primary-light active:text-white hover:bg-secondary-light/60 rounded bg-black/50 p-1',
    className
  );

  return (
    <div className="flex">
      <div className={arrowClasses}>
        <button
          type="button"
          onClick={() => onResultChange('prev')}
          className="flex items-center justify-center"
          title="Previous AI Result"
        >
          <Icons.ArrowLeftBold className={isActive ? "text-white" : "text-primary-light"} />
        </button>
      </div>
      <div className={arrowClasses}>
        <button
          type="button"
          onClick={() => onResultChange('next')}
          className="flex items-center justify-center"
          title="Next AI Result"
        >
          <Icons.ArrowRightBold className={isActive ? "text-white" : "text-primary-light"} />
        </button>
      </div>
    </div>
  );
};

export default AIResultsSelector;
