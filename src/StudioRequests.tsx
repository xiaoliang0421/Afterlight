import { useResource } from "./api";
import { Author, Empty, Loading, Notice } from "./components";
export function StudioRequests() {
  const resource = useResource<{
    requests: {
      id: string;
      reason: string;
      createdAt: number;
      userId: string;
      nickname: string;
      email: string;
    }[];
  }>("/admin/account-requests");
  if (resource.loading) return <Loading />;
  if (!resource.data) return <Notice danger>{resource.error}</Notice>;
  return (
    <section>
      <p className="muted">
        Private account requests. Check unfinished paid provider requests and
        the shared story’s attribution before carrying out deletion. Record the
        outcome through the documented account runbook.
      </p>
      <div className="studio-tasks">
        {resource.data.requests.map((r) => (
          <article className="studio-task" key={r.id}>
            <p className="eyebrow">ACCOUNT DELETION REQUEST</p>
            <Author id={r.userId} name={r.nickname || "Storyteller"} />
            <p>{r.reason || "No additional note."}</p>
            <p className="fine-print">
              Private contact: {r.email}
              <br />
              Received {new Date(r.createdAt).toLocaleString("en")}
              <br />
              Request ID: {r.id}
            </p>
          </article>
        ))}
      </div>
      {!resource.data.requests.length && (
        <p className="muted">No account requests awaiting review.</p>
      )}
    </section>
  );
}
