// Renders the real React app in jsdom against a scripted mediaAPI (no Electron, no network).
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const fs = require("fs");
fs.mkdirSync(path.join(__dirname, ".build"), { recursive: true });
const out = path.join(__dirname, ".build", `app-${process.pid}.cjs`);
process.on("exit", () => fs.rmSync(out, { force: true }));
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "../src/App.jsx")],
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  outfile: out,
  external: ["react", "react-dom", "react/jsx-runtime"],
  logLevel: "silent",
  define: { "process.env.NODE_ENV": '"test"' },
});

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
Object.defineProperty(global, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
  confirm: () => true,
});
dom.window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
dom.window.confirm = () => true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;

const plan = {
  _id: "p1".padEnd(24, "0"),
  name: "Pro",
  slug: "pro",
  priceMinor: 49900,
  currency: "BDT",
  billingPeriodDays: 30,
  isLifetime: false,
  entitlements: {
    features: { videoCompression: true, pdfMerge: true },
    limits: { dailyJobs: 20 },
  },
};
const customer = {
  signedIn: true,
  user: {
    id: "u1",
    email: "a@b.com",
    name: "Sam",
    role: "CUSTOMER",
    emailVerified: true,
  },
  offline: false,
  entitlement: {
    source: "FREE",
    planName: "Free trial",
    features: { videoCompression: true },
    limits: {},
    endsAt: null,
  },
  remaining: { total: 7 },
  pendingSync: 0,
};
const admin = {
  ...customer,
  user: { ...customer.user, role: "ADMIN", email: "admin@b.com" },
};
const calls = [];
const routes = {
  "GET /api/plans": { plans: [plan] },
  "GET /api/payments/methods": {
    sslcommerz: true,
    mfs: true,
    providers: [{ _id: "m1", name: "bKash" }],
    message: null,
  },
  "GET /api/help/faq": {
    faq: [{ _id: "f1", question: "Is it offline?", answer: "Yes." }],
  },
  "POST /api/subscriptions/quote": {
    plan: { id: plan._id, name: "Pro" },
    originalPriceMinor: 49900,
    discountMinor: 0,
    finalPriceMinor: 49900,
    currency: "BDT",
    discountCode: null,
  },
  "POST /api/auth/register": { ok: true },
  "POST /api/auth/verify-email": { ok: true, verified: true },
  "GET /api/admin/dashboard": {
    users: 12,
    activeUsers30d: 5,
    activeSubs: 3,
    expiredSubs: 1,
    pendingManual: 2,
    sslPaid: 4,
    revenueMinor: { BDT: 123400 },
    activePlans: 3,
    openBugs: 1,
    openContacts: 2,
    popularPlans: [{ _id: "Pro", n: 3 }],
    recent: [{ _id: "a1", at: new Date(), action: "plan.created" }],
  },
  "GET /api/admin/reports": {
    byMethod: [{ _id: "MFS", n: 2 }],
    byStatus: [],
    freeOperations: 9,
    failedPayments: 1,
  },
  "GET /api/admin/plans": {
    items: [{ ...plan, active: true, updatedAt: new Date().toISOString() }],
  },
  "GET /api/admin/discounts": {
    items: [
      {
        _id: "d1",
        code: "SAVE10",
        type: "PERCENT",
        value: 10,
        enabled: true,
        redeemedCount: 1,
        remaining: 4,
      },
    ],
  },
  "GET /api/admin/gateways": { SSLCOMMERZ: true, MFS: false },
  "GET /api/admin/mfs": {
    items: [
      {
        _id: "m1",
        name: "bKash",
        accountNumber: "01700000000",
        accountType: "PERSONAL",
        enabled: true,
      },
    ],
  },
  "GET /api/admin/settings": {
    app: { appName: "Media Toolkit Pro", maintenanceMode: false },
    security: { otpExpiryMinutes: 5 },
    freeAccess: {
      enabled: true,
      trialDays: 7,
      operationCount: null,
      dailyLimit: 5,
      monthlyLimit: null,
      allowedFeatures: ["videoCompression"],
      maxFileSizeMB: 500,
    },
    subscription: { expiryReminderDays: 3 },
  },
  "GET /api/admin/payments/manual": {
    items: [
      {
        _id: "x1",
        userId: { email: "buyer@b.com" },
        planId: { name: "Pro" },
        providerId: { name: "bKash" },
        transactionId: "TX1",
        senderNumber: "0170",
        amountMinor: 49900,
        expectedMinor: 49900,
        currency: "BDT",
        status: "PENDING",
      },
    ],
    total: 1,
    page: 1,
    pages: 1,
  },
  "POST /api/admin/payments/manual/x1/review": { ok: true },
};
const S = { reauthed: true, history: [], loginResult: null };
Object.assign(routes, {
  "GET /api/admin/payments/ssl": {
    items: [
      {
        _id: "s1",
        userId: { email: "buyer@b.com" },
        tranId: "TRAN1",
        amountMinor: 49900,
        currency: "BDT",
        status: "PAID",
        paidAt: new Date(),
      },
    ],
    total: 1,
    page: 1,
    pages: 1,
  },
  "POST /api/admin/payments/ssl/s1/refund": { status: "REFUNDED" },
  "POST /api/admin/reauth/request": { ok: true },
  "GET /api/admin/version": { server: "0.1.0", minDesktopVersion: "0.1.0" },
  "POST /api/bugs": { reportId: "BUG-1" },
  "GET /api/admin/bugs": {
    items: [
      {
        _id: "b1",
        reportId: "BUG-1",
        title: "Crash on start",
        email: "u@b.com",
        status: "OPEN",
        createdAt: new Date(),
        hasScreenshot: true,
      },
    ],
    total: 1,
    page: 1,
    pages: 1,
  },
  "GET /api/admin/bugs/b1": {
    _id: "b1",
    reportId: "BUG-1",
    title: "Crash on start",
    description: "It crashes",
    severity: "HIGH",
    category: "VIDEO",
    screenshot: "data:image/jpeg;base64,/9j/",
    assignedTo: null,
    replies: [],
    logExcerpt: "log text",
  },
  "PUT /api/admin/bugs/b1/assign": { ok: true },
  "GET /api/admin/users": {
    items: [
      { _id: "u9", email: "x@y.com", role: "CUSTOMER", createdAt: new Date() },
    ],
    total: 1,
    page: 1,
    pages: 1,
  },
  "GET /api/admin/users/u9": {
    user: {
      id: "u9",
      email: "x@y.com",
      role: "CUSTOMER",
      createdAt: new Date(),
    },
    subscriptions: [],
    payments: { ssl: [], manual: [] },
    entitlement: {
      planName: null,
      source: "NONE",
      usage: { today: 0, month: 0, total: 0 },
    },
  },
  "POST /api/admin/users/u9/reset-access": { ok: true },
});
const GUARDED =
  /^\/api\/admin\/payments\/(manual\/[^/]+\/review|(ssl|manual)\/[^/]+\/refund)$/;
