export type TransparencyNote = Readonly<{
  label: string;
  text: string;
  tone: "information" | "caution";
}>;

export type TransparencySection = Readonly<{
  id: string;
  eyebrow: string;
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
  note?: TransparencyNote;
}>;

export type TransparencyStatusItem = Readonly<{
  title: string;
  detail: string;
}>;

export type TransparencyContent = Readonly<{
  eyebrow: string;
  pageTitle: string;
  introduction: string;
  sections: readonly TransparencySection[];
  currentBuild: Readonly<{
    id: string;
    eyebrow: string;
    title: string;
    introduction: string;
    enabled: readonly TransparencyStatusItem[];
    notEnabled: readonly TransparencyStatusItem[];
  }>;
  tenantSpecific: Readonly<{
    id: string;
    eyebrow: string;
    title: string;
    text: string;
  }>;
  closing: string;
}>;

/**
 * Platform-level transparency copy for the current build. A future reviewed
 * Tenant deployment may provide narrow local disclosures through this typed
 * shape; this module intentionally is not a CMS or a Tenant selector.
 */
export const transparencyContent = {
  eyebrow: "Student transparency",
  pageTitle: "What CampusHub does with information",
  introduction:
    "CampusHub is the digital home of student life. This page explains, in plain language, what the product may hold, who may see it, and what is or is not enabled in this build.",
  sections: [
    {
      id: "what-campus-hub-is",
      eyebrow: "Start here",
      title: "What CampusHub is",
      paragraphs: [
        "CampusHub brings campus information and participation into one trusted place. It is designed to help students find useful campus updates, understand who is allowed to act on them, and take part when a feature has completed its required review.",
        "It is not a student directory, an academic-results system, a general chat service, or an advertising technology platform.",
      ],
    },
    {
      id: "information-we-may-hold",
      eyebrow: "Your information",
      title: "What information CampusHub may hold",
      paragraphs: [
        "Depending on the features your university enables, CampusHub may hold the following categories of information:",
        "Some categories are conditional or future work. Seeing a category on this list does not mean that it is active for every university or in this build.",
      ],
      bullets: [
        "Account and security information when the reviewed Auth features are enabled.",
        "Tenant Membership and the campus, programme, year, or residence affiliation that applies to that Membership.",
        "Verification evidence and its provenance where a reviewed verification process requires it.",
        "Participation information for features that are enabled and have completed their required review.",
        "Security and audit records needed to protect the service and record privileged actions.",
        "Preferences and settings where the relevant feature supports them.",
      ],
    },
    {
      id: "guild-visibility",
      eyebrow: "Visibility",
      title: "What your Guild can see",
      paragraphs: [
        "Guild administrators and other Guild roles can see information needed for authorised Tenant work, and only within the roles and capabilities configured for that Tenant.",
        "Tenant boundaries are part of the product design. A Guild cannot use CampusHub to browse another university's information or a cross-Tenant behavioural history.",
      ],
      bullets: [
        "Guild access does not include passwords or secret authentication credentials.",
        "The product does not provide a view of an individual student's Poll answer.",
        "Student Voice identity is not exposed to peers by default; any future authorised moderator access is separately governed and audited.",
      ],
    },
    {
      id: "university-visibility",
      eyebrow: "Institutional access",
      title: "What the university can see",
      paragraphs: [
        "University access is constrained by the roles and capabilities explicitly configured and approved for the Tenant. It is not a general surveillance view.",
        "The exact authority for some privileged non-student roles remains an open product decision. This page does not create a University Official dashboard or promise access that has not been approved.",
      ],
    },
    {
      id: "sponsor-visibility",
      eyebrow: "Sponsors",
      title: "What sponsors can see",
      paragraphs: [
        "CampusHub is not an ad-tech platform. Sponsors do not receive personal student data, and behavioural targeting is prohibited.",
        "Sponsorship is not enabled in this build. The product's unresolved sponsorship audience question remains open, so this page does not promise a verified-student audience or any sponsor access to student records.",
      ],
    },
    {
      id: "poll-privacy",
      eyebrow: "Polls",
      title: "Poll privacy status",
      paragraphs: [
        "Polls are not yet enabled in this build. CampusHub will not launch Poll participation until its privacy and storage design has completed the required review.",
        "The final Poll privacy wording will be published only after the A1 design review and must match what the reviewed system actually delivers. This page does not promise a particular identity or ballot-linkage outcome.",
      ],
      note: {
        label: "Current status",
        text: "A1/OD-11 remains unresolved; no Poll participation or Poll storage is available here.",
        tone: "caution",
      },
    },
    {
      id: "student-voice-privacy",
      eyebrow: "Student Voice",
      title: "Student Voice privacy status",
      paragraphs: [
        "Student Voice is not enabled in this build. Its future activation requires the relevant readiness, moderation, safety, and identity-access reviews.",
        "In a future reviewed configuration, Student Voice is intended to be pseudonymous to peers, with separately governed access for authorised moderators. That is planned behaviour, not a current feature guarantee.",
      ],
      note: {
        label: "Current status",
        text: "Student Voice is disabled here; no submission, moderation, or identity-access workflow is available.",
        tone: "caution",
      },
    },
    {
      id: "audit-history",
      eyebrow: "Accountability",
      title: "Audit history",
      paragraphs: [
        "Privileged actions in supported governance paths are recorded in an immutable audit history. That history helps show what happened and who was authorised to act.",
        "Immutable audit history does not mean that harmful public content must stay publicly visible forever. Public content can be restricted, redacted, or removed through governed processes while the permitted audit fact remains protected.",
        "This page describes the product principle, not technical signing or storage details.",
      ],
    },
    {
      id: "retention-and-removal",
      eyebrow: "Keeping and removing information",
      title: "Retention and removal",
      paragraphs: [
        "CampusHub follows a minimisation principle: collect what is needed for a legitimate purpose, and keep it only for as long as that purpose and applicable obligations require.",
        "Specific legal retention periods, deletion procedures, and related lifecycle choices are not decided by this page. They remain product, privacy, and legal work before a real Pilot.",
      ],
      bullets: [
        "Public access can be stopped or narrowed through an approved content process.",
        "Redaction prevents future authorised access to the affected content through the reviewed paths.",
        "A copy already downloaded to someone else's unmanaged device cannot be remotely erased by CampusHub.",
      ],
    },
    {
      id: "your-data-rights",
      eyebrow: "Your choices",
      title: "Your data rights",
      paragraphs: [
        "Depending on where you live and how your university operates, you may have rights such as access, correction, deletion or closure where applicable, and the ability to ask questions or make a complaint.",
        "Formal request workflows will be published before the first real CampusHub Pilot. This build does not offer a self-service export, correction, or deletion workflow, and this page is not a final legal rights notice.",
        "When a live deployment publishes a request path, use that path to ask what information is held about you, request a correction, or ask how a removal or complaint will be handled. Do not send passwords or secret credentials in a request.",
      ],
    },
  ],
  currentBuild: {
    id: "current-build",
    eyebrow: "Be clear about today",
    title: "What is enabled in this build",
    introduction:
      "The items below describe the implementation foundation present today. They do not mean that a real university Pilot has launched or that every future product contract is ready.",
    enabled: [
      {
        title: "Tenant-separated foundation",
        detail:
          "Tenant, Membership, hierarchy, and Tenant-safe data boundaries are present in the production foundation.",
      },
      {
        title: "Publications and authorised reads",
        detail:
          "The Publication foundation supports governed persistence, audience rules, and authorised direct and collection reads.",
      },
      {
        title: "Campus Home Publication experience",
        detail:
          "The reviewed Home slice presents authorised campus notices and news, with detail reauthorization and bounded pagination.",
      },
      {
        title: "Immutable audit foundation",
        detail:
          "The reviewed audit foundation records supported privileged events with append-only and tamper-evidence controls.",
      },
    ],
    notEnabled: [
      {
        title: "Real account registration and login",
        detail:
          "Auth, verified contact channels, sessions, MFA, and account recovery are not enabled in this build.",
      },
      {
        title: "Poll participation",
        detail:
          "Polls remain blocked by the unresolved A1/OD-11 privacy and storage review.",
      },
      {
        title: "Student Voice and sponsorship",
        detail:
          "These modules are future or disabled; no live Voice or sponsor workflow is promised here.",
      },
      {
        title: "Real roster onboarding and self-service data-rights workflows",
        detail:
          "Roster onboarding and the CH-PRV access, correction, deletion, and export workflows are not enabled.",
      },
    ],
  },
  tenantSpecific: {
    id: "tenant-specific-details",
    eyebrow: "For a future deployment",
    title: "Tenant-specific details",
    text: "A reviewed Tenant deployment may later add local names, enabled-module status, and approved disclosure details. This platform page does not invent a public Tenant selector, choose a university, or expose internal Tenant records.",
  },
  closing:
    "Questions about a live CampusHub deployment should use the request path published by that deployment. Formal privacy and legal review remains a requirement before real student contact data is processed in a Pilot or production environment.",
} as const satisfies TransparencyContent;
