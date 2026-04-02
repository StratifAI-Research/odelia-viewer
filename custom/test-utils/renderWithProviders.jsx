/**
 * Render helper that wraps components with the minimal React context tree
 * expected by OHIF-based components.
 *
 * Usage:
 *   import { renderWithProviders } from '../../test-utils/renderWithProviders';
 *   const { getByText } = renderWithProviders(<MyPanel />);
 */
const React = require('react');
const { render } = require('@testing-library/react');

function renderWithProviders(ui, { servicesManager, commandsManager, extensionManager, ...renderOptions } = {}) {
  const {
    createMockServicesManager,
  } = require('./ohif-mocks');

  const mockServicesManager = servicesManager || createMockServicesManager();
  const mockCommandsManager = commandsManager || { runCommand: jest.fn() };
  const mockExtensionManager = extensionManager || { getModuleEntry: jest.fn() };

  function Wrapper({ children }) {
    return React.createElement(React.Fragment, null, children);
  }

  return {
    servicesManager: mockServicesManager,
    commandsManager: mockCommandsManager,
    extensionManager: mockExtensionManager,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}

module.exports = { renderWithProviders };
