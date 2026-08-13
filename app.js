// ============================================================
//  HANA LIMA — לוגיקת האפליקציה (v2)
// ============================================================

import { auth, db, isConfigured } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  updateDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ------------------------------------------------------------
//  ערכים קבועים
// ------------------------------------------------------------
const CATEGORIES = {
  income: [
    { v: "fair", l: "יריד/דוכן" },
    { v: "direct", l: "מכירה ישירה" },
    { v: "instagram", l: "אינסטגרם/הזמנה" },
    { v: "website", l: "אתר" },
    { v: "workshop", l: "סדנה" },
    { v: "other", l: "אחר" },
  ],
  expense: [
    { v: "materials", l: "חומרי גלם" },
    { v: "casting", l: "יציקות" },
    { v: "booth", l: "דוכן/יריד" },
    { v: "training", l: "סדנה/השתלמות" },
    { v: "packaging", l: "אריזה (קופסאות/שקיות/מדבקות)" },
    { v: "tools", l: "כלי עבודה" },
    { v: "equipment", l: "ציוד משלים" },
    { v: "other", l: "אחר" },
  ],
};

const ITEM_TYPES = [
  { v: "necklace_gold", l: "שרשרת זהב" },
  { v: "necklace_silver", l: "שרשרת כסף" },
  { v: "earrings_gold", l: "עגילי זהב" },
  { v: "earrings_silver", l: "עגילי כסף" },
  { v: "ring_gold", l: "טבעת זהב" },
  { v: "ring_silver", l: "טבעת כסף" },
  { v: "bracelet_gold", l: "צמיד זהב" },
  { v: "bracelet_silver", l: "צמיד כסף" },
  { v: "set_gold", l: "סט זהב" },
  { v: "set_silver", l: "סט כסף" },
  { v: "other", l: "אחר" },
];

const PAYMENTS = { bit: "ביט", paybox: "פייבוקס", cash: "מזומן", credit: "אשראי", other: "אחר" };

const ORDER_STATUS = {
  new: "חדשה",
  prep: "בהכנה",
  ready: "מוכנה",
  delivered: "נמסרה",
};

const catLabel = (type, v) =>
  (CATEGORIES[type]?.find((c) => c.v === v) || {}).l || v || "—";
const itemLabel = (v) => (ITEM_TYPES.find((i) => i.v === v) || {}).l || v || "—";
const payLabel = (v) => PAYMENTS[v] || v || "—";

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

// ------------------------------------------------------------
//  עזרי פורמט ותאריך
// ------------------------------------------------------------
const ils = (n) => "₪" + Math.round(n).toLocaleString("he-IL");
const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const monthOf = (iso) => (iso || "").slice(0, 7);
const yearOf = (iso) => (iso || "").slice(0, 4);
const currentMonth = () => todayISO().slice(0, 7);
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return `${MONTHS_HE[+m - 1]} ${y}`;
};
const fmtDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// ------------------------------------------------------------
//  מצב גלובלי
// ------------------------------------------------------------
let uid = null;
let transactions = [];
let orders = [];
let shopping = [];
let unsub = { tx: null, shop: null, orders: null };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ============================================================
//  אתחול / התחברות
// ============================================================
window.addEventListener("DOMContentLoaded", init);

