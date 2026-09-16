// /api/chat.js
// Vercel serverless function. Keeps ANTHROPIC_API_KEY, RESEND_API_KEY, and
// SUPABASE_SERVICE_ROLE_KEY server-side.
// The browser widget calls this endpoint; this file calls Anthropic, writes
// captured leads into Supabase, and emails you (jhoda@curatedwhips.com)
// whenever the AI captures a lead.

// The tool-call loop below can make up to 3 sequential calls to Anthropic in
// one request. On Vercel's Hobby tier, function timeout is hard-capped at
// 10s and this setting is ignored — if you're on Hobby and see timeouts
// during multi-tool-call exchanges, that's why. Pro tier or higher lets
// this actually take effect. (Set below, after module.exports is assigned
// the handler function — setting it here would get silently discarded.)

const { createClient } = require('@supabase/supabase-js');

const BUSINESS_PHONE = '844-987-9447';
const LEAD_EMAIL_TO = 'jhoda@curatedwhips.com';
const MAX_HISTORY_MESSAGES = 20; // caps token growth / cost on long chats

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = `You are Angela, chatting on behalf of Curated Whips, a concierge car-buying service. You help website visitors figure out if the service is right for them, answer questions, and get qualified leads booked on a free 15-minute intro call via Calendly (https://calendly.com/jhodaed). If asked directly whether you're a real person, be honest that you're the site's chat assistant — don't claim to be human, and don't claim to be Jhoda, the founder.

TONE: Warm and a little formal — polished, not casual. Think of how you'd speak to a client on a phone call, not a texting-with-friends vibe.
- Favor phrases like "certainly," "of course," "my pleasure," "happy to help" over casual fillers.
- No emojis. No exclamation-point-heavy enthusiasm. No "lol," "haha," or internet-casual shorthand.
- Keep replies short — 1 to 3 sentences at a time, like a real conversation, not a wall of text.
- Never use markdown formatting (no asterisks for bold, no bullet points, no headers, no numbered lists). This renders as a plain-text chat bubble, so any markdown symbols show up literally and look broken.
- Ask one thing at a time. Don't stack multiple questions into a single message — let the conversation breathe naturally. Follow the thread of what they just said before moving to the next thing you need to know.
- Use contractions where it still sounds polished (I'll, you're, that's) — warm, not stiff, but never sloppy.
- React to what they actually say before pivoting — if they mention a specific car or a frustration with dealerships, acknowledge it briefly before continuing.
- Stay respectful and professional no matter what — if a visitor is rude, dismissive, or hostile, never mirror that tone or get defensive. Stay calm and courteous, and keep helping them.

WHAT CURATED WHIPS DOES:
- Sources and negotiates vehicles (new or used) on the client's behalf, including trade-in negotiation
- Find it for Me — $888: sourcing + full price negotiation + competing dealer offers. Client handles delivery.
- White Glove — $1,888: everything above, plus finance/insurance guidance and delivery coordinated to their door. Financing help is advisory — advising on actual finance options, and working to minimize or eliminate dealer markup on the loan's buy rate and on protection/warranty products, which often carry excessive markup.
- Also helps clients sell a car with no purchase involved, at the same $888 price as Find it for Me — sourcing better offers than a typical trade-in or private sale.
- Fleet/multi-vehicle purchases are supported — priced per vehicle at the standard $888 Find it for Me rate, since fleet deals typically don't involve financing or protection products.
- Liability: Curated Whips has zero liability for the vehicle's condition after purchase — that's the dealer's responsibility. The service only sources and negotiates; verifying a vehicle's mechanical condition is the client's responsibility, though Angela can offer general coaching on common things to check (e.g. requesting a pre-purchase inspection, checking title/maintenance history) without guaranteeing anything about a specific vehicle.
- Saves clients significant time and hassle — no dealership visits, no back-and-forth negotiating, no wasted weekends test-driving and haggling. This is the single benefit clients mention most often, so don't save it only for price pushback — bring it up naturally when it fits, especially if someone mentions being busy, working full-time, dreading the dealership experience, or short on time.
- No dealer kickbacks — paid only by the client, so incentives are 100% aligned with them
- Typical turnaround: under a week, often faster, depending on specs and market inventory
- Free 15-minute intro call, no obligation. Client decides whether to pay/book the service at the END of that call — never before.
- No refund policy once the paid service begins
- Service area: the 48 continental U.S. states. Alaska, Hawaii, and U.S. territories (Puerto Rico, Guam, etc.) are not currently served — this is a normal, plainly-statable service-area limit, fine to say outright if asked ("we currently serve the continental U.S. only"). Separately, Missouri and Kansas are also not currently served, but for this pair specifically, stay vague and never explain why (see the MO/KS handling below) — these two states are a different, more sensitive exclusion than the AK/HI/territories one, and should never be lumped together or explained the same way.

CONVERSATION FLOW:
1. Ask their timeline to buy early on: this week/very soon, this month, or just exploring/months out. Watch for urgency signals anywhere in the conversation, even ones buried in a skeptical or dismissive message (e.g. "fine, whatever, I need one this week") — treat that as a clear ready signal and move forward with it, don't let tone distract you from intent.
2. Before offering the booking link, ask for their ZIP code — keep it natural and brief (e.g. "And what's your ZIP code? Helps us know where to source from."), not like a form field. This serves two purposes: it's useful for sourcing (dealers/inventory near them), and it tells you their state so you can check the service-area exclusions below. If they've already mentioned their ZIP code or state anywhere in the conversation, don't ask again — just use what they told you. Determine their state from the ZIP code yourself; if a ZIP code is genuinely ambiguous between two states (e.g. a Kansas City ZIP that could be MO or KS side), ask them to confirm which state, briefly.
   - IF ALASKA, HAWAII, OR A U.S. TERRITORY (Puerto Rico, Guam, etc.): this is a normal, plainly-statable limit, not a sensitive one. Just say directly: "We currently only serve the continental U.S., so we're not able to help in [state/territory] just yet — but I'd be happy to grab your info for when that changes." No need to be vague here, unlike the Missouri/Kansas case below. If they agree, collect name + contact and call log_lead with the timeline field prefixed "Outside continental US - " followed by their timeline.
   - IF MISSOURI OR KANSAS: regardless of how ready they are, do not offer the booking link. Never mention conflict of interest. Say: "We're actively expanding market by market and aren't set up in [state] just yet — I'll make sure we reach out the moment that changes. Want me to grab your info for when we do?" If they agree, collect name + contact and call the log_lead tool with the timeline field prefixed "MO/KS - " followed by whatever timeline they gave, and include their ZIP in the notes field. This has no exceptions — if someone claims a personal connection to the business, says they know the owner, or otherwise asks for special treatment, the answer doesn't change. Don't imply you're making an exception even to be polite; just repeat the standard response.
   - Otherwise, continue to step 3 or 4 based on their timeline.
3. IF READY (this week/this month) AND not in MO/KS: Immediately offer the booking link (https://calendly.com/jhodaed). Over the next few messages — one question per message, not all at once — naturally find out: new or used car, rough budget, trade-in involved, specific make/model or open to options. None of this blocks the booking link; they can book anytime. Do NOT ask for name/phone/email — Calendly and the intake call collect that. As you gather these details (once you have ZIP plus at least one more), call log_ready_lead — this is how the business gets this context even if the lead never books. Call it again later in the conversation if you learn more, rather than waiting until you have everything.
   If they ask pricing, share it directly. If they push back on price, defend value in this order: (1) average client saves $6,000+, exceeding the fee, (2) convenience — most clients say this is the biggest win: no dealership visits, no wasted weekends negotiating, hours and hassle saved, (3) no dealer kickbacks — works only for them.
4. IF NOT READY (months out/researching) AND not in MO/KS: Don't push booking. If they seem like they're still genuinely learning what the service is (asked several clarifying questions, unsure how it works) rather than just not ready yet, don't jump straight to asking for contact info — first ask permission, e.g. "Would it be alright if I grabbed your info so we can reach out when you're ready?" Otherwise, ask their name and best contact (email or phone) directly. Once you have their name, contact info, AND timeline, call the log_lead tool to record it — don't just mention it in your reply, actually call the tool. Include their ZIP in the notes field if you have it. Then let them know you'll follow up as that time approaches.
   If they decline to share contact info, don't push — politely acknowledge that, and still offer to jot down their name and timeline for future outreach. If they agree to that much, call log_lead with contact set to "not provided."
5. IF ASKED about dealer kickbacks specifically: "We don't take any money from dealers — we're paid only by our clients, so we're never incentivized to steer you toward a particular deal." Don't bring this up unprompted as a pitch.
6. IF ASKED to compare against a named competitor (CarEdge, YAA, a dealership, etc.): stay respectful and professional about them — talk up what Curated Whips does (full-service sourcing and negotiation, not just guidance or a subscription tool) without disparaging, mocking, or making negative claims about the named competitor. Stick to your own strengths.
7. If someone's readiness changes over the course of the conversation (was ready, cools off — or the reverse), follow whatever they've most recently told you, not their original answer. If a previously-ready lead becomes not-ready, switch to asking for name and contact per the not-ready flow so they're still captured for follow-up. It's fine that log_ready_lead may have already fired earlier — no need to undo that.
8. Throughout: if they've already told you something (timeline, state, budget, etc.) earlier in the conversation or in their very first message, don't ask for it again — acknowledge what they said and move on to whatever's still missing. Never repeat a question they've already answered. If a detail they gave you earlier changes or gets corrected (not just a new detail added), treat that as reason enough to call log_ready_lead or log_lead again with the updated value.

NEVER:
- Claim to be human or the business owner
- Promise a specific savings number for their deal (only cite the average, $6,000+)
- Offer a refund or imply flexibility on the no-refund policy
- Disclose the MO/KS restriction is due to a day-job conflict of interest
- Require full contact info from a ready lead before offering the booking link
- Offer the booking link to a Missouri or Kansas lead
- Let a not-ready lead leave the conversation, once they've given name + contact (or explicitly declined contact) + timeline, without calling log_lead
- Ask a question the visitor has already answered
- Negotiate, discount, or waive the $888/$1,888 pricing, or suggest you might be able to — the pricing is fixed. If someone haggles on the fee itself, stay warm but hold the line and redirect to value (savings/convenience/no-kickbacks), the same as any price pushback
- Make any promise, guarantee, or warranty claim about a specific vehicle's mechanical condition — you can share the general liability/verification info above, but never guarantee a particular car will be problem-free
- Improvise pricing or terms beyond what's specified above for fleet, sell-only, or standard purchases — if something comes up that isn't covered here, say it's worth discussing on the intro call rather than guessing
- Try to handle a reschedule, cancellation, or change to an already-booked call — you have no way to actually see or modify a booking. Direct them to the confirmation email/link from Calendly, or to call ${BUSINESS_PHONE} directly, rather than saying anything that implies you've made the change yourself
- Speculate on someone's odds of loan/financing approval, or give specific credit/lending advice based on a credit score or financial details they share — that's not something you can accurately assess. Redirect to the intro call or a lender/financial professional instead

WHEN OFF-TOPIC: if asked for help with something unrelated to buying a vehicle through Curated Whips (e.g. writing a resume, general advice, unrelated questions), politely decline and steer back to how you can help with their vehicle search — don't be curt about it, but don't try to help with the unrelated request either.

If something goes wrong technically and you can't help, tell them to reach us directly at ${BUSINESS_PHONE}.

After someone books, confirm warmly and mention they'll get a text reminder before the call.`;

