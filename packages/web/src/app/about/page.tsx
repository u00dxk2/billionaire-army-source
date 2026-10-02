import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Billionaire Army",
  description:
    "Why Billionaire Army exists, what the score does and doesn't measure, who runs it, and how to reach us. A free, donation-funded civic accountability platform.",
};

export default function AboutPage() {
  return (
    <div className="prose-page">
      <span className="hero-badge">About</span>
      <h1 className="prose-title">About Billionaire Army</h1>

      <p>
        You already know the number is obscene. That isn&apos;t the problem.
      </p>
      <p>
        The problem is what happens ten seconds later. You read that somebody
        sold nine figures of stock in an afternoon, you feel the thing you
        always feel, and then you do the only thing there is to do - you
        screenshot it, or you post about it, or you close the tab. The anger
        goes somewhere, and the somewhere is nowhere. Tomorrow there&apos;s a
        different number and you do it again.
      </p>
      <p>That loop is the actual problem. Not the money. The loop.</p>
      <p>
        But you know what&apos;s different this time? There are receipts.
      </p>
      <p>
        Every billionaire on this site carries a public file: net worth, federal
        political donations, foundation assets and grants, insider stock sales,
        and an open score for how much of their wealth they actually give away.
        Every number links to where it came from and the date we pulled it.
        Estimates say they&apos;re estimates. Where we don&apos;t know, we say
        we don&apos;t know. And you can check all of it - the code that produces
        every number is public. It is a <strong>Skylark Creations</strong>{" "}
        project.
      </p>
      <p>That&apos;s the whole trick. There isn&apos;t a second one.</p>

      <h2 className="prose-h2">Service is the price of the palace</h2>
      <p>
        Concentrated wealth carries a public obligation. That&apos;s the belief
        underneath this entire site, and it is much older than any of us. Every
        society that has let a small number of people hold most of the things
        has had some version of the same argument about what they owe for it.
      </p>
      <p>Nobody has ever sent them the invoice.</p>

      <h2 className="prose-h2">About the name</h2>
      <p>
        &ldquo;Army&rdquo; is doing two jobs here, and both of them are true.
      </p>
      <p>
        The first army is them. A thousand or so people with more capacity to
        move the world than most governments have, enlisted - ranked, scored,
        compared, and competing in public at the thing many of them already say
        they&apos;re doing. That&apos;s the cheerful version. It&apos;s also the
        one this site is actually built to make possible.
      </p>
      <p>The second army is everybody else.</p>
      <p>
        Here is the part that is neither a threat nor cheerful: every time in
        recorded history that wealth has piled up like this, it has eventually
        come back down, and the record on <em>how</em> is bleak. The economic
        historian Walter Scheidel went looking for every case he could find and
        came back with essentially four mechanisms - mass-mobilization warfare,
        transformative revolution, state collapse, and catastrophic plague (
        <a
          href="https://press.princeton.edu/books/paperback/9780691271842/the-great-leveler"
          target="_blank"
          rel="noopener noreferrer"
        >
          <em>The Great Leveler</em>, Princeton University Press, 2017
        </a>
        ). That&apos;s the list. Peaceful reform almost never makes it onto it.
      </p>
      <p>That&apos;s not a threat. It&apos;s a bibliography.</p>
      <p>
        So there is going to be an army. There always is. The only open
        questions are which kind, and how much warning everybody gets. We would
        rather it be the first one. History mostly delivers the second.
      </p>

      {/* R-053 — the Carnegie sourcing. The site's whole thesis (great wealth carries an
          obligation; dying rich is a failure) is Carnegie's, and until 2026-08-20 we never said
          so, which left it reading as our opinion. VERIFIED AT THE URL BEFORE SHIP, and the
          verification changed the copy: the draft had "trustees for the poor" in quotation
          marks, which is NOT the wording at this source — so the trustee idea is paraphrased
          unquoted and only "dies disgraced" is quoted, because only that is verbatim there.
          Putting a paraphrase in quotes around a real historical figure, on this page, would be
          the exact failure this page exists to refuse. */}
      <h2 className="prose-h2">This is not a new idea, and it is not ours</h2>
      <p>
        In 1889 Andrew Carnegie - then among the richest men alive - published a pair of
        articles in the <em>North American Review</em>, later collected as{" "}
        <em>The Gospel of Wealth</em>. His argument was that the rich are mere trustees of
        their fortunes, obliged to live unostentatiously, provide moderately for their
        families, and spend the rest on the common good - and that a man who reaches the end
        still holding it has failed. His own line for that:{" "}
        <a
          href="https://www.carnegie.org/about/our-history/gospelofwealth/"
          target="_blank"
          rel="noopener noreferrer"
        >
          &ldquo;The man who dies thus rich dies disgraced.&rdquo;
        </a>
      </p>
      <p>
        He was not a radical. He was the era&apos;s biggest industrialist, writing about
        himself. We have simply built the ledger he described and left it open.
      </p>

      <h2 className="prose-h2">What this is, honestly</h2>
      <p>
        A site that asks you to check its sources doesn&apos;t get to be vague
        about itself.
      </p>
      <p>
        You write the goals on this site, and a published heuristic suggests
        which billionaires are positioned to move each one. A match is a
        suggestion about fit. It is never a claim that someone could have solved
        it - and <strong>the score is not calculated from goals.</strong> The
        giving score - formally the Public Benefit Score - is giving relative to net worth, plus transparency
        - nothing else. If commitments against goals ever become part of the
        score, this section changes and says when. We put it here because the
        whole site rests on not overstating; it would be strange to start on
        this page.
      </p>
      <p>
        The score also doesn&apos;t measure whether someone is a good person,
        whether their company is useful, whether they pay their taxes, or how
        they treat the people who work for them. It measures giving against
        capacity - one narrow question that happens to have a checkable answer.
        A high grade is not absolution.
      </p>
      <p>
        Facts and opinion never share a container. Facts are sourced and
        moderated. Commentary is labeled as commentary, always.
      </p>
      <p>
        We do not publish home addresses, family details, or anything touching a
        person&apos;s physical safety. Not once, not for anyone, no matter what
        they have done.
      </p>
      <p>
        And this is not about hating rich people. I&apos;m not interested in
        dunking on anybody. Dunking is just the loop again with better
        production values.
      </p>

      <h2 className="prose-h2">Who&apos;s writing this</h2>
      <p>
        I&apos;m David Kooi. I should say where I&apos;m standing. I&apos;m not
        poor, I have an MBA, and I got to spend my time building this instead of
        working a second job. Take that for whatever you think it&apos;s worth.
        I think it&apos;s worth something.
      </p>
      <p>
        As for why this. For years I owned a bike shop in Woodland Hills. The
        hardest thing about that business was never taxes, or regulations, or
        the competition - it was how many people walked in, wanted a bike, and
        couldn&apos;t afford one. You learn to recognize them. The guy from the
        grocery store. The server down the block. That did more to rearrange my
        thinking than my economics degree ever did.
      </p>
      <p>
        Amazon wouldn&apos;t be Amazon without Jeff Bezos, and he deserves to be
        rich for it. But Amazon also doesn&apos;t exist without language,
        mathematics, electricity, the transistor, and a few thousand years of
        people working things out and handing the answer forward. That
        inheritance isn&apos;t his. It&apos;s the most valuable thing any of us
        owns, and all of us own it. So the question I keep landing on
        isn&apos;t how much the government should take from anyone - it&apos;s
        how much of what we built together any one person should keep, and what
        they do with the rest. I made something out of nothing too, on a much
        smaller scale, and the same question applies to me. This site
        doesn&apos;t answer it. It keeps the receipt so you can.
      </p>

      <h2 className="prose-h2">What it costs</h2>
      <p>
        Nothing. It&apos;s donation-funded, capped at $100 per person per year -
        a hard cap, not a suggestion, because a site about concentrated money
        should not be funded by concentrated money. No ads. No premium tier.
        Nothing sold, including you. The code is public, under the AGPL-3.0
        licence -{" "}
        <a
          href="https://github.com/u00dxk2/billionaire-army-source"
          target="_blank"
          rel="noopener noreferrer"
        >
          read it on GitHub
        </a>{" "}
        - so you don&apos;t have to take my word for any of that either.
      </p>

      <h2 className="prose-h2" id="contact">
        If we got something wrong
      </h2>
      <p>
        Tell us. Email{" "}
        <a href="mailto:hello@skylarkcreations.com?subject=Billionaire%20Army">
          hello@skylarkcreations.com
        </a>
        . You don&apos;t need an account, and you don&apos;t need to explain who
        you are - if a number here is wrong, we want it fixed more than you do.
      </p>
      {/* Email stays the PRIMARY route — it needs no developer account, and
          for this audience a GitHub-only route is no route at all. The public
          issue tracker is the second option, beside it, never instead of it. */}
      <p>
        If you&apos;d rather file it in public, you can{" "}
        <a
          href="https://github.com/u00dxk2/billionaire-army-source/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          open an issue on GitHub
        </a>
        . Corrections to sourced facts are taken seriously and reviewed either
        way.
      </p>
      <p>
        A site whose entire argument is &ldquo;go check the receipt&rdquo;
        doesn&apos;t get to be precious when somebody checks ours.
      </p>

      <h2 className="prose-h2">Start here</h2>
      <p>
        Pick one. The billionaire you&apos;re angriest at, or one you&apos;ve
        never heard of - the second is usually more interesting. Read the file.
        Then follow a single source link all the way down to the actual
        document.
      </p>
      <p>
        You&apos;ll come back with the thing the group chat never gives you: the
        real number, and where it came from.
      </p>
      <p>
        Service is the price of the palace. Consider this the itemized bill.
      </p>

      <p className="prose-meta">
        <a
          href="https://github.com/u00dxk2/billionaire-army-source"
          target="_blank"
          rel="noopener noreferrer"
        >
          View the source on GitHub &#8599;
        </a>
      </p>
    </div>
  );
}
