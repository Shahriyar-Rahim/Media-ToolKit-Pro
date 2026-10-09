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
    "Welcome aboard — your account is ready!",
    `<p>Hi ${esc(d.name || "there")},</p>
     <p>You're all set! Your account has been successfully verified, and you can now explore everything <b>{app}</b> has to offer.</p>
     <p>We're glad to have you with us. Here's to a great experience ahead!</p>
     <p>Welcome to the community.</p>`,
  ],

  verifyEmail: (d) => [
    "Your email verification code",
    `<p>You're just one step away from getting started.</p>
     <p>Use the verification code below to confirm your email address:</p>
     <div style="margin:24px 0;padding:22px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;text-align:center;">
       <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7c3aed;margin-bottom:10px;">VERIFICATION CODE</div>
       <b style="font-size:30px;letter-spacing:8px;color:#4c1d95;">${esc(d.code)}</b>
       <div style="margin-top:12px;font-size:13px;color:#6b7280;">Expires in ${esc(d.minutes)} minutes</div>
     </div>
     <p>Enter this code in the verification screen to continue.</p>
     <p style="color:#6b7280;font-size:13px;">If you didn't create an account with us, you can safely ignore this email.</p>`,
  ],

  loginOtp: (d) => [
    "Your secure sign-in code",
    `<p>Someone is attempting to sign in to your account. Use the code below to complete your sign-in.</p>
     <div style="margin:24px 0;padding:22px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;text-align:center;">
       <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7c3aed;margin-bottom:10px;">SIGN-IN CODE</div>
       <b style="font-size:30px;letter-spacing:8px;color:#4c1d95;">${esc(d.code)}</b>
       <div style="margin-top:12px;font-size:13px;color:#6b7280;">Expires in ${esc(d.minutes)} minutes</div>
     </div>
     <p><b>Security reminder:</b> Never share this code with anyone, including someone claiming to be from our support team.</p>
     <p style="color:#b91c1c;">If you didn't attempt to sign in, change your password immediately to help protect your account.</p>`,
  ],

  passwordReset: (d) => [
    "Your password reset code",
    `<p>We received a request to reset your password.</p>
     <p>Use the following code to continue with your password reset:</p>
     <div style="margin:24px 0;padding:22px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;text-align:center;">
       <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c2410c;margin-bottom:10px;">PASSWORD RESET CODE</div>
       <b style="font-size:30px;letter-spacing:8px;color:#9a3412;">${esc(d.code)}</b>
       <div style="margin-top:12px;font-size:13px;color:#7c6f64;">Expires in ${esc(d.minutes)} minutes</div>
     </div>
     <p>Once verified, you'll be able to choose a new password.</p>
     <p style="color:#b91c1c;font-size:13px;">If you didn't request a password reset, ignore this email. Your password will remain unchanged unless the reset process is completed.</p>`,
  ],

  subscriptionActivated: (d) => [
    "You're in! Your subscription is active",
    `<p>Great news! Your <b>${esc(d.plan)}</b> plan is now active.</p>
     <div style="margin:24px 0;padding:22px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#047857;">SUBSCRIPTION STATUS</div>
       <div style="font-size:22px;font-weight:700;color:#065f46;margin:10px 0;">Active</div>
       <div style="font-size:14px;color:#065f46;">Plan: <b>${esc(d.plan)}</b></div>
       <div style="font-size:14px;color:#065f46;margin-top:6px;">${d.endsAt ? `Valid until ${esc(new Date(d.endsAt).toDateString())}` : "Lifetime access"}</div>
     </div>
     <p>You now have access to the features included in your plan. Make the most of your upgraded experience!</p>`,
  ],

  subscriptionExpiring: (d) => [
    "A quick reminder: your plan expires soon",
    `<p>Your <b>${esc(d.plan)}</b> subscription is approaching its expiration date.</p>
     <div style="margin:24px 0;padding:22px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#92400e;">EXPIRATION DATE</div>
       <div style="font-size:22px;font-weight:700;color:#78350f;margin-top:10px;">${esc(new Date(d.endsAt).toDateString())}</div>
       <div style="font-size:14px;color:#92400e;margin-top:8px;">Plan: ${esc(d.plan)}</div>
     </div>
     <p>Renew your subscription before it expires to continue enjoying your premium tools without interruption.</p>`,
  ],

  subscriptionExpired: (d) => [
    "Your subscription has ended",
    `<p>Your <b>${esc(d.plan)}</b> subscription has expired.</p>
     <p>We hope you've enjoyed your premium experience. You can renew your plan to regain access to its premium tools and features.</p>
     <div style="margin:24px 0;padding:18px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280;">SUBSCRIPTION STATUS</div>
       <div style="font-size:20px;font-weight:700;color:#374151;margin-top:8px;">Expired</div>
       <div style="font-size:14px;color:#6b7280;margin-top:6px;">Plan: ${esc(d.plan)}</div>
     </div>
     <p>Whenever you're ready, we'll be here to help you get started again.</p>`,
  ],

  paymentReceived: (d) => [
    "Payment received — thank you!",
    `<p>Thank you for your payment. We've successfully received the following amount:</p>
     <div style="margin:24px 0;padding:24px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;text-align:center;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1d4ed8;">AMOUNT RECEIVED</div>
       <div style="font-size:30px;font-weight:700;color:#1e3a8a;margin:10px 0;">${esc(money(d.amountMinor, d.currency))}</div>
       <div style="font-size:14px;color:#1d4ed8;">Plan: <b>${esc(d.plan)}</b></div>
     </div>
     <p>Your payment has been recorded. Thank you for choosing us!</p>`,
  ],

  paymentApproved: (d) => [
    "Payment approved — you're all set!",
    `<p>Good news! Your manual payment has been reviewed and approved.</p>
     <div style="margin:24px 0;padding:20px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#047857;">PAYMENT STATUS</div>
       <div style="font-size:22px;font-weight:700;color:#065f46;margin:10px 0;">✓ Approved</div>
       <div style="font-size:14px;color:#065f46;">Transaction ID: <b>${esc(d.transactionId)}</b></div>
     </div>
     <p>Thank you for completing your payment. Your transaction has been confirmed.</p>`,
  ],

  paymentRejected: (d) => [
    `Payment update${d.orderId ? ` — Order ${esc(d.orderId)}` : ""}`,
    `<p>Unfortunately, your manual payment could not be approved.</p>
     <div style="margin:24px 0;padding:20px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b91c1c;">PAYMENT STATUS</div>
       <div style="font-size:22px;font-weight:700;color:#991b1b;margin:10px 0;">Not approved</div>
       <div style="font-size:14px;color:#991b1b;">Transaction ID: <b>${esc(d.transactionId)}</b></div>
       ${d.orderId ? `<div style="font-size:14px;color:#991b1b;margin-top:6px;">Order ID: <b>${esc(d.orderId)}</b></div>` : ""}
       ${d.note ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid #fecaca;font-size:14px;color:#7f1d1d;"><b>Reason / note:</b><br>${esc(d.note).replace(/\n/g, "<br>")}</div>` : ""}
     </div>
     <p>Please review the information provided and contact support if you need assistance with your payment.</p>`,
  ],

  manualPaymentSubmitted: (d) => [
    "Payment submitted — awaiting verification",
    `<p>Thanks for submitting your payment details. We've received your transaction and added it to our review queue.</p>
     <div style="margin:24px 0;padding:20px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1d4ed8;">TRANSACTION DETAILS</div>
       <div style="font-size:14px;color:#1e40af;margin-top:12px;">Transaction ID</div>
       <div style="font-size:18px;font-weight:700;color:#1e3a8a;margin-top:4px;">${esc(d.transactionId)}</div>
       <div style="font-size:14px;color:#1d4ed8;margin-top:12px;">Status: <b>Pending review</b></div>
     </div>
     <p>Our admin team will verify your transaction. We'll email you when there's an update.</p>
     <p>Thank you for your patience!</p>`,
  ],

  adminNewPayment: (d) => [
    `New payment received — ${esc(d.orderId)} | ${esc(d.plan)} | ${esc(money(d.amountMinor, d.currency))}`,
    `<p>${esc(d.headline)}</p>
     <div style="margin:20px 0;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1d4ed8;">ADMIN ACTION REQUIRED</div>
       <div style="font-size:14px;color:#1e40af;margin-top:8px;">A new payment requires review. Please verify the transaction details before approving or rejecting it.</div>
     </div>
     ${table(d.rows)}`,
  ],

  paymentUnderReview: (d) => [
    `Payment under review — ${esc(d.orderId)}`,
    `<p>Hi ${esc(d.userName || "there")},</p>
     <p>Thank you for submitting your payment! We've received your request, and it's now <b>under review</b>.</p>
     <div style="margin:24px 0;padding:20px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#92400e;">CURRENT STATUS</div>
       <div style="font-size:22px;font-weight:700;color:#78350f;margin:10px 0;">Under review</div>
       <div style="font-size:14px;color:#92400e;">Order ID: <b>${esc(d.orderId)}</b></div>
     </div>
     <p>Our admin team will verify your transaction shortly. Once your payment is approved, we'll email you your payment memo and activate your plan.</p>
     ${table(d.rows)}
     <p style="font-size:13px;color:#6b7280;">No further action is needed unless our team contacts you for additional information.</p>`,
  ],

  memo: (d) => [
    `Your payment confirmation & memo — ${esc(d.orderId)}`,
    `<p>Hi ${esc(d.userName || "there")},</p>
     <p>Your payment has been <b>${esc(d.statusText)}</b>, and your plan is now active.</p>
     <div style="margin:24px 0;padding:20px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#047857;">PAYMENT CONFIRMATION</div>
       <div style="font-size:22px;font-weight:700;color:#065f46;margin:10px 0;">Your memo is ready</div>
       <div style="font-size:14px;color:#065f46;">Order ID: <b>${esc(d.orderId)}</b></div>
       <div style="font-size:14px;color:#065f46;margin-top:6px;">A PDF copy of your payment memo is attached to this email for your records.</div>
     </div>
     <p>Please keep your memo for future reference. Thank you for choosing us!</p>
     ${table(d.memo.rows)}`,
  ],

  refundProcessed: (d) => [
    "Your refund has been processed",
    `<p>Your refund has been processed. Here are the details:</p>
     <div style="margin:24px 0;padding:22px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280;">REFUND AMOUNT</div>
       <div style="font-size:28px;font-weight:700;color:#111827;margin:10px 0;">${esc(money(d.amountMinor, d.currency))}</div>
       <div style="font-size:14px;color:#374151;">Plan: <b>${esc(d.plan)}</b></div>
       ${d.orderId ? `<div style="font-size:14px;color:#374151;margin-top:6px;">Order ID: <b>${esc(d.orderId)}</b></div>` : ""}
     </div>
     <p>Your access to this plan has ended.</p>
     ${d.viaGateway ? `<p>The refund was sent to your original payment method. The time it takes to appear in your account depends on your bank or payment provider.</p>` : ""}
     <p>If you have any questions, please contact our support team.</p>`,
  ],

  bugReceived: (d) => [
    "We've received your bug report",
    `<p>Thank you for helping us improve! Your bug report has been successfully received.</p>
     <div style="margin:24px 0;padding:20px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1d4ed8;">REPORT REFERENCE</div>
       <div style="font-size:22px;font-weight:700;color:#1e3a8a;margin-top:10px;">${esc(d.reportId)}</div>
       <div style="font-size:14px;color:#1d4ed8;margin-top:8px;">Status: <b>Open</b></div>
     </div>
     <p>Our team can now review the issue. Please keep this reference ID in case you need to follow up.</p>
     <p>We appreciate your help in making our platform better.</p>`,
  ],

  contactReceived: (d) => [
    "Message received — we'll be in touch",
    `<p>Thanks for reaching out! We've successfully received your message.</p>
     <div style="margin:24px 0;padding:20px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7c3aed;">SUPPORT REFERENCE</div>
       <div style="font-size:22px;font-weight:700;color:#4c1d95;margin-top:10px;">${esc(d.ticketId)}</div>
       <div style="font-size:14px;color:#6d28d9;margin-top:8px;">Status: <b>Received</b></div>
     </div>
     <p>Our team will review your message and get back to you as soon as possible.</p>
     <p>Keep your reference ID handy in case you need to follow up. Thanks for your patience!</p>`,
  ],

  adminReply: (d) => [
    `Re: ${esc(d.subject || "your request")}`,
    `<p>Hi there,</p>
     <p>We've got an update regarding your request.</p>
     <div style="margin:24px 0;padding:22px;background:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid #6366f1;border-radius:8px;">
       <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280;margin-bottom:12px;">MESSAGE FROM OUR TEAM</div>
       <div style="font-size:15px;line-height:1.8;color:#374151;">${esc(d.message).replace(/\n/g, "<br>")}</div>
     </div>
     <p>If you have any further questions, simply reply to this email.</p>
     <p>Best regards,<br><b>Support Team</b></p>`,
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