function init() {
  buildSelects();
  wireEvents();
  registerServiceWorker();

  if (!isConfigured) {
    $("#splash").classList.add("hidden");
    $("#auth-screen").classList.remove("hidden");
    $("#config-warning").classList.remove("hidden");
    return;
  }

  onAuthStateChanged(auth, (user) => {
    $("#splash").classList.add("hidden");
    if (user) {
      uid = user.uid;
      $("#auth-screen").classList.add("hidden");
      $("#app").classList.remove("hidden");
      $("#account-email").textContent = user.email || "";
      startListeners();
    } else {
      uid = null;
      stopListeners();
      $("#app").classList.add("hidden");
      $("#auth-screen").classList.remove("hidden");
    }
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

// ------------------------------------------------------------
//  בניית תפריטי בחירה
// ------------------------------------------------------------
function buildSelects() {
  const itemOpts = ITEM_TYPES.map((i) => `<option value="${i.v}">${i.l}</option>`).join("");
  $("#tx-item-type").innerHTML = itemOpts;
  $("#order-item-type").innerHTML = itemOpts;
  $("#order-category").innerHTML = CATEGORIES.income
    .map((c) => `<option value="${c.v}">${c.l}</option>`)
    .join("");
  fillCategories("income");
}
function fillCategories(type) {
  $("#tx-category").innerHTML = CATEGORIES[type]
    .map((c) => `<option value="${c.v}">${c.l}</option>`)
    .join("");
}

// ============================================================
//  חיווט אירועים
// ============================================================
function wireEvents() {
  $("#login-form").addEventListener("submit", handleLogin);
  $("#logout-btn").addEventListener("click", () => signOut(auth));
  $("#logout-btn-2").addEventListener("click", () => signOut(auth));

  $$(".tab[data-goto]").forEach((t) =>
    t.addEventListener("click", () => showScreen(t.dataset.goto))
  );
  $$("[data-add]").forEach((b) =>
    b.addEventListener("click", () => openForm(b.dataset.add))
  );
  $$("[data-goto-btn]").forEach((b) =>
    b.addEventListener("click", () => showScreen(b.dataset.gotoBtn))
  );

  // טופס תנועה
  $("#form-back").addEventListener("click", () => showScreen(lastScreen));
  $$(".toggle").forEach((t) =>
    t.addEventListener("click", () => setFormType(t.dataset.type))
  );
  $("#tx-form").addEventListener("submit", handleSaveTx);
  $("#tx-category").addEventListener("change", updateOtherField);
  $("#tx-payment").addEventListener("change", updateOtherField);

  // קבלה
  $("#receipt-btn").addEventListener("click", () => $("#tx-receipt").click());
  $("#tx-receipt").addEventListener("change", handleReceiptPick);
  $("#receipt-remove").addEventListener("click", clearReceiptPreview);
  $("#receipt-close").addEventListener("click", () => $("#receipt-modal").classList.add("hidden"));
  $("#receipt-modal").addEventListener("click", (e) => {
    if (e.target.id === "receipt-modal") $("#receipt-modal").classList.add("hidden");
  });

  // תנועות
  $("#filter-month").addEventListener("change", renderList);
  $("#search-box").addEventListener("input", renderList);

  // הזמנות
  $("#orders-back").addEventListener("click", () => showScreen(lastScreen === "orders" ? "home" : lastScreen));
  $$("[data-add-order]").forEach((b) => b.addEventListener("click", () => openOrderForm()));
  $("#add-order-btn").addEventListener("click", () => openOrderForm());
  $("#add-order-btn-2").addEventListener("click", () => openOrderForm());
  $("#home-orders-manage").addEventListener("click", () => showScreen("orders"));
  $("#order-form-back").addEventListener("click", () => showScreen("orders"));
  $("#order-form").addEventListener("submit", handleSaveOrder);

  // דוחות
  $("#report-month").addEventListener("change", renderReports);

  // קניות
  $("#shopping-back").addEventListener("click", () => showScreen("settings"));
  $("#shopping-form").addEventListener("submit", handleAddShopping);

  // ייצוא
  $("#export-scope").addEventListener("change", onExportScopeChange);
  $("#export-btn").addEventListener("click", exportCSV);

  // מודלים
  $("#confirm-cancel").addEventListener("click", () => closeConfirm(false));
  $("#confirm-modal").addEventListener("click", (e) => {
    if (e.target.id === "confirm-modal") closeConfirm(false);
  });

  // גלילת שדה-בפוקוס לתצוגה (חשוב בטלפון עם מקלדת פתוחה)
  $$("input, select").forEach((el) =>
    el.addEventListener("focus", () => {
      setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    })
  );
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const pass = $("#login-password").value;
  const errEl = $("#login-error");
  errEl.textContent = "";
  if (!email || !pass) {
    errEl.textContent = "יש למלא אימייל וסיסמה.";
    return;
  }
  const btn = $("#login-btn");
  btn.disabled = true;
  btn.textContent = "מתחברת…";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    const map = {
      "auth/invalid-credential": "אימייל או סיסמה שגויים.",
      "auth/invalid-email": "כתובת אימייל לא תקינה.",
      "auth/user-not-found": "המשתמש לא נמצא.",
      "auth/wrong-password": "סיסמה שגויה.",
      "auth/too-many-requests": "יותר מדי ניסיונות. נסי שוב בעוד כמה דקות.",
      "auth/network-request-failed": "אין חיבור לרשת.",
    };
    errEl.textContent = map[err.code] || "שגיאה בהתחברות. נסי שוב.";
  } finally {
    btn.disabled = false;
    btn.textContent = "התחברות";
  }
}

// ============================================================
//  מאזינים בזמן אמת
// ============================================================
function userCol(name) {
  return collection(db, "users", uid, name);
}
function startListeners() {
  unsub.tx = onSnapshot(query(userCol("transactions"), orderBy("date", "desc")), (snap) => {
    transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
  unsub.orders = onSnapshot(query(userCol("orders"), orderBy("createdAt", "desc")), (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    buildEventsDatalist();
    renderOrders();
    renderDashboard();
  });
  unsub.shop = onSnapshot(query(userCol("shoppingList"), orderBy("createdAt", "desc")), (snap) => {
    shopping = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderShopping();
  });
}
function stopListeners() {
  Object.values(unsub).forEach((u) => u && u());
  unsub = { tx: null, shop: null, orders: null };
  transactions = [];
  orders = [];
  shopping = [];
}

// ============================================================
//  ניווט
// ============================================================
let lastScreen = "home";
const SUB_SCREENS = ["form", "order-form", "orders", "shopping"];
function showScreen(name) {
  $$(".screen").forEach((s) => s.classList.toggle("hidden", s.dataset.screen !== name));
  $$(".tab[data-goto]").forEach((t) => t.classList.toggle("active", t.dataset.goto === name));
  if (!SUB_SCREENS.includes(name)) lastScreen = name;
  window.scrollTo(0, 0);
  if (name === "list") renderList();
  if (name === "reports") renderReports();
  if (name === "orders") renderOrders();
}

// ============================================================
//  טופס תנועה
// ============================================================
let formType = "income";
// מצב קבלה נוכחי בטופס
let newReceiptDataUrl = null; // תמונה חדשה שנבחרה (טרם נשמרה)
let currentReceiptId = null; // מזהה קבלה קיימת (בעריכה)
let receiptRemoved = false;

function setFormType(type) {
  formType = type;
  $$(".toggle").forEach((t) => t.classList.toggle("active", t.dataset.type === type));
  fillCategories(type);
  const isIncome = type === "income";
  $("#item-type-field").classList.toggle("hidden", !isIncome);
  // ברירת מחדל לאמצעי תשלום ברישום חדש: הוצאה=אשראי, הכנסה=ביט
  if (!$("#tx-id").value) {
    $("#tx-payment").value = isIncome ? "bit" : "credit";
  }
  updateOtherField();
}

// מציג שדה "פירוט (אחר)" כשקטגוריה או אמצעי תשלום = "אחר"
function updateOtherField() {
  const show = $("#tx-category").value === "other" || $("#tx-payment").value === "other";
  $("#tx-other-field").classList.toggle("hidden", !show);
}

function openForm(type, tx = null) {
  $("#form-error").textContent = "";
  resetReceiptState();
  if (tx) {
    $("#form-title").textContent = "עריכת רישום";
    $("#tx-id").value = tx.id;
    setFormType(tx.type);
    $("#tx-amount").value = tx.amount;
    $("#tx-description").value = tx.description || "";
    $("#tx-date").value = tx.date || todayISO();
    $("#tx-payment").value = tx.paymentMethod || "bit";
    $("#tx-category").value = tx.category || CATEGORIES[tx.type][0].v;
    $("#tx-item-type").value = tx.itemType || ITEM_TYPES[0].v;
    $("#tx-event").value = tx.event || "";
    $("#tx-other").value = tx.otherDetail || "";
    updateOtherField();
    if (tx.receiptId) {
      currentReceiptId = tx.receiptId;
      showReceiptExisting(tx.receiptId);
    }
  } else {
    $("#form-title").textContent = type === "income" ? "הכנסה חדשה" : "הוצאה חדשה";
    $("#tx-id").value = "";
    setFormType(type);
    $("#tx-amount").value = "";
    $("#tx-description").value = "";
    $("#tx-date").value = todayISO();
    $("#tx-event").value = "";
    $("#tx-other").value = "";
    // אמצעי התשלום נקבע ב-setFormType לפי סוג הרישום
    updateOtherField();
  }
  showScreen("form");
  setTimeout(() => $("#tx-amount").focus(), 120);
}

async function handleSaveTx(e) {
  e.preventDefault();
  const errEl = $("#form-error");
  errEl.textContent = "";

  const amount = parseFloat($("#tx-amount").value);
  const date = $("#tx-date").value;
  if (!amount || isNaN(amount) || amount <= 0) {
    errEl.textContent = "יש להזין סכום גדול מ-0.";
    $("#tx-amount").focus();
    return;
  }
  if (!date) {
    errEl.textContent = "יש לבחור תאריך.";
    return;
  }

  const isIncome = formType === "income";

  const data = {
    type: formType,
    amount: Math.round(amount * 100) / 100,
    description: $("#tx-description").value.trim(),
    date,
    paymentMethod: $("#tx-payment").value,
    category: $("#tx-category").value,
    itemType: isIncome ? $("#tx-item-type").value : null,
    quantity: isIncome ? 1 : null, // כל פריט נספר כיחידה אחת
    event: $("#tx-event").value.trim() || null,
    otherDetail:
      $("#tx-category").value === "other" || $("#tx-payment").value === "other"
        ? $("#tx-other").value.trim() || null
        : null,
  };

  const id = $("#tx-id").value;
  const btn = $("#save-tx");
  btn.disabled = true;
  btn.textContent = "שומרת…";
  try {
    // טיפול בקבלה
    let receiptId = currentReceiptId;
    if (newReceiptDataUrl) {
      if (currentReceiptId) await deleteReceipt(currentReceiptId);
      receiptId = await saveReceipt(newReceiptDataUrl);
    } else if (receiptRemoved && currentReceiptId) {
      await deleteReceipt(currentReceiptId);
      receiptId = null;
    }
    data.receiptId = receiptId || null;

    if (id) {
      await updateDoc(doc(db, "users", uid, "transactions", id), data);
      toast("הרישום עודכן");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(userCol("transactions"), data);
      toast(isIncome ? "הכנסה נשמרה ✓" : "הוצאה נשמרה ✓");
    }
    showScreen(lastScreen === "form" ? "home" : lastScreen);
  } catch (err) {
    errEl.textContent = "שגיאה בשמירה. בדקי חיבור לרשת.";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "שמירה";
  }
}

// ============================================================
//  קבלות — כיווץ תמונה ושמירה ב-Firestore (חינמי)
// ============================================================
function resetReceiptState() {
  newReceiptDataUrl = null;
  currentReceiptId = null;
  receiptRemoved = false;
  $("#tx-receipt").value = "";
  $("#receipt-preview").classList.add("hidden");
  $("#receipt-thumb").src = "";
  $("#receipt-btn").classList.remove("hidden");
}
function clearReceiptPreview() {
  newReceiptDataUrl = null;
  receiptRemoved = true; // מסמן שצריך למחוק קיימת (אם יש)
  $("#tx-receipt").value = "";
  $("#receipt-preview").classList.add("hidden");
  $("#receipt-thumb").src = "";
  $("#receipt-btn").classList.remove("hidden");
}

async function handleReceiptPick(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await compressImage(file, 1000, 0.6);
    newReceiptDataUrl = dataUrl;
    receiptRemoved = false;
    $("#receipt-thumb").src = dataUrl;
    $("#receipt-preview").classList.remove("hidden");
    $("#receipt-btn").classList.add("hidden");
  } catch (err) {
    toast("לא ניתן לטעון את התמונה");
    console.error(err);
  }
}

// מכווץ תמונה למימד מקסימלי ולאיכות מבוקשת, מחזיר data URL קטן מ-~700KB
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        let q = quality;
        let out = canvas.toDataURL("image/jpeg", q);
        // אם עדיין גדול מדי — מקטין איכות בהדרגה (מגבלת מסמך Firestore ~1MB)
        while (out.length > 700000 && q > 0.3) {
          q -= 0.1;
          out = canvas.toDataURL("image/jpeg", q);
        }
        resolve(out);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveReceipt(dataUrl) {
  const ref = await addDoc(userCol("receipts"), { data: dataUrl, createdAt: serverTimestamp() });
  return ref.id;
}
async function deleteReceipt(id) {
  try {
    await deleteDoc(doc(db, "users", uid, "receipts", id));
  } catch (e) { /* ignore */ }
}
async function showReceiptExisting(id) {
  // מציג ממוזערת של קבלה קיימת בזמן עריכה
  try {
    const snap = await getDoc(doc(db, "users", uid, "receipts", id));
    if (snap.exists() && !receiptRemoved && !newReceiptDataUrl) {
      $("#receipt-thumb").src = snap.data().data;
      $("#receipt-preview").classList.remove("hidden");
      $("#receipt-btn").classList.add("hidden");
    }
  } catch (e) { /* ignore */ }
}
async function openReceiptModal(id) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "receipts", id));
    if (snap.exists()) {
      $("#receipt-full").src = snap.data().data;
      $("#receipt-modal").classList.remove("hidden");
    } else {
      toast("הקבלה לא נמצאה");
    }
  } catch (e) {
    toast("שגיאה בטעינת הקבלה");
  }
}

