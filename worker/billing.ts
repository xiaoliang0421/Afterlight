import { Hono } from "hono";
import { z } from "zod";
import { checkoutInput, type BillingOverview } from "../shared/billing";
import policies from "../shared/policies.json";
import { requireUser, requireAdmin, rateLimit, type AppEnv } from "./auth";
import { AppError } from "./errors";
import {
  transactionSchema,
  transactionEntitlement,
  verifyPaddleSignature,
  type OrderExpectation,
} from "./paddle-contract";

interface OrderRow extends OrderExpectation {
  user_id: string;
  package_id: string;
  environment: string;
  status: string;
  idempotency_key: string;
  granted_points: number;
  terms_version: string;
}
export async function generationOffer(env: Cloudflare.Env) {
  const settings = await env.DB.prepare(
    "SELECT text_points,task_reserve_cents,uploads_enabled,reference_generation_enabled,reference_points,reference_reserve_cents FROM settings WHERE id=1",
  ).first<{
    text_points: number;
    task_reserve_cents: number;
    uploads_enabled: number;
    reference_generation_enabled: number;
    reference_points: number;
    reference_reserve_cents: number;
  }>();
  return {
    textEnabled:
      (settings?.text_points ?? 0) > 0 &&
      (settings?.task_reserve_cents ?? 0) >= 40,
    textPoints: settings?.text_points ?? 0,
    textReserveCents: settings?.task_reserve_cents ?? 0,
    uploadsEnabled: !!settings?.uploads_enabled,
    referenceEnabled:
      env.REFERENCE_GENERATION_ENABLED === "true" &&
      !!settings?.reference_generation_enabled &&
      settings.reference_points > 0 &&
      settings.reference_reserve_cents >= 80,
    referencePoints: settings?.reference_points ?? 0,
    referenceReserveCents: settings?.reference_reserve_cents ?? 0,
  };
}
export function paddleEnvironment(
  env: Cloudflare.Env,
): "sandbox" | "production" {
  if (env.PADDLE_ENVIRONMENT === "production") return "production";
  if (!env.PADDLE_ENVIRONMENT || env.PADDLE_ENVIRONMENT === "sandbox")
    return "sandbox";
  throw new AppError(
    "payment_configuration",
    "Payments are being configured.",
    503,
  );
}
export function checkoutConfigured(env: Cloudflare.Env) {
  const production = paddleEnvironment(env) === "production";
  return (
    String(env.PAYMENTS_ENABLED) === "true" &&
    !!env.PADDLE_WEBHOOK_SECRET &&
    !!env.PADDLE_API_KEY?.startsWith(production ? "pdl_live_" : "pdl_sdbx_") &&
    !!env.PADDLE_CLIENT_TOKEN?.startsWith(production ? "live_" : "test_") &&
    (!production ||
      (String(env.ENVIRONMENT) === "production" &&
        env.PADDLE_LIVE_APPROVED === "true" &&
        policies.status === "final"))
  );
}
async function paddleRequest(
  env: Cloudflare.Env,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const production = paddleEnvironment(env) === "production";
  if (!env.PADDLE_API_KEY?.startsWith(production ? "pdl_live_" : "pdl_sdbx_"))
    throw new AppError(
      "payment_configuration",
      "Payments are being configured.",
      503,
    );
  const response = await fetch(
    `https://${production ? "api" : "sandbox-api"}.paddle.com${path}`,
    {
      method: body ? "POST" : "GET",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${env.PADDLE_API_KEY}`,
        "Content-Type": "application/json",
        "Paddle-Version": "1",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new AppError(
      "payment_provider_unavailable",
      "Payment status needs to be checked. Please use your existing order.",
      503,
    );
  return response.json();
}
export async function paidWallet(env: Cloudflare.Env, userId: string) {
  const [account, held] = await Promise.all([
    env.DB.prepare(
      "SELECT balance,reserved,spent FROM paid_credit_accounts WHERE user_id=?",
    )
      .bind(userId)
      .first<{ balance: number; reserved: number; spent: number }>(),
    env.DB.prepare(
      "SELECT id FROM payment_orders WHERE user_id=? AND billing_hold=1 LIMIT 1",
    )
      .bind(userId)
      .first(),
  ]);
  return {
    available: held
      ? 0
      : Math.max(0, (account?.balance ?? 0) - (account?.reserved ?? 0)),
    covered: (account?.balance ?? 0) >= (account?.reserved ?? 0),
    reserved: account?.reserved ?? 0,
    spent: account?.spent ?? 0,
    debt: Math.max(0, -(account?.balance ?? 0)),
    held: !!held,
  };
}
const orderSelect =
  "SELECT id,points,amount_cents AS amountCents,currency,status,granted_points AS grantedPoints,total_paid_cents AS totalPaidCents,tax_cents AS taxCents,created_at AS createdAt,environment FROM payment_orders";
export const billing = new Hono<AppEnv>();
billing.get("/", async (c) => {
  const user = requireUser(c),
    offer = await generationOffer(c.env),
    environment = paddleEnvironment(c.env);
  const [wallet, packages, orders, requests] = await Promise.all([
    paidWallet(c.env, user.id),
    c.env.DB.prepare(
      "SELECT id,name,points,amount_cents AS amountCents,currency FROM payment_packages WHERE active=1 AND environment=? ORDER BY amount_cents",
    )
      .bind(environment)
      .all<BillingOverview["packages"][number]>(),
    c.env.DB.prepare(
      orderSelect + " WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(user.id)
      .all<BillingOverview["orders"][number]>(),
    c.env.DB.prepare(
      "SELECT id,order_id AS orderId,reason,status,response,created_at AS createdAt FROM billing_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(user.id)
      .all<BillingOverview["requests"][number]>(),
  ]);
  return c.json({
    enabled:
      checkoutConfigured(c.env) &&
      (offer.textEnabled || offer.referenceEnabled),
    environment,
    ...offer,
    wallet,
    packages: packages.results,
    orders: orders.results,
    requests: requests.results,
  } satisfies BillingOverview);
});
billing.post("/orders/:id/help", async (c) => {
  const user = requireUser(c),
    id = c.req.param("id");
  const { reason } = z
    .object({ reason: z.string().trim().min(10).max(1200) })
    .parse(await c.req.json());
  if (
    !(await c.env.DB.prepare(
      "SELECT id FROM payment_orders WHERE id=? AND user_id=?",
    )
      .bind(id, user.id)
      .first())
  )
    throw new AppError("not_found", "Order not found.", 404);
  await rateLimit(c.env, `billing-help:${user.id}`, 3);
  await c.env.DB.prepare(
    "INSERT INTO billing_requests(id,order_id,user_id,reason,created_at) VALUES(?,?,?,?,?) ON CONFLICT(order_id) WHERE status='open' DO NOTHING",
  )
    .bind(crypto.randomUUID(), id, user.id, reason, Date.now())
    .run();
  return c.json({ ok: true });
});
billing.get("/admin", async (c) => {
  requireAdmin(c);
  const [orders, requests] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id,user_id AS userId,points,status,provider_transaction_id AS transactionId,created_at AS createdAt FROM payment_orders ORDER BY created_at DESC LIMIT 100",
    ).all(),
    c.env.DB.prepare(
      "SELECT id,order_id AS orderId,user_id AS userId,reason,status,response,created_at AS createdAt FROM billing_requests WHERE status='open' ORDER BY created_at LIMIT 100",
    ).all(),
  ]);
  return c.json({ orders: orders.results, requests: requests.results });
});
billing.post("/admin/requests/:id/respond", async (c) => {
  const admin = requireAdmin(c),
    id = c.req.param("id");
  const { response } = z
    .object({ response: z.string().trim().min(10).max(1200) })
    .parse(await c.req.json());
  const request = await c.env.DB.prepare(
    "SELECT id FROM billing_requests WHERE id=? AND status='open'",
  )
    .bind(id)
    .first();
  if (!request) throw new AppError("not_found", "Open request not found.", 404);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE billing_requests SET status='resolved',response=?,resolved_at=? WHERE id=? AND status='open'",
    ).bind(response, Date.now(), id),
    c.env.DB.prepare("INSERT INTO audit_log VALUES(?,?,?,?,?,?)").bind(
      crypto.randomUUID(),
      admin.id,
      "payment.support-response",
      id,
      "{}",
      Date.now(),
    ),
  ]);
  return c.json({ ok: true });
});
billing.post("/checkout", async (c) => {
  const offer = await generationOffer(c.env);
  if (
    !checkoutConfigured(c.env) ||
    !(offer.textEnabled || offer.referenceEnabled)
  )
    throw new AppError(
      "payment_disabled",
      "Purchases are not available. There is no charge to your account.",
      403,
    );
  const user = requireUser(c, true),
    input = checkoutInput.parse(await c.req.json());
  if (input.termsVersion !== policies.version)
    throw new AppError(
      "terms_changed",
      "Review the current purchase terms before continuing.",
      409,
    );
  await rateLimit(c.env, `checkout:${user.id}`, 5);
  const previous = await c.env.DB.prepare(
    "SELECT * FROM payment_orders WHERE user_id=? AND idempotency_key=?",
  )
    .bind(user.id, input.idempotencyKey)
    .first<OrderRow>();
  if (
    previous &&
    (previous.package_id !== input.packageId ||
      previous.terms_version !== input.termsVersion)
  )
    throw new AppError(
      "idempotency_conflict",
      "This checkout key belongs to another order.",
      409,
    );
  let order = previous;
  if (!order) {
    const capacity = await c.env.DB.prepare(
      "SELECT generation_enabled,balance_cents,debited_cents,reserved_cents,checked_at FROM settings JOIN provider_wallet USING(id) WHERE id=1",
    ).first<{
      generation_enabled: number;
      balance_cents: number;
      debited_cents: number;
      reserved_cents: number;
      checked_at: number;
    }>();
    if (
      !capacity?.generation_enabled ||
      capacity.checked_at < Date.now() - 300000 ||
      capacity.balance_cents -
        capacity.debited_cents -
        capacity.reserved_cents <
        Math.min(
          offer.textEnabled ? offer.textReserveCents : Infinity,
          offer.referenceEnabled ? offer.referenceReserveCents : Infinity,
        )
    )
      throw new AppError(
        "capacity_full",
        "Purchases are paused while creation capacity is replenished.",
        503,
      );
    const pack = await c.env.DB.prepare(
      "SELECT * FROM payment_packages WHERE id=? AND active=1 AND environment=?",
    )
      .bind(input.packageId, paddleEnvironment(c.env))
      .first<{
        id: string;
        points: number;
        amount_cents: number;
        currency: string;
        paddle_price_id: string;
      }>();
    if (!pack)
      throw new AppError(
        "package_unavailable",
        "This point package is not available.",
        409,
      );
    const id = crypto.randomUUID(),
      now = Date.now();
    await c.env.DB.prepare(
      "INSERT INTO payment_orders(id,user_id,package_id,idempotency_key,environment,points,amount_cents,currency,paddle_price_id,terms_version,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        user.id,
        pack.id,
        input.idempotencyKey,
        paddleEnvironment(c.env),
        pack.points,
        pack.amount_cents,
        pack.currency,
        pack.paddle_price_id,
        policies.version,
        now,
        now,
        now,
      )
      .run();
    // An uncertain POST is never repeated. The durable order is reconciled via a signed event or Studio.
    try {
      const result = z
        .object({
          data: z.object({ id: z.string().regex(/^txn_[a-z0-9]{26}$/) }),
        })
        .parse(
          await paddleRequest(c.env, "/transactions", {
            items: [{ price_id: pack.paddle_price_id, quantity: 1 }],
            collection_mode: "automatic",
            currency_code: pack.currency,
            custom_data: { afterlight_order_id: id },
          }),
        );
      await c.env.DB.prepare(
        "UPDATE payment_orders SET provider_transaction_id=?,status='pending',updated_at=? WHERE id=? AND provider_transaction_id IS NULL AND status='creating'",
      )
        .bind(result.data.id, Date.now(), id)
        .run();
    } catch {
      await c.env.DB.prepare(
        "UPDATE payment_orders SET status='review',billing_hold=1,updated_at=? WHERE id=? AND status='creating'",
      )
        .bind(Date.now(), id)
        .run();
      throw new AppError(
        "checkout_uncertain",
        "Your checkout is saved and needs a status check. No second checkout was created.",
        409,
      );
    }
    order = await c.env.DB.prepare("SELECT * FROM payment_orders WHERE id=?")
      .bind(id)
      .first<OrderRow>();
  }
  if (!order?.provider_transaction_id || order.status !== "pending")
    throw new AppError(
      "order_needs_review",
      "Check your existing order in your account before starting another checkout.",
      409,
    );
  return c.json({
    orderId: order.id,
    transactionId: order.provider_transaction_id,
    clientToken: c.env.PADDLE_CLIENT_TOKEN,
    environment: paddleEnvironment(c.env),
  });
});

/** Per-order lease serializes concurrent webhook/cron reads; the entitlement delta and wallet update are one D1 statement. */
export async function syncPaymentOrder(env: Cloudflare.Env, id: string) {
  const lock = crypto.randomUUID(),
    now = Date.now();
  const order = await env.DB.prepare(
    "UPDATE payment_orders SET sync_lock=?,sync_locked_at=? WHERE id=? AND (sync_lock IS NULL OR sync_locked_at<?) RETURNING *",
  )
    .bind(lock, now, id, now - 60000)
    .first<OrderRow>();
  if (!order)
    throw new AppError(
      "payment_sync_busy",
      "This order is already being checked.",
      409,
    );
  try {
    if (
      order.environment !== paddleEnvironment(env) ||
      !order.provider_transaction_id
    )
      throw new AppError(
        "order_needs_review",
        "The saved checkout needs a studio status check.",
        409,
      );
    const response = z
      .object({ data: transactionSchema })
      .parse(
        await paddleRequest(
          env,
          `/transactions/${order.provider_transaction_id}?include=adjustments`,
        ),
      );
    const outcome = transactionEntitlement(response.data, order);
    // A completed transaction cannot revert to pending and regain credits due to an inconsistent provider read.
    if (order.granted_points > 0 && outcome.status === "pending")
      throw new AppError(
        "payment_mismatch",
        "This order needs a payment review.",
        409,
      );
    await env.DB.prepare(
      "UPDATE payment_orders SET status=?,granted_points=?,billing_hold=?,total_paid_cents=?,tax_cents=?,revision=revision+1,last_checked_at=?,updated_at=? WHERE id=? AND sync_lock=?",
    )
      .bind(
        outcome.status,
        outcome.points,
        Number(outcome.hold),
        outcome.total,
        outcome.tax,
        Date.now(),
        Date.now(),
        id,
        lock,
      )
      .run();
  } catch (error) {
    if (error instanceof AppError && error.code === "payment_mismatch")
      await env.DB.prepare(
        "UPDATE payment_orders SET status='review',billing_hold=1,updated_at=? WHERE id=? AND sync_lock=?",
      )
        .bind(Date.now(), id, lock)
        .run();
    throw error;
  } finally {
    await env.DB.prepare(
      "UPDATE payment_orders SET sync_lock=NULL WHERE id=? AND sync_lock=?",
    )
      .bind(id, lock)
      .run();
  }
}
billing.post("/orders/:id/sync", async (c) => {
  const user = requireUser(c),
    id = c.req.param("id");
  const order = await c.env.DB.prepare(
    "SELECT id FROM payment_orders WHERE id=? AND user_id=?",
  )
    .bind(id, user.id)
    .first();
  if (!order) throw new AppError("not_found", "Order not found.", 404);
  await rateLimit(c.env, `order-sync:${user.id}`, 5);
  await syncPaymentOrder(c.env, id);
  return c.json({ ok: true });
});
billing.post("/orders/:id/checkout", async (c) => {
  const offer = await generationOffer(c.env);
  const user = requireUser(c, true);
  if (
    !checkoutConfigured(c.env) ||
    !(offer.textEnabled || offer.referenceEnabled)
  )
    throw new AppError("payment_disabled", "Purchases are paused.", 403);
  const order = await c.env.DB.prepare(
    "SELECT * FROM payment_orders WHERE id=? AND user_id=? AND environment=?",
  )
    .bind(c.req.param("id"), user.id, paddleEnvironment(c.env))
    .first<OrderRow>();
  if (!order) throw new AppError("not_found", "Order not found.", 404);
  if (
    order.status !== "pending" ||
    !order.provider_transaction_id ||
    order.terms_version !== policies.version
  )
    throw new AppError(
      "order_needs_review",
      "This order needs a status check before checkout can resume.",
      409,
    );
  return c.json({
    orderId: order.id,
    transactionId: order.provider_transaction_id,
    clientToken: c.env.PADDLE_CLIENT_TOKEN,
    environment: paddleEnvironment(c.env),
  });
});
// Reconciliation attaches a known Paddle transaction after a lost create response; it never makes a new purchase.
billing.post("/admin/reconcile", async (c) => {
  const admin = requireAdmin(c),
    input = z
      .object({
        orderId: z.string(),
        transactionId: z.string().regex(/^txn_[a-z0-9]{26}$/),
      })
      .parse(await c.req.json());
  const order = await c.env.DB.prepare(
    "SELECT * FROM payment_orders WHERE id=?",
  )
    .bind(input.orderId)
    .first<OrderRow>();
  if (!order) throw new AppError("not_found", "Order not found.", 404);
  const tx = z
    .object({ data: transactionSchema })
    .parse(
      await paddleRequest(
        c.env,
        `/transactions/${input.transactionId}?include=adjustments`,
      ),
    ).data;
  transactionEntitlement(tx, order);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE payment_orders SET provider_transaction_id=? WHERE id=? AND provider_transaction_id IS NULL",
    ).bind(tx.id, order.id),
    c.env.DB.prepare("INSERT INTO audit_log VALUES(?,?,?,?,?,?)").bind(
      crypto.randomUUID(),
      admin.id,
      "payment.reconcile",
      order.id,
      JSON.stringify({ transactionId: tx.id }),
      Date.now(),
    ),
  ]);
  await syncPaymentOrder(c.env, order.id);
  return c.json({ ok: true });
});

const eventSchema = z.object({
  event_id: z.string().regex(/^evt_[a-z0-9]{26}$/),
  event_type: z.string(),
  occurred_at: z.string().datetime(),
  data: z.object({ id: z.string(), transaction_id: z.string().optional() }),
});
export async function receivePaddleWebhook(
  env: Cloudflare.Env,
  request: Request,
) {
  if (!env.PADDLE_WEBHOOK_SECRET)
    throw new AppError("payment_configuration", "Webhook unavailable.", 503);
  const raw = await request.text();
  await verifyPaddleSignature(
    raw,
    request.headers.get("Paddle-Signature") ?? "",
    env.PADDLE_WEBHOOK_SECRET,
  );
  const event = eventSchema.parse(JSON.parse(raw));
  if (
    !event.event_type.startsWith("transaction.") &&
    !event.event_type.startsWith("adjustment.")
  )
    return;
  const transactionId = event.event_type.startsWith("transaction.")
    ? event.data.id
    : event.data.transaction_id;
  if (!transactionId || !/^txn_[a-z0-9]{26}$/.test(transactionId))
    throw new AppError("invalid_event", "Malformed payment event.", 400);
  // Persist only routing metadata, not the customer's full address, email or payment payload.
  await env.DB.prepare(
    "INSERT INTO payment_events(id,environment,event_type,entity_id,transaction_id,occurred_at,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
  )
    .bind(
      event.event_id,
      paddleEnvironment(env),
      event.event_type,
      event.data.id,
      transactionId,
      event.occurred_at,
      Date.now(),
    )
    .run();
}
export async function reconcilePayments(env: Cloudflare.Env) {
  if (!env.PADDLE_API_KEY) return;
  let failures = 0;
  const events = await env.DB.prepare(
    "SELECT id,transaction_id,attempts FROM payment_events WHERE processed_at IS NULL AND environment=? AND next_attempt_at<=? ORDER BY created_at LIMIT 20",
  )
    .bind(paddleEnvironment(env), Date.now())
    .all<{ id: string; transaction_id: string; attempts: number }>();
  for (const event of events.results) {
    try {
      let order = await env.DB.prepare(
        "SELECT * FROM payment_orders WHERE provider_transaction_id=? AND environment=?",
      )
        .bind(event.transaction_id, paddleEnvironment(env))
        .first<OrderRow>();
      if (!order) {
        const tx = z
          .object({ data: transactionSchema })
          .parse(
            await paddleRequest(
              env,
              `/transactions/${event.transaction_id}?include=adjustments`,
            ),
          ).data;
        if (tx.custom_data?.afterlight_order_id) {
          order = await env.DB.prepare(
            "SELECT * FROM payment_orders WHERE id=? AND environment=?",
          )
            .bind(tx.custom_data.afterlight_order_id, paddleEnvironment(env))
            .first<OrderRow>();
          if (order) {
            transactionEntitlement(tx, order);
            await env.DB.prepare(
              "UPDATE payment_orders SET provider_transaction_id=? WHERE id=? AND provider_transaction_id IS NULL",
            )
              .bind(tx.id, order.id)
              .run();
          }
        }
      }
      if (order) await syncPaymentOrder(env, order.id);
      await env.DB.prepare(
        "UPDATE payment_events SET processed_at=?,last_error='' WHERE id=?",
      )
        .bind(Date.now(), event.id)
        .run();
    } catch (error) {
      failures++;
      await env.DB.prepare(
        "UPDATE payment_events SET attempts=attempts+1,next_attempt_at=?,last_error=? WHERE id=?",
      )
        .bind(
          Date.now() +
            Math.min(3600000, 30000 * 2 ** Math.min(event.attempts, 7)),
          error instanceof AppError ? error.code : "payment_sync_failed",
          event.id,
        )
        .run();
    }
  }
  // Repair missed notifications, including refunds on completed orders. Read-only Paddle calls are safe to retry.
  const orders = await env.DB.prepare(
    "SELECT id FROM payment_orders WHERE provider_transaction_id IS NOT NULL AND environment=? AND COALESCE(last_checked_at,0)<? ORDER BY COALESCE(last_checked_at,0) LIMIT 10",
  )
    .bind(paddleEnvironment(env), Date.now() - 3600000)
    .all<{ id: string }>();
  for (const order of orders.results) {
    try {
      await syncPaymentOrder(env, order.id);
    } catch {
      failures++;
      console.error(
        JSON.stringify({
          event: "payment.reconcile-deferred",
          orderId: order.id,
        }),
      );
    }
  }
  if (failures) throw new Error("Payment reconciliation is incomplete.");
}
