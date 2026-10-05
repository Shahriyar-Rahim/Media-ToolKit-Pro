const crypto = require("crypto");

// .env files mangle multi-line PEM keys easily (quotes, escaped \n, lost lines). Accept the PEM directly or, more safely, as base64.
function decode(raw, b64) {
  if (b64 && b64.trim()) {
    try {
      return Buffer.from(b64.trim(), "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return String(raw || "")
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .replace(/\\n/g, "\n");
}

// Validates the offline-entitlement key pair and returns only what is usable, plus plain-English problems.
function loadKeys(e) {
  const problems = [];
  let privateKey = "",
    publicKey = "";
  const priv = decode(e.ENTITLEMENT_PRIVATE_KEY, e.ENTITLEMENT_PRIVATE_KEY_B64),
    pub = decode(e.ENTITLEMENT_PUBLIC_KEY, e.ENTITLEMENT_PUBLIC_KEY_B64);
  const check = (pem, kind, make) => {
    try {
      const k = make(pem);
      if (
        k.asymmetricKeyType !== "ec" ||
        k.asymmetricKeyDetails.namedCurve !== "prime256v1"
      )
        throw new Error("it must be an EC P-256 key (run npm run keys)");
      return true;
    } catch (err) {
      problems.push(
        `ENTITLEMENT_${kind}_KEY is not a valid key (${String(err.message).split("\n")[0]}).`,
      );
      return false;
    }
  };
  if (priv && check(priv, "PRIVATE", crypto.createPrivateKey))
    privateKey = priv;
  if (pub && check(pub, "PUBLIC", crypto.createPublicKey)) publicKey = pub;
  if (privateKey && publicKey) {
    // a valid but mismatched pair would sign snapshots the desktop app rejects
    const data = Buffer.from("mtp-key-check");
    const ok = crypto.verify(
      "sha256",
      data,
      publicKey,
      crypto.sign("sha256", data, privateKey),
    );
    if (!ok) {
      problems.push(
        "ENTITLEMENT_PRIVATE_KEY and ENTITLEMENT_PUBLIC_KEY are not a matching pair.",
      );
      privateKey = "";
    }
  }
  return { privateKey, publicKey, problems };
}
module.exports = { loadKeys, decode };