// ============================================================
//  רינדור כללי
// ============================================================
function renderAll() {
  buildEventsDatalist();
  renderDashboard();
  renderList();
  renderReports();
}

// רשימת אירועים/מכירות ייחודיים להשלמה אוטומטית (נגזרת מהנתונים הקיימים)
function buildEventsDatalist() {
  const names = new Set();
  transactions.forEach((t) => t.event && names.add(t.event));
  orders.forEach((o) => o.event && names.add(o.event));
  const opts = [...names].sort((a, b) => a.localeCompare(b, "he"));
  $("#events-list").innerHTML = opts.map((n) => `<option value="${escapeHTML(n)}"></option>`).join("");
}

const sumBy = (txs, type) =>
  txs.filter((t) => t.type === type).reduce((s, t) => s + (+t.amount || 0), 0);

// ------------------------------------------------------------
//  דשבורד
// ------------------------------------------------------------
function renderDashboard() {
  const cm = currentMonth();
  const monthTx = transactions.filter((t) => monthOf(t.date) === cm);
  const mInc = sumBy(monthTx, "income");
  const mExp = sumBy(monthTx, "expense");
  const mProfit = mInc - mExp;

  $("#current-month-label").textContent = monthLabel(cm);
  const mp = $("#month-profit");
  mp.textContent = ils(mProfit);
  mp.classList.toggle("neg", mProfit < 0);
  $("#month-income").textContent = ils(mInc);
  $("#month-expense").textContent = ils(mExp);

  const totProfit = sumBy(transactions, "income") - sumBy(transactions, "expense");
  const tp = $("#total-profit");
  tp.textContent = ils(totProfit);
  tp.classList.toggle("neg", totProfit < 0);

  renderHomeOrders();
  renderTrend();
}

