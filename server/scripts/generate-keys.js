const { generateKeyPairSync } = require("crypto");
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const one = (k) =>
  k
    .export({ type: k === privateKey ? "pkcs8" : "spki", format: "pem" })
    .replace(/\n/g, "\\n");
console.log(
  `ENTITLEMENT_PRIVATE_KEY="${one(privateKey)}"\n\nENTITLEMENT_PUBLIC_KEY="${one(publicKey)}"\n\nPut the private key in the server .env only. Embed the public key in the desktop app.`,
);
