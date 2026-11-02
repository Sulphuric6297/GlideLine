// A Claude Code hook (PreToolUse on Edit/Write): when a screen's code or a mockup is about to
// change, puts docs/DESIGN.md's rule in front of whoever is changing it.
let raw = "";
process.stdin.on("data", d => (raw += d));
process.stdin.on("end", () => {
  let path = "";
  try { path = JSON.parse(raw)?.tool_input?.file_path ?? ""; } catch { /* (not JSON: nothing to say) */ }
  if (!/(src[\\/](components|auth)[\\/]|src[\\/]index\.css|[\\/]mockups[\\/])/.test(path)) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        "Design rule (docs/DESIGN.md in the GlideLine repo): each platform matches the GUI of everything else on that platform. " +
        "A computer's version uses the computer's parts (side panel sections and fields, the toolbar, the map's floating buttons); a phone's uses the phone's (the glass bar, the steps, the panel out of its tab). " +
        "Never put the phone's sliding row on a computer or a tall panel on a phone. Before showing or building, answer for the phone AND the computer: best for the design language and goal? clearer, could it hurt anyone? which existing parts? everything visible and reachable, nothing cut off? grouped the way someone looks? standard labels? " +
        "Then check both in the browser with real taps and clicks."
    }
  }));
});