// שורות הזמנות פתוחות בעמוד הבית
function renderHomeOrders() {
  const section = $("#home-orders");
  const list = $("#home-orders-list");
  const totalEl = $("#home-orders-total");
  if (!orders.length) {
    section.classList.add("hidden");
    list.innerHTML = "";
    return;
  }
  section.classList.remove("hidden");
  const total = orders.reduce((s, o) => s + (+o.amount || 0), 0);
  totalEl.textContent = `כסף בדרך · ${ils(total)}`;

  list.innerHTML = orders
    .map((o) => {
      const meta = [itemLabel(o.itemType), catLabel("income", o.category), fmtDate(o.orderDate), o.event ? "📍" + escapeHTML(o.event) : null]
        .filter(Boolean).join(" · ");
      return `<div class="home-order-row" data-order-open="${o.id}">
          <div class="home-order-info">
            <div class="home-order-name">${escapeHTML(o.name)}</div>
            <div class="home-order-meta">${meta}</div>
          </div>
          <div class="home-order-amount">${ils(o.amount)}</div>
          <button class="btn btn-income btn-sm" data-home-paid="${o.id}">שולם ✓</button>
        </div>`;
    })
    .join("");

  list.querySelectorAll("[data-home-paid]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      openPayModal(b.dataset.homePaid);
    })
  );
  list.querySelectorAll("[data-order-open]").forEach((row) =>
    row.addEventListener("click", () => {
      const o = orders.find((x) => x.id === row.dataset.orderOpen);
      if (o) openOrderForm(o);
    })
  );
}

