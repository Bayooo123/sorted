// Vercel Node.js Serverless Function — deliberately no dependencies, no
// package.json needed (matches the root's "no build step" static-site
// setup, README.md). Calls Resend's REST API directly via the Node 18+
// runtime's built-in fetch.
//
// Fire-and-forget from the waitlist form in index.html, after a
// successful insert into the Supabase waitlist table. This endpoint only
// sends the email — it never touches the waitlist table itself, and a
// failure here must never be reported to the user as a failed signup
// (the insert already succeeded).
//
// Required env var (Vercel project -> Settings -> Environment Variables,
// Production + Preview): RESEND_API_KEY, from the Resend dashboard.
//
// Optional: RESEND_FROM_EMAIL, e.g. "Sorted <hello@yourdomain.com>".
// Without a verified sending domain in Resend, mail can only go out from
// onboarding@resend.dev and can only be DELIVERED to the Resend account's
// own verified email — fine for testing this endpoint, not for real
// waitlist signups. Verify a domain in Resend, then set this.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const email = req.body && req.body.email;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Valid email required' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set');
    res.status(500).json({ error: 'Email service not configured' });
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL || 'Sorted <onboarding@resend.dev>';

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from,
        to: email,
        subject: "You're on the list — Sorted",
        html: WELCOME_EMAIL_HTML,
      }),
    });

    if (!resendRes.ok) {
      const text = await resendRes.text();
      console.error('Resend API error:', resendRes.status, text);
      res.status(502).json({ error: 'Email send failed' });
      return;
    }

    res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Resend request failed:', err);
    res.status(502).json({ error: 'Email send failed' });
  }
};

// Inline CSS throughout — email clients don't reliably support <style>
// blocks. Design tokens match HANDOFF.md §6 / index.html.
const WELCOME_EMAIL_HTML = `
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F4FAF8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">

    <div style="display:flex;align-items:center;gap:9px;margin-bottom:32px;">
      <div style="width:26px;height:26px;border-radius:8px;background:#C8FFF6;display:inline-block;vertical-align:middle;text-align:center;line-height:26px;color:#027A61;font-weight:700;font-size:14px;">&#10003;</div>
      <span style="font-family:Georgia,'Times New Roman',serif;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;font-size:17px;color:#0C1F1B;vertical-align:middle;">Sorted</span>
    </div>

    <div style="background:#FFFFFF;border:1px solid #E0E6E4;border-radius:20px;padding:36px 32px;">
      <p style="font-size:12.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#027A61;margin:0 0 12px;">You're on the list</p>
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#0C1F1B;margin:0 0 16px;">Thanks for signing up.</h1>
      <p style="font-size:15px;line-height:1.65;color:#3A4A47;margin:0 0 24px;">
        Sorted is an escrow-protected way to get real work done and get paid
        for it — money held in the middle until the work is verified done,
        no chasing, no guessing. We'll email you the moment we're ready for
        you.
      </p>

      <table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 4px;">
        <tr>
          <td style="padding:12px 0;border-top:1px solid #E0E6E4;font-size:14px;color:#0C1F1B;font-weight:600;">1. Post a gig</td>
        </tr>
        <tr>
          <td style="padding:0 0 12px;font-size:13.5px;color:#7E8F8D;">Describe the job and the criteria that define "done."</td>
        </tr>
        <tr>
          <td style="padding:12px 0;border-top:1px solid #E0E6E4;font-size:14px;color:#0C1F1B;font-weight:600;">2. Fund it in escrow</td>
        </tr>
        <tr>
          <td style="padding:0 0 12px;font-size:13.5px;color:#7E8F8D;">The bounty is held safely in the middle before work starts.</td>
        </tr>
        <tr>
          <td style="padding:12px 0;border-top:1px solid #E0E6E4;font-size:14px;color:#0C1F1B;font-weight:600;">3. Sign off, get paid</td>
        </tr>
        <tr>
          <td style="padding:0;font-size:13.5px;color:#7E8F8D;">Escrow releases automatically once the work is verified.</td>
        </tr>
      </table>
    </div>

    <p style="font-size:12px;color:#7E8F8D;text-align:center;margin:24px 0 0;">
      Consider it sorted.<br>
      You're getting this because you joined the Sorted waitlist.
    </p>
  </div>
</body>
</html>
`;
