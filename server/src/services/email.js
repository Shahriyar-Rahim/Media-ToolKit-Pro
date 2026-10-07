const { Resend } = require("resend");
const env = require("../config/env");
const settings = require("./settings");
const { EmailLog } = require("../models");

// Initialize Resend if API key is configured
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const money = (m, c) => `${(m / 100).toFixed(2)} ${c}`;
const table = (rows) =>
  `<table style="border-collapse:collapse;width:100%;font-size:14px">${rows
    .filter(Boolean)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px;border:1px solid #ddd;background:#f6f7f8;width:38%">${esc(
          k,
        )}</td><td style="padding:6px 10px;border:1px solid #ddd">${esc(
          v,
        )}</td></tr>`,
    )
    .join("")}</table>`;

// One reusable layout + a table of small templates. Every value is HTML-escaped.
const T = {
  welcome: (d) => [
    "Welcome to {app}",
    `Hi ${esc(d.name || "there")}, your account is verified and ready.`,
  ],
  verifyEmail: (d) => [
    "Verify your email",
    `Your verification code is <b style="font-size:20px">${esc(d.code)}</b>. It expires in ${esc(d.minutes)} minutes.`,
  ],
  loginOtp: (d) => [
    "Your sign-in code",
    `Your sign-in code is <b style="font-size:20px">${esc(d.code)}</b>. It expires in ${esc(d.minutes)} minutes. If this wasn't you, change your password.`,
  ],
  passwordReset: (d) => [
    "Reset your password",
    `Your password reset code is <b style="font-size:20px">${esc(d.code)}</b>. It expires in ${esc(d.minutes)} minutes. Ignore this email if you didn't ask for it.`,
  ],
  subscriptionActivated: (d) => [
    "Your plan is active",
    `${esc(d.plan)} is now active${d.endsAt ? ` until ${esc(new Date(d.endsAt).toDateString())}` : " (lifetime)"}.`,
  ],
  subscriptionExpiring: (d) => [
    "Your plan expires soon",
    `${esc(d.plan)} expires on ${esc(new Date(d.endsAt).toDateString())}.`,
  ],
  subscriptionExpired: (d) => [
    "Your plan has expired",
    `${esc(d.plan)} has expired. Renew to keep using premium tools.`,
  ],
  paymentReceived: (d) => [
    "Payment received",
    `We received ${esc(money(d.amountMinor, d.currency))} for ${esc(d.plan)}.`,
  ],
  paymentApproved: (d) => [
    "Payment approved",
    `Your manual payment ${esc(d.transactionId)} was approved.`,
  ],
  paymentRejected: (d) => [
    `Payment rejected${d.orderId ? ` (${d.orderId})` : ""}`,
    `Your manual payment ${esc(d.transactionId)}${d.orderId ? ` (order ${esc(d.orderId)})` : ""} was rejected.${d.note ? ` Note: ${esc(d.note)}` : ""}`,
  ],
  manualPaymentSubmitted: (d) => [
    "Payment submitted for review",
    `We received your transaction ${esc(d.transactionId)}. An admin will review it soon.`,
  ],
  adminNewPayment: (d) => [
    `New payment: ${d.orderId} - ${d.plan} - ${money(d.amountMinor, d.currency)}`,
    `<p>${esc(d.headline)}</p>${table(d.rows)}`,
  ],
  paymentUnderReview: (d) => [
    `We received your payment request ${d.orderId}`,
    `<p>Hi ${esc(d.userName || "there")}, thank you! Your payment is <b>under review</b>. An admin will verify the transaction shortly, and once it is approved we will email you your memo and activate your plan.</p>${table(d.rows)}`,
  ],
  memo: (d) => [
    `Your payment memo ${d.orderId}`,
    `<p>Hi ${esc(d.userName || "there")}, your payment was <b>${esc(d.statusText)}</b> and your plan is now active. Your memo is below, and a PDF copy is attached.</p>${table(d.memo.rows)}`,
  ],
  refundProcessed: (d) => [
    "Your payment was refunded",
    `We refunded ${esc(money(d.amountMinor, d.currency))} for ${esc(d.plan)}${d.orderId ? ` (order ${esc(d.orderId)})` : ""}. Access to that plan has ended.${d.viaGateway ? " The money returns to your original payment method; timing depends on your bank." : ""}`,
  ],
  bugReceived: (d) => [
    "Bug report received",
    `Thanks. Your report ${esc(d.reportId)} is open.`,
  ],
  contactReceived: (d) => [
    "We got your message",
    `Your message ${esc(d.ticketId)} was received. We'll reply soon.`,
  ],
  adminReply: (d) => [
    `Re: ${d.subject || "your request"}`,
    esc(d.message).replace(/\n/g, "<br>"),
  ],
};

