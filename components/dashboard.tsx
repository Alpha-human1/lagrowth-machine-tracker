"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Campaign } from "@/src/lib/lgm-api";
import type { SafeClient } from "@/src/lib/clients-store";
import { AuthPortal, type AppUser, type AuthScreenMode } from "@/components/auth-portal";
import { TeamAccessModal } from "@/components/team-access-modal";

type EngagementStats = {
  campaignId?: string;
  audienceSize?: number;
  completed?: number;
  started?: number;
  skipped?: number;
  replies?: {
    contacted?: number;
    replied?: number;
    emailContacted?: number;
    linkedinContacted?: number;
    emailReplied?: number;
    linkedinReplied?: number;
    totalReplyPercent?: number;
    contactedReplyPercent?: number;
  };
  relations?: { requestSent?: number; relations?: number; newRelations?: number; alreadyConnected?: number };
  channel?: {
    email?: { activated?: boolean; sent?: number; opened?: number; replied?: number; clicked?: number; bounced?: number; openedPercent?: number; repliedPercent?: number };
    linkedin?: { activated?: boolean; contactRequest?: { sent?: number; newRelations?: number }; message?: { sent?: number; replied?: number } };
    twitter?: { activated?: boolean; sent?: number; followed?: number; followBack?: number };
    enrich?: { activated?: boolean; enriched?: number };
    call?: { activated?: boolean; contacted?: number; won?: number };
  };
  status?: {
    activated?: { total?: number; activated?: number; contacted?: number; completed?: number; outOfOffice?: number; notActivated?: number };
    replied?: { total?: number; toQualify?: number; wrongTiming?: number; toReview?: number; toCall?: number; inviteNote?: number; customMessage?: number };
    won?: { total?: number; interested?: number; callBooked?: number; negotiating?: number; readyToBuy?: number; converted?: number };
    lost?: { total?: number; wrongTarget?: number; notInterested?: number; alreadyEquipped?: number; unsubscribed?: number };
  };
  templates?: Array<{
    sent?: number;
    opened?: number;
    clicked?: number;
    replied?: number;
    bounced?: number;
    won?: number;
    openedPercent?: number;
    clickedPercent?: number;
    repliedPercent?: number;
    channel?: string;
    name?: string;
    templateId?: string;
    position?: number;
  }>;
  objective?: string | null;
};

type CampaignStep = { stepId?: string; type?: string; channel?: string; position?: number; hasMessage?: boolean; templateId?: string | null; templateName?: string | null };
type CampaignStatsResponse = { engagementStats?: EngagementStats; steps?: CampaignStep[]; statusCode?: number; [key: string]: unknown };
type ReportingPeriod = "week" | "month";

type ClientInsightsMetrics = { audience: number; connections: number; linkedinReplies: number; emailReplies: number; conversions: number };
type ClientInsightsResponse = {
  metrics: ClientInsightsMetrics;
  currentPeriod: ClientInsightsMetrics | null;
  previousPeriod: ClientInsightsMetrics | null;
  currentBaselineAt: number | null;
  currentBaselineIsPartial: boolean;
  historyStartedAt: number;
  sampledAt: number;
  campaignCount: number;
  note: string;
};

const numberFormat = new Intl.NumberFormat("en-US");

function formatCount(value?: number) {
  return numberFormat.format(Number.isFinite(value) ? Number(value) : 0);
}

function formatPercent(value?: number) {
  return `${(Number.isFinite(value) ? Number(value) : 0).toFixed(2)}%`;
}

function ratioPercent(numerator?: number, denominator?: number) {
  return Number(denominator) > 0 ? formatPercent((100 * (Number(numerator) || 0)) / Number(denominator)) : "—";
}

function periodBounds(period: ReportingPeriod) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else {
    start.setDate(1);
  }
  const previous = new Date(start);
  if (period === "week") previous.setDate(previous.getDate() - 7);
  else previous.setMonth(previous.getMonth() - 1);
  return { from: start.getTime(), to: now.getTime(), currentStart: start.getTime(), previousStart: previous.getTime() };
}

function channelName(channel?: string) {
  const normalized = channel?.toUpperCase() ?? "";
  if (normalized === "GOOGLE" || normalized === "EMAIL") return "Email";
  if (normalized === "LINKEDIN") return "LinkedIn";
  if (normalized === "TWITTER") return "X";
  return normalized || "Message";
}

function campaignStatus(status?: string) {
  const normalized = status?.toUpperCase() ?? "";
  if (normalized === "RUNNING") return { label: "Running", className: "running" };
  if (normalized === "PAUSED") return { label: "Paused", className: "paused" };
  if (normalized === "READY") return { label: "Draft", className: "ready" };
  return { label: normalized === "CANCELED" ? "Canceled" : "Inactive", className: "other" };
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "LG";
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const shapes: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6.2L20 12M4 12l2 5.8A7 7 0 0 0 18.4 15"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.3 4.3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.3a1.7 1.7 0 1 1-3.4 0v-.2A1.7 1.7 0 0 0 8 17.1l-.2.2a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2A1.7 1.7 0 0 0 5.4 6l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2A1.7 1.7 0 0 0 17 3.4l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.3a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.3 2.9Z"/></>,
    lock: <><rect x="4.5" y="10" width="15" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    linkedin: <><path d="M5 9v10M5 5v.01M10 19v-6a3 3 0 0 1 6 0v6M10 10v9M3 3h18v18H3z"/></>,
    chart: <><path d="M4 19V5M4 19h17M8 15l4-4 3 2 5-7"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V20"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    chevron: <><path d="m9 18 6-6-6-6"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
    moon: <><path d="M20.8 14.2A8.7 8.7 0 0 1 9.8 3.2 8.8 8.8 0 1 0 20.8 14.2Z"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
  };
  return <svg {...common}>{shapes[name] ?? shapes.grid}</svg>;
}

