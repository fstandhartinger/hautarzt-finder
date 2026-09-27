'use strict';

(() => {
  const privacySignal = navigator.doNotTrack || navigator.msDoNotTrack || window.doNotTrack;
  const doNotTrack = privacySignal === true || /^(1|yes)$/i.test(String(privacySignal || ''));
  if (doNotTrack || navigator.globalPrivacyControl === true) return;

  // Only allow anonymous pageviews for the app landing page and this notice.
  // Canonicalizing the URL and clearing the referrer prevents queries,
  // fragments, search terms, and previous app paths from reaching Umami.
  window.hautarztUmamiBeforeSend = (type, payload) => {
    if (type !== 'event' || !payload || typeof payload !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(payload, 'name') ||
        Object.prototype.hasOwnProperty.call(payload, 'data')) return false;

    let page;
    try {
      page = new URL(payload.url, window.location.origin);
    } catch {
      return false;
    }
    if (page.origin !== window.location.origin || !['/', '/privacy.html'].includes(page.pathname)) {
      return false;
    }

    return {
      website: '42ccc78c-2bdc-4a83-8d4f-3b98a35ad2c9',
      hostname: window.location.hostname,
      url: page.pathname,
      referrer: '',
      title: 'Hautarzt-Finder',
    };
  };

  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://bh-analytics.app.mintapis.com/script.js';
  script.integrity = 'sha384-ZMxgpYfO/phGz4GiYTIZhcauuGKTb2onmOB5gsiigjmBR38DGAmIna5J1Y/dM/13';
  script.crossOrigin = 'anonymous';
  script.referrerPolicy = 'no-referrer';
  script.dataset.websiteId = '42ccc78c-2bdc-4a83-8d4f-3b98a35ad2c9';
  script.dataset.domains = 'hautarzt-finder.app.mintapis.com';
  script.dataset.doNotTrack = 'true';
  script.dataset.excludeSearch = 'true';
  script.dataset.excludeHash = 'true';
  script.dataset.beforeSend = 'hautarztUmamiBeforeSend';
  document.head.append(script);
})();