function renderTrend() {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const data = months.map((ym) => {
    const mt = transactions.filter((t) => monthOf(t.date) === ym);
    return { ym, profit: sumBy(mt, "income") - sumBy(mt, "expense") };
  });
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.profit)));
  $("#trend-chart").innerHTML = data
    .map((d) => {
      const h = Math.max(4, (Math.abs(d.profit) / maxAbs) * 100);
      const cls = d.profit < 0 ? "neg" : "pos";
      const short = MONTHS_HE[+d.ym.split("-")[1] - 1].slice(0, 3);
      return `<div class="trend-bar-wrap" title="${monthLabel(d.ym)}: ${ils(d.profit)}">
          <span class="trend-val">${d.profit ? ils(d.profit) : ""}</span>
          <div class="trend-bar ${cls}" style="height:${h}%"></div>
          <span class="trend-label">${short}</span>
        </div>`;
    })
    .join("");
}

// ------------------------------------------------------------
//  רשימת תנועות
// ------------------------------------------------------------
function renderList() {
  const monthEl = $("#filter-month");
  if (!monthEl.value) monthEl.value = currentMonth();
  const ym = monthEl.value;
  const term = $("#search-box").value.trim().toLowerCase();

  let list = transactions.filter((t) => monthOf(t.date) === ym);
  if (term) {
    list = list.filter((t) =>
      [t.description, catLabel(t.type, t.category), itemLabel(t.itemType), payLabel(t.paymentMethod), t.event]
        .join(" ").toLowerCase().includes(term)
    );
  }

  const inc = sumBy(list, "income");
  const exp = sumBy(list, "expense");
  $("#list-summary").innerHTML = `
    <span>הכנסות: <b style="color:var(--income)">${ils(inc)}</b></span>
    <span>הוצאות: <b style="color:var(--expense)">${ils(exp)}</b></span>
    <span>מאזן: <b>${ils(inc - exp)}</b></span>`;

  const empty = $("#list-empty");
  const container = $("#tx-list");
  if (!list.length) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    empty.querySelector("p").textContent = term ? "לא נמצאו תוצאות לחיפוש." : "אין תנועות לחודש הזה עדיין.";
    return;
  }
  empty.classList.add("hidden");

  container.innerHTML = list
    .map((t) => {
      const sign = t.type === "income" ? "+" : "−";
      const meta = [
        fmtDate(t.date),
        payLabel(t.paymentMethod),
        t.otherDetail ? catLabel(t.type, t.category) + " (" + escapeHTML(t.otherDetail) + ")" : catLabel(t.type, t.category),
        t.type === "income" && t.itemType ? itemLabel(t.itemType) : null,
        t.event ? "📍" + escapeHTML(t.event) : null,
      ].filter(Boolean).join(" · ");
      const receiptBadge = t.receiptId ? `<button class="receipt-badge" data-receipt="${t.receiptId}" aria-label="צפייה בקבלה">📎</button>` : "";
      return `<div class="tx-item" data-id="${t.id}">
          <div class="tx-icon ${t.type}">${t.type === "income" ? "💰" : "🛒"}</div>
          <div class="tx-main">
            <div class="tx-desc">${escapeHTML(t.description) || catLabel(t.type, t.category)}</div>
            <div class="tx-meta">${meta} ${receiptBadge}</div>
          </div>
          <div class="tx-amount ${t.type}">${sign}${ils(t.amount)}</div>
          <div class="tx-actions">
            <button class="icon-btn" data-edit="${t.id}" aria-label="עריכה">✎</button>
            <button class="icon-btn" data-del="${t.id}" aria-label="מחיקה">🗑</button>
          </div>
        </div>`;
    })
    .join("");

  container.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const tx = transactions.find((x) => x.id === b.dataset.edit);
      if (tx) openForm(tx.type, tx);
    })
  );
  container.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => confirmDeleteTx(b.dataset.del))
  );
  container.querySelectorAll("[data-receipt]").forEach((b) =>
    b.addEventListener("click", () => openReceiptModal(b.dataset.receipt))
  );
}

