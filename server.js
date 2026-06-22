/**
 * Missed-Call Text-Back — Twilio webhook server
 *
 * Flow:
 *   1. Someone calls your Twilio number  -> POST /voice
 *        We try to forward the call to your real phone (FORWARD_TO).
 *        We attach a statusCallback so Twilio tells us how the call ended.
 *   2. Twilio reports the call result    -> POST /status
 *        If the call was missed (no-answer / busy / failed / canceled) and the
 *        caller never spoke to a human, we send them an SMS.
 *
 * Set FORWARD_TO empty if you have no phone to forward to — then every call is
 * treated as "missed" and the caller always gets the text back (great for demos).
 */

const express = require("express");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ---- Config (from environment) ------------------------------------------------
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_NUMBER, // your Twilio number, E.164 e.g. +15551234567
  FORWARD_TO, // optional: your real phone to ring first, E.164
  BUSINESS_NAME = "Our Team",
  BOOKING_LINK = "https://cal.com/your-handle",
  PUBLIC_URL, // the public https base URL of THIS server (set after deploy)
  PORT = 3000,
} = process.env;

// Appointment-oriented text-back copy.
function textBackBody() {
  return (
    `Hi! Sorry we missed your call at ${BUSINESS_NAME}. ` +
    `We'd love to help — book a time that works for you here: ${BOOKING_LINK} ` +
    `Or just reply to this text and we'll get right back to you.`
  );
}

// Statuses that mean "the caller did not reach a human".
const MISSED_STATUSES = new Set([
  "no-answer",
  "busy",
  "failed",
  "canceled",
]);

// Twilio REST client (only needed to SEND the SMS). Falls back to a logger if
// credentials aren't set, so the simulator and local runs still work.
let client = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function sendTextBack(toNumber) {
  const body = textBackBody();
  if (!client || !TWILIO_NUMBER) {
    console.log(
      `[DRY RUN] Would SMS ${toNumber} from ${TWILIO_NUMBER || "<unset>"}:\n  "${body}"`
    );
    return { dryRun: true, to: toNumber, body };
  }
  const msg = await client.messages.create({
    to: toNumber,
    from: TWILIO_NUMBER,
    body,
  });
  console.log(`Sent text-back SMS ${msg.sid} to ${toNumber}`);
  return { sid: msg.sid, to: toNumber, body };
}

// ---- Voice webhook: Twilio hits this when the number is CALLED ----------------
app.post("/voice", (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const statusCallback = `${PUBLIC_URL || ""}/status`;

  if (FORWARD_TO) {
    const dial = twiml.dial({
      timeout: 15,
      action: "/dial-result",
      method: "POST",
    });
    dial.number(
      {
        statusCallbackEvent: ["completed", "no-answer", "busy", "failed"],
        statusCallback: statusCallback || undefined,
        statusCallbackMethod: "POST",
      },
      FORWARD_TO
    );
  } else {
    twiml.say(
      { voice: "alice" },
      `Thanks for calling ${BUSINESS_NAME}. We can't take your call right now, but we'll text you a link to book a time. Talk soon!`
    );
    twiml.hangup();
  }

  res.type("text/xml").send(twiml.toString());
});

app.post("/dial-result", async (req, res) => {
  const dialStatus = req.body.DialCallStatus;
  const caller = req.body.From;

  const twiml = new twilio.twiml.VoiceResponse();
  if (dialStatus && dialStatus !== "completed") {
    await sendTextBack(caller);
    twiml.say(
      { voice: "alice" },
      "Sorry we missed you. We just sent you a text with a link to book a time."
    );
  }
  twiml.hangup();
  res.type("text/xml").send(twiml.toString());
});

app.post("/status", async (req, res) => {
  const status = req.body.CallStatus || req.body.DialCallStatus;
  const caller = req.body.From;
  const direction = req.body.Direction;

  console.log(`Call status: ${status} (from ${caller}, ${direction})`);

  if (caller && MISSED_STATUSES.has(status)) {
    try {
      await sendTextBack(caller);
    } catch (err) {
      console.error("Failed to send text-back:", err.message);
    }
  }
  res.sendStatus(204);
});

app.get("/", (_req, res) => {
  res.send(
    `Missed-call text-back is running. Mode: ${
      FORWARD_TO ? "forward-then-textback" : "demo (always text back)"
    }. SMS: ${client ? "live" : "dry-run"}.`
  );
});

module.exports = { app, sendTextBack, textBackBody, MISSED_STATUSES };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Listening on :${PORT}`);
    console.log(`Mode: ${FORWARD_TO ? "forward-then-textback" : "demo (always text back)"}`);
    console.log(`SMS: ${client ? "LIVE (Twilio)" : "DRY-RUN (logs only)"}`);
  });
}
