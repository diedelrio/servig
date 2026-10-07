import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
const HALF_UP = 4; // ROUND_HALF_UP de decimal.js

export type LineInput = { quantity: number; unitPrice: number; taxRate: number };

/**
 * Aritmética decimal exacta (nunca float). Neto e impuesto se redondean por línea a 2 decimales,
 * y los totales son la suma de las líneas ya redondeadas, así el documento siempre cuadra.
 */
export function computeLine(l: LineInput) {
  const net = new D(String(l.quantity)).mul(String(l.unitPrice)).toDecimalPlaces(2, HALF_UP);
  const tax = net.mul(String(l.taxRate)).div(100).toDecimalPlaces(2, HALF_UP);
  return { lineNet: net, lineTax: tax };
}

export function computeTotals(lines: LineInput[]) {
  let subtotal = new D(0);
  let taxTotal = new D(0);
  const computed = lines.map((l) => {
    const c = computeLine(l);
    subtotal = subtotal.add(c.lineNet);
    taxTotal = taxTotal.add(c.lineTax);
    return c;
  });
  return { lines: computed, subtotal, taxTotal, total: subtotal.add(taxTotal) };
}