// ------------------------------------------------------------
//  הזמנות
// ------------------------------------------------------------
function openOrderForm(order = null) {
  $("#order-error").textContent = "";
  if (order) {
    $("#order-form-title").textContent = "עריכת הזמנה";
    $("#order-id").value = order.id;
    $("#order-name").value = order.name || "";
    $("#order-amount").value = order.amount || "";
    $("#order-category").value = order.category || CATEGORIES.income[0].v;
    $("#order-item-type").value = order.itemType || ITEM_TYPES[0].v;
    $("#order-event").value = order.event || "";
    $("#order-date").value = order.orderDate || todayISO();
    $("#order-status").value = order.status || "new";
    $("#order-notes").value = order.notes || "";
  } else {
    $("#order-form-title").textContent = "הזמנה חדשה";
    $("#order-id").value = "";
    $("#order-name").value = "";
    $("#order-amount").value = "";
    $("#order-category").value = CATEGORIES.income[0].v;
    $("#order-item-type").value = ITEM_TYPES[0].v;
    $("#order-event").value = "";
    $("#order-date").value = todayISO();
    $("#order-status").value = "new";
    $("#order-notes").value = "";
  }
  showScreen("order-form");
  setTimeout(() => $("#order-name").focus(), 120);
}

async function handleSaveOrder(e) {
  e.preventDefault();
  const errEl = $("#order-error");
  errEl.textContent = "";
  const name = $("#order-name").value.trim();
  const amount = parseFloat($("#order-amount").value);
  if (!name) {
    errEl.textContent = "יש להזין שם לקוח/ה.";
    return;
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    errEl.textContent = "יש להזין סכום גדול מ-0.";
    return;
  }
  const data = {
    name,
    amount: Math.round(amount * 100) / 100,
    category: $("#order-category").value,
    itemType: $("#order-item-type").value,
    event: $("#order-event").value.trim() || null,
    orderDate: $("#order-date").value || todayISO(),
    status: $("#order-status").value,
    notes: $("#order-notes").value.trim(),
  };
  const id = $("#order-id").value;
  const btn = $("#save-order");
  btn.disabled = true;
  btn.textContent = "שומרת…";
  try {
    if (id) {
      await updateDoc(doc(db, "users", uid, "orders", id), data);
      toast("ההזמנה עודכנה");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(userCol("orders"), data);
      toast("הזמנה נוספה ✓");
    }
    showScreen("orders");
  } catch (err) {
    errEl.textContent = "שגיאה בשמירה. בדקי חיבור לרשת.";
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "שמירת הזמנה";
  }
}

function renderOrders() {
  const el = $("#orders-list");
  const empty = $("#orders-empty");
  const banner = $("#orders-pending-banner");

  if (!orders.length) {
    el.innerHTML = "";
    empty.classList.remove("hidden");
    banner.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  const total = orders.reduce((s, o) => s + (+o.amount || 0), 0);
  banner.innerHTML = `<span>כסף בדרך</span><b>${ils(total)}</b><span class="pending-sub">${orders.length} הזמנות פתוחות</span>`;

  const statusCls = { new: "s-new", prep: "s-prep", ready: "s-ready", delivered: "s-delivered" };
  el.innerHTML = orders
    .map((o) => {
      const meta = [itemLabel(o.itemType), catLabel("income", o.category), fmtDate(o.orderDate), o.event ? "📍" + escapeHTML(o.event) : null]
        .filter(Boolean).join(" · ");
      const statusOpts = Object.entries(ORDER_STATUS)
        .map(([v, l]) => `<option value="${v}" ${o.status === v ? "selected" : ""}>${l}</option>`)
        .join("");
      return `<div class="order-item" data-id="${o.id}">
          <div class="order-top">
            <div class="order-name">${escapeHTML(o.name)}</div>
            <div class="order-amount">${ils(o.amount)}</div>
          </div>
          <div class="order-meta">${meta}</div>
          ${o.notes ? `<div class="order-notes">${escapeHTML(o.notes)}</div>` : ""}
          <div class="order-controls">
            <select class="order-status-select ${statusCls[o.status] || ""}" data-status="${o.id}">${statusOpts}</select>
            <button class="btn btn-income btn-sm" data-paid="${o.id}">שולם ✓</button>
            <button class="icon-btn" data-order-edit="${o.id}" aria-label="עריכה">✎</button>
            <button class="icon-btn" data-order-del="${o.id}" aria-label="מחיקה">🗑</button>
          </div>
        </div>`;
    })
    .join("");

  el.querySelectorAll("[data-status]").forEach((s) =>
    s.addEventListener("change", () =>
      updateDoc(doc(db, "users", uid, "orders", s.dataset.status), { status: s.value })
    )
  );
  el.querySelectorAll("[data-paid]").forEach((b) =>
    b.addEventListener("click", () => openPayModal(b.dataset.paid))
  );
  el.querySelectorAll("[data-order-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const o = orders.find((x) => x.id === b.dataset.orderEdit);
      if (o) openOrderForm(o);
    })
  );
  el.querySelectorAll("[data-order-del]").forEach((b) =>
    b.addEventListener("click", () => confirmDeleteOrder(b.dataset.orderDel))
  );
}

