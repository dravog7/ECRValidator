const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || "G-M6RS4S49J6";
const GA_DEBUG = import.meta.env.DEV;

let initialized = false;
const enabled = typeof window !== "undefined" && Boolean(GA_MEASUREMENT_ID);
export function gtag(...args) {
  if (!enabled) return;
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag === "function" && window.gtag !== gtag) {
    window.gtag(...args);
  } else {
    window.dataLayer.push(arguments);
  }
}

export function initAnalytics() {
  if (!enabled || initialized) return;

  initialized = true;
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = gtag;
  }

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
    ...(GA_DEBUG ? { debug_mode: true } : {}),
  });
}

export function trackPageView(pageTitle, pagePath = window.location.pathname) {
  if (!enabled) return;

  const params = {
    page_title: pageTitle,
    page_location: window.location.href,
    page_path: pagePath,
  };
  if (GA_DEBUG) {
    params.debug_mode = true;
  }

  gtag("event", "page_view", params);
}

export function trackEvent(eventName, params = {}) {
  if (!enabled) return;

  const eventParams = {
    app_name: "epfo_ecr_checker",
    ...params,
  };
  if (GA_DEBUG) {
    eventParams.debug_mode = true;
  }

  gtag("event", eventName, eventParams);
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