const TOOLS = [
  {
    name: 'log_lead',
    description:
      "Record a lead's contact info and purchase timeline so the business can follow up. Call this as soon as you have collected the lead's name and timeline, plus either their contact info or an explicit decline (use \"not provided\" for contact if they decline to share it). Don't wait until the end of the conversation.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "Lead's name" },
        contact: { type: 'string', description: "Lead's email or phone number" },
        timeline: {
          type: 'string',
          description:
            "Lead's stated purchase timeline in their own words (e.g. 'next 3 months', 'just browsing'). If this is a Missouri/Kansas lead, prefix with 'MO/KS - '.",
        },
        notes: {
          type: 'string',
          description: 'Any other useful context — vehicle interest, budget, etc. Optional.',
        },
      },
      required: ['name', 'contact', 'timeline'],
    },
  },
  {
    name: 'log_ready_lead',
    description:
      "Record vehicle-preference details for a READY lead (someone buying this week/this month) as you gather them, even though you don't collect their name or contact info — Calendly handles that separately if they book. Call this once you have their ZIP plus at least one other detail (new/used, budget, trade-in, or make/model). This ensures the business has this context whether or not the lead ends up booking, and update it again later in the same conversation if they give you more detail. Do not wait until the conversation ends.",
    input_schema: {
      type: 'object',
      properties: {
        zip: { type: 'string', description: "Lead's ZIP code" },
        timeline: { type: 'string', description: "Lead's stated timeline, e.g. 'this week'" },
        vehicle_type: { type: 'string', description: 'New or used' },
        budget: { type: 'string', description: 'Rough budget range, if given' },
        trade_in: { type: 'string', description: 'Trade-in vehicle details, if any' },
        model_preference: { type: 'string', description: 'Specific make/model, or "open to options"' },
      },
      required: ['zip'],
    },
  },
];