const mkApi = (session) => ({
  api: async (method, p, body) => {
    calls.push({ method, p, body });
    const key = `${method} ${p.split("?")[0]}`;
    if (method === "POST" && GUARDED.test(p) && !S.reauthed)
      return {
        status: 403,
        data: { code: "REAUTH_REQUIRED", error: "Please confirm it is you." },
      };
    if (key === "POST /api/admin/reauth/confirm") {
      S.reauthed = true;
      return { status: 200, data: { ok: true } };
    }
    if (key === "POST /api/auth/login" && S.loginResult) return S.loginResult;
    if (routes[key]) return { status: 200, data: routes[key] };
    if (/GET \/api\/admin\//.test(key))
      return { status: 200, data: { items: [], total: 0, page: 1, pages: 1 } };
    return { status: 404, data: { error: `unmocked ${key}` } };
  },
  authBoot: async () => session,
  authState: async () => session,
  authRefresh: async () => session,
  logout: async () => ({ signedIn: false }),
  appInfo: async () => ({ version: "0.1.0" }),
  openCheckout: async () => true,
  getSettings: async () => ({
    theme: "light",
    outputMode: "source",
    concurrency: 2,
  }),
  detectHardware: async () => ({ vaapi: false, reason: "test" }),
  listJobs: async () => [],
  onJobUpdate: () => () => {},
  getHistory: async () => S.history,
  selectFiles: async () => [],
  thumbnail: async () => "data:image/jpeg;base64,AAAA",
  prepareScreenshot: async () => ({
    name: "shot.png",
    dataUrl: "data:image/jpeg;base64,/9j/",
    bytes: 2048,
  }),
  recentLog: async () => ({ text: "log line" }),
  updateCheck: async () => ({
    supported: true,
    available: true,
    version: "1.1.0",
  }),
  updateDownload: async () => ({ ok: true }),
  updateInstall: async () => true,
});
async function mount(session) {
  document.body.innerHTML = '<div id="root"></div>';
  window.mediaAPI = mkApi(session);
  calls.length = 0;
  S.reauthed = true;
  S.history = [];
  S.loginResult = null;
  const App = require(out).default;
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(App));
  });
  await settle();
  return root;
}
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
const text = () => document.body.textContent;
const byText = (t, sel = "button") =>
  [...document.querySelectorAll(sel)].find(
    (b) => b.textContent.trim() === t || b.textContent.includes(t),
  );
