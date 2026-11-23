// api/_gradient.js — The Gradient Edit (Lux Bracelet + Lux Cobra Bracelet): the ONLY line on the £2.99 multi-buy
// ladder (owner decision 22 Nov 2026). Server-side list = authority for which barcodes get the ladder price and
// for the Stripe line name (the client's name is never used). Must match index.html DATA rows whose type is
// in LADDER_TYPES; tests/pricing.test.mjs fails if the page and this list drift apart.
// Any barcode NOT listed here is priced by the database (WAT till single price) and is fail-closed.

export const LADDER_TYPES = ['Lux Bracelet', 'Lux Cobra Bracelet'];

/** barcode -> customer colour name */
export const GRADIENT = Object.freeze({
  "1074": "Champagne", // Lux Bracelet
  "1111": "Champagne", // Lux Cobra Bracelet
  "1112": "Lotus Pink", // Lux Cobra Bracelet
  "1103": "Lotus Pink", // Lux Cobra Bracelet
  "1082": "Baby Green", // Lux Bracelet
  "1061": "Ice Blue", // Lux Bracelet
  "0470": "Pastel Green", // Lux Bracelet
  "0381": "Emerald Green", // Lux Bracelet
  "1088": "Sheer Mint", // Lux Cobra Bracelet
  "1057": "Rosewater", // Lux Bracelet
  "1113": "Jade", // Lux Cobra Bracelet
  "1077": "Dusty Rose", // Lux Bracelet
  "1055": "Sky Blue", // Lux Bracelet
  "1049": "Champagne", // Lux Bracelet
  "1062": "Baby Pink", // Lux Bracelet
  "1045": "Clear", // Lux Bracelet
  "1070": "Clear", // Lux Bracelet
  "1059": "Baby Pink", // Lux Bracelet
  "1068": "Dusty Rose", // Lux Bracelet
  "1069": "Light Champagne", // Lux Bracelet
  "1084": "Dusty Rose", // Lux Cobra Bracelet
  "1091": "Sea Blue", // Lux Cobra Bracelet
  "1104": "Teal", // Lux Cobra Bracelet
  "1108": "Multi", // Lux Cobra Bracelet
  "1110": "Teal", // Lux Cobra Bracelet
  "1265": "Rosewater", // Lux Cobra Bracelet
  "1266": "Clear", // Lux Cobra Bracelet
  "1267": "Baby Pink", // Lux Cobra Bracelet
  "1268": "Ice Blue", // Lux Cobra Bracelet
  "1269": "Neon Pink", // Lux Cobra Bracelet
  "1271": "Orchid Pink", // Lux Cobra Bracelet
  "1272": "Salmon Pink", // Lux Cobra Bracelet
  "1302": "Light Champagne", // Lux Bracelet
  "1304": "Baby Green", // Lux Bracelet
  "1306": "Teal", // Lux Bracelet
  "1307": "Clear", // Lux Bracelet
  "1308": "Azure Blue", // Lux Bracelet
  "1310": "Light Champagne", // Lux Bracelet
});

export const isGradient = (bc) => Object.prototype.hasOwnProperty.call(GRADIENT, String(bc));
