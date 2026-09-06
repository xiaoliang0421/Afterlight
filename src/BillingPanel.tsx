import { useEffect, useRef, useState } from "react";
import type { Paddle } from "@paddle/paddle-js";
import { CreditCard, RefreshCw } from "lucide-react";
import type { BillingOverview } from "../shared/billing";
import { api, useResource } from "./api";
import { useApp } from "./context";
import { Button, Notice, Loading, Modal } from "./components";
import policies from "../shared/policies.json";

let paddlePromise: Promise<Paddle | undefined> | undefined;
const paddleEvents = new EventTarget();
interface CheckoutSession {
  orderId: string;
  transactionId: string;
  clientToken: string;
  environment: "sandbox" | "production";
}
function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    cents / 100,
  );
}
export function BillingPanel() {
  const { boot } = useApp();
  const resource = useResource<BillingOverview>(boot.user ? "/billing" : null, [
    boot.user?.id,
  ]);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [helpOrder, setHelpOrder] = useState<string | null>(null),
    [helpReason, setHelpReason] = useState("");
  const keys = useRef(new Map<string, string>());
  const currentOrder = useRef<string | null>(null);
  const data = resource.data;
  const pending = data?.orders.some((o) =>
    ["creating", "pending", "review"].includes(o.status),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (!document.hidden) void resource.reload();
    }, 10000);
    return () => clearInterval(timer);
  }, [pending, resource.reload]);
  useEffect(() => {
    const completed = () => {
      setMessage(
        "Payment submitted. We’re checking it with Paddle; your points will appear after confirmation.",
      );
      if (currentOrder.current)
        void api(`/billing/orders/${currentOrder.current}/sync`, "POST", {})
          .then(resource.reload)
          .catch(() => resource.reload());
    };
    const failed = () =>
      setError(
        "Checkout could not finish. Your existing order is saved; check its status before trying again.",
      );
    paddleEvents.addEventListener("completed", completed);
    paddleEvents.addEventListener("failed", failed);
    return () => {
      paddleEvents.removeEventListener("completed", completed);
      paddleEvents.removeEventListener("failed", failed);
    };
  }, [resource.reload]);
  if (!boot.user) return null;
  async function openCheckout(session: CheckoutSession) {
    if (!paddlePromise)
      paddlePromise = import("@paddle/paddle-js")
        .then(({ initializePaddle }) =>
          initializePaddle({
            token: session.clientToken,
            environment: session.environment,
            eventCallback: (event) => {
              if (event.name === "checkout.completed") {
                // UI events are informational. Only the verified server reconciliation grants points.
                paddleEvents.dispatchEvent(new Event("completed"));
              } else if (
                ["checkout.error", "checkout.payment.error"].includes(
                  event.name ?? "",
                )
              ) {
                paddleEvents.dispatchEvent(new Event("failed"));
              }
            },
          }),
        )
        .catch((error) => {
          paddlePromise = undefined;
          throw error;
        });
    const paddle = await paddlePromise;
    if (!paddle) {
      paddlePromise = undefined;
      throw new Error(
        "Checkout could not load. You can resume this order from your account.",
      );
    }
    currentOrder.current = session.orderId;
    paddle.Checkout.open({
      transactionId: session.transactionId,
      settings: {
        theme: "dark",
        variant: "one-page",
        locale: "en",
        allowLogout: false,
        showAddDiscounts: false,
      },
      ...(boot.user?.email ? { customer: { email: boot.user.email } } : {}),
    });
  }
  async function purchase(packageId: string) {
    setError("");
    setMessage("");
    setBusy(packageId);
    const key = keys.current.get(packageId) ?? crypto.randomUUID();
    keys.current.set(packageId, key);
    try {
      const session = await api<CheckoutSession>("/billing/checkout", "POST", {
        packageId,
        idempotencyKey: key,
        termsVersion: policies.version,
        purchaseAccepted: accepted,
      });
      await resource.reload();
      await openCheckout(session);
    } catch (error) {
      setError((error as Error).message);
      await resource.reload();
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="billing-panel" id="creation-points">
      <div className="billing-heading">
        <div>
          <p className="eyebrow">FOR REFERENCE-GUIDED SCENES</p>
          <h2>Creation points.</h2>
        </div>
        <CreditCard size={25} />
      </div>
      <p className="muted">
        Free text-to-video uses your daily allowance. Purchased points are a
        separate balance for scenes made with approved visual references.
      </p>
      {resource.loading && <Loading />}
      {(error || resource.error) && (
        <Notice danger>{error || resource.error}</Notice>
      )}
      {message && <Notice>{message}</Notice>}
      {data && (
        <>
          <div className="point-balances">
            <div>
              <strong>{data.wallet.available}</strong>
              <span>Available points</span>
            </div>
            <div>
              <strong>{data.wallet.reserved}</strong>
              <span>Reserved for scenes</span>
            </div>
            <div>
              <strong>{data.wallet.spent}</strong>
              <span>Used on published scenes</span>
            </div>
          </div>
          {(data.wallet.held || data.wallet.debt > 0) && (
            <Notice danger>
              Your purchased balance needs a payment review. Use “Payment help”
              beside the relevant order to contact the studio.
            </Notice>
          )}
          {!data.enabled ? (
            <Notice>
              Purchases are not open yet. You can keep creating with your free
              allowance. Reference-guided creation will open after payment setup
              and testing.
            </Notice>
          ) : (
            <>
              {data.environment === "sandbox" && (
                <Notice>
                  Payment sandbox · test orders and test cards only. These are
                  not live purchases.
                </Notice>
              )}
              <p>
                {data.referencePoints} points per reference-guided scene, shown
                again before you join the queue. No subscription or automatic
                top-up. Taxes are shown in checkout.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>
                  I have reviewed the{" "}
                  <a href="/terms#credits" target="_blank" rel="noopener">
                    purchase and refund terms
                  </a>
                  . Points are reserved on joining the queue and used when a
                  scene is published. Visual consistency is not guaranteed.
                </span>
              </label>
              <div className="point-packages">
                {data.packages.map((pack) => (
                  <article key={pack.id}>
                    <h3>{pack.name}</h3>
                    <strong>{pack.points} points</strong>
                    <p>
                      {money(pack.amountCents, pack.currency)} + applicable tax
                      · one time
                    </p>
                    <Button
                      disabled={!accepted || !!busy || !!pending}
                      busy={busy === pack.id}
                      onClick={() => void purchase(pack.id)}
                    >
                      Buy points
                    </Button>
                  </article>
                ))}
              </div>
              {!data.packages.length && (
                <Notice>
                  Point packages are being prepared. No purchase can be made
                  yet.
                </Notice>
              )}
            </>
          )}
          <p className="fine-print">
            A failed or rejected scene returns its reserved points. Returning
            generation points is separate from a payment refund. Free allowances
            reset daily; purchased points do not reset daily. Neither balance is
            transferable.
          </p>
          <div className="billing-heading">
            <h3>Your orders</h3>
            <Button kind="secondary" onClick={() => void resource.reload()}>
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
          {!data.orders.length ? (
            <p className="muted">No purchases yet.</p>
          ) : (
            <div className="billing-orders">
              {data.orders.map((order) => (
                <article key={order.id}>
                  <div>
                    <strong>
                      {order.points} points ·{" "}
                      {money(
                        order.totalPaidCents ?? order.amountCents,
                        order.currency,
                      )}
                    </strong>
                    <p>
                      {order.status === "pending"
                        ? "Awaiting payment confirmation"
                        : order.status === "review"
                          ? "Needs a studio payment review"
                          : order.status === "creating"
                            ? "Checkout status is being checked"
                            : order.status === "refunded"
                              ? "Refunded / points withdrawn"
                              : order.status === "completed"
                                ? `${order.grantedPoints} points credited after adjustments`
                                : "Canceled"}
                    </p>
                    <small>
                      {new Date(order.createdAt).toLocaleDateString("en")} ·{" "}
                      {order.environment === "sandbox" ? "Test order · " : ""}
                      {order.id}
                    </small>
                    {order.taxCents !== null && (
                      <small>
                        Includes {money(order.taxCents, order.currency)} tax
                      </small>
                    )}
                  </div>
                  <div className="order-actions">
                    <Button
                      kind="secondary"
                      onClick={() => {
                        setHelpOrder(order.id);
                        setHelpReason("");
                      }}
                    >
                      Payment help
                    </Button>
                    {order.status === "pending" && data.enabled && (
                      <Button
                        kind="secondary"
                        disabled={!!busy}
                        onClick={async () => {
                          setBusy(order.id);
                          setError("");
                          try {
                            await openCheckout(
                              await api<CheckoutSession>(
                                `/billing/orders/${order.id}/checkout`,
                                "POST",
                                {},
                              ),
                            );
                          } catch (error) {
                            setError((error as Error).message);
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        Resume checkout
                      </Button>
                    )}
                    <Button
                      kind="secondary"
                      disabled={!!busy}
                      busy={busy === order.id}
                      onClick={async () => {
                        setBusy(order.id);
                        setError("");
                        try {
                          await api(
                            `/billing/orders/${order.id}/sync`,
                            "POST",
                            {},
                          );
                          await resource.reload();
                        } catch (error) {
                          setError((error as Error).message);
                        } finally {
                          setBusy("");
                        }
                      }}
                    >
                      Check payment
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {data.requests?.map((request) => (
            <Notice key={request.id}>
              <strong>Order {request.orderId}</strong>
              <p>
                {request.status === "open"
                  ? "Your payment request is awaiting studio review. This does not itself cancel or refund the order."
                  : request.response}
              </p>
              <small>{request.reason}</small>
            </Notice>
          ))}
        </>
      )}
      {helpOrder && (
        <Modal
          title="Payment or refund help"
          onClose={() => setHelpOrder(null)}
        >
          <p>
            Tell the studio what happened. Your order number is included
            automatically. Do not send card details or passwords. A request does
            not automatically issue a refund.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy("help");
              setError("");
              try {
                await api(`/billing/orders/${helpOrder}/help`, "POST", {
                  reason: helpReason,
                });
                await resource.reload();
                setHelpOrder(null);
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            <label className="field-label">
              What needs attention?
              <textarea
                required
                minLength={10}
                maxLength={1200}
                value={helpReason}
                onChange={(event) => setHelpReason(event.target.value)}
              />
            </label>
            {error && <Notice danger>{error}</Notice>}
            <Button type="submit" busy={busy === "help"}>
              Send request to the studio
            </Button>
          </form>
        </Modal>
      )}
    </section>
  );
}
