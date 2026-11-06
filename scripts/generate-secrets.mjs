// Gera segredos fortes para o .env.local / variáveis da Vercel.
// Uso: npm run secrets
import { randomBytes } from "node:crypto";
const s = (n) => randomBytes(n).toString("base64url");
console.log(`ACTIVATION_CODE_SECRET=${s(48)}`);
console.log(`ACTIVATION_HASH_PEPPER=${s(48)}`);
console.log(`IP_HASH_SALT=${s(24)}`);
console.log("\n# Guarde ACTIVATION_CODE_SECRET e ACTIVATION_HASH_PEPPER com cuidado:");
console.log("# se forem trocados, os códigos de ativação já impressos deixam de funcionar.");
