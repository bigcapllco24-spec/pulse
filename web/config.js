// App settings. Fill these in after following README.md. With firebase left as null the app runs in
// demo mode: everything is saved on this phone only and AI features are off.
export const CONFIG = {
  appName: "Pulse", // working name; change freely
  // Firebase project "pulseapp". These values are public by design; firestore.rules protects the data.
  firebase: {
    apiKey: "AIzaSyBc0zWWmkgrMbVjldxIWBESsRboAcSYBZU",
    authDomain: "pulseapp-e536f.firebaseapp.com",
    projectId: "pulseapp-e536f",
    storageBucket: "pulseapp-e536f.firebasestorage.app",
    messagingSenderId: "1052244541798",
    appId: "1:1052244541798:web:cc38a7673a3b1d7f1588a7",
  },
  vapidKey: "BLZdEHd_OJUEAO09DL3oEucPYFjHMiM-YUCoVdUvuqs4O7IkxWCDMuZ-8GwkKN4h0HKvIlOz-upbn1CAr08a_fQ", // Cloud Messaging → Web Push certificates
  workerUrl: "",    // the AI relay after `wrangler deploy`, e.g. "https://pulse-ai.<you>.workers.dev"
  ads: { enabled: false, every: 8, html: "" }, // contextual ads only; labelled "Ad"; never inside news or AI text
  grievanceEmail: "grievance@example.com",
  companyName: "Your company Pvt Ltd",
};