const render = (template, data) => T[template](data);

async function send(template, to, data, opts = {}) {
  const app = (await settings.get("app")).appName || "Media Toolkit Pro";
  const [subject, body] = render(template, data);
  const formattedSubject = subject.replace("{app}", app);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px"><h2>${esc(app)}</h2>${body.startsWith("<") ? body : `<p>${body}</p>`}</div>`;

  if (resend) {
    console.log(`[RESEND API] Sending ${template} email to ${to}...`);

    // Map attachments for Resend if present (expects array of { filename, content / path })
    const attachments = opts.attachments
      ? opts.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          path: a.path,
        }))
      : undefined;

    const { data: resData, error } = await resend.emails.send({
      from: env.smtp?.from || "Media Toolkit Pro <no-reply@no-idea.top>",
      to: [to],
      subject: formattedSubject,
      html,
      attachments,
    });

    if (error) {
      console.error("[RESEND ERROR]", error);
      throw new Error(`Resend Delivery Error: ${error.message}`);
    }

    console.log(
      `[RESEND SUCCESS] Email sent successfully with ID: ${resData.id}`,
    );
    return resData;
  }

  // Development / Local Mock Logging
  if (!env.prod) {
    console.log(
      `[dev mock email] ${template} -> ${to}`,
      data.code ? `code=${data.code}` : "",
    );
  }
  return { id: "dev-mock-id" };
}

// ---- background outbox: requests never wait for a mail server ----
const config = { retryMs: 15000 };
const outbox = [];
let draining = false,
  retrying = 0;

function enqueue(job) {
  outbox.push(job);
  setImmediate(drain);
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (outbox.length) {
      const j = outbox.shift();
      try {
        await module.exports.send(j.template, j.to, j.data, j.opts);
      } catch (e) {
        j.attempts = (j.attempts || 0) + 1;
        console.error(
          `[email] ${j.template} to ${j.to} failed (attempt ${j.attempts}): ${e.message}`,
        );
        if (j.attempts < 3) {
          retrying++;
          const t = setTimeout(() => {
            retrying--;
            enqueue(j);
          }, config.retryMs * j.attempts);
          if (t.unref) t.unref();
        } else if (j.key) {
          await EmailLog.deleteOne({ key: j.key }).catch(() => {}); // give the key back so a later repeat can try again
        }
      }
    }
  } finally {
    draining = false;
  }
}

const flush = () =>
  new Promise((res) => {
    const t = setInterval(() => {
      if (!outbox.length && !draining && !retrying) {
        clearInterval(t);
        res();
      }
    }, 5);
  });

// Idempotent: the unique key is claimed (a quick database write) BEFORE queueing, so a repeated callback can't produce a duplicate mail.
// Resolves when the email is QUEUED; delivery happens in the background with retries.
async function sendOnce(key, template, to, data, opts) {
  try {
    await EmailLog.create({ key, to, template });
  } catch (e) {
    if (e.code === 11000) return false;
    throw e;
  }
  enqueue({ key, template, to, data, opts });
  return true;
}

// For one-time codes the user is waiting on: wait briefly so a broken mail server is reported, but never longer than waitMs.
async function sendFast(template, to, data, waitMs = 8000) {
  const p = module.exports.send(template, to, data);
  let timer;
  try {
    await Promise.race([
      p,
      new Promise((res) => {
        timer = setTimeout(res, waitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  p.catch((e) =>
    console.error(
      `[email] slow ${template} to ${to} failed later: ${e.message}`,
    ),
  );
}

const safe = (p) => p.catch((e) => console.error("[email failed]", e.message)); // email trouble must never fail a payment or request

module.exports = {
  send,
  sendOnce,
  sendFast,
  enqueue,
  flush,
  config,
  render,
  safe,
};
