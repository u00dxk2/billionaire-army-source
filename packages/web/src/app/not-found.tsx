// Design-canon Wave 2 S1: branded 404 (Rules 13/14/31) — shared links are the
// growth loop, so a dead link should still say where you are and where to go.
export default function NotFound() {
  return (
    <div className="not-found-page">
      <h1>404</h1>
      <p>That page doesn&apos;t exist — or it moved.</p>
      <p>
        <a href="/">Home</a> · <a href="/feed">The Feed</a> ·{" "}
        <a href="/billionaires">All profiles</a>
      </p>
    </div>
  );
}
