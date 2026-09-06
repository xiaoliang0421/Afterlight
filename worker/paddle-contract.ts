import { z } from "zod";
import { AppError } from "./errors";

const money = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine(Number.isSafeInteger);
const paddleId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{26}$`));
export const transactionSchema = z.object({
  id: paddleId("txn"),
  status: z.string(),
  currency_code: z.string(),
  collection_mode: z.string(),
  custom_data: z
    .object({ afterlight_order_id: z.string().optional() })
    .nullable(),
  items: z.array(
    z.object({
      quantity: z.number().int(),
      price: z.object({
        id: paddleId("pri"),
        billing_cycle: z.unknown().nullable(),
        unit_price: z.object({ amount: money, currency_code: z.string() }),
      }),
    }),
  ),
  details: z
    .object({
      totals: z.object({
        subtotal: money,
        discount: money,
        tax: money,
        credit: money,
        grand_total: money,
      }),
    })
    .nullable(),
  adjustments: z
    .array(
      z.object({
        id: paddleId("adj"),
        transaction_id: paddleId("txn"),
        action: z.string(),
        status: z.string(),
        totals: z.object({
          total: z
            .string()
            .regex(/^-?\d+$/)
            .transform(Number)
            .refine(Number.isSafeInteger),
          currency_code: z.string(),
        }),
      }),
    )
    .default([]),
});
export type PaddleTransaction = z.infer<typeof transactionSchema>;
export interface OrderExpectation {
  id: string;
  points: number;
  amount_cents: number;
  currency: string;
  paddle_price_id: string;
  provider_transaction_id: string | null;
}

/** Read current Paddle state, not an out-of-order event snapshot. No client data can mint points. */
export function transactionEntitlement(
  tx: PaddleTransaction,
  order: OrderExpectation,
) {
  const item = tx.items[0];
  if (
    tx.custom_data?.afterlight_order_id !== order.id ||
    (order.provider_transaction_id &&
      tx.id !== order.provider_transaction_id) ||
    tx.currency_code !== order.currency ||
    tx.collection_mode !== "automatic" ||
    tx.items.length !== 1 ||
    item.quantity !== 1 ||
    item.price.id !== order.paddle_price_id ||
    item.price.billing_cycle !== null ||
    item.price.unit_price.amount !== order.amount_cents ||
    item.price.unit_price.currency_code !== order.currency
  )
    throw new AppError(
      "payment_mismatch",
      "This order needs a payment review.",
      409,
    );
  if (tx.status !== "completed")
    return {
      status: tx.status === "canceled" ? "canceled" : "pending",
      points: 0,
      hold: false,
      total: null,
      tax: null,
    };
  const totals = tx.details?.totals;
  if (
    !totals ||
    totals.subtotal !== order.amount_cents ||
    totals.discount !== 0 ||
    totals.credit !== 0 ||
    totals.grand_total !== order.amount_cents + totals.tax
  )
    throw new AppError(
      "payment_mismatch",
      "The settled amount needs a payment review.",
      409,
    );
  let refunded = 0,
    hold = false;
  for (const adjustment of tx.adjustments) {
    if (
      adjustment.transaction_id !== tx.id ||
      adjustment.totals.currency_code !== order.currency
    )
      throw new AppError(
        "payment_mismatch",
        "The adjustment needs a payment review.",
        409,
      );
    if (adjustment.status === "rejected" || adjustment.status === "reversed")
      continue;
    if (
      adjustment.action.startsWith("chargeback") ||
      adjustment.action === "credit_reverse"
    ) {
      // Reversals and disputes need a human reconciliation. Never automatically unlock contested credits.
      hold = true;
      if (
        adjustment.action === "chargeback" &&
        adjustment.status === "approved"
      )
        refunded = totals.grand_total;
      continue;
    }
    if (!["refund", "credit"].includes(adjustment.action)) {
      hold = true;
      continue;
    }
    if (adjustment.status !== "approved") {
      hold = true;
      continue;
    }
    refunded += Math.abs(adjustment.totals.total);
  }
  const points = Math.max(
    0,
    order.points -
      Math.ceil(
        (order.points * Math.min(refunded, totals.grand_total)) /
          totals.grand_total,
      ),
  );
  return {
    status: hold ? "review" : points === 0 ? "refunded" : "completed",
    points,
    hold,
    total: totals.grand_total,
    tax: totals.tax,
  };
}

export async function verifyPaddleSignature(
  raw: string,
  header: string,
  secret: string,
  now = Date.now(),
) {
  const parts = header.split(";").map((part) => part.trim().split("="));
  const timestamps = parts.filter(([key]) => key === "ts");
  const timestamp = timestamps[0]?.[1] ?? "";
  const signatures = parts.filter(
    ([key, value]) => key === "h1" && /^[a-f0-9]{64}$/.test(value ?? ""),
  );
  if (
    !secret ||
    timestamps.length !== 1 ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 5 ||
    !signatures.length
  )
    throw new AppError(
      "invalid_signature",
      "Webhook verification failed.",
      401,
    );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const payload = new TextEncoder().encode(`${timestamp}:${raw}`);
  for (const [, signature] of signatures) {
    const bytes = Uint8Array.from(signature.match(/../g)!, (pair) =>
      parseInt(pair, 16),
    );
    if (await crypto.subtle.verify("HMAC", key, bytes, payload)) return;
  }
  throw new AppError("invalid_signature", "Webhook verification failed.", 401);
}
