import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Billionaire Army",
  description:
    "How Billionaire Army collects, uses, discloses, and retains information. No ads, no data sales.",
};

export default function PrivacyPage() {
  return (
    <div className="prose-page">
      <span className="hero-badge">Legal</span>
      <h1 className="prose-title">Privacy Policy</h1>
      <p className="prose-legal-meta">
        Effective date: July 5, 2026 · Operator: Skylark Creations LLC, doing
        business as &ldquo;Billionaire Army&rdquo; · Contact:{" "}
        hello@skylarkcreations.com
      </p>

      <h2 className="prose-h2">1. Overview</h2>
      <p>
        This Privacy Policy explains how Billionaire Army collects, uses,
        discloses, retains, and protects information when you use the
        Service.
      </p>
      <p>The Service involves two different groups of people:</p>
      <ul className="prose-list">
        <li>
          <strong>Registered users and visitors</strong> — people who browse
          the Service, create accounts, vote, comment, rate goals, submit
          rewrites, propose additions, or contact us.
        </li>
        <li>
          <strong>Profile subjects</strong> — people whose names,
          public-record information, news coverage, scores, summaries,
          photos, or other information may appear on the Service, whether or
          not they use the Service or consent to inclusion.
        </li>
      </ul>
      <p>Those groups raise different privacy and legal issues. This Policy describes both.</p>

      <h2 className="prose-h2">2. Scope</h2>
      <p>
        This Policy applies to the Service. It does not apply to third-party
        websites, APIs, news sources, public databases, hosting
        providers&rsquo; own websites, social media platforms, or other
        services we do not control.
      </p>
      <p>
        The Service is operated from the United States and is intended for
        a U.S. audience. If you use the Service from outside the United
        States, you understand that your information may be processed in
        the United States, where privacy laws may differ from those in your
        location.
      </p>

      <h2 className="prose-h2">3. Information we collect from registered users and visitors</h2>
      <h3 className="prose-h3">3.1 Account information</h3>
      <p>If you create an account, we collect information needed to create and maintain the account, such as:</p>
      <ul className="prose-list">
        <li>email address;</li>
        <li>password or authentication credential processed through our authentication provider;</li>
        <li>optional display name if provided or later supported;</li>
        <li>account identifiers, timestamps, and account status information.</li>
      </ul>
      <p>
        We do not intentionally collect phone numbers, physical addresses,
        payment-card information, bank-account information, government
        identifiers, biometric data, or precise GPS location from registered
        users.
      </p>

      <h3 className="prose-h3">3.2 User activity</h3>
      <p>If you use interactive features, we may collect and store:</p>
      <ul className="prose-list">
        <li>votes and approval/disapproval activity;</li>
        <li>comments and comment metadata;</li>
        <li>goal ratings, SMART-criteria ratings, and priority scores;</li>
        <li>proposed goal rewrites and related comments;</li>
        <li>
          proposed additions of people to the Service, including the
          proposed person&rsquo;s name, reason, industry tags, state,
          Wikidata ID, and related metadata;
        </li>
        <li>reports, correction requests, takedown requests, support messages, and other communications;</li>
        <li>timestamps, internal IDs, and related records needed to operate and protect the Service.</li>
      </ul>
      <p>
        Some activity may be public or may affect public content. For
        example, comments may be publicly visible, votes may be displayed in
        aggregate, and proposed additions may affect public profile data. Do
        not submit information you want to keep private.
      </p>

      <h3 className="prose-h3">3.3 Automatically collected information</h3>
      <p>
        When you use the Service, we and our hosting or infrastructure
        providers may automatically process technical information such as:
      </p>
      <ul className="prose-list">
        <li>IP address;</li>
        <li>device, browser, and operating-system information;</li>
        <li>pages visited;</li>
        <li>referring URLs;</li>
        <li>access times;</li>
        <li>request logs;</li>
        <li>error logs;</li>
        <li>security, fraud-prevention, and performance information.</li>
      </ul>
      <p>
        At this time, the application does not maintain its own IP-address
        database field, but hosting providers may transiently process IP
        addresses and request logs to provide and secure the Service.
      </p>

      <h3 className="prose-h3">3.4 Cookies and similar technologies</h3>
      <p>
        We may use cookies, local storage, and similar technologies that are
        necessary or useful for authentication, session management,
        security, preferences, and basic Service operation.
      </p>
      <p>
        We do not currently use advertising cookies, behavioral advertising
        networks, or third-party analytics tools in the live product. If we
        add analytics, advertising, donation, payment, newsletter, or
        similar tools later, we will update this Policy as appropriate
        before or when those tools begin processing personal information.
      </p>

      <h2 className="prose-h2">4. Information we publish or process about profile subjects</h2>
      <p>
        The Service may collect, generate, store, display, and update
        information about profile subjects from public records, public
        APIs, news sources, public websites, user submissions, and
        AI-generated or algorithmic processing.
      </p>
      <p>This may include:</p>
      <ul className="prose-list">
        <li>
          name, aliases, birth year, death year, country, state, industry
          tags, gender, photos, and public biographical details;
        </li>
        <li>net-worth estimates and related source data;</li>
        <li>foundation and philanthropic-giving data;</li>
        <li>political-contribution data and party-affiliation indicators derived from public records;</li>
        <li>SEC filing and ownership information;</li>
        <li>news headlines, article links, summaries, and source metadata;</li>
        <li>profile summaries and feed-card summaries generated or assisted by AI;</li>
        <li>
          Giving score values, grades, badges, rankings,
          comparisons, and underlying scoring features;
        </li>
        <li>
          user-submitted proposals, source suggestions, comments, votes, and
          other community signals related to a profile.
        </li>
      </ul>
      <p>
        Profile subjects may not have provided this information to us, may
        not use the Service, and may not have consented to inclusion. We
        process and publish this information for public-interest,
        civic-accountability, commentary, research, reporting, and
        discussion purposes.
      </p>
      <p>
        We do not intentionally publish private home addresses,
        family-member details, personal-security information, government
        identifiers, financial-account numbers, biometric data, or precise
        GPS location for profile subjects. Users are prohibited from
        submitting that information.
      </p>

      <h2 className="prose-h2">5. How we use information</h2>
      <p>We may use information to:</p>
      <ul className="prose-list">
        <li>provide, operate, maintain, and secure the Service;</li>
        <li>create and manage user accounts;</li>
        <li>authenticate users;</li>
        <li>enable votes, comments, ratings, rewrites, proposals, and correction requests;</li>
        <li>display public content and aggregate community signals;</li>
        <li>build, update, score, compare, and explain public profiles;</li>
        <li>
          retrieve and organize public records, filings, public datasets,
          news articles, and source links;
        </li>
        <li>generate or assist with summaries, feed cards, classifications, and explanatory content;</li>
        <li>detect abuse, spam, manipulation, scraping, security threats, and policy violations;</li>
        <li>moderate, remove, or restrict content;</li>
        <li>
          respond to questions, legal notices, privacy requests, correction
          requests, and takedown requests;
        </li>
        <li>analyze and improve Service reliability, quality, and safety;</li>
        <li>enforce our Terms;</li>
        <li>comply with legal obligations;</li>
        <li>
          protect the rights, safety, reputation, and security of users,
          profile subjects, the public, and us.
        </li>
      </ul>

      <h2 className="prose-h2">6. How we disclose information</h2>
      <p>We may disclose information in the following ways.</p>

      <h3 className="prose-h3">6.1 Public disclosure through the Service</h3>
      <p>
        Certain content is public by design, including profile pages, public
        scores, public rankings, source links, AI-generated or editorial
        summaries, feed cards, comments, aggregate vote results, goals, and
        other public-facing content.
      </p>
      <p>
        Do not submit comments, proposals, corrections, or other content
        that contains information you do not want made public or reviewed
        by administrators.
      </p>

      <h3 className="prose-h3">6.2 Service providers</h3>
      <p>
        We may disclose information to service providers that help us
        operate the Service, such as hosting, database, authentication,
        infrastructure, security, and AI providers. Current service
        providers and data flows include:
      </p>
      <ul className="prose-list">
        <li><strong>Supabase</strong> — database and authentication hosting;</li>
        <li><strong>Render</strong> — website/API hosting and infrastructure;</li>
        <li>
          <strong>OpenAI</strong> — AI generation and verification involving
          public-record, news-derived, and profile-subject data; we do not
          intentionally send registered users&rsquo; email addresses,
          passwords, votes, or comments to OpenAI;
        </li>
        <li>
          public-record and source APIs used to retrieve or verify
          profile-subject data, such as FEC, SEC EDGAR, ProPublica Nonprofit
          Explorer, NewsAPI.ai, GDELT, and Wikidata.
        </li>
      </ul>
      <p>
        We may add, replace, or remove providers as the Service changes. If
        a material change affects personal-information handling, we will
        update this Policy as appropriate.
      </p>

      <h3 className="prose-h3">6.3 Legal, safety, and enforcement disclosures</h3>
      <p>We may disclose information if we believe it is reasonably necessary to:</p>
      <ul className="prose-list">
        <li>comply with law, subpoenas, court orders, legal process, or government requests;</li>
        <li>enforce our Terms;</li>
        <li>
          investigate or prevent fraud, abuse, security incidents,
          manipulation, harassment, doxxing, threats, or unlawful activity;
        </li>
        <li>
          protect the rights, safety, reputation, property, or security of
          users, profile subjects, the public, service providers, or us;
        </li>
        <li>establish, exercise, or defend legal claims.</li>
      </ul>

      <h3 className="prose-h3">6.4 Business transfers</h3>
      <p>
        If we are involved in a merger, acquisition, financing,
        reorganization, bankruptcy, asset sale, or similar transaction,
        information may be transferred as part of that transaction, subject
        to applicable law and appropriate notice where required.
      </p>

      <h2 className="prose-h2">7. No sale of personal information; no advertising</h2>
      <p>
        We do not sell registered-user personal information. We do not sell
        profile-subject personal information. We do not currently display
        advertising, use advertising networks, or share personal information
        for cross-context behavioral advertising.
      </p>
      <p>
        If this changes, we will update this Policy and provide choices
        required by applicable law before or when the change occurs.
      </p>

      <h2 className="prose-h2">8. Public sources and public information</h2>
      <p>
        Some information on the Service comes from public records,
        government databases, public filings, public news sources, public
        websites, public APIs, public signatory lists, and similar sources.
        Public availability does not guarantee accuracy, completeness,
        fairness, currentness, or lawful use for every purpose.
      </p>
      <p>
        We may combine public information with scoring methods, AI-generated
        summaries, editorial context, user submissions, and internal
        metadata. This combined output may differ from the original source
        material and may contain errors. We encourage users and profile
        subjects to review underlying source links and report material
        inaccuracies.
      </p>

      <h2 className="prose-h2">9. AI processing</h2>
      <p>
        We may use AI systems to help generate, summarize, classify,
        compare, score, verify, or explain content. AI processing may
        involve sending public-record, news-derived, source, and
        profile-subject data to AI providers.
      </p>
      <p>
        We do not intentionally send registered users&rsquo; email
        addresses, passwords, votes, comments, or account credentials to AI
        providers for profile-summary or feed-card generation. Users should
        not include sensitive personal information in public comments,
        proposals, correction requests, or other submissions.
      </p>
      <p>
        AI-generated content may be inaccurate, incomplete, outdated, or
        misleading. We may store AI outputs, prompts, source snippets,
        verification records, and related metadata to operate, audit,
        improve, and defend the Service.
      </p>

      <h2 className="prose-h2">10. Data retention</h2>
      <p>
        We retain information for as long as reasonably necessary for the
        purposes described in this Policy unless a shorter or longer period
        is required or permitted by law.
      </p>
      <p>At launch, the Service does not have automated deletion or expiration for all data categories. In practice:</p>
      <ul className="prose-list">
        <li>
          account information may be retained while the account exists and
          for a reasonable period afterward for security, legal, audit, and
          abuse-prevention purposes;
        </li>
        <li>
          comments, votes, goal activity, proposals, and related records may
          be retained to preserve community integrity, prevent
          manipulation, enforce rules, and maintain public context;
        </li>
        <li>
          public-record, source, profile, score, AI-generated, and editorial
          data may be retained while relevant to the Service&rsquo;s
          public-interest purpose;
        </li>
        <li>logs may be retained by infrastructure providers according to their systems and policies;</li>
        <li>
          legal, safety, correction, dispute, and abuse records may be
          retained as long as needed to address the issue and protect
          rights.
        </li>
      </ul>
      <p>We may delete, anonymize, aggregate, de-identify, or preserve information in our discretion and as allowed by law.</p>

      <h2 className="prose-h2">11. Your privacy choices and requests</h2>
      <p>
        You may contact us at{" "}
        <a href="mailto:hello@skylarkcreations.com">
          hello@skylarkcreations.com
        </a>{" "}
        to request access, correction, deletion, or other action regarding
        personal information associated with your account or submitted by
        you.
      </p>
      <p>
        We may need to verify your identity before fulfilling a request. We
        may decline or limit a request where we cannot verify it, where the
        request is fraudulent or abusive, where retention is required or
        permitted by law, where the information is public-record or
        editorial content, where deletion would impair security or
        integrity, or where another exception applies.
      </p>
      <p>
        If you have an account, we may require you to submit certain
        requests from or in connection with the email address associated
        with your account.
      </p>
      <p>
        Deleting your account may not remove content that has already been
        published, aggregated, de-identified, backed up, relied on for
        public context, preserved for legal or safety reasons, or submitted
        as public User Content, unless applicable law requires removal.
      </p>

      <h2 className="prose-h2">12. Requests by profile subjects</h2>
      <p>
        If you are a profile subject or an authorized representative, you
        may contact us at{" "}
        <a href="mailto:hello@skylarkcreations.com">
          hello@skylarkcreations.com
        </a>{" "}
        to request correction, annotation, source review, limitation, or
        removal of content about you.
      </p>
      <p>
        Please include enough information to identify the profile and
        evaluate the request, including disputed statements, source links,
        reliable contrary sources, and the specific remedy you seek.
      </p>
      <p>
        We may ask for information reasonably necessary to verify identity
        or authority. We will use verification information only for request
        handling, legal, safety, security, or dispute-resolution purposes,
        unless you consent to another use or law requires otherwise.
      </p>
      <p>
        We may not remove information solely because it is unfavorable,
        critical, public, newsworthy, sourced from public records, or part
        of public-interest commentary. We may correct, annotate, limit,
        remove, or retain information depending on the circumstances,
        applicable law, source quality, public interest, safety, and
        editorial judgment.
      </p>

      <h2 className="prose-h2">13. State privacy notices</h2>
      <p>
        Depending on where you live and whether a particular law applies to
        us, you may have rights to know, access, correct, delete, obtain a
        copy of, or opt out of certain processing of personal information.
        You may also have the right not to be discriminated against for
        exercising privacy rights.
      </p>
      <p>
        We do not currently sell personal information or share it for
        cross-context behavioral advertising. We will honor legally
        required opt-out signals if and when applicable to us and
        technically feasible for the relevant processing.
      </p>

      <h3 className="prose-h3">13.1 California notice</h3>
      <p>
        To the extent the California Consumer Privacy Act or similar
        California privacy laws apply, California residents may have rights
        to know, access, delete, correct, opt out of sale or sharing, limit
        certain uses of sensitive personal information, and not be
        discriminated against for exercising those rights.
      </p>
      <p>The categories of personal information we may collect include:</p>
      <ul className="prose-list">
        <li>identifiers, such as email address, account ID, public name, or IP address;</li>
        <li>internet or electronic network activity, such as log data and usage records;</li>
        <li>user-generated content and communications;</li>
        <li>inferences or scores derived from activity, such as aggregated voting or trust/integrity signals;</li>
        <li>publicly available information and news-derived information about profile subjects;</li>
        <li>
          sensitive personal information only to the limited extent account
          credentials or verification information fall within that
          category.
        </li>
      </ul>
      <p>
        We do not use sensitive personal information to infer
        characteristics about registered users. We do not sell or share
        personal information for cross-context behavioral advertising.
      </p>

      <h3 className="prose-h3">13.2 Colorado notice</h3>
      <p>
        To the extent the Colorado Privacy Act applies, Colorado residents
        may have rights to access, correct, delete, obtain a portable copy
        of personal data, and opt out of certain processing such as
        targeted advertising, sale of personal data, or profiling that
        produces legal or similarly significant effects.
      </p>
      <p>
        We do not currently sell personal data, use targeted advertising, or
        use the Service to make legal or similarly significant decisions
        about registered users. Giving scores and public profiles
        are public-interest editorial and informational content, not
        eligibility decisions for credit, employment, housing, insurance,
        lending, education, criminal justice, or essential services.
      </p>

      <h2 className="prose-h2">14. Children&rsquo;s privacy</h2>
      <p>
        The Service is not directed to children under 13. Children under 13
        may not use the Service, create accounts, submit comments, vote,
        propose people, or provide personal information. Users under 18 may
        not create accounts or submit content.
      </p>
      <p>
        If you believe a child under 13 has provided personal information to
        us, contact{" "}
        <a href="mailto:hello@skylarkcreations.com">
          hello@skylarkcreations.com
        </a>
        . If we learn that we have collected personal information from a
        child under 13 without legally required consent, we will take
        appropriate steps to delete it or otherwise comply with applicable
        law.
      </p>

      <h2 className="prose-h2">15. Security</h2>
      <p>
        We use reasonable administrative, technical, and organizational
        measures designed to protect information. No website, database,
        transmission, hosting environment, authentication system, or AI
        provider can be guaranteed secure.
      </p>
      <p>
        You are responsible for using a strong, unique password; protecting
        your login credentials; keeping your devices secure; and notifying
        us promptly of suspected unauthorized access.
      </p>

      <h2 className="prose-h2">16. Data breach notice</h2>
      <p>
        If we determine that a security incident requires notice under
        applicable law, we will provide notice as required by law. We may
        also take steps such as resetting passwords, disabling sessions,
        limiting access, investigating the issue, or notifying service
        providers.
      </p>

      <h2 className="prose-h2">17. Do Not Track and global privacy controls</h2>
      <p>
        Some browsers send &ldquo;Do Not Track&rdquo; signals. There is no
        single industry-standard response to Do Not Track signals. Because
        we do not currently sell personal information or share it for
        cross-context behavioral advertising, we do not treat Do Not Track
        differently from other requests at this time.
      </p>
      <p>
        Where legally required and technically feasible, we will treat
        recognized global privacy control signals as opt-out requests for
        applicable sale, sharing, or targeted-advertising processing. We do
        not currently engage in those activities.
      </p>

      <h2 className="prose-h2">18. Third-party links and sources</h2>
      <p>
        The Service links to news sites, government databases, public APIs,
        source documents, and other third-party websites. We do not control
        those third parties, and their privacy practices are governed by
        their own policies.
      </p>

      <h2 className="prose-h2">19. Changes to this Policy</h2>
      <p>
        We may update this Policy from time to time. The &ldquo;Effective
        date&rdquo; above shows when this Policy was last updated. If
        changes are material, we may provide additional notice, such as by
        posting a notice on the Service or emailing registered users where
        appropriate.
      </p>
      <p>Your continued use of the Service after an updated Policy takes effect means the updated Policy applies going forward.</p>

      <h2 className="prose-h2">20. Contact</h2>
      <p>Privacy questions, requests, correction requests, and legal notices may be sent to:</p>
      <p>
        Skylark Creations LLC
        <br />
        1500 N Grant St, Ste R
        <br />
        Denver, CO 80203
        <br />
        <a href="mailto:hello@skylarkcreations.com">
          hello@skylarkcreations.com
        </a>
      </p>

      <p className="prose-meta">
        See also our <a href="/terms">Terms of Service</a>.
      </p>
    </div>
  );
}
