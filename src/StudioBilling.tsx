import { t as tr } from "./i18n";
import { useState } from "react";
import { api, useResource } from "./api";
import { Button, Loading, Notice } from "./components";
export function StudioBilling() {
  const resource = useResource<{
    orders: {
      id: string;
      userId: string;
      points: number;
      status: string;
      transactionId: string | null;
    }[];
    requests: { id: string; orderId: string; userId: string; reason: string }[];
  }>("/billing/admin");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  if (resource.loading) return <Loading />;
  return (
    <section>
      <p className="muted">
        {tr(
          "Reconcile only existing Paddle transactions. Refunds are handled in the matching Paddle dashboard; a support response does not move money or alter points.",
        )}
      </p>
      {(error || resource.error) && (
        <Notice danger>{tr(error || resource.error)}</Notice>
      )}
      {!resource.data?.orders.length && (
        <Notice>
          {tr(
            "No customer orders yet. Live payments are closed until merchant and fulfillment acceptance.",
          )}
        </Notice>
      )}
      {resource.data?.requests.map((request) => (
        <article className="studio-task" key={request.id}>
          <h3>{tr("Payment request")}</h3>
          <p>{request.reason}</p>
          <small>
            {tr("Order:")} {request.orderId} {tr("· Account:")} {request.userId}
          </small>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setBusy(request.id);
              setError("");
              try {
                await api(
                  `/billing/admin/requests/${request.id}/respond`,
                  "POST",
                  { response: form.get("response") },
                );
                await resource.reload();
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            <label className="field-label">
              {tr("Response visible to the customer")}
              <textarea
                name="response"
                required
                minLength={10}
                maxLength={1200}
              />
            </label>
            <Button type="submit" busy={busy === request.id}>
              {tr("Record response and resolve request")}
            </Button>
          </form>
        </article>
      ))}
      {resource.data?.orders.map((order) => (
        <article className="studio-task" key={order.id}>
          <h3>
            {order.points} {tr("points ·")} {tr(order.status)}
          </h3>
          <small>
            {tr("Order:")} {order.id} {tr("· Account:")} {order.userId}
          </small>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setBusy(order.id);
              setError("");
              try {
                await api("/billing/admin/reconcile", "POST", {
                  orderId: order.id,
                  transactionId: form.get("transactionId"),
                });
                await resource.reload();
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            <label className="field-label">
              {tr("Verified existing Paddle transaction")}
              <input
                name="transactionId"
                defaultValue={order.transactionId ?? ""}
                required
                pattern="txn_[a-z0-9]{26}"
              />
            </label>
            <Button type="submit" kind="secondary" busy={busy === order.id}>
              {tr("Check this transaction")}
            </Button>
          </form>
        </article>
      ))}
    </section>
  );
}
