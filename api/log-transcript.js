// /api/log-transcript.js
// Fallback safety net. Sends the FULL raw conversation transcript by email
// whenever a visitor closes the widget or leaves the page — regardless of
// whether log_lead or log_ready_lead ever fired in chat.js. This exists so
// no conversation is silently lost just because it didn't reach either
// tool's trigger conditions.

const LEAD_EMAIL_TO = 'jhoda@curatedwhips.com';

async function notifyFailure(message) {
  if (!process.env.NTFY_TOPIC) return;
  try {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        Title: 'Curated Whips widget alert',
        Priority: 'high',
        // ntfy's own email relay — independent of Resend, so a Resend
        // outage doesn't also silence the alert about the Resend outage.
        Email: LEAD_EMAIL_TO,
      },
      body: message,
    });
  } catch (err) {
    console.error('Failed to send ntfy alert:', err);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Same stopgap as chat.js — not a real security boundary, headers are
  // forgeable, but stops casual scripted abuse. Loosened to also match
  // Vercel preview deployment URLs, which don't match an exact hostname
  // check. See chat.js for full note.
  const origin = req.headers.origin || req.headers.referer || '';
  const originAllowed =
    origin.includes('curatedwhips.com') || (origin.includes('curatedwhips') && origin.includes('.vercel.app'));
  if (origin && !originAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Defensive access, not destructuring — see chat.js for why.
  const messages = req.body && req.body.messages;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // This endpoint previously had no bounds at all on message count or
  // content length — unlike chat.js, which caps both. A visitor's local
  // `history` array (sent here) is never trimmed client-side, so without
  // a cap here a very long or malicious payload could produce an oversized
  // email or waste Resend quota.
  if (messages.length > 200) {
    return res.status(400).json({ error: 'too many messages' });
  }
  const MAX_TRANSCRIPT_MESSAGE_LENGTH = 3000;
  for (const m of messages) {
    if (typeof m.content !== 'string' || m.content.length > MAX_TRANSCRIPT_MESSAGE_LENGTH) {
      return res.status(400).json({ error: 'invalid message content' });
    }
  }

  // Only bother sending if the visitor actually said something.
  const hasUserMessage = messages.some((m) => m.role === 'user');
  if (!hasUserMessage) {
    return res.status(200).json({ skipped: true });
  }

  const transcriptText = messages
    .map((m) => {
      // content is either a plain string or (rarely) a tool_result block array —
      // only plain user/assistant text turns are ever pushed to client history,
      // so this is always a string in practice, but guard just in case.
      const text = typeof m.content === 'string' ? m.content : '[non-text content]';
      const speaker = m.role === 'user' ? 'Visitor' : 'Angela';
      return `${speaker}: ${text}`;
    })
    .join('\n\n');

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set — transcript captured but email not sent.');
    await notifyFailure('RESEND_API_KEY missing — a chat transcript was captured but no email was sent.');
    return res.status(200).json({ sent: false });
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Curated Whips Widget <leads@curatedwhips.com>',
        to: [LEAD_EMAIL_TO],
        subject: 'Full chat transcript (backup)',
        text: `This is a full backup of a widget conversation, sent regardless of whether a structured lead was logged separately. If you already got a "New lead" or "Ready lead" email for this same conversation, this is a duplicate on purpose — better to over-send than lose one.\n\n---\n\n${transcriptText}`,
      }),
    });
    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error(`Resend rejected transcript email (status ${emailRes.status}):`, errBody);
      await notifyFailure(`Transcript email failed to send (Resend status ${emailRes.status}). A conversation record may have been lost.`);
      return res.status(200).json({ sent: false });
    }
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Failed to send transcript email (network error):', err);
    await notifyFailure('Transcript email failed to send (network error). A conversation record may have been lost.');
    // Don't fail loudly to the client — this fires in the background on page close.
    return res.status(200).json({ sent: false });
  }
}
