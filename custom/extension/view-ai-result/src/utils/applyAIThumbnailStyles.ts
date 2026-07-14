/**
 * Applies multiline styles to AI result thumbnails containing robot emoji
 */
export function applyAIThumbnailStyles() {
  // Wait for DOM to be ready
  setTimeout(() => {
    // Find all text elements in thumbnails that contain robot emoji
    const allTextElements = document.querySelectorAll('div[class*="text-"], span[class*="text-"]');

    allTextElements.forEach(node => {
      const element = node as HTMLElement;
      if (element.textContent && element.textContent.includes('🤖')) {
        // Only apply styles if the element is inside an AI-result thumbnail
        const thumbnailRoot = element.closest('.ai-result-thumbnail');

        // If not contained in an AI thumbnail, skip entirely (prevents accordion wrapper being styled)
        if (!thumbnailRoot) {
          return;
        }

        // Skip styling when the element is inside a list-row thumbnail (height 40px)
        if (thumbnailRoot.classList.toString().includes('h-[40px]')) {
          return; // Keep list preset single-line
        }

        // Check if already styled to prevent re-styling
        if (element.dataset.aiStyled === 'true') {
          return;
        }

        // Apply multiline styles directly (respect \n line breaks)
        element.style.whiteSpace = 'pre-line';
        element.style.textOverflow = 'clip';
        element.style.overflow = 'hidden';
        element.style.lineHeight = '1.1';
        element.style.fontSize = '10px';
        element.style.maxHeight = '60px';
        element.style.display = '-webkit-box';
        // Non-standard webkit clamp properties are not in CSSStyleDeclaration's type.
        (element.style as any).webkitLineClamp = '4';
        (element.style as any).webkitBoxOrient = 'vertical';

        // Mark as styled to prevent re-styling
        element.dataset.aiStyled = 'true';

        // Also apply to parent containers that might be constraining
        let parent = element.parentElement;
        while (parent && parent.classList) {
          if (parent.classList.toString().includes('text-ellipsis') ||
              parent.classList.toString().includes('whitespace-nowrap')) {
            parent.style.whiteSpace = 'pre-line';
            parent.style.textOverflow = 'clip';
            parent.style.overflow = 'hidden';
          }
          parent = parent.parentElement;
        }
      }
    });
  }, 100);
}

let observerDebounceTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Set up a mutation observer to handle dynamically added thumbnails
 */
export function setupAIThumbnailObserver() {
  const win = window as any;

  // Clear any existing observer
  if (win.aiThumbnailObserver) {
    win.aiThumbnailObserver.disconnect();
  }

  const observer = new MutationObserver((mutations) => {
    // Debounce to prevent excessive calls
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
    }
    observerDebounceTimer = setTimeout(() => {
      let shouldApplyStyles = false;

      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          // Only trigger if we actually added thumbnail-related nodes
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) { // Element node
              const element = node as Element;
              // Safe className check - ensure it's a string before calling includes
              const className: unknown = (element as any).className;
              const classNameStr = typeof className === 'string' ? className : (className as any)?.toString?.() || '';

              if (classNameStr.includes('thumbnail') ||
                  (element.querySelector && element.querySelector('[class*="thumbnail"]'))) {
                shouldApplyStyles = true;
                break;
              }
            }
          }
        }
      });

      if (shouldApplyStyles) {
        console.log('[MutationObserver] Applying AI styles due to thumbnail changes');
        applyAIThumbnailStyles();
      }
    }, 200); // Debounce for 200ms
  });

  // Only observe specific containers, not the entire document
  const studyBrowserContainer = document.querySelector('[class*="study-browser"], [class*="StudyBrowser"]');
  const targetElement = studyBrowserContainer || document.body;

  observer.observe(targetElement, {
    childList: true,
    subtree: true
  });

  // Store observer globally so we can clean it up
  win.aiThumbnailObserver = observer;
}
