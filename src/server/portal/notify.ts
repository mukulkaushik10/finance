// Outgoing notifications seam. The MVP writes to the server log; plug an email provider
// (SES, Postmark, SendGrid) in here.
export interface Notice { to: string; subject: string; body: string }

export const sentNotices: Notice[] = [];

export async function notify(n: Notice): Promise<void> {
  sentNotices.push(n);
  if (sentNotices.length > 200) sentNotices.shift();
  if (process.env.NODE_ENV !== "test") console.log(`[notify] to=${n.to} subject="${n.subject}" ${n.body}`);
}
