const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || "G-M6RS4S49J6";
const GA_DEBUG = import.meta.env.DEV;

let initialized = false;
const enabled = typeof window !== "undefined" && Boolean(GA_MEASUREMENT_ID);

function gtag(...args) {
  if (!enabled) return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

export function initAnalytics() {
  if (!enabled || initialized) return;

  initialized = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = gtag;

  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID, {
    anonymize_ip: true,
    send_page_view: false,
    debug_mode: GA_DEBUG,
  });

  if (!document.querySelector(`script[src*="${GA_MEASUREMENT_ID}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }
}

export function trackPageView(pageTitle, pagePath = window.location.pathname) {
  if (!enabled) return;

  gtag("event", "page_view", {
    page_title: pageTitle,
    page_location: window.location.href,
    page_path: pagePath,
  });
}

export function trackEvent(eventName, params = {}) {
  if (!enabled) return;

  gtag("event", eventName, {
    app_name: "epfo_ecr_checker",
    ...params,
  });
}

export function buildValidationAnalytics(rows) {
  const issueCounts = rows.reduce((acc, row) => {
    for (const issue of row.issues) {
      const key = issue.hbKey || "UNKNOWN";
      acc[key] = (acc[key] || 0) + 1;
    }
    return acc;
  }, {});

  return {
    row_count: rows.length,
    error_count: rows.reduce((sum, row) => sum + row.issues.filter(issue => issue.severity === "red").length, 0),
    warning_count: rows.reduce((sum, row) => sum + row.issues.filter(issue => issue.severity === "medium").length, 0),
    clean_row_count: rows.filter(row => !row.hasRed && !row.hasMedium).length,
    issue_codes: Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, count]) => `${code}:${count}`)
      .join(","),
  };
}