// סימון הזמנה כשולמה → הופך לתנועת הכנסה
function openPayModal(orderId) {
  const o = orders.find((x) => x.id === orderId);
  if (!o) return;
  $("#pay-modal-sub").textContent = `${o.name} · ${ils(o.amount)}`;
  $("#pay-date").value = todayISO();
  $("#pay-method").value = "bit";
  $("#pay-modal").classList.remove("hidden");

  const close = () => {
    $("#pay-modal").classList.add("hidden");
    $("#pay-cancel").onclick = null;
    $("#pay-confirm").onclick = null;
    $("#pay-modal").onclick = null;
  };
  $("#pay-cancel").onclick = close;
  $("#pay-modal").onclick = (e) => { if (e.target.id === "pay-modal") close(); };
  $("#pay-confirm").onclick = async () => {
    const method = $("#pay-method").value;
    const date = $("#pay-date").value || todayISO();
    close();
    try {
      await addDoc(userCol("transactions"), {
        type: "income",
        amount: o.amount,
        description: o.notes ? `${o.name} — ${o.notes}` : o.name,
        date,
        paymentMethod: method,
        category: o.category,
        itemType: o.itemType,
        quantity: 1,
        event: o.event || null,
        receiptId: null,
        createdAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, "users", uid, "orders", orderId));
      toast("ההזמנה סומנה כשולמה 💛");
    } catch (err) {
      toast("שגיאה בסימון התשלום");
      console.error(err);
    }
  };
}

// ------------------------------------------------------------
//  דוחות
// ------------------------------------------------------------
function renderReports() {
  const monthEl = $("#report-month");
  if (!monthEl.value) monthEl.value = currentMonth();
  const ym = monthEl.value;
  const list = transactions.filter((t) => monthOf(t.date) === ym);
  const incList = list.filter((t) => t.type === "income");
  const expList = list.filter((t) => t.type === "expense");

  const inc = sumBy(list, "income");
  const exp = sumBy(list, "expense");
  $("#rep-income").textContent = ils(inc);
  $("#rep-expense").textContent = ils(exp);
  const profEl = $("#rep-profit");
  profEl.textContent = ils(inc - exp);
  profEl.classList.toggle("neg", inc - exp < 0);

  renderEventReport(list);
  renderBars("#rep-channel", groupSum(incList, (t) => catLabel("income", t.category)), "income", "אין הכנסות החודש.");
  renderBars("#rep-payment", groupSum(incList, (t) => payLabel(t.paymentMethod)), "income", "אין הכנסות החודש.");
  renderBars("#rep-expense-cat", groupSum(expList, (t) => catLabel("expense", t.category)), "expense", "אין הוצאות החודש.");

  renderItemTypeReport(incList.filter((t) => t.itemType));
}

function groupSum(list, keyFn) {
  const m = {};
  list.forEach((t) => {
    const k = keyFn(t);
    m[k] = (m[k] || 0) + (+t.amount || 0);
  });
  return Object.entries(m).map(([label, val]) => ({ label, val })).sort((a, b) => b.val - a.val);
}

