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
        console.log('Found AI thumbnail text element:', element.textContent);

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

/**
 * Set up a mutation observer to handle dynamically added thumbnails
 */
export function setupAIThumbnailObserver() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) {
        applyAIThumbnailStyles();
      }
    });
  });

  // Start observing the document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}
