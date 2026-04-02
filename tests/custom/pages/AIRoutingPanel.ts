import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for the AI Routing Panel.
 * Encapsulates interactions with the Orthanc AI routing extension UI.
 */
export class AIRoutingPanel {
  readonly page: Page;
  readonly panel: Locator;
  readonly sendButton: Locator;
  readonly statusIndicator: Locator;
  readonly endpointSelector: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator('[data-cy="ai-routing-panel"]');
    this.sendButton = this.panel.locator('button:has-text("Send")');
    this.statusIndicator = this.panel.locator('[data-cy="ai-status"]');
    this.endpointSelector = this.panel.locator('[data-cy="ai-endpoint-select"]');
  }

  async waitForPanel() {
    await this.panel.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async selectEndpoint(name: string) {
    await this.endpointSelector.click();
    await this.page.locator(`text=${name}`).click();
  }

  async sendToAI() {
    await this.sendButton.click();
  }

  async waitForResult(timeout = 60_000) {
    await this.statusIndicator.waitFor({ state: 'visible', timeout });
  }
}
