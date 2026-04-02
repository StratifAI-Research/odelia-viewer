import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for the Chat Panel (MedGemma / Ollama chat).
 * Encapsulates interactions with the WebSocket-based chat UI.
 */
export class ChatPanel {
  readonly page: Page;
  readonly panel: Locator;
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  readonly messageList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator('[data-cy="chat-panel"]');
    this.messageInput = this.panel.locator('textarea, input[type="text"]');
    this.sendButton = this.panel.locator('button[data-cy="chat-send"], button:has-text("Send")');
    this.messageList = this.panel.locator('[data-cy="chat-messages"]');
  }

  async waitForPanel() {
    await this.panel.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async sendMessage(text: string) {
    await this.messageInput.fill(text);
    await this.sendButton.click();
  }

  async waitForResponse(timeout = 30_000) {
    const lastMsg = this.messageList.locator('[data-cy="chat-message-assistant"]').last();
    await lastMsg.waitFor({ state: 'visible', timeout });
    return lastMsg.textContent();
  }
}
