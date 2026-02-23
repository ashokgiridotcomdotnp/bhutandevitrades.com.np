function toTrimmedString(value) {
  return String(value || '').trim();
}

function sanitizeFromEmail(value) {
  var fromEmail = toTrimmedString(value);
  return fromEmail || 'onboarding@resend.dev';
}

async function sendEmail(options) {
  var apiKey = toTrimmedString(process.env.RESEND_API_KEY);
  var fromEmail = sanitizeFromEmail(process.env.RESEND_FROM_EMAIL);
  var toEmail = toTrimmedString(options && options.to);
  var subject = toTrimmedString(options && options.subject);
  var html = String(options && options.html ? options.html : '');
  var text = String(options && options.text ? options.text : '');
  var response = null;
  var responseBody = null;

  if (!apiKey) {
    return {
      ok: false,
      errorCode: 'resend-not-configured',
    };
  }

  if (!toEmail || !subject) {
    return {
      ok: false,
      errorCode: 'invalid-email-params',
    };
  }

  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: subject,
        html: html,
        text: text,
      }),
    });

    responseBody = await response.json().catch(function () {
      return null;
    });

    if (!response.ok) {
      return {
        ok: false,
        errorCode: 'resend-request-failed',
        status: response.status,
        details: responseBody,
      };
    }

    return {
      ok: true,
      id: responseBody && responseBody.id ? responseBody.id : '',
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: 'resend-network-error',
      details: error && error.message ? error.message : '',
    };
  }
}

module.exports = {
  sendEmail: sendEmail,
};
