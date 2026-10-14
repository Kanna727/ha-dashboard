// Loads the Maps JS API once per page, with the libraries the commute card
// needs. Shares the global promise name used by the Lovelace card.
declare global {
  interface Window {
    __gmapsLoadingPromise?: Promise<void>;
  }
}

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps?.places && window.google.maps.geometry) return Promise.resolve();
  if (!window.__gmapsLoadingPromise) {
    window.__gmapsLoadingPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,geometry&loading=async&callback=__gmapsReady`;
      script.async = true;
      (window as unknown as Record<string, unknown>).__gmapsReady = () => resolve();
      script.onerror = () => {
        window.__gmapsLoadingPromise = undefined;
        reject(new Error('Failed to load Google Maps'));
      };
      document.head.appendChild(script);
    });
  }
  return window.__gmapsLoadingPromise;
}