const click = async (t, sel) => {
  const el = byText(t, sel);
  assert.ok(el, `button "${t}" not found. Page: ${text().slice(0, 200)}`);
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await settle();
};
const type = async (label, value) => {
  const l = [...document.querySelectorAll("label")].find((x) =>
    x.textContent.startsWith(label),
  );
  assert.ok(l, `field ${label}`);
  const i = l.querySelector("input,textarea,select");
  const proto =
    i.tagName === "SELECT"
      ? window.HTMLSelectElement
      : i.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement
        : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(i, value);
  await act(async () => {
    i.dispatchEvent(new window.Event("input", { bubbles: true }));
    i.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
};

test("signed out: landing shows the required entry points and the registration flow calls the server", async () => {
  const root = await mount({ signedIn: false });
  for (const t of [
    "Get started",
    "Log in",
    "Register",
    "Pricing",
    "Help",
    "Contact",
    "Works offline",
  ])
    assert.ok(text().includes(t), t);
  await click("Register");
  assert.ok(text().includes("Create your account"));
  await type("Email", "new@user.com");
  await type("Password", "abcdef12345");
  await type("Confirm password", "abcdef12345");
  await act(async () => {
    document
      .querySelector("form")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
  await settle();
  const reg = calls.find((c) => c.p === "/api/auth/register");
  assert.ok(
    reg &&
      reg.body.email === "new@user.com" &&
      reg.body.confirmPassword === "abcdef12345",
  );
  assert.ok(text().includes("Verify your email"));
  await act(async () => root.unmount());
});
test("signed out: pricing lists server plans and asks to log in", async () => {
  const root = await mount({ signedIn: false });
  await click("Pricing");
  assert.ok(
    text().includes("Pro") &&
      text().includes("499.00 BDT") &&
      text().includes("Video compression"),
  );
  assert.ok(text().includes("Log in to choose"));
  await act(async () => root.unmount());
});
test("customer: home, nav, tool page, gateway message, checkout quote and both payment methods", async () => {
  const root = await mount(customer);
  assert.ok(
    text().includes("Welcome, Sam") &&
      text().includes("7 left in your trial") &&
      !text().includes("Administration") &&
      !text().includes("ADMINISTRATION"),
  );
  await click("Video");
  assert.ok(text().includes("CPU fallback"));
  await click("Subscription");
  await click("Choose plan");
  assert.ok(text().includes("Checkout: Pro") && text().includes("499.00 BDT"));
  assert.ok(text().includes("SSLCommerz") && text().includes("bKash"));
  await act(async () => {
    byText("Pay online", "label")
      .querySelector("input")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await settle();
  assert.ok(byText("Continue to payment"));
  await act(async () => root.unmount());
});
test("customer: account tabs render without crashing", async () => {
  const root = await mount(customer);
  await click("Account");
  for (const t of [
    "Subscription",
    "Payment history",
    "Usage",
    "Security",
    "Support",
  ]) {
    await click(t, "[role=tab]");
    assert.ok(document.body.textContent.length > 50, t);
  }
  await act(async () => root.unmount());
});
test("customer: expired trial shows the upgrade banner on tools", async () => {
  const root = await mount({
    ...customer,
    entitlement: {
      source: "NONE",
      trialExpired: true,
      features: {},
      limits: {},
    },
    remaining: {},
  });
  await click("Audio");
  assert.ok(text().includes("Your free trial has ended"));
  await act(async () => root.unmount());
});
test("offline banner is shown when the session is offline", async () => {
  const root = await mount({ ...customer, offline: true });
  assert.ok(text().includes("You are offline"));
  await act(async () => root.unmount());
});
test("admin: admin nav present; every admin tab renders; approving a manual payment calls the review endpoint", async () => {
  const root = await mount(admin);
  await click("Admin");
  assert.ok(
    (text().includes("Total users") &&
      text().includes("12") &&
      text().includes("1,234.00 BDT")) ||
      text().includes("1234.00 BDT"),
  );
  for (const t of [
    "Users",
    "Plans",
    "Discounts",
    "Payments",
    "MFS",
    "Gateways",
    "Settings",
    "Help/FAQ",
    "Support",
    "Audit log",
  ]) {
    await click(t, "[role=tab]");
    assert.ok(
      !/undefined|NaN|\[object/.test(text()),
      `${t} rendered bad values`,
    );
  }
  await click("Payments", "[role=tab]");
  assert.ok(text().includes("TX1"));
  await click("Approve");
  const r = calls.find((c) => c.p === "/api/admin/payments/manual/x1/review");
  assert.ok(r && r.body.approve === true);
  await click("Plans", "[role=tab]");
  await click("New plan");
  assert.ok(text().includes("Preview"));
  await click("Discounts", "[role=tab]");
  assert.ok(text().includes("SAVE10"));
  await click("Settings", "[role=tab]");
  assert.ok(
    text().includes("Free access (trial)") &&
      text().includes("never shown here"),
  );
  await act(async () => root.unmount());
});

test("REAUTH: a sensitive admin action asks for the emailed code once, then retries by itself", async () => {
  const root = await mount(admin);
  S.reauthed = false;
  await click("Admin");
  await click("Payments", "[role=tab]");
  await click("Approve");
  assert.ok(document.querySelector("[role=dialog]"), "modal shown");
  assert.ok(calls.some((c) => c.p === "/api/admin/reauth/request"));
  await type("6-digit code", "123456");
  await click("Confirm");
  assert.strictEqual(
    calls.filter((c) => c.p === "/api/admin/payments/manual/x1/review").length,
    2,
  );
  assert.ok(!document.querySelector("[role=dialog]"), "modal closed");
  assert.ok(
    calls.some(
      (c) => c.p === "/api/admin/reauth/confirm" && c.body.code === "123456",
    ),
  );
  await act(async () => root.unmount());
});
test("REFUND: admin sees consequences, must give a reason, and the request carries reason + gateway choice", async () => {
  const root = await mount(admin);
  await click("Admin");
  await click("Payments", "[role=tab]");
  await click("SSLCommerz", "[role=tab]");
  await click("Refund");
  assert.ok(
    text().includes("ends the customer") &&
      text().includes("sent back through SSLCommerz"),
  );
  const go = byText("Refund 499.00 BDT");
  assert.ok(go.disabled, "needs a reason first");
  await type("Reason", "Customer asked");
  await click("Refund 499.00 BDT");
  const r = calls.find((c) => c.p === "/api/admin/payments/ssl/s1/refund");
  assert.deepStrictEqual(r.body, {
    reason: "Customer asked",
    viaGateway: true,
  });
  await act(async () => root.unmount());
});
test("VAULT: locked when the plan lacks it; gallery view loads thumbnails when allowed", async () => {
  let root = await mount({
    ...customer,
    entitlement: {
      ...customer.entitlement,
      features: { videoCompression: true },
    },
  });
  await click("Media Vault");
  assert.ok(text().includes("not included in your current plan"));
  await act(async () => root.unmount());
  S.history = [
    {
      id: "h1",
      original_name: "a.mp4",
      output_name: "a_compressed.mp4",
      output_path: "/x/a_compressed.mp4",
      media_type: "video",
      operation: "video",
      output_size: 1000,
      success: 1,
    },
  ];
  root = await mount({
    ...customer,
    entitlement: { ...customer.entitlement, features: { mediaVault: true } },
  });
  S.history = [
    {
      id: "h1",
      original_name: "a.mp4",
      output_name: "a_compressed.mp4",
      output_path: "/x/a_compressed.mp4",
      media_type: "video",
      operation: "video",
      output_size: 1000,
      success: 1,
    },
  ];
  await click("Media Vault");
  await click("Gallery");
  assert.ok(
    document.querySelector('img[alt="Preview of a_compressed.mp4"]'),
    "thumbnail shown",
  );
  await act(async () => root.unmount());
});
test("UPDATE: outdated-app banner explains local tools still work", async () => {
  const root = await mount({ ...customer, updateRequired: "2.0.0" });
  assert.ok(
    text().includes("Update required") &&
      text().includes("2.0.0") &&
      text().includes("local tools still work"),
  );
  await act(async () => root.unmount());
});
test("UPDATE: settings check, download and install are separate user actions", async () => {
  const root = await mount(customer);
  await click("Settings");
  await click("Check for updates");
  assert.ok(text().includes("Version 1.1.0 is available"));
  assert.ok(!byText("Restart and install"));
  await click("Download version 1.1.0");
  assert.ok(byText("Restart and install"));
  await act(async () => root.unmount());
});
test("BUG REPORT: screenshot and diagnostic log are optional, previewed, and sent only when chosen", async () => {
  const root = await mount(customer);
  await click("Help");
  await click("Report a bug");
  await type("Title", "Crash on start");
  await type("What happened?", "It crashes when I press start");
  await click("Attach screenshot");
  assert.ok(
    text().includes("shot.png") &&
      document.querySelector('img[alt="Screenshot preview"]'),
  );
  await act(async () => {
    document
      .querySelector("input[type=checkbox]")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await settle();
  assert.ok(text().includes("Review what will be sent"));
  await act(async () => {
    document
      .querySelector("form")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
  await settle();
  const b = calls.find((c) => c.p === "/api/bugs").body;
  assert.strictEqual(b.screenshot, "data:image/jpeg;base64,/9j/");
  assert.strictEqual(b.logExcerpt, "log line");
  assert.ok(text().includes("BUG-1"));
  await act(async () => root.unmount());
  const r2 = await mount(customer);
  await click("Help");
  await click("Report a bug");
  await type("Title", "Another one");
  await type("What happened?", "Nothing attached here");
  await act(async () => {
    document
      .querySelector("form")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
  await settle();
  const b2 = calls.filter((c) => c.p === "/api/bugs").pop().body;
  assert.ok(
    !("screenshot" in b2) && !("logExcerpt" in b2),
    "nothing extra without consent",
  );
  await act(async () => r2.unmount());
});
test("SUPPORT: admin sees the screenshot and log, and can assign a bug to themselves", async () => {
  const root = await mount(admin);
  await click("Admin");
  await click("Support", "[role=tab]");
  await click("Open");
  assert.ok(
    document.querySelector('img[alt="Screenshot attached to the report"]'),
  );
  assert.ok(text().includes("Unassigned") && text().includes("Diagnostic log"));
  await click("Assign to me");
  assert.deepStrictEqual(
    calls.find((c) => c.p === "/api/admin/bugs/b1/assign").body,
    { assignedTo: "u1" },
  );
  await act(async () => root.unmount());
});
test("USERS: reset access and forced password reset call the right endpoint", async () => {
  const root = await mount(admin);
  await click("Admin");
  await click("Users", "[role=tab]");
  await click("Open");
  await click("Reset access");
  await click("Force password reset");
  const rs = calls.filter((c) => c.p === "/api/admin/users/u9/reset-access");
  assert.deepStrictEqual(
    rs.map((c) => c.body.forcePasswordReset),
    [false, true],
  );
  await act(async () => root.unmount());
});
test("LOGIN: a forced password reset moves the user straight to choosing a new password", async () => {
  const root = await mount({ signedIn: false });
  S.loginResult = {
    status: 403,
    data: { code: "PASSWORD_RESET_REQUIRED", error: "reset" },
  };
  await click("Log in");
  await type("Email", "a@b.com");
  await type("Password", "whatever-123");
  await act(async () => {
    document
      .querySelector("form")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
  await settle();
  assert.ok(
    text().includes("Choose a new password") &&
      text().includes("you need a new password"),
  );
  await act(async () => root.unmount());
});