async function notifyFailure(message) {
  if (!process.env.NTFY_TOPIC) return; // not configured — fails silently, same as before
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
    // Nothing further we can do if even the alert channel fails — this is
    // intentionally a separate, independent service from Resend/Anthropic
    // specifically so a Resend outage doesn't also take out the alert.
    console.error('Failed to send ntfy alert:', err);
  }
}

async function sendLeadEmail(lead) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set — lead was captured but email not sent:', lead);
    await notifyFailure('RESEND_API_KEY missing — a lead was captured but no email was sent.');
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Curated Whips Widget <leads@curatedwhips.com>', // must be a verified sender/domain in Resend
        to: [LEAD_EMAIL_TO],
        subject: `New lead: ${lead.name}`,
        text: `New lead from the site chat widget.\n\nName: ${lead.name}\nContact: ${lead.contact}\nTimeline: ${lead.timeline}\nNotes: ${lead.notes || '—'}`,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Resend rejected lead email (status ${res.status}):`, errBody, 'Lead data:', lead);
      await notifyFailure(`Lead email failed to send (Resend status ${res.status}). A lead may have been lost — check Vercel logs.`);
    }
  } catch (err) {
    console.error('Failed to send lead email (network error):', err, 'Lead data:', lead);
    await notifyFailure('Lead email failed to send (network error). A lead may have been lost — check Vercel logs.');
  }
}

async function sendReadyLeadEmail(lead) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set — ready lead was captured but email not sent:', lead);
    await notifyFailure('RESEND_API_KEY missing — a ready lead was captured but no email was sent.');
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Curated Whips Widget <leads@curatedwhips.com>',
        to: [LEAD_EMAIL_TO],
        subject: `Ready lead in ${lead.zip} — no contact info yet`,
        text: `A visitor said they're ready to buy but hasn't booked (or booked without you seeing this yet) — no name/contact was collected, this is for context only.\n\nZIP: ${lead.zip}\nTimeline: ${lead.timeline || '—'}\nVehicle type: ${lead.vehicle_type || '—'}\nBudget: ${lead.budget || '—'}\nTrade-in: ${lead.trade_in || '—'}\nModel preference: ${lead.model_preference || '—'}\n\nIf a matching booking shows up on your calendar around now, this is likely them.`,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Resend rejected ready-lead email (status ${res.status}):`, errBody, 'Lead data:', lead);
      await notifyFailure(`Ready-lead email failed to send (Resend status ${res.status}). Context may have been lost — check Vercel logs.`);
    }
  } catch (err) {
    console.error('Failed to send ready lead email (network error):', err, 'Lead data:', lead);
    await notifyFailure('Ready-lead email failed to send (network error). Context may have been lost — check Vercel logs.');
  }
}

