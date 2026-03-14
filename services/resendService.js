import config from '../lib/config.js';
import logger from '../lib/logger.js';


function toTrimmedString(value) {
  return String(value || '').trim();
}

function sanitizeFromEmail(value) {
  let fromEmail = toTrimmedString(value);
  return fromEmail || 'onboarding@resend.dev';
}

function parseTimeoutMs(value, fallbackMs) {
  let parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallbackMs;
  }

  return Math.floor(parsedValue);
}

async function sendEmail(options) {
  let apiKey = config.resend.apiKey;
  let fromEmail = sanitizeFromEmail(config.resend.fromEmail);
  let timeoutMs = parseTimeoutMs(config.resend.timeoutMs, 9000);
  let toEmail = toTrimmedString(options && options.to);
  let subject = toTrimmedString(options && options.subject);
  let html = String(options && options.html ? options.html : '');
  let text = String(options && options.text ? options.text : '');
  let response = null;
  let responseBody = null;
  let controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId = null;

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
      logger.warn('Resend request failed', {
        status: response.status,
        errorCode: 'resend-request-failed',
      });
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
export default {
  sendEmail: sendEmail,
};
