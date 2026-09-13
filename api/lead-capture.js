// /api/lead-capture.js
// Called by Angela (the chat widget) the moment a conversation happens,
// so lead source and qualifying answers are captured automatically —
// no manual entry, no waiting until a call is booked.
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
    const {
      lead_source,
      utm_source,
      utm_medium,
      utm_campaign,
      contact_name,
      contact_email,
      contact_phone,
      timeline,
      service_tier,
      notes,
    } = req.body;

    const { error } = await supabase.from('leads').insert({
      lead_source: lead_source || 'Website Widget',
      utm_source,
      utm_medium,
      utm_campaign,
      contact_name,
      contact_email,
      contact_phone,
      timeline,
      service_tier,
      status: 'New',
      notes,
    });

    if (error) throw error;
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Lead capture error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