function EmptyState({ onAdd, onManageTeam }: { onAdd: () => void; onManageTeam: () => void }) {
  return (
    <div className="onboarding">
      <header className="onboarding-heading">
        <div>
          <span className="eyebrow">GET STARTED</span>
          <h2>Your dashboard starts here.</h2>
          <p>Connect a La Growth Machine account to bring campaign performance into one clear view.</p>
        </div>
        <span className="connection-status"><i /> READY TO CONNECT</span>
      </header>
      <div className="onboarding-body">
        <section className="connect-card">
          <div className="connect-visual" aria-hidden="true">
            <div className="visual-orbit orbit-a" /><div className="visual-orbit orbit-b" />
            <div className="visual-window">
              <div className="visual-window-top"><i /><i /><i /><span /></div>
              <div className="visual-chart"><b /><b /><b /><b /><b /><b /><b /></div>
              <div className="visual-window-foot"><span /><i /><i /></div>
            </div>
            <span className="visual-lock"><Icon name="lock" size={17} /></span>
          </div>
          <div className="connect-copy">
            <span className="eyebrow">STEP 01 <i className="eyebrow-dot" /> CONNECT</span>
            <h3>Add your first account</h3>
            <p>Choose a name for the client, then enter its API key in the secure form. We’ll verify the key before saving it.</p>
            <div className="connect-actions"><button className="button primary large" onClick={onAdd}><Icon name="plus" size={17} /> Connect first account</button><button className="button quiet invite-teammates-button" onClick={onManageTeam}>Invite teammates</button></div>
            <div className="connect-caption"><Icon name="lock" size={14} /> Key encrypted before storage</div>
          </div>
        </section>
        <aside className="steps-card">
          <span className="eyebrow">WHAT HAPPENS NEXT</span>
          <ol className="setup-steps">
            <li><span>1</span><div><b>Name the account</b><p>Use any label that makes sense to you.</p></div></li>
            <li><span>2</span><div><b>Review campaigns</b><p>See campaign status, audience and reply rates.</p></div></li>
            <li><span>3</span><div><b>Open campaign stats</b><p>Explore channel, lead and message metrics.</p></div></li>
          </ol>
          <div className="security-note"><Icon name="lock" size={16} /><p>Your key is checked with La Growth Machine, then encrypted before it is saved.</p></div>
        </aside>
      </div>
    </div>
  );
}

