const { generateKeyPairSync } = require("crypto");
const fs = require("fs");
const path = require("path");
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const priv = privateKey.export({ type: "pkcs8", format: "pem" }),
  pub = publicKey.export({ type: "spki", format: "pem" });
const b64 = (s) => Buffer.from(s).toString("base64");
console.log(`# Paste these two lines into server/.env (base64 avoids every quoting/newline problem):
ENTITLEMENT_PRIVATE_KEY_B64=${b64(priv)}
ENTITLEMENT_PUBLIC_KEY_B64=${b64(pub)}
`);
const dest = path.join(__dirname, "..", "..", "electron", "config"); // the PUBLIC key goes in the desktop app (safe: it can only verify)
if (fs.existsSync(dest)) {
  fs.writeFileSync(path.join(dest, "entitlement-public.pem"), pub);
  console.log(
    `Wrote the PUBLIC key to ${path.join(dest, "entitlement-public.pem")} for the desktop app.`,
  );
} else
  console.log(
    "Save this PUBLIC key as electron/config/entitlement-public.pem in the desktop app:\n" +
      pub,
  );
console.log(
  "\nKeep the private key only in server/.env. Restart the server after editing .env. If you ever regenerate keys, rewrite both files together.",
);
