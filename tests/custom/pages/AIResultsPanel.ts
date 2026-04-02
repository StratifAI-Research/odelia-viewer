import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for the AI Results / Feedback Panel.
 * Encapsulates interactions with AI result viewing and feedback submission.
 */
export class AIResultsPanel {
  readonly page: Page;
  readonly panel: Locator;
  readonly resultContainer: Locator;
  readonly feedbackSection: Locator;
  readonly agreeButton: Locator;
  readonly disagreeButton: Locator;
  readonly submitFeedbackButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator('[data-cy="ai-results-panel"]');
    this.resultContainer = this.panel.locator('[data-cy="ai-result"]');
    this.feedbackSection = this.panel.locator('[data-cy="feedback-section"]');
    this.agreeButton = this.feedbackSection.locator('button:has-text("Agree")');
    this.disagreeButton = this.feedbackSection.locator('button:has-text("Disagree")');
    this.submitFeedbackButton = this.feedbackSection.locator('button:has-text("Submit")');
  }

  async waitForResults(timeout = 30_000) {
    await this.resultContainer.first().waitFor({ state: 'visible', timeout });
  }

  async submitFeedback(verdict: 'agree' | 'disagree') {
    if (verdict === 'agree') {
      await this.agreeButton.click();
    } else {
      await this.disagreeButton.click();
    }
    await this.submitFeedbackButton.click();
  }
}