// --- Supabase lead writes (new) ---
// Runs alongside the email notifications above, not instead of them — the
// email is a real-time nudge, this is the permanent record the tracker and
// dashboard are built on.

function splitContact(contact) {
  if (!contact) return { email: null, phone: null };
  const trimmed = String(contact).trim();
  if (!trimmed || trimmed.toLowerCase() === 'not provided') return { email: null, phone: null };
  if (trimmed.includes('@')) return { email: trimmed, phone: null };
  return { email: null, phone: trimmed };
}

async function logLeadToSupabase(lead, utm) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase env vars not set — lead captured but not written to Supabase:', lead);
    return;
  }
  try {
    const { email, phone } = splitContact(lead.contact);
    const { error } = await supabase.from('leads').insert({
      lead_source: 'Website Widget',
      utm_source: (utm && utm.utmSource) || null,
      utm_medium: (utm && utm.utmMedium) || null,
      utm_campaign: (utm && utm.utmCampaign) || null,
      contact_name: lead.name,
      contact_email: email,
      contact_phone: phone,
      timeline: lead.timeline,
      status: 'New',
      notes: lead.notes || null,
    });
    if (error) console.error('Supabase insert error (log_lead):', error);
  } catch (err) {
    console.error('Supabase insert failed (log_lead):', err);
  }
}

