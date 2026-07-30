import React from 'react';

interface HeatmapToggleProps {
  onToggle: () => void;
  isActive: boolean;
  className?: string;
  disabled?: boolean;
}

const HeatmapToggle: React.FC<HeatmapToggleProps> = ({
  onToggle,
  isActive,
  className = '',
  disabled = false,
}) => {
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-gray-700 text-gray-500'
          : isActive
            ? 'bg-primary-main text-white'
            : 'bg-secondary-dark text-primary-light hover:bg-secondary-main'
      } ${className}`}
      title={disabled ? 'No heatmap available' : `${isActive ? 'Hide' : 'Show'} Heatmap`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm1 1h8v8H4V4z" />
      </svg>
    </button>
  );
};

export default HeatmapToggle;
