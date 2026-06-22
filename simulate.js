/**
 * Local simulator — proves the missed-call -> text-back flow without Twilio.
 *
 * It boots the real server in-process, then POSTs a fake Twilio "call status"
 * webhook payload (status = no-answer) at /status, exactly like Twilio would.
 * With no Twilio credentials set, the SMS send runs in DRY-RUN and logs the
 * exact message that WOULD be texted to the caller.
 *
 * Run:  node simulate.js
 */

const { app } = require("./server");

const CALLER = process.env.SIM_CALLER || "+15558675309";

const server = app.listen(0, async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  console.log(`\n=== Simulating a missed call from ${CALLER} ===\n`);

  const form = new URLSearchParams({
    CallSid: "CAsimulated0000000000000000000000",
    From: CALLER,
    To: process.env.TWILIO_NUMBER || "+15550000000",
    CallStatus: "no-answer",
    Direction: "inbound",
  });

  const resp = await fetch(`${base}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  console.log(`\n/status responded ${resp.status} (expected 204)\n`);
  console.log("=== Done. The line above starting with [DRY RUN] is the SMS that would be sent. ===\n");

  server.close();
});
