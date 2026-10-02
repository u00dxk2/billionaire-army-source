import type { Metadata } from "next";
import { apiFetch } from "@/lib/api";

// R-053 — the page addressed to the index itself. This is the only page on the site with a
// NAMED reader, and it is the argument the whole platform is making, said out loud to the
// people it is about.
//
// Two rules it must never break:
//  1. It makes NO claim about any individual. Every hard edge is structural ("you are being
//     counted"), never "you are ungenerous". That is what keeps the register hot and the page
//     defensible at the same time.
//  2. The count is read LIVE. It moved 1,102 -> 1,092 on 2026-08-19 when eleven duplicate
//     person pairs were merged; a hardcoded number on this page would be wrong within weeks.
//     The route is /enlisted for the same reason — never a numbered URL.

export const metadata: Metadata = {
  title: "You are on this list",
  description:
    "A page for the American billionaires in this index: what the score measures, why yours may be lower than you expect, and how to correct the record.",
};

export const revalidate = 3600;

async function personCount(): Promise<number> {
  try {
    const res = await apiFetch<{ pagination?: { total?: number } }>(
      "/api/persons?limit=1",
      { next: { revalidate: 3600 } }
    );
    return Number(res?.pagination?.total) || 0;
  } catch {
    // Never block the page on the count — the sentence reads fine without a figure, and a
    // fabricated fallback number on THIS page would be the one unforgivable thing.
    return 0;
  }
}

export default async function EnlistedPage() {
  const count = await personCount();
  const countText = count > 0 ? `${count.toLocaleString()} names` : "every name";

  return (
    <div className="prose-page">
      <h1 className="page-title">You are on this list</h1>

      <p>
        There are {countText} in this index. If yours is one of them, this page is for you.
      </p>
      <p>
        Nobody asked you to enlist. That is rather the point - the wealth is public, its
        effects are public, and so the accounting is public too.{" "}
        <strong>You are not being accused of anything. You are being counted.</strong>
      </p>

      <h2 className="prose-h2">What the number means</h2>
      <p>
        Your grade is one ratio and one adjustment: how much you give away, against how much
        you have, plus how legible that giving is to someone trying to find it. The formula is
        published and the weights are adjustable -{" "}
        <a href="/leaderboard">move them yourself on the leaderboard</a> and watch the ranking
        rearrange, including yours. Every input on your profile shows its source and the date
        we retrieved it.
      </p>
      <p>
        It is not a moral verdict, and it does not pretend to be. It measures one thing, and it
        says which one.
      </p>

      <h2 className="prose-h2">Why yours might be lower than you expect</h2>
      <p>Usually one of three reasons, and two of them are ours to fix.</p>
      <ol className="prose-list">
        <li>
          <strong>Your giving is real and we cannot see it.</strong> Private foundations file
          once a year, donor-advised funds file almost nothing, and direct gifts often leave no
          public trace at all. From out here, a quiet giver and a non-giver look identical.
          That is a limit of the record, not a judgment of you.
        </li>
        <li>
          <strong>We attached something that is not yours.</strong> Foundations are matched to
          people by <em>name</em>, not by trustee records, so a same-surname family foundation
          can end up on your page in error. If that has happened, tell us and we will pull it
          today.
        </li>
        <li>
          <strong>The number is right and you do not like it.</strong>
        </li>
      </ol>

      <h2 className="prose-h2">What to do about it</h2>
      <p>
        <strong>Correct the record.</strong> Send the filing, the link, the annual report to{" "}
        <a href="mailto:hello@skylarkcreations.com">hello@skylarkcreations.com</a>. We publish
        corrections - that is the job - and we name what changed and when.
      </p>
      <p>
        <strong>Show your work.</strong> Transparency is a scored input. A public, itemized
        giving record moves your grade without you giving another dollar, because it lets the
        record show what is already true.
      </p>
      <p>
        <strong>Or do the thing.</strong> <a href="/goals">The Assignment</a> was written by
        the public, with dollar figures and deadlines attached. It is not connected to your
        score and we will not pretend otherwise. It is just what people said they needed.
      </p>

      <h2 className="prose-h2">What we will never publish</h2>
      <p>
        Home addresses. Family details. Your children. Anything touching your personal
        security. Not as a courtesy - because a site that did that would be a different site,
        making a different argument, and we would deserve everything that followed.
      </p>

      <p style={{ marginTop: "2rem" }}>
        <a href="/billionaires" className="btn btn-primary">
          Find your profile
        </a>
      </p>
    </div>
  );
}
