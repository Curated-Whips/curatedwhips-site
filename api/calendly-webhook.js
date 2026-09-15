// /api/calendly-webhook.js
// Calendly webhook subscription target. Auto-logs bookings and cancellations
// into the `leads` table so booked-call data never requires manual entry.
//
// Env vars needed (set in Vercel project settings):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { event, payload } = req.body;
    console.log('Calendly webhook received. Event:', event);

    if (event === 'invitee.canceled') {
      const { error } = await supabase
        .from('leads')
        .update({ status: 'Nurture', notes: 'Calendly booking canceled' })
        .eq('calendly_event_uri', payload.uri);
      if (error) console.error('Supabase update error (cancel):', error);
      return res.status(200).json({ received: true });
    }

    if (event !== 'invitee.created') {
      console.log('Ignoring unrecognized event type:', event);
      return res.status(200).json({ received: true });
    }

    const invitee = payload;
    const eventInfo = invitee.scheduled_event || {};

    const record = {
      calendly_event_uri: invitee.uri,
      contact_name: invitee.name,
      contact_email: invitee.email,
      intake_call_datetime: eventInfo.start_time || null,
      status: 'Booked Call',
    };
    console.log('Prepared record:', record);

    const { data: existing, error: selectError } = await supabase
      .from('leads')
      .select('id')
      .eq('contact_email', invitee.email)
      .is('intake_call_datetime', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (selectError) console.error('Supabase select error:', selectError);

    if (existing && existing.length > 0) {
      const { error: updateError } = await supabase
        .from('leads')
        .update(record)
        .eq('id', existing[0].id);
      if (updateError) console.error('Supabase update error:', updateError);
    } else {
      const { error: insertError } = await supabase.from('leads').insert(record);
      if (insertError) console.error('Supabase insert error:', insertError);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Calendly webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
