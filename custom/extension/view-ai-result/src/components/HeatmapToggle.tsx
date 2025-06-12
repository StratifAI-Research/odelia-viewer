import React from 'react';

interface HeatmapToggleProps {
  onToggle: () => void;
  isActive: boolean;
  className?: string;
}

const HeatmapToggle: React.FC<HeatmapToggleProps> = ({
  onToggle,
  isActive,
  className = '',
}) => {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-center w-8 h-8 rounded transition-colors ${
        isActive
          ? 'bg-primary-main text-white'
          : 'bg-secondary-dark text-primary-light hover:bg-secondary-main'
      } ${className}`}
      title={`${isActive ? 'Hide' : 'Show'} Heatmap`}
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