function renderBars(sel, rows, cls, emptyMsg) {
  const el = $(sel);
  if (!rows.length) {
    el.innerHTML = `<p class="muted-small">${emptyMsg}</p>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.val));
  el.innerHTML = rows
    .map((r) => `<div class="bar-row">
        <div class="bar-top"><span>${r.label}</span><b>${ils(r.val)}</b></div>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${(r.val / max) * 100}%"></div></div>
      </div>`)
    .join("");
}

// דוח רווח לפי מכירה/אירוע (הכנסות − הוצאות לכל אירוע)
function renderEventReport(list) {
  const el = $("#rep-event");
  const tagged = list.filter((t) => t.event);
  if (!tagged.length) {
    el.innerHTML = `<p class="muted-small">לא סומנו מכירות/אירועים החודש. אפשר להוסיף שם אירוע בטופס.</p>`;
    return;
  }
  const m = {};
  tagged.forEach((t) => {
    if (!m[t.event]) m[t.event] = { income: 0, expense: 0 };
    m[t.event][t.type] += +t.amount || 0;
  });
  const rows = Object.entries(m)
    .map(([label, v]) => ({ label, income: v.income, expense: v.expense, net: v.income - v.expense }))
    .sort((a, b) => b.net - a.net);
  el.innerHTML = rows
    .map((r) => `<div class="event-row">
        <div class="event-top">
          <span class="event-name">📍 ${escapeHTML(r.label)}</span>
          <b class="event-net ${r.net < 0 ? "neg" : ""}">${ils(r.net)}</b>
        </div>
        <div class="event-sub">הכנסות ${ils(r.income)} · הוצאות ${ils(r.expense)}</div>
      </div>`)
    .join("");
}

// דוח הכי-נמכר: גם כמות יחידות וגם ₪
function renderItemTypeReport(incItems) {
  const el = $("#rep-item-type");
  if (!incItems.length) {
    el.innerHTML = `<p class="muted-small">אין נתוני מכירות לפי פריט.</p>`;
    return;
  }
  const m = {};
  incItems.forEach((t) => {
    const k = itemLabel(t.itemType);
    if (!m[k]) m[k] = { qty: 0, amount: 0 };
    m[k].qty += +t.quantity || 1;
    m[k].amount += +t.amount || 0;
  });
  const rows = Object.entries(m)
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.qty - a.qty);
  const maxQty = Math.max(...rows.map((r) => r.qty));
  el.innerHTML = rows
    .map((r) => `<div class="bar-row">
        <div class="bar-top"><span>${r.label}</span><b>${r.qty} יח׳ · ${ils(r.amount)}</b></div>
        <div class="bar-track"><div class="bar-fill income" style="width:${(r.qty / maxQty) * 100}%"></div></div>
      </div>`)
    .join("");
}

// ============================================================
//  מחיקה עם אישור (מודל כללי, בלי דליפת מאזינים)
// ============================================================
let confirmResolve = null;
function askConfirm({ title, text, okLabel = "אישור", danger = true }) {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  const ok = $("#confirm-ok");
  ok.textContent = okLabel;
  ok.className = "btn " + (danger ? "btn-danger" : "btn-primary");
  $("#confirm-modal").classList.remove("hidden");
  // מאזין חד-פעמי מנוהל ע"י השמה ל-onclick (מחליף קודמים, לא מצטבר)
  ok.onclick = () => closeConfirm(true);
  return new Promise((resolve) => (confirmResolve = resolve));
}
function closeConfirm(result) {
  $("#confirm-modal").classList.add("hidden");
  $("#confirm-ok").onclick = null;
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

async function confirmDeleteTx(id) {
  const tx = transactions.find((t) => t.id === id);
  const ok = await askConfirm({
    title: "מחיקת רישום",
    text: tx ? `למחוק את "${tx.description || catLabel(tx.type, tx.category)}" (${ils(tx.amount)})?` : "למחוק את הרישום?",
    okLabel: "מחיקה",
  });
  if (!ok) return;
  try {
    if (tx && tx.receiptId) await deleteReceipt(tx.receiptId);
    await deleteDoc(doc(db, "users", uid, "transactions", id));
    toast("הרישום נמחק");
  } catch (e) {
    toast("שגיאה במחיקה");
  }
}

async function confirmDeleteOrder(id) {
  const o = orders.find((x) => x.id === id);
  const ok = await askConfirm({
    title: "מחיקת הזמנה",
    text: o ? `למחוק את ההזמנה של ${o.name} (${ils(o.amount)})?` : "למחוק את ההזמנה?",
    okLabel: "מחיקה",
  });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "users", uid, "orders", id));
    toast("ההזמנה נמחקה");
  } catch (e) {
    toast("שגיאה במחיקה");
  }
}

// ============================================================
//  רשימת קניות
// ============================================================
async function handleAddShopping(e) {
  e.preventDefault();
  const input = $("#shopping-name");
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  try {
    await addDoc(userCol("shoppingList"), { name, done: false, note: "", createdAt: serverTimestamp() });
  } catch (err) {
    toast("שגיאה בהוספה");
  }
}

function renderShopping() {
  const el = $("#shopping-list");
  const empty = $("#shopping-empty");
  if (!shopping.length) {
    el.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  const sorted = [...shopping].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  el.innerHTML = sorted
    .map((s) => `<div class="shop-item ${s.done ? "done" : ""}" data-id="${s.id}">
        <button class="shop-check" data-toggle="${s.id}" aria-label="סימון נקנה">${s.done ? "✓" : ""}</button>
        <span class="shop-name">${escapeHTML(s.name)}</span>
        <button class="icon-btn" data-shopdel="${s.id}" aria-label="מחיקה">🗑</button>
      </div>`)
    .join("");
  el.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const s = shopping.find((x) => x.id === b.dataset.toggle);
      await updateDoc(doc(db, "users", uid, "shoppingList", b.dataset.toggle), { done: !s.done });
    })
  );
  el.querySelectorAll("[data-shopdel]").forEach((b) =>
    b.addEventListener("click", async () => {
      await deleteDoc(doc(db, "users", uid, "shoppingList", b.dataset.shopdel));
    })
  );
}

// ============================================================
//  ייצוא — לפי תקופה
// ============================================================
function onExportScopeChange() {
  const scope = $("#export-scope").value;
  $("#export-month-field").classList.toggle("hidden", scope !== "month");
  $("#export-year-field").classList.toggle("hidden", scope !== "year");
  if (scope === "month" && !$("#export-month").value) $("#export-month").value = currentMonth();
  if (scope === "year" && !$("#export-year").value) $("#export-year").value = new Date().getFullYear();
}

function exportCSV() {
  const scope = $("#export-scope").value;
  let list = [...transactions];
  let suffix = "all";
  if (scope === "month") {
    const ym = $("#export-month").value || currentMonth();
    list = list.filter((t) => monthOf(t.date) === ym);
    suffix = ym;
  } else if (scope === "year") {
    const y = String($("#export-year").value || new Date().getFullYear());
    list = list.filter((t) => yearOf(t.date) === y);
    suffix = y;
  }
  if (!list.length) {
    toast("אין נתונים לתקופה שנבחרה");
    return;
  }
  const headers = ["תאריך", "סוג", "סכום", "הערות", "אמצעי תשלום", "קטגוריה", "פירוט (אחר)", "סוג פריט", "מכירה/אירוע"];
  const rows = list
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((t) => [
      t.date,
      t.type === "income" ? "הכנסה" : "הוצאה",
      t.amount,
      t.description || "",
      payLabel(t.paymentMethod),
      catLabel(t.type, t.category),
      t.otherDetail || "",
      t.type === "income" ? itemLabel(t.itemType) : "",
      t.event || "",
    ]);
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hana-lima-${suffix}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("הקובץ ירד ✓");
}

// ============================================================
//  עזרי UI
// ============================================================
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}
function escapeHTML(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