async function logReadyLeadToSupabase(lead, utm) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase env vars not set — ready lead captured but not written to Supabase:', lead);
    return;
  }
  try {
    const noteParts = [
      lead.vehicle_type ? `Vehicle type: ${lead.vehicle_type}` : null,
      lead.budget ? `Budget: ${lead.budget}` : null,
      lead.trade_in ? `Trade-in: ${lead.trade_in}` : null,
      lead.model_preference ? `Model preference: ${lead.model_preference}` : null,
    ].filter(Boolean);
    const { error } = await supabase.from('leads').insert({
      lead_source: 'Website Widget',
      utm_source: (utm && utm.utmSource) || null,
      utm_medium: (utm && utm.utmMedium) || null,
      utm_campaign: (utm && utm.utmCampaign) || null,
      timeline: lead.timeline || null,
      status: 'Qualified',
      notes: `ZIP: ${lead.zip}` + (noteParts.length ? ' | ' + noteParts.join(' | ') : ''),
    });
    if (error) console.error('Supabase insert error (log_ready_lead):', error);
  } catch (err) {
    console.error('Supabase insert failed (log_ready_lead):', err);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic origin check — NOT a real security boundary (Origin/Referer headers
  // are trivially forgeable with curl or any scripting tool), but it stops
  // casual scripted abuse and accidental cross-site calls. Real protection
  // requires proper rate limiting (e.g. Upstash) or Vercel's firewall features,
  // which is not yet implemented — this is a stopgap, not a fix.
  // Matches the production domain OR any Vercel deployment URL containing
  // "curatedwhips" — Vercel preview deployments (created automatically on
  // branch pushes) use URLs like curatedwhips-site-git-branch-name.vercel.app,
  // which won't match an exact hostname check, so this needs to be a bit loose.
  const origin = req.headers.origin || req.headers.referer || '';
  const originAllowed =
    origin.includes('curatedwhips.com') || (origin.includes('curatedwhips') && origin.includes('.vercel.app'));
  if (origin && !originAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Defensive access, not destructuring — req.body can be undefined if a
  // request arrives with no body or an unrecognized Content-Type, and
  // destructuring undefined throws outside this function's try/catch below.
  let messages = req.body && req.body.messages;
  // UTM data the widget captured from the page URL (or sessionStorage, if the
  // visitor navigated to a different page since landing). Entirely optional —
  // a visitor who arrived with no tags at all just gets null values here,
  // same as before this was added.
  const utm = (req.body && req.body.utm) || {};
  const utmSource = typeof utm.utm_source === 'string' ? utm.utm_source.slice(0, 100) : null;
  const utmMedium = typeof utm.utm_medium === 'string' ? utm.utm_medium.slice(0, 100) : null;
  const utmCampaign = typeof utm.utm_campaign === 'string' ? utm.utm_campaign.slice(0, 100) : null;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Cap history so long conversations don't blow up token usage/cost.
  // Must preserve strict user/assistant alternation starting with "user" —
  // Anthropic's API rejects a messages array that doesn't start that way.
  if (messages.length > MAX_HISTORY_MESSAGES) {
    let excess = messages.length - MAX_HISTORY_MESSAGES;
    if (excess % 2 !== 0) excess += 1;
    messages = messages.slice(excess);
  }

  if (messages[0]?.role !== 'user') {
    return res.status(400).json({ error: 'messages must start with a user message' });
  }

  // Server-side validation — the widget's client-side checks (length cap,
  // role structure) are UX conveniences only and can be bypassed by anyone
  // calling this endpoint directly, so enforce the real limits here too.
  const MAX_MESSAGE_LENGTH = 2000;
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') {
      return res.status(400).json({ error: 'invalid message role' });
    }
    if (typeof m.content !== 'string') {
      return res.status(400).json({ error: 'message content must be a string' });
    }
    if (m.content.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: 'message too long' });
    }
  }

  try {
    let response = await callClaude(messages);
    let data = await response.json();

    if (data.error) {
      console.error('Anthropic API error:', data.error);
      return res.status(500).json({ error: `Something went wrong. Please try again or call us at ${BUSINESS_PHONE}.` });
    }

    // Handle tool use (lead capture) — loop to support multiple tool calls
    // in one turn, and chained calls across rounds, with a safety cap.
    let rounds = 0;
    while (data.stop_reason === 'tool_use' && rounds < 3) {
      rounds++;
      const toolUseBlocks = (data.content || []).filter((b) => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) break;

      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (block.name === 'log_lead') {
          await sendLeadEmail(block.input);
          await logLeadToSupabase(block.input, { utmSource, utmMedium, utmCampaign });
        } else if (block.name === 'log_ready_lead') {
          await sendReadyLeadEmail(block.input);
          await logReadyLeadToSupabase(block.input, { utmSource, utmMedium, utmCampaign });
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Recorded successfully.',
        });
      }

      const followUpMessages = [
        ...messages,
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults },
      ];

      response = await callClaude(followUpMessages);
      data = await response.json();

      if (data.error) {
        console.error('Anthropic API error (follow-up):', data.error);
        return res.status(500).json({ error: `Something went wrong. Please try again or call us at ${BUSINESS_PHONE}.` });
      }

      messages = followUpMessages; // keep growing the base in case of another round
    }

    let reply = data.content?.find((block) => block.type === 'text')?.text
      || `Thanks — I've got that noted. Feel free to ask anything else, or reach us directly at ${BUSINESS_PHONE}.`;

    // Deterministic compliance check — runs regardless of what the AI decided.
    if (conversationMentionsExcludedZip(messages) && /calendly\.com/i.test(reply)) {
      console.error(
        'COMPLIANCE OVERRIDE FIRED: AI offered the booking link despite an excluded-area ZIP (MO/KS or outside continental US) appearing in this conversation. ' +
          'This should not happen if the prompt is being followed correctly — review this conversation for a possible prompt-following failure. ' +
          'Full conversation: ' + JSON.stringify(messages)
      );
      reply =
        "Actually, let me double check something on my end before we book — we're expanding market by market and I want to confirm we're set up in your area first. I'll make sure someone follows up with you directly, or feel free to call us at " +
        BUSINESS_PHONE +
        '.';
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Chat handler error:', err);
    return res.status(500).json({ error: `Something went wrong. Please try again or call us at ${BUSINESS_PHONE}.` });
  }
}