function ClientModal({ client, onClose, onSaved }: { client?: SafeClient; onClose: () => void; onSaved: (client: SafeClient) => void }) {
  const [name, setName] = useState(client?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(client ? `/api/clients/${client.id}` : "/api/clients", {
        method: client ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...(apiKey ? { apiKey } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The client could not be saved.");
      setApiKey("");
      onSaved(data.client as SafeClient);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The client could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="client-modal-title">
        <div className="modal-head">
          <div><span className="eyebrow">CLIENT ACCOUNT</span><h2 id="client-modal-title">{client ? "Edit client" : "Connect an account"}</h2></div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button>
        </div>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="client-name">Client name</label>
          <input id="client-name" className="text-field" autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme Studio" required />
          <label className="field-label key-label" htmlFor="client-key">La Growth Machine API key <span>{client ? "OPTIONAL TO REPLACE" : "REQUIRED"}</span></label>
          <input id="client-key" className="text-field" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={client ? "Leave blank to keep the saved key" : "Paste the API key from LGM"} required={!client} />
          <div className="secure-hint"><Icon name="lock" size={15} /><span>Your key is checked with La Growth Machine, then encrypted before it is saved. It is never shown again.</span></div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="modal-actions"><button type="button" className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !name.trim() || (!client && !apiKey.trim())}>{saving ? <><span className="spinner small" /> Checking key…</> : client ? "Save changes" : "Connect account"}</button></div>
        </form>
      </section>
    </div>
  );
}

function LoadingSkeleton() {
  return <div className="skeleton-list" aria-label="Loading campaigns"><div className="skeleton wide" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
}

type CampaignReply = {
  id: string;
  leadId: string;
  name: string;
  company: string;
  jobTitle: string;
  linkedinUrl: string;
  message: string;
  createdAt: string | null;
  referralSignal: "referral" | "none" | "review";
};

function CampaignDetail({ campaign, clientId, stats, loading, error, replyFrom, periodLabel }: { campaign: Campaign; clientId: string; stats: CampaignStatsResponse | null; loading: boolean; error: string; replyFrom: number; periodLabel: string }) {
  const engagement = stats?.engagementStats;
  const replies = engagement?.replies;
  const relations = engagement?.relations;
  const status = campaignStatus(campaign.status);
  const [showReplies, setShowReplies] = useState(false);
  const [replyRows, setReplyRows] = useState<CampaignReply[]>([]);
  const [replyCursor, setReplyCursor] = useState<string | null>(null);
  const [replyTotal, setReplyTotal] = useState(0);
  const [replyHasMore, setReplyHasMore] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replyLoaded, setReplyLoaded] = useState(false);

  async function loadReplies(cursor?: string | null) {
    setReplyLoading(true);
    setReplyError("");
    try {
      const params = new URLSearchParams({ from: String(replyFrom) });
      if (cursor) params.set("cursor", cursor);
      const suffix = `?${params.toString()}`;
      const response = await fetch(`/api/clients/${clientId}/campaigns/${campaign.id}/replies${suffix}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Replies could not be loaded.");
      setReplyRows((current) => {
        const byLead = new Map(current.map((item) => [item.leadId, item]));
        for (const item of data.replies as CampaignReply[]) byLead.set(item.leadId, item);
        return [...byLead.values()];
      });
      setReplyCursor(data.nextCursor ?? null);
      setReplyTotal(Number(data.total) || 0);
      setReplyHasMore(Boolean(data.hasMore));
      setReplyLoaded(true);
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : "Replies could not be loaded.");
    } finally {
      setReplyLoading(false);
    }
  }

  function toggleReplies() {
    const next = !showReplies;
    setShowReplies(next);
    if (next && !replyLoaded && !replyLoading) void loadReplies();
  }

  useEffect(() => {
    setReplyRows([]);
    setReplyCursor(null);
    setReplyTotal(0);
    setReplyHasMore(false);
    setReplyLoaded(false);
    setReplyError("");
    if (showReplies) void loadReplies();
    // The date window is intentionally part of this effect: changing the dashboard period refreshes the reply list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, campaign.id, replyFrom]);

  const referralCount = replyRows.filter((reply) => reply.referralSignal === "referral").length;
  const noReferralCount = replyRows.filter((reply) => reply.referralSignal === "none").length;
  const reviewCount = replyRows.filter((reply) => reply.referralSignal === "review").length;
  const newConnections = Number(relations?.newRelations) || 0;
  const linkedinReplies = Number(replies?.linkedinReplied) || 0;
  const linkedinRequestsSent = Number(relations?.requestSent ?? engagement?.channel?.linkedin?.contactRequest?.sent) || 0;
  const connectionRate = linkedinRequestsSent ? (100 * newConnections) / linkedinRequestsSent : 0;
  const connectionReplyRate = newConnections ? (100 * linkedinReplies) / newConnections : 0;
  const stepRows = (stats?.steps ?? [])
    .filter((step) => step.hasMessage !== false && Boolean(step.templateId || step.templateName))
    .slice()
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
    .map((step, index) => {
      const metric = engagement?.templates?.find((template) => Boolean(step.templateId) && template.templateId === step.templateId)
        ?? engagement?.templates?.find((template) => Boolean(step.templateName) && template.name === step.templateName)
        ?? null;
      return { step, metric, number: index + 1 };
    });

  return (
    <section className="detail-panel campaign-inline-detail">
      <div className="detail-heading">
        <div className="detail-heading-copy"><span className="eyebrow">{status.className === "running" ? "LIVE CAMPAIGN" : "CAMPAIGN DETAILS"}</span><h2>{campaign.name}</h2><div className="detail-meta"><span className={`status-pill ${status.className}`}><span />{status.label}</span><span>{campaign.channels?.filter((item) => item !== "LGM").map((item) => item === "GOOGLE" ? "Email" : item).join(" · ") || "Campaign"}</span></div></div>
      </div>
      {loading ? <div className="detail-loading"><span className="spinner" /> Pulling campaign stats…</div> : error ? <div className="inline-error"><span>!</span>{error}</div> : !engagement ? <div className="empty-campaign">No stats were returned for this campaign.</div> : <>
        <div className="funnel-strip" aria-label="Campaign conversion funnel">
          <div className="funnel-metric"><span>Total leads</span><b>{formatCount(engagement.audienceSize)}</b><small>Campaign audience</small></div>
          <span className="funnel-divider" aria-hidden="true">›</span>
          <div className="funnel-metric"><span>New LinkedIn connections</span><b>{formatCount(newConnections)}</b><small>{formatPercent(connectionRate)} connection rate</small></div>
          <span className="funnel-divider" aria-hidden="true">›</span>
          <button className={`funnel-metric reply-trigger ${showReplies ? "open" : ""}`} onClick={toggleReplies} aria-expanded={showReplies}>
            <span>LinkedIn replies</span><b>{formatCount(linkedinReplies)}</b><small>{formatPercent(connectionReplyRate)} reply rate from connections · {periodLabel} log</small>
          </button>
        </div>
        <details className="step-metrics-card">
          <summary><span><b>Message step conversions</b><small>See replies and leads converted at each sequence message</small></span><span className="step-summary-action">{stepRows.length ? `${stepRows.length} steps` : "No step data"}</span></summary>
          {stepRows.length > 0 ? <div className="template-table-wrap"><table className="template-table step-metrics-table"><thead><tr><th>SEQUENCE STEP</th><th>CHANNEL</th><th>SENT</th><th>REPLIED</th><th>REPLY RATE</th><th>CONVERTED AFTER STEP</th><th>CONVERSION RATE</th></tr></thead><tbody>{stepRows.map(({ step, metric, number }) => <tr key={step.stepId ?? step.templateId ?? `${campaign.id}-${number}`}>
            <td><span className="template-name"><i className="step-number">{number}</i><b>{metric?.name || step.templateName || `Step ${number}`}</b></span></td>
            <td>{channelName(step.channel)}</td><td>{formatCount(metric?.sent)}</td><td>{formatCount(metric?.replied)}</td><td>{ratioPercent(metric?.replied, metric?.sent)}</td><td><b>{formatCount(metric?.won)}</b></td><td>{ratioPercent(metric?.won, metric?.sent)}</td>
          </tr>)}</tbody></table><p className="step-metrics-note">Conversions use LGM’s per-message “won” attribution; an empty count means LGM returned no conversion for that message.</p></div> : <div className="template-empty muted-empty">LGM did not return message-step details for this campaign.</div>}
        </details>
        {showReplies && <section className="reply-insights" aria-label="LinkedIn reply breakdown">
          <div className="reply-insights-head"><div><span className="eyebrow">REPLY INSIGHT</span><h3>What people replied</h3></div><span className="reply-count-label">{replyLoaded ? `${formatCount(replyRows.length)} of ${formatCount(replyTotal)} conversations` : "LinkedIn replies"}</span></div>
          <p className="reply-method-note">Referral signals use simple wording matches. Read the message before treating one as a referral.</p>
          {replyRows.length > 0 && <div className="reply-signal-strip"><span className="reply-signal-scope">Among loaded replies</span><span><i className="signal referral" />Possible referral <b>{referralCount}</b></span><span><i className="signal none" />No referral wording <b>{noReferralCount}</b></span><span><i className="signal review" />Needs review <b>{reviewCount}</b></span></div>}
          {replyLoading && replyRows.length === 0 && <div className="reply-loading"><span className="spinner small" /> Reading recent replies…</div>}
          {replyError && <div className="inline-error"><span>!</span>{replyError}<button className="button quiet" onClick={() => void loadReplies(replyCursor)}>Retry</button></div>}
          {!replyLoading && !replyError && replyLoaded && replyRows.length === 0 && <div className="reply-empty">No recent LinkedIn reply messages were returned for this campaign.</div>}
          {replyRows.length > 0 && <div className="reply-list">{replyRows.map((reply) => <article className="reply-row" key={reply.leadId}>
            <div className="reply-person"><b>{reply.name}</b><span>{[reply.jobTitle, reply.company].filter(Boolean).join(" · ") || "Campaign lead"}</span></div>
            <span className={`referral-badge ${reply.referralSignal}`}>{reply.referralSignal === "referral" ? "Possible referral" : reply.referralSignal === "none" ? "No referral wording" : "Needs review"}</span>
            <p className="reply-message">{reply.message || "No reply text was available."}</p>
            {reply.linkedinUrl && <a className="reply-link" href={reply.linkedinUrl} target="_blank" rel="noreferrer">Open LinkedIn profile <Icon name="arrow" size={13} /></a>}
          </article>)}</div>}
          {replyHasMore && <button className="button quiet load-replies" disabled={replyLoading} onClick={() => void loadReplies(replyCursor)}>{replyLoading ? "Loading…" : "Load more replies"}</button>}
        </section>}
      </>}
    </section>
  );
}

type ActivityReply = {
  id: string;
  leadId: string;
  campaignId: string;
  campaignName: string;
  channel: "LINKEDIN" | "EMAIL";
  name: string;
  company: string;
  jobTitle: string;
  linkedinUrl: string;
  message: string;
  createdAt: string;
  referralSignal: "referral" | "none" | "review";
};

function metricForPeriod(metrics: ClientInsightsMetrics | null, key: "audience" | "connections" | "replies" | "conversions") {
  if (!metrics) return null;
  if (key === "replies") return metrics.linkedinReplies + metrics.emailReplies;
  return metrics[key];
}

function signedCount(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatCount(Math.abs(value))}`;
}

function ClientReplyActivity({ clientId, period }: { clientId: string; period: ReportingPeriod }) {
  const bounds = periodBounds(period);
  const from = bounds.from;
  const [rows, setRows] = useState<ActivityReply[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [syncedAt, setSyncedAt] = useState("");
  const lastSyncAt = useRef(0);
  const requestInFlight = useRef(false);

  const syncReplies = useCallback(async (searchAfter: string | null = null, append = false, automatic = false) => {
    if (requestInFlight.current) return;
    if (automatic && Date.now() - lastSyncAt.current < 60 * 60 * 1000) return;
    requestInFlight.current = true;
    lastSyncAt.current = Date.now();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from: String(from), to: String(Date.now()) });
      if (searchAfter) params.set("cursor", searchAfter);
      const response = await fetch(`/api/clients/${clientId}/replies?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Replies could not be synced.");
      const incoming = Array.isArray(data.replies) ? data.replies as ActivityReply[] : [];
      setRows((current) => {
        if (!append) return incoming;
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of incoming) byId.set(item.id, item);
        return [...byId.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      });
      setCursor(data.nextCursor ?? null);
      setHasMore(Boolean(data.hasMore));
      setSyncedAt(data.syncedAt || new Date().toISOString());
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Replies could not be synced.");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [clientId, from]);

  useEffect(() => {
    setRows([]);
    setLoaded(false);
    setCursor(null);
    setHasMore(false);
    setSyncedAt("");
    void syncReplies(null, false, true);
    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") void syncReplies(null, true, true);
    };
    document.addEventListener("visibilitychange", syncWhenVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncReplies(null, true, true);
    }, 60 * 60 * 1000);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, [syncReplies]);

  const periodLabel = period === "week" ? "this week" : "this month";
  const referralCount = rows.filter((reply) => reply.referralSignal === "referral").length;
  return <section className="client-reply-activity">
    <button className="reply-activity-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <span><b>Replies</b><small>{loaded ? `${formatCount(rows.length)} ${periodLabel}` : `Syncing ${periodLabel} replies`}</small></span>
      <span className="reply-activity-right">{syncedAt && <small>Synced {new Date(syncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>}<i className={expanded ? "expanded" : ""}><Icon name="chevron" size={14} /></i></span>
    </button>
    {expanded && <div className="reply-activity-body">
      <div className="reply-activity-toolbar"><span>{rows.length ? `${formatCount(referralCount)} possible referral signals · review message context` : "Newest replies from this client’s campaigns"}</span><button className="button quiet" disabled={loading} onClick={() => void syncReplies(null, false)}>{loading ? "Syncing…" : "Sync now"}</button></div>
      {error && <div className="inline-error"><span>!</span>{error}<button className="button quiet" onClick={() => void syncReplies(null, false)}>Retry</button></div>}
      {loading && rows.length === 0 && <div className="reply-loading"><span className="spinner small" /> Reading recent replies…</div>}
      {!loading && loaded && rows.length === 0 && !error && <div className="reply-empty">No replies were found in {periodLabel}.</div>}
      {rows.length > 0 && <div className="reply-list">{rows.map((reply) => <article className="reply-row activity-reply-row" key={reply.id}>
        <div className="reply-person"><b>{reply.name}</b><span>{[reply.jobTitle, reply.company].filter(Boolean).join(" · ") || "Campaign lead"}</span><small>{reply.campaignName} · {channelName(reply.channel)} · {new Date(reply.createdAt).toLocaleString()}</small></div>
        <span className={`referral-badge ${reply.referralSignal}`}>{reply.referralSignal === "referral" ? "Possible referral" : reply.referralSignal === "none" ? "No referral wording" : "Needs review"}</span>
        <p className="reply-message">{reply.message || "No reply text was available."}</p>
        {reply.linkedinUrl && <a className="reply-link" href={reply.linkedinUrl} target="_blank" rel="noreferrer">Open LinkedIn profile <Icon name="arrow" size={13} /></a>}
      </article>)}</div>}
      {hasMore && <button className="button quiet load-replies" disabled={loading} onClick={() => void syncReplies(cursor, true)}>{loading ? "Loading…" : "Load more replies"}</button>}
    </div>}
  </section>;
}

function ClientInsights({ clientId, period, onPeriodChange }: { clientId: string; period: ReportingPeriod; onPeriodChange: (period: ReportingPeriod) => void }) {
  const bounds = periodBounds(period);
  const [insights, setInsights] = useState<ClientInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const lastSyncAt = useRef(0);
  const rangeName = period === "week" ? "week" : "month";
  const previousName = period === "week" ? "last week (same days)" : "last month (same dates)";

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    const load = async (automatic = false) => {
      if (requestInFlight) return;
      if (automatic && Date.now() - lastSyncAt.current < 60 * 60 * 1000) return;
      requestInFlight = true;
      lastSyncAt.current = Date.now();
      setLoading(true);
      setError("");
      setInsights(null);
      try {
        const params = new URLSearchParams({ period, currentStart: String(bounds.currentStart), previousStart: String(bounds.previousStart) });
        const response = await fetch(`/api/clients/${clientId}/insights?${params.toString()}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Client insights could not be loaded.");
        if (active) setInsights(data as ClientInsightsResponse);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Client insights could not be loaded.");
      } finally {
        requestInFlight = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", syncWhenVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, [clientId, period, bounds.currentStart, bounds.previousStart, refreshVersion]);

  const cards: Array<{ key: "audience" | "connections" | "replies" | "conversions"; label: string; allTime: number | null }> = [
    { key: "audience", label: "Leads added", allTime: insights?.metrics.audience ?? null },
    { key: "connections", label: "LinkedIn connections", allTime: insights?.metrics.connections ?? null },
    { key: "replies", label: "Replies", allTime: insights ? insights.metrics.linkedinReplies + insights.metrics.emailReplies : null },
    { key: "conversions", label: "Converted leads", allTime: insights?.metrics.conversions ?? null },
  ];
  const current = insights?.currentPeriod ?? null;
  const previous = insights?.previousPeriod ?? null;

  return <>
    <section className="client-insights-panel" aria-label="Client performance overview">
      <div className="insights-heading">
        <div><span className="eyebrow">CLIENT PERFORMANCE</span><h2>Period overview</h2><p>{period === "week" ? "This week so far vs the same days last week" : "This month so far vs the same dates last month"}</p></div>
        <div className="insights-actions"><div className="period-switch" role="group" aria-label="Choose date range"><button className={period === "week" ? "active" : ""} aria-pressed={period === "week"} onClick={() => onPeriodChange("week")}>Week</button><button className={period === "month" ? "active" : ""} aria-pressed={period === "month"} onClick={() => onPeriodChange("month")}>Month</button></div><button className="button outline insights-refresh" onClick={() => setRefreshVersion((version) => version + 1)} disabled={loading}><Icon name="refresh" size={15} />{loading ? "Syncing…" : "Sync profile"}</button></div>
      </div>
      {error ? <div className="inline-error"><span>!</span>{error}<button className="button quiet" onClick={() => setRefreshVersion((version) => version + 1)}>Try again</button></div> : <div className="insights-grid">{cards.map((card) => {
        const periodValue = metricForPeriod(current, card.key);
        const previousValue = metricForPeriod(previous, card.key);
        const delta = periodValue !== null && previousValue !== null ? periodValue - previousValue : null;
        return <article className="insight-card" key={card.key}>
          <span className="insight-card-label">{card.label}</span>
          <b className="insight-period-value">{loading && !insights ? "…" : periodValue === null ? "—" : signedCount(periodValue)}</b>
          <small className="insight-card-period">{periodValue === null ? "Waiting for a saved baseline" : insights?.currentBaselineIsPartial ? `Since tracking began ${new Date(insights.currentBaselineAt ?? 0).toLocaleDateString()}` : `During this ${rangeName}`}</small>
          <span className={`insight-comparison ${delta !== null && delta > 0 ? "positive" : delta !== null && delta < 0 ? "negative" : ""}`}>{delta === null ? "Comparison builds after more history" : `${signedCount(delta)} vs ${previousName}`}</span>
          <small className="insight-card-total">{card.allTime === null ? "Lifetime total unavailable" : card.key === "replies" && insights ? `All time · LinkedIn ${formatCount(insights.metrics.linkedinReplies)} · Email ${formatCount(insights.metrics.emailReplies)}` : `Campaign total ${formatCount(card.allTime)}`}</small>
        </article>;
      })}</div>}
      {insights && <div className="insights-footnote"><span>Tracking since {new Date(insights.historyStartedAt).toLocaleDateString()} · comparisons use saved snapshots</span><span>{insights.note}</span></div>}
    </section>
    <ClientReplyActivity key={`${clientId}-${period}`} clientId={clientId} period={period} />
  </>;
}

function CampaignDashboard({ currentUser, onLogout }: { currentUser: AppUser; onLogout: () => void }) {
  const isAdmin = currentUser.role === "admin";
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [clients, setClients] = useState<SafeClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [totalCampaigns, setTotalCampaigns] = useState(0);
  const [inactiveCampaigns, setInactiveCampaigns] = useState<Campaign[]>([]);
  const [inactiveTotal, setInactiveTotal] = useState(0);
  const [inactiveLoaded, setInactiveLoaded] = useState(false);
  const [inactiveLoading, setInactiveLoading] = useState(false);
  const [inactiveError, setInactiveError] = useState("");
  const [showInactiveCampaigns, setShowInactiveCampaigns] = useState(false);
  const [period, setPeriod] = useState<ReportingPeriod>("week");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [stats, setStats] = useState<CampaignStatsResponse | null>(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [campaignError, setCampaignError] = useState("");
  const [statsError, setStatsError] = useState("");
  const [lastSynced, setLastSynced] = useState("");
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [teamModal, setTeamModal] = useState(false);
  const [query, setQuery] = useState("");
  const statsRequestId = useRef(0);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("lagrowth-machine-tracker-theme")
      ?? window.localStorage.getItem("lagrove-machine-tracker-theme");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem("lagrowth-machine-tracker-theme", next);
      return next;
    });
  }

  const selectedClient = clients.find((client) => client.id === selectedClientId);
  const selectedPeriodBounds = periodBounds(period);
  const campaignsForView = showInactiveCampaigns ? inactiveCampaigns : campaigns;
  const currentCampaignTotal = showInactiveCampaigns ? inactiveTotal : totalCampaigns;
  const currentCampaignsLoading = showInactiveCampaigns ? inactiveLoading : campaignsLoading;
  const currentCampaignError = showInactiveCampaigns ? inactiveError : campaignError;
  const visibleCampaigns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? campaignsForView.filter((campaign) => campaign.name.toLowerCase().includes(needle)) : campaignsForView;
  }, [campaignsForView, query]);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const response = await fetch("/api/clients", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Clients could not be loaded.");
      const loaded = data.clients as SafeClient[];
      setClients(loaded);
      setSelectedClientId((current) => loaded.some((client) => client.id === current) ? current : loaded[0]?.id ?? "");
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : "Clients could not be loaded.");
    } finally {
      setClientsLoading(false);
    }
  }, []);

  useEffect(() => { void loadClients(); }, [loadClients]);

  const loadCampaigns = useCallback(async (clientId: string) => {
    if (!clientId) return;
    setCampaignsLoading(true);
    setCampaignError("");
    setStats(null);
    setSelectedCampaignId("");
    try {
      const response = await fetch(`/api/clients/${clientId}/campaigns`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Campaigns could not be loaded.");
      setCampaigns(data.campaigns as Campaign[]);
      setTotalCampaigns(Number(data.total) || 0);
      setLastSynced(data.fetchedAt || new Date().toISOString());
    } catch (error) {
      setCampaigns([]);
      setTotalCampaigns(0);
      setCampaignError(error instanceof Error ? error.message : "Campaigns could not be loaded.");
    } finally {
      setCampaignsLoading(false);
    }
  }, []);

  const loadInactiveCampaigns = useCallback(async (clientId: string) => {
    if (!clientId) return;
    setInactiveLoading(true);
    setInactiveError("");
    setStats(null);
    setSelectedCampaignId("");
    try {
      const response = await fetch(`/api/clients/${clientId}/campaigns?scope=inactive`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Inactive campaigns could not be loaded.");
      setInactiveCampaigns(data.campaigns as Campaign[]);
      setInactiveTotal(Number(data.total) || 0);
      setInactiveLoaded(true);
      setLastSynced(data.fetchedAt || new Date().toISOString());
    } catch (error) {
      setInactiveCampaigns([]);
      setInactiveTotal(0);
      setInactiveError(error instanceof Error ? error.message : "Inactive campaigns could not be loaded.");
    } finally {
      setInactiveLoading(false);
    }
  }, []);

  function openInactiveCampaigns() {
    statsRequestId.current += 1;
    setShowInactiveCampaigns(true);
    setQuery("");
    setStats(null);
    setStatsLoading(false);
    setSelectedCampaignId("");
    if (!inactiveLoaded && !inactiveLoading) void loadInactiveCampaigns(selectedClientId);
  }

  function openActiveCampaigns() {
    statsRequestId.current += 1;
    setShowInactiveCampaigns(false);
    setQuery("");
    setStats(null);
    setStatsLoading(false);
    setSelectedCampaignId("");
  }

  useEffect(() => {
    statsRequestId.current += 1;
    setCampaigns([]);
    setTotalCampaigns(0);
    setInactiveCampaigns([]);
    setInactiveTotal(0);
    setInactiveLoaded(false);
    setInactiveError("");
    setShowInactiveCampaigns(false);
    setStats(null);
    setSelectedCampaignId("");
    if (selectedClientId) void loadCampaigns(selectedClientId);
  }, [selectedClientId, loadCampaigns]);

  async function selectCampaign(campaign: Campaign) {
    statsRequestId.current += 1;
    const requestId = statsRequestId.current;
    if (selectedCampaignId === campaign.id) {
      setSelectedCampaignId("");
      setStats(null);
      setStatsError("");
      setStatsLoading(false);
      return;
    }

    setSelectedCampaignId(campaign.id);
    setStats(null);
    setStatsError("");
    setStatsLoading(true);
    try {
      const response = await fetch(`/api/clients/${selectedClientId}/campaigns/${campaign.id}/stats`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Campaign stats could not be loaded.");
      if (statsRequestId.current !== requestId) return;
      setStats(data as CampaignStatsResponse);
    } catch (error) {
      if (statsRequestId.current !== requestId) return;
      setStatsError(error instanceof Error ? error.message : "Campaign stats could not be loaded.");
    } finally {
      if (statsRequestId.current === requestId) setStatsLoading(false);
    }
  }

  function onClientSaved(client: SafeClient) {
    setClients((current) => {
      const exists = current.some((item) => item.id === client.id);
      return exists ? current.map((item) => item.id === client.id ? client : item) : [...current, client];
    });
    setSelectedClientId(client.id);
    setModal(null);
    setCampaignError("");
  }

  return (
    <div className={`app-shell ${theme === "dark" ? "dark-theme" : ""}`}>
      <aside className="sidebar">
        <div className="brand-row"><div className="brand-mark"><span /><span /><span /></div><div className="brand-copy"><b>Lagrowth Machine Tracker</b><small>CAMPAIGN ANALYTICS</small></div></div>
        <div className="side-section-head"><span>WORKSPACES</span>{isAdmin && <button aria-label="Add client account" className="add-client-mini" onClick={() => setModal("add")}><Icon name="plus" size={16} /></button>}</div>
        <nav className="client-nav" aria-label="Client accounts">
          {clientsLoading && <div className="nav-loading"><span className="spinner small" /> Loading accounts</div>}
          {!clientsLoading && clients.map((client, index) => <button key={client.id} className={`client-nav-item ${client.id === selectedClientId ? "active" : ""}`} onClick={() => setSelectedClientId(client.id)}><span className={`client-avatar avatar-${index % 5}`}>{initials(client.name)}</span><span className="client-nav-copy"><b>{client.name}</b><small>La Growth Machine</small></span><span className="connected-dot" /></button>)}
          {!clientsLoading && clients.length === 0 && <div className="no-clients">Your client accounts will appear here.</div>}
        </nav>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>Dashboard</span><Icon name="chevron" size={14} /><b>{selectedClient?.name || "Connect account"}</b></div><div className="topbar-actions"><button className="icon-button theme-toggle" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={toggleTheme}><Icon name={theme === "dark" ? "sun" : "moon"} size={17} /></button><span className="signed-in-email" title={currentUser.email}>{currentUser.email}</span><button className="button quiet sign-out-button" onClick={onLogout}>Sign out</button>{selectedClient && isAdmin && <button className="icon-button settings-button" aria-label="Edit client settings" title="Edit client" onClick={() => setModal("edit")}><Icon name="settings" size={17} /></button>}</div></header>

        <div className="content-area">
          {clients.length === 0 && !clientsLoading ? isAdmin ? <EmptyState onAdd={() => setModal("add")} onManageTeam={() => setTeamModal(true)} /> : <div className="shared-empty-state"><span className="eyebrow">WORKSPACE</span><h1>No client accounts yet</h1><p>The administrator will connect a La Growth Machine account before campaigns appear here.</p></div> : <>
            <section className="page-intro"><div><span className="eyebrow">{showInactiveCampaigns ? "INACTIVE CAMPAIGNS" : "LIVE VIEW"} <i className="eyebrow-dot" /> {selectedClient?.name ?? "CLIENT"}</span><h1>{showInactiveCampaigns ? "Inactive campaigns" : "Active campaigns"}</h1>{showInactiveCampaigns && <p>Review paused, draft, and canceled campaigns for this account.</p>}</div>{isAdmin && <div className="intro-actions"><button className="button outline team-access-button" onClick={() => setTeamModal(true)}>Team access</button>{selectedClient && <button className="button outline" onClick={() => setModal("edit")}><Icon name="settings" size={15} /> Client settings</button>}<button className="button primary" onClick={() => setModal("add")}><Icon name="plus" size={16} /> Add client</button></div>}</section>

            {selectedClientId && <ClientInsights clientId={selectedClientId} period={period} onPeriodChange={setPeriod} />}

            <section className="campaigns-section">
              <div className="section-title-row"><div><span className="eyebrow">{showInactiveCampaigns ? "PAUSED · DRAFT · CANCELED" : "RUNNING NOW"}</span><h2>Campaigns <span className="count-badge">{formatCount(currentCampaignTotal)}</span></h2></div><div className="list-tools">{showInactiveCampaigns && <button className="button quiet view-active-button" onClick={openActiveCampaigns}>Show active campaigns</button>}<label className="search-box"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${showInactiveCampaigns ? "inactive" : "active"} campaigns`} aria-label={`Search ${showInactiveCampaigns ? "inactive" : "active"} campaigns`} /></label><button className="icon-button refresh-button" title={`Refresh ${showInactiveCampaigns ? "inactive" : "active"} campaigns`} aria-label={`Refresh ${showInactiveCampaigns ? "inactive" : "active"} campaigns`} disabled={currentCampaignsLoading} onClick={() => void (showInactiveCampaigns ? loadInactiveCampaigns(selectedClientId) : loadCampaigns(selectedClientId))}><Icon name="refresh" size={17} /></button></div></div>
              <div className="campaign-card">
                {currentCampaignsLoading ? <LoadingSkeleton /> : currentCampaignError ? <div className="table-error"><span className="error-symbol">!</span><div><b>Couldn’t sync this account</b><p>{currentCampaignError}</p></div><button className="button quiet" onClick={() => void (showInactiveCampaigns ? loadInactiveCampaigns(selectedClientId) : loadCampaigns(selectedClientId))}>Try again</button></div> : visibleCampaigns.length === 0 ? <div className="empty-campaign-list"><div className="empty-list-icon"><Icon name="grid" size={21} /></div><b>{query ? "No matching campaigns" : showInactiveCampaigns ? "No inactive campaigns" : "No campaigns are running"}</b><span>{query ? "Try a different search term." : showInactiveCampaigns ? "There are no paused, draft, or canceled campaigns in this account." : "Paused, draft, and canceled campaigns are hidden from this view."}</span>{!query && !showInactiveCampaigns && <button className="button outline inactive-campaign-option" onClick={openInactiveCampaigns}>Check inactive campaigns</button>}{!query && showInactiveCampaigns && <button className="button outline inactive-campaign-option" onClick={openActiveCampaigns}>Show active campaigns</button>}</div> : visibleCampaigns.map((campaign, index) => {
                  const status = campaignStatus(campaign.status);
                  const isExpanded = campaign.id === selectedCampaignId;
                  return <div className="campaign-row-wrap" key={campaign.id}>
                    <button className={`campaign-row ${isExpanded ? "selected" : ""}`} aria-expanded={isExpanded} aria-controls={isExpanded ? `campaign-details-${campaign.id}` : undefined} onClick={() => void selectCampaign(campaign)}>
                      <span className={`campaign-symbol symbol-${index % 4}`}><Icon name={campaign.channels?.includes("LINKEDIN") ? "linkedin" : campaign.channels?.includes("GOOGLE") ? "mail" : "chart"} size={16} /></span>
                      <span className="campaign-name-copy"><b>{campaign.name}</b><small>{(campaign.channels || []).filter((item) => item !== "LGM").map((item) => item === "GOOGLE" ? "Email" : item).join(" · ") || "Campaign"}</small></span>
                      <span className="campaign-lead-count">{formatCount(campaign.leadsCount)} leads</span>
                      <span className={`status-pill ${status.className}`}><span />{status.label}</span>
                      <span className="row-arrow"><Icon name="arrow" size={15} /></span>
                    </button>
                    {isExpanded && <div className="campaign-expanded-detail" id={`campaign-details-${campaign.id}`}><CampaignDetail campaign={campaign} clientId={selectedClientId} stats={stats} loading={statsLoading} error={statsError} replyFrom={selectedPeriodBounds.from} periodLabel={period === "week" ? "this week" : "this month"} /></div>}
                  </div>;
                })}
                {!currentCampaignsLoading && !currentCampaignError && campaignsForView.length > 0 && <div className="table-foot"><span>{formatCount(visibleCampaigns.length)} {showInactiveCampaigns ? "inactive" : "active"} campaigns</span><span>{lastSynced ? <>Updated {new Date(lastSynced).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</> : "Refresh to see latest"}</span></div>}
              </div>
            </section>
            <footer className="page-footer"><span>Campaign data comes directly from La Growth Machine.</span><span><Icon name="lock" size={13} /> Account keys are encrypted before storage</span></footer>
          </>}
        </div>
      </main>
      {modal && <ClientModal key={`${modal}-${selectedClient?.id ?? "new"}`} client={modal === "edit" ? selectedClient : undefined} onClose={() => setModal(null)} onSaved={onClientSaved} />}
      {teamModal && <TeamAccessModal onClose={() => setTeamModal(false)} />}
    </div>
  );
}

type AuthStatus = {
  setupRequired: boolean;
  setupAvailable: boolean;
  setupSecretRequired: boolean;
  user: AppUser | null;
  invitation: { email: string; expiresAt: string } | null;
};

export default function Dashboard() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState("");

  async function refreshAuth(token?: string | null) {
    setLoadingAuth(true);
    setAuthError("");
    try {
      const query = token ? `?invite=${encodeURIComponent(token)}` : "";
      const response = await fetch(`/api/auth/status${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in settings could not be loaded.");
      setAuthStatus(data as AuthStatus);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in settings could not be loaded.");
    } finally {
      setLoadingAuth(false);
    }
  }

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    setInviteToken(token);
    void refreshAuth(token);
  }, []);

  async function completeAuth() {
    if (inviteToken) {
      const url = new URL(window.location.href);
      url.searchParams.delete("invite");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      setInviteToken(null);
    }
    await refreshAuth();
  }

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* The cookie will expire if the server is unavailable. */ }
    await refreshAuth();
  }

  if (loadingAuth && !authStatus) return <AuthPortal mode="loading" />;

  if (inviteToken) {
    return <AuthPortal mode="invite" inviteToken={inviteToken} invitedEmail={authStatus?.invitation?.email} errorMessage={authStatus?.invitation ? "" : authError || "This invitation link is invalid or has expired. Ask the administrator for a new one."} onComplete={() => void completeAuth()} />;
  }

  if (!authStatus) {
    return <AuthPortal mode="login" errorMessage={authError || "The workspace could not be reached. Refresh the page and try again."} onComplete={() => void refreshAuth()} />;
  }

  if (!authStatus.user && authStatus.setupRequired) {
    if (!authStatus.setupAvailable) return <AuthPortal mode="setup-blocked" errorMessage="Administrator setup is not configured yet. Check the setup settings and refresh this page." />;
    return <AuthPortal mode="setup" setupSecretRequired={authStatus.setupSecretRequired} onComplete={() => void completeAuth()} />;
  }

  if (!authStatus.user) return <AuthPortal mode="login" errorMessage={authError} onComplete={() => void completeAuth()} />;
  return <CampaignDashboard currentUser={authStatus.user} onLogout={() => void logout()} />;
}
