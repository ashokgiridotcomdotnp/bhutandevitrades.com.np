function toTrimmedString(value) {
  return String(value || '').trim();
}

function sanitizeFromEmail(value) {
  var fromEmail = toTrimmedString(value);
  return fromEmail || 'onboarding@resend.dev';
}

function parseTimeoutMs(value, fallbackMs) {
  var parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallbackMs;
  }

  return Math.floor(parsedValue);
}

async function sendEmail(options) {
  var apiKey = toTrimmedString(process.env.RESEND_API_KEY);
  var fromEmail = sanitizeFromEmail(process.env.RESEND_FROM_EMAIL);
  var timeoutMs = parseTimeoutMs(process.env.RESEND_TIMEOUT_MS, 9000);
  var toEmail = toTrimmedString(options && options.to);
  var subject = toTrimmedString(options && options.subject);
  var html = String(options && options.html ? options.html : '');
  var text = String(options && options.text ? options.text : '');
  var response = null;
  var responseBody = null;
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timeoutId = null;

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
    if (controller) {
      timeoutId = setTimeout(function () {
        controller.abort();
      }, timeoutMs);
    }

    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      signal: controller ? controller.signal : undefined,
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
    if (
      error &&
      (
        error.name === 'AbortError' ||
        String(error.message || '').toLowerCase().indexOf('aborted') !== -1
      )
    ) {
      return {
        ok: false,
        errorCode: 'resend-timeout',
        details: 'Email request timed out after ' + timeoutMs + 'ms.',
      };
    }

    return {
      ok: false,
      errorCode: 'resend-network-error',
      details: error && error.message ? error.message : '',
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

module.exports = {
  sendEmail: sendEmail,
};
