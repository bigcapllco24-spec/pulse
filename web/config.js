// App settings. Fill these in after following README.md. With firebase left as null the app runs in
// demo mode: everything is saved on this phone only and AI features are off.
export const CONFIG = {
  appName: "Pulse", // working name; change freely
  firebase: null,   // { apiKey, authDomain, projectId, messagingSenderId, appId } from Firebase console → Project settings → Web app
  vapidKey: "",     // Firebase console → Cloud Messaging → Web Push certificates
  workerUrl: "",    // the AI relay after `wrangler deploy`, e.g. "https://pulse-ai.<you>.workers.dev"
  ads: { enabled: false, every: 8, html: "" }, // contextual ads only; labelled "Ad"; never inside news or AI text
  grievanceEmail: "grievance@example.com",
  companyName: "Your company Pvt Ltd",
};
