/**
 * Applies multiline styles to AI result thumbnails containing robot emoji
 */
export function applyAIThumbnailStyles() {
  // Wait for DOM to be ready
  setTimeout(() => {
    // Find all text elements in thumbnails that contain robot emoji
    const allTextElements = document.querySelectorAll('div[class*="text-"], span[class*="text-"]');

    allTextElements.forEach(element => {
      if (element.textContent && element.textContent.includes('🤖')) {
        // Check if already styled to prevent re-styling
        if (element.dataset.aiStyled === 'true') {
          return;
        }

        // Apply multiline styles directly
        element.style.whiteSpace = 'normal';
        element.style.textOverflow = 'clip';
        element.style.overflow = 'visible';
        element.style.lineHeight = '1.1';
        element.style.fontSize = '10px';
        element.style.maxHeight = '60px';
        element.style.display = '-webkit-box';
        element.style.webkitLineClamp = '4';
        element.style.webkitBoxOrient = 'vertical';

        // Mark as styled to prevent re-styling
        element.dataset.aiStyled = 'true';

        // Also apply to parent containers that might be constraining
        let parent = element.parentElement;
        while (parent && parent.classList) {
          if (parent.classList.toString().includes('text-ellipsis') ||
              parent.classList.toString().includes('whitespace-nowrap')) {
            parent.style.whiteSpace = 'normal';
            parent.style.textOverflow = 'clip';
            parent.style.overflow = 'visible';
          }
          parent = parent.parentElement;
        }
      }
    });
  }, 100);
}

let observerDebounceTimer = null;

/**
 * Set up a mutation observer to handle dynamically added thumbnails
 */
export function setupAIThumbnailObserver() {
  // Clear any existing observer
  if (window.aiThumbnailObserver) {
    window.aiThumbnailObserver.disconnect();
  }

  const observer = new MutationObserver((mutations) => {
    // Debounce to prevent excessive calls
    clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
      let shouldApplyStyles = false;

      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          // Only trigger if we actually added thumbnail-related nodes
          for (let node of mutation.addedNodes) {
            if (node.nodeType === 1 && // Element node
                (node.className?.includes('thumbnail') ||
                 node.querySelector && node.querySelector('[class*="thumbnail"]'))) {
              shouldApplyStyles = true;
              break;
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
  window.aiThumbnailObserver = observer;
}