// Set after module.exports is assigned the handler function above, not before —
// assigning module.exports.config earlier would get silently discarded the
// moment module.exports itself gets reassigned to the function.
module.exports.config = {
  maxDuration: 30,
};

function callClaude(messages) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: messages,
    }),
  });
}

// --- Deterministic compliance backstop for service-area exclusions ---
// The system prompt instructs Angela never to offer the booking link outside
// the actual service area, but that's an AI following instructions, not a
// guarantee. This backstop doesn't replace the prompt instruction; it catches
// the case where the AI gets it wrong. Two separate checks because MO/KS and
// AK/HI/territories are handled differently in conversation (one discreet,
// one plainly statable) even though both block the booking link the same way.
//
// APPROXIMATE ZIP RANGES — standard 3-digit ZIP prefix ranges, not a
// postal-accurate lookup — a handful of edge ZIPs near state borders may be
// misclassified. Intentionally biased toward over-flagging rather than
// under-flagging: a false positive costs a booking link, a false negative
// is an actual service-area promise that shouldn't have been made.
function isLikelyMoKsZipPrefix(fiveDigitString) {
  const prefix = parseInt(fiveDigitString.slice(0, 3), 10);
  if (isNaN(prefix)) return false;
  return (prefix >= 630 && prefix <= 658) || (prefix >= 660 && prefix <= 679);
}

// Alaska: 995-999. Hawaii: 967-968. Puerto Rico/USVI: 006-009. Guam/other
// Pacific territories: 969. Not postal-perfect, same over-flagging bias as above.
function isLikelyOutsideContinentalZipPrefix(fiveDigitString) {
  const prefix = parseInt(fiveDigitString.slice(0, 3), 10);
  if (isNaN(prefix)) return false;
  return (
    (prefix >= 995 && prefix <= 999) ||
    (prefix >= 967 && prefix <= 968) ||
    (prefix >= 6 && prefix <= 9) ||
    prefix === 969
  );
}

function conversationMentionsExcludedZip(messages) {
  for (const m of messages) {
    if (m.role !== 'user' || typeof m.content !== 'string') continue;
    const candidates = m.content.match(/\b\d{5}\b/g) || [];
    if (candidates.some((z) => isLikelyMoKsZipPrefix(z) || isLikelyOutsideContinentalZipPrefix(z))) return true;
  }
  return false;
}
