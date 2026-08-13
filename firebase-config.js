// ============================================================
//  HANA LIMA – הגדרות Firebase
// ============================================================
//  ⚠️  החליפי את הערכים למטה בערכים מהפרויקט שלך ב-Firebase.
//  ראי הוראות מלאות ב-README.md (שלב "הדבקת ה-config").
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ה-config של הפרויקט hana-lima
const firebaseConfig = {
  apiKey: "AIzaSyBBk0jGGKqB2TVgw6aIszMcxObmogjwUgc",
  authDomain: "hana-lima.firebaseapp.com",
  projectId: "hana-lima",
  storageBucket: "hana-lima.firebasestorage.app",
  messagingSenderId: "944914985000",
  appId: "1:944914985000:web:0141ba7a3662a4fcdf451d",
  measurementId: "G-60Y0WRQDW2",
};

// אתחול האפליקציה
export const app = initializeApp(firebaseConfig);

// שירות ההתחברות
export const auth = getAuth(app);

// מסד הנתונים – עם שמירה מקומית (offline) כדי שהוספה תעבוד גם ברשת חלשה
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// דגל עזר – האם ה-config עדיין לא הוגדר (מציג הודעה במסך במקום שגיאה)
export const isConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";
